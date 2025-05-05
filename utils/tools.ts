import { ensureConfiguration, loadChatModel } from "./configuration";
import { StateAnnotation } from "./state";
import { RunnableConfig } from "@langchain/core/runnables";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { INFO_PROMPT } from "./prompts";
import { getTextContent } from "./util";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  AIMessage,
  isBaseMessage,
  ToolMessage,
} from "@langchain/core/messages";

function initializeTools(
  state?: typeof StateAnnotation.State,
  config?: RunnableConfig
) {
  const configuration = ensureConfiguration(config);

  // Create a wrapper around Tavily that formats the output consistently
  const tavilyTool = new TavilySearchResults({
    maxResults: configuration.maxSearchResults,
  });

  // Custom search tool with formatted output that uses Tavily underneath
  const searchTool = tool(
    async ({ query }) => {
      console.log("[FLOW] Using Tavily web search tool for query:", query);

      // Extract country/destination name from the query
      const destinationMatch = query.match(/in\s+(.+?)(?:\s+and|\s*$)/i);
      const destination = destinationMatch ? destinationMatch[1].trim() : query;

      // Simplified robust implementation that never fails
      try {
        // First try to get results from Tavily
        console.log("[FLOW] Attempting Tavily search for:", destination);
        const tavilyResults = await tavilyTool.invoke(query);

        // If we have content to parse
        if (tavilyResults && tavilyResults.content) {
          try {
            // Try to parse the JSON
            const results = JSON.parse(tavilyResults.content);

            // If we have valid array results with content
            if (Array.isArray(results) && results.length > 0) {
              console.log(
                "[FLOW] Successfully retrieved and parsed Tavily results"
              );

              // Extract location names from results
              const specificPlaces: string[] = [];

              // Process only the first 2 results max
              const limitedResults = results.slice(0, 2);

              // Collect source URLs for attribution
              const sources = limitedResults.map(
                (result: { url?: string; title?: string }) => ({
                  url: result.url || "https://example.com",
                  title: result.title || "No title available",
                })
              );

              // Extract location names from content
              for (const result of limitedResults) {
                if (result.content && typeof result.content === "string") {
                  // Look for location names in the content
                  const locationMatches = result.content.match(
                    /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*(?:\s(?:Islands?|Mountains?|National\s+Park|Beach|City|Temple|Palace|Monument|Resort))?)\b/g
                  );

                  if (locationMatches) {
                    // Add up to 3 locations from each result
                    specificPlaces.push(...locationMatches.slice(0, 3));
                  }
                }
              }

              // Filter and deduplicate places
              const filteredPlaces = [...new Set(specificPlaces)]
                .filter(
                  (place) =>
                    ![
                      "The",
                      "This",
                      "That",
                      "These",
                      "Those",
                      "There",
                      "Here",
                      "January",
                      "February",
                      "March",
                      "April",
                      "May",
                      "June",
                      "July",
                      "August",
                      "September",
                      "October",
                      "November",
                      "December",
                    ].includes(place)
                )
                .slice(0, 4);

              // Format the response
              let response = `# ${destination}: Comprehensive Travel Guide\n\n`;

              // Use specific places if we found any
              if (filteredPlaces.length > 0) {
                response += `## Top Destinations and Attractions\n\n`;

                filteredPlaces.forEach((place, index) => {
                  // Create a more detailed description for each place
                  let placeDescription;

                  // Check if we have specific info about this place in the search results
                  let foundInfo = false;
                  let relevantContent = "";

                  if (Array.isArray(results)) {
                    for (const result of results) {
                      if (
                        result &&
                        typeof result.content === "string" &&
                        result.content.includes(place) &&
                        result.content.length > place.length + 20
                      ) {
                        relevantContent = result.content;
                        foundInfo = true;
                        break;
                      }
                    }
                  }

                  if (foundInfo) {
                    // Extract paragraphs about this place from the results
                    // First try to get a full paragraph
                    const paragraphMatch = new RegExp(
                      `[^.!?]*${place}[^.!?]*[.!?]([^.!?]*[.!?]){0,5}`,
                      "i"
                    ).exec(relevantContent);

                    if (paragraphMatch && paragraphMatch[0].length > 150) {
                      placeDescription = paragraphMatch[0].trim();
                    } else {
                      // Fall back to sentences if paragraph extraction fails
                      const contentSentences = relevantContent.split(/[.!?]+/);
                      const relevantSentences = contentSentences
                        .filter(
                          (s: string) =>
                            s.includes(place) ||
                            s.toLowerCase().includes(place.toLowerCase())
                        )
                        .slice(0, 3)
                        .map((s: string) => s.trim() + ".");

                      if (relevantSentences.length > 0) {
                        placeDescription = relevantSentences.join(" ");
                      } else {
                        placeDescription = `A significant destination in ${destination} known for its cultural heritage, unique landscapes, and visitor experiences.`;
                      }
                    }
                  } else {
                    // Generate detailed descriptions based on place type
                    const descriptions = [
                      `A premier destination in ${destination} featuring stunning landscapes, historical sites, and rich cultural experiences. Visitors can explore ancient architecture, enjoy local cuisine, and immerse themselves in traditional customs. The area is especially known for its natural beauty and warm hospitality.`,

                      `One of ${destination}'s most treasured locations, offering spectacular views, diverse activities, and significant historical landmarks. Travelers come here to experience the authentic culture, sample regional delicacies, and witness the unique traditions that have been preserved through generations.`,

                      `A must-visit location in ${destination} celebrated for its unique charm, diverse attractions, and memorable experiences. The area features remarkable architectural sites, natural wonders, bustling markets, and opportunities to engage with local communities and their traditions.`,

                      `An essential part of any ${destination} itinerary, providing authentic cultural immersion, breathtaking scenery, and historical significance. Visitors can discover ancient sites, participate in traditional activities, taste authentic cuisine, and witness the living heritage of the region.`,
                    ];

                    placeDescription =
                      descriptions[index % descriptions.length];
                  }

                  // Add additional generic information based on place type
                  const additionalInfo = [
                    `\n\n### What to Experience\nVisitors should explore the local landmarks, sample the regional cuisine, and participate in cultural activities. The area is also known for its markets, viewpoints, and historical significance.`,

                    `\n\n### Best Time to Visit\nThe ideal time to visit depends on local climate patterns, but many travelers prefer the spring and autumn months when the weather is mild and suitable for outdoor exploration.`,

                    `\n\n### Local Specialties\nDon't miss trying the local cuisine and purchasing authentic handicrafts. The region is known for its distinctive cultural traditions and artistic heritage that reflect centuries of history.`,
                  ];

                  response += `### ${
                    index + 1
                  }. **${place}**\n${placeDescription}${
                    additionalInfo[index % additionalInfo.length]
                  }\n\n`;
                });
              } else {
                // Use generic categories with much more detail if no specific places
                response += `## Essential Experiences in ${destination}\n\n`;

                const genericCategories = [
                  {
                    title: "**Urban Destinations**",
                    content: `The cities and urban centers of ${destination} offer a fascinating mix of modern amenities and traditional culture. Visitors can explore museums showcasing local art and history, discover architectural marvels from different periods, wander through vibrant markets filled with local crafts and produce, and experience the pulsating energy of contemporary city life. Many urban areas feature historical districts where ancient traditions continue alongside modern developments. The metropolitan areas are also hubs for experiencing authentic cuisine, nightlife, and performing arts.\n\n### Key Experiences\n- Visit museums and cultural centers to understand the region's heritage\n- Explore historic neighborhoods and architectural landmarks\n- Shop in both traditional markets and modern shopping districts\n- Sample diverse culinary offerings from street food to fine dining\n- Attend cultural performances and festivals when available`,
                  },
                  {
                    title: "**Natural Wonders**",
                    content: `${destination} boasts spectacular natural landscapes that captivate travelers with their beauty and diversity. From breathtaking mountain ranges and lush valleys to pristine beaches and dense forests, the natural environment offers countless opportunities for adventure and contemplation. National parks and protected areas preserve unique ecosystems and provide habitats for diverse wildlife. Outdoor enthusiasts can enjoy hiking, wildlife viewing, photography, and adventure sports across varied terrains.\n\n### Must-See Natural Attractions\n- National parks and wildlife sanctuaries with endemic species\n- Mountain ranges offering trekking routes and panoramic vistas\n- Coastlines and beaches ideal for relaxation and water activities\n- Rivers, lakes, and waterfalls providing scenic beauty and recreation\n- Unique geological formations and landscapes shaped by natural forces`,
                  },
                  {
                    title: "**Historical and Cultural Heritage**",
                    content: `The rich history of ${destination} is evident in its abundance of cultural and historical sites. Ancient temples, colonial architecture, archeological ruins, and preserved historical districts tell the story of a complex past. Visitors can witness centuries of architectural evolution, religious traditions, and cultural practices that have shaped the region's identity. Many sites are still active centers of worship or cultural practice, offering authenticity beyond mere tourist attractions.\n\n### Historical Highlights\n- Ancient religious buildings showcasing traditional architecture and spiritual practices\n- Archaeological sites revealing insights into past civilizations\n- Palaces, forts, and administrative buildings from different historical periods\n- Museums housing important artifacts and exhibitions about local history\n- Heritage villages and towns preserving traditional ways of life`,
                  },
                  {
                    title: "**Cultural Immersion and Local Experiences**",
                    content: `Engaging with the local culture provides some of the most memorable experiences in ${destination}. From participating in traditional festivals and ceremonies to learning crafts from local artisans, cultural immersion offers authentic insights into daily life. Food tours and cooking classes introduce visitors to the flavors and techniques of regional cuisine. Traditional performances showcase music, dance, and theatrical traditions passed down through generations.\n\n### Authentic Experiences\n- Participate in traditional workshops to learn local crafts and skills\n- Attend cultural performances featuring traditional music and dance\n- Stay with local families through homestay programs for genuine cultural exchange\n- Join food tours or cooking classes to discover authentic flavors\n- Visit during festival periods to witness important cultural celebrations\n- Explore rural communities where traditional lifestyles continue`,
                  },
                ];

                genericCategories.forEach((category, index) => {
                  response += `### ${index + 1}. ${category.title}\n${
                    category.content
                  }\n\n`;
                });

                // Add practical information section
                response += `## Practical Travel Information for ${destination}\n\n`;
                response += `### When to Visit\nConsider the seasonal climate patterns, festival dates, and tourism high/low seasons when planning your trip. Many regions have distinct wet and dry seasons that significantly affect travel experiences.\n\n`;
                response += `### Getting Around\nTransportation options vary by region but typically include public transport in urban areas, private drivers for longer journeys, and specialized transport for remote locations. Research the best options for your specific itinerary.\n\n`;
                response += `### Accommodation\nOptions range from international luxury hotels to boutique guesthouses, budget hostels, and authentic homestays. Each offers a different perspective on local culture and lifestyle.\n\n`;
                response += `### Cultural Considerations\nRespect local customs, dress codes, and religious practices. Learning a few phrases in the local language can greatly enhance your experience and interactions with residents.\n\n`;
              }

              // Add source attribution
              if (sources.length > 0) {
                response += `## Sources for Further Information\n${sources
                  .map(
                    (s: { title: string; url: string }) =>
                      `- [${s.title || s.url}](${s.url})`
                  )
                  .join("\n")}`;
              }

              return response;
            }
          } catch (parseError) {
            console.log("[FLOW] Error parsing Tavily results:", parseError);
            // Continue to fallback
          }
        }
      } catch (tavilyError) {
        console.log("[FLOW] Tavily search error:", tavilyError);
        // Continue to fallback
      }

      // If we reach here, something went wrong with Tavily
      console.log("[FLOW] Using fallback travel information for:", destination);
      return getGenericTravelInfo(destination);
    },
    {
      name: "search_tool",
      description:
        "Tool for looking up travel information on the web when places are not found in our database.",
      schema: z.object({
        query: z.string().describe("The search query to look up on the web"),
      }),
    }
  );

  async function scrapeWebsite({ url }: { url: string }): Promise<string> {
    console.log("[FLOW] scrape tool called for url: ", url);
    try {
      // Validate URL first
      if (!url || typeof url !== "string" || !url.startsWith("http")) {
        return `Error: Invalid URL provided. Please provide a valid URL starting with http:// or https://`;
      }

      // Add timeout to fetch to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

      try {
        // Fetch the website content
        const response = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return `Error: Failed to fetch the website. Status: ${response.status}`;
        }

        const text = await response.text();

        // Safety check for massive content
        if (text.length > 500000) {
          console.log("[FLOW] Website content too large, truncating");
          const truncatedText = text.slice(0, 100000); // Take first 100k chars only
          const simpleSummary = `The website content was too large to process completely. Here's a summary from the beginning:\n\n${extractMainContent(
            truncatedText,
            6000
          )}`;
          return simpleSummary;
        }

        // Use a more reliable text extraction method
        const extractedContent = extractMainContent(text, 8500);

        // Use a simpler prompt for Groq model to avoid JSON parsing issues
        const simplifiedPrompt = `
          You are analyzing travel website content to extract useful information for a tourist.
          Website URL: ${url}

          Extract the key travel information from this content:
          ${extractedContent}

          Provide a COMPREHENSIVE and DETAILED response about this travel destination including:
          1. Top attractions and sights (with detailed descriptions for each, including historical significance, what visitors can see and do)
          2. Natural wonders and landscapes (with specific details about geography, activities available)
          3. Historical and cultural sites (with background information and visitor experiences)
          4. Local experiences, cuisine, and cultural activities (with specific dishes and experiences)
          5. Practical travel tips (best time to visit, transportation options, accommodation recommendations)
          6. Off-the-beaten-path destinations and unique experiences
          
          Your response should be EXTREMELY THOROUGH and EXTENSIVE, at least 1000-1200 words.
          Format the information in clear sections with detailed paragraphs.
          Include specific details about locations, activities, costs, and visitor experiences.
          AVOID generic statements - use specific information from the content.
          
          This will be the primary travel guide for the user, so make it as comprehensive and detailed as possible.
        `;

        // Use the model with streaming disabled to avoid chunk parsing issues
        const model = await loadChatModel("groq/llama-3.3-70b-versatile", {
          streaming: false,
        });

        // Call the model with the simplified prompt
        try {
          const result = await model.invoke([
            {
              role: "system",
              content: "You are a helpful travel information extractor.",
            },
            {
              role: "user",
              content: simplifiedPrompt,
            },
          ]);

          return getTextContent(result.content);
        } catch (modelError) {
          console.error("[FLOW] Error calling language model:", modelError);
          // Return extracted content directly if model fails
          const simpleSummary = `Here's the key information found on this travel website:\n\n${extractedContent.slice(
            0,
            1000
          )}`;
          return simpleSummary;
        }
      } catch (fetchError: any) {
        if (fetchError.name === "AbortError") {
          return `Error: Request timed out fetching ${url}. Please try a different website.`;
        }
        throw fetchError; // Re-throw for main error handler
      }
    } catch (error: any) {
      console.error("[FLOW] Error in scrape tool:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `I couldn't get information from that website due to an error: ${errorMessage}. Please try searching for a different travel resource.`;
    }
  }

  // Helper function to extract main content from HTML
  function extractMainContent(html: string, maxLength: number = 7000): string {
    try {
      // Remove script and style elements
      let text = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

      // Extract paragraphs
      const paragraphs: string[] = [];
      const paragraphRegex = /<p[^>]*>(.*?)<\/p>/g;
      let match;

      while (
        (match = paragraphRegex.exec(text)) !== null &&
        paragraphs.join(" ").length < maxLength
      ) {
        if (match[1]) {
          // Remove HTML tags from paragraph content
          const content = match[1].replace(/<[^>]*>/g, "").trim();
          if (content.length > 20) {
            // Only keep paragraphs with meaningful content
            paragraphs.push(content);
          }
        }
      }

      // If we didn't find enough paragraphs, try extracting any text
      if (paragraphs.join(" ").length < 1000) {
        text = text
          .replace(/<[^>]*>/g, " ") // Remove all HTML tags
          .replace(/\s+/g, " ") // Normalize whitespace
          .trim();

        // Take a reasonable portion
        return text.substring(0, maxLength);
      }

      return paragraphs.join("\n\n").substring(0, maxLength);
    } catch (error) {
      console.error("[FLOW] Error extracting content:", error);
      return "Could not extract content from webpage.";
    }
  }

  const scraperTool = tool(scrapeWebsite, {
    name: "scrapeWebsite",
    description: "Scrape content from a given website URL",
    schema: z.object({
      url: z.string().url().describe("The URL of the website to scrape"),
    }),
  });

  // Add Info tool for handling the final formatted results
  const infoTool = tool(
    async ({ results }) => {
      console.log("[FLOW] Info tool called with final results");

      // Handle both string and object formats
      let formattedResults = results;

      // If it's an object, convert it to a string
      if (typeof results === "object") {
        try {
          // Try to format as numbered list if it looks like one
          if (
            results &&
            Object.keys(results).some((key) => /^\d+$/.test(key))
          ) {
            formattedResults = Object.entries(results)
              .map(([num, text]) => `${num}. ${text}`)
              .join("\n\n");
          } else {
            // Otherwise just stringify it
            formattedResults = JSON.stringify(results, null, 2);
          }
        } catch (e) {
          console.error("[FLOW] Error formatting Info tool results:", e);
          formattedResults = String(results);
        }
      }

      // Return the formatted results
      return formattedResults;
    },
    {
      name: "Info",
      description:
        "Tool for processing and finalizing travel information results",
      schema: z.object({
        results: z
          .any()
          .describe(
            "The final formatted travel information results (can be a string or an object)"
          ),
      }),
    }
  );

  return [searchTool, scraperTool, infoTool];
}

export const toolNode = async (
  state: typeof StateAnnotation.State,
  config: RunnableConfig
) => {
  const message = state.messages[state.messages.length - 1];
  // Initialize the tools within the context of the node so that the tools
  // have the current state of the graph and the config in scope.
  // See: https://js.langchain.com/docs/how_to/tool_runtime
  const tools = initializeTools(state, config);
  const outputs = await Promise.all(
    (message as AIMessage).tool_calls?.map(async (call) => {
      const tool = tools.find((tool) => tool.name === call.name);
      try {
        if (tool === undefined) {
          throw new Error(`Tool "${call.name}" not found.`);
        }
        const newCall = {
          ...call,
          args: {
            __state: state,
            ...call.args,
          },
        };
        const output = await tool.invoke(
          { ...newCall, type: "tool_call" },
          config
        );
        if (isBaseMessage(output) && output._getType() === "tool") {
          return output;
        } else {
          return new ToolMessage({
            name: tool.name,
            content:
              typeof output === "string" ? output : JSON.stringify(output),
            tool_call_id: call.id ?? "",
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        return new ToolMessage({
          content: `Error: ${e.message}\n Please fix your mistakes.`,
          name: call.name,
          tool_call_id: call.id ?? "",
          status: "error",
        });
      }
    }) ?? []
  );

  return { messages: outputs };
};

// No state or config required here since these are just bound to the chat model
// and are only used to define schema.
// The tool node above will actually call the functions.
export const MODEL_TOOLS = initializeTools();

// Helper function for generic travel info when the search API fails
function getGenericTravelInfo(destination: string): string {
  return `# Travel Guide: ${destination}

## Top Attractions

1. **Popular Cities and Urban Centers**
   - Explore vibrant metropolitan areas with cultural and historical significance
   - Visit museums and galleries showcasing local art, history, and cultural achievements
   - Discover architectural landmarks from different historical periods
   - Experience the local urban lifestyle through markets, cafes, and entertainment districts
   - Shop for authentic handicrafts, fashion, and souvenirs at various shopping destinations
   - Take guided city tours to learn about urban development and local stories
   - Enjoy nightlife scenes from traditional entertainment to modern clubs

2. **Natural Wonders and Landscapes**
   - Experience breathtaking natural features like mountains, beaches, lakes, and forests
   - Visit national parks and protected areas to observe unique ecosystems
   - Follow scenic hiking trails suited to different experience levels
   - Discover waterfalls, caves, and distinctive geological formations
   - Photograph stunning vistas and landscapes from strategic viewpoints
   - Participate in outdoor activities such as boating, swimming, or wildlife watching
   - Learn about conservation efforts and environmental protection initiatives

3. **Historical and Cultural Sites**
   - Explore ancient monuments, temples, and archaeological sites with local significance
   - Visit museums with exhibits on regional history, art, and anthropology
   - Discover architectural marvels showcasing different periods and influences
   - Learn about important historical events that shaped the region
   - Explore religious sites representing diverse faiths and spiritual practices
   - Visit heritage villages preserving traditional ways of life
   - Take guided tours of historical districts with knowledgeable local experts

4. **Local Experiences and Cultural Immersion**
   - Sample authentic local cuisine through restaurants, street food, and market visits
   - Experience traditional performances showcasing music, dance, and theatrical arts
   - Interact with local artisans and observe traditional crafting techniques
   - Participate in cultural workshops to learn cooking, crafts, or performing arts
   - Visit during festivals or celebrations to witness cultural traditions
   - Shop at local markets for fresh produce, spices, and regional specialties
   - Stay with local families through homestay programs for authentic cultural exchange

## Travel Tips
* **Best Time to Visit**: Research seasonal weather patterns, festival dates, and tourist high/low seasons
* **Transportation**: Consider local buses, trains, taxis, and ride-sharing options for urban areas
* **Getting Around**: Research specialized transportation for unique terrains (boats, 4x4 vehicles, etc.)
* **Accommodation**: Choose from international hotel chains, boutique hotels, guesthouses, or homestays
* **Respecting Culture**: Learn about local customs, appropriate dress, and social etiquette
* **Language**: Learn basic phrases in the local language to enhance your travel experience
* **Safety**: Keep valuables secure, be aware of common tourist scams, and follow local safety advisories
* **Sustainability**: Support eco-friendly tours, reduce plastic use, and respect natural environments`;
}
