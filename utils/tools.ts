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

      // Use Tavily to get real search results
      try {
        const tavilyResults = await tavilyTool.invoke(query);
        console.log("[FLOW] Received Tavily search results");
        const tavileParsedResults = JSON.parse(tavilyResults?.content);

        // Get URLs for attribution and potential scraping
        console.log(tavileParsedResults);
        const sources = tavileParsedResults
          .slice(0, 2) // Increase to top 3 sources for more options
          .map((result: { url?: string; title?: string }) => ({
            url: result.url || "https://example.com",
            title: result.title || "No title available",
          }));

        // Extract specific location information from Tavily results
        let specificPlaces: string[] = [];
        for (const result of tavileParsedResults) {
          if (result.content && typeof result.content === "string") {
            // Look for location names in the content
            const locationMatches = result.content.match(
              /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*(?:\s(?:Islands?|Mountains?|National\s+Park|Beach|City|Temple|Palace|Monument|Resort))?)\b/g
            );
            if (locationMatches) {
              specificPlaces = [...specificPlaces, ...locationMatches];
            }
          }
        }

        // Filter out common words that aren't locations
        specificPlaces = specificPlaces.filter(
          (place) =>
            ![
              "The",
              "This",
              "That",
              "These",
              "Those",
              "There",
              "Here",
              "One",
              "Many",
              "Some",
              "Any",
              "All",
              "Most",
              "More",
              "Less",
              "Best",
              "Worst",
              "First",
              "Last",
              "Next",
              "Previous",
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
        );

        // Remove duplicates and limit to 5 places
        specificPlaces = [...new Set(specificPlaces)].slice(0, 5);

        // Create descriptive elements for each place based on available information
        let placeDescriptions: string[] = [];
        specificPlaces.forEach((place, index) => {
          // Find content related to this place in Tavily results
          let relatedContent = "";
          for (const result of tavileParsedResults) {
            if (
              result.content &&
              typeof result.content === "string" &&
              result.content.includes(place)
            ) {
              const sentences = result.content.match(
                new RegExp(`[^.!?]*?${place}[^.!?]*[.!?]`, "g")
              );
              if (sentences && sentences.length > 0) {
                relatedContent = sentences[0].trim();
                break;
              }
            }
          }

          // Create description for the place
          if (relatedContent) {
            placeDescriptions.push(`**${place}**: ${relatedContent}`);
          } else {
            // Generic descriptions if specific info not found
            const genericDescriptions = [
              `a popular destination known for its unique attractions and cultural experiences`,
              `an amazing place with beautiful sights and local experiences`,
              `a must-visit location with numerous activities and points of interest`,
              `a remarkable destination showcasing the region's heritage and natural beauty`,
              `a fascinating place offering unique experiences and stunning scenery`,
              `a wonderful destination with rich cultural significance and beautiful landscapes`,
              `a charming location with distinctive character and local attractions`,
              `an exciting destination with diverse activities and interesting sights`,
            ];
            placeDescriptions.push(
              `**${place}**: ${
                genericDescriptions[index % genericDescriptions.length]
              }.`
            );
          }
        });

        // If not enough specific places were found, add generic categories
        if (placeDescriptions.length < 8) {
          const genericCategories = [
            "**Popular Cities**: Major urban centers with unique architecture, museums, historical sites, and vibrant local culture.",
            "**Natural Wonders**: Breathtaking landscapes including mountains, beaches, forests, and national parks.",
            "**Historical Sites**: Ancient temples, colonial buildings, museums, and cultural landmarks.",
            "**Local Experiences**: Immerse yourself in local culture through food tours, traditional performances, and markets.",
            "**Outdoor Activities**: Hiking, water sports, wildlife watching, and adventure activities.",
            "**Culinary Highlights**: Regional specialties, street food, and local delicacies.",
            "**Hidden Gems**: Off-the-beaten-path locations away from typical tourist crowds.",
            "**Practical Tips**: Consider visiting during the dry season and respect local customs during your travels.",
          ];

          // Add generic categories until we have 8 items
          while (placeDescriptions.length < 8) {
            placeDescriptions.push(genericCategories[placeDescriptions.length]);
          }
        }

        // Format the response with numbered points
        let response = `Here are the top places to visit in ${destination}:\n\n`;
        placeDescriptions.forEach((description, index) => {
          response += `${index + 1}. ${description}\n\n`;
        });

        // Add source URLs with titles in a format that encourages scraping
        response += `For more detailed information, you can explore these sources:\n\n`;
        sources.forEach(
          (source: { url: string; title: string }, index: number) => {
            response += `[${index + 1}] ${source.title}: ${source.url}\n`;
          }
        );

        // Add a hint about scraping for more details
        response += `\nYou can use the scrapeWebsite tool on these URLs to get more specific details about attractions, activities, and travel tips.`;

        return response;
      } catch (error) {
        console.error("[FLOW] Tavily search error:", error);

        // Fallback to generic data if Tavily fails
        return `Here are the top places to visit in ${destination || query}:

1. **Popular Cities**: Major urban centers with unique architecture, museums, historical sites, and vibrant local culture.

2. **Natural Wonders**: Breathtaking landscapes including mountains, beaches, forests, and national parks.

3. **Historical Sites**: Ancient temples, colonial buildings, museums, and cultural landmarks that showcase the region's rich history.

4. **Local Experiences**: Immerse yourself in local culture through food tours, traditional performances, markets, and community-based tourism.

5. **Outdoor Activities**: Hiking, water sports, wildlife watching, and adventure activities suited to the local geography.

6. **Culinary Highlights**: Regional specialties, street food, and local delicacies that define the destination's cuisine.

7. **Hidden Gems**: Off-the-beaten-path locations away from typical tourist crowds for a more authentic experience.

8. **Practical Tips**: Consider visiting during the dry season, use local transportation options, and respect cultural customs during your travels.

Based on web search results (search engine temporarily unavailable, using general travel information).

Note: For more specific information, consider trying another search query or asking about specific aspects of the destination.`;
      }
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
      // Fetch the website content
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      });

      if (!response.ok) {
        return `Error: Failed to fetch the website. Status: ${response.status}`;
      }

      const text = await response.text();

      // Truncate and clean the content
      let content = text.slice(0, 30000); // Smaller size to avoid model issues

      // Extract just the main content by focusing on paragraph text
      const paragraphRegex = /<p[^>]*>(.*?)<\/p>/gs;
      const headingRegex = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/gs;

      let extractedText = "";
      let paragraphMatches = [...content.matchAll(paragraphRegex)];
      let headingMatches = [...content.matchAll(headingRegex)];

      // Combine headings and paragraphs
      const combined = [...headingMatches, ...paragraphMatches].sort((a, b) => {
        return content.indexOf(a[0]) - content.indexOf(b[0]);
      });

      // Extract text from matches
      combined.forEach((match) => {
        const text = match[1].replace(/<[^>]*>/g, "").trim();
        if (text) {
          extractedText += text + "\n\n";
        }
      });

      // If we couldn't extract text effectively, use a simple text extraction
      if (extractedText.length < 100) {
        extractedText = content
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
          .replace(/<[^>]*>/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 8000);
      }

      // Use a simpler prompt for Groq model to avoid JSON parsing issues
      const simplifiedPrompt = `
        You are analyzing travel website content to extract useful information for a tourist.
        Website URL: ${url}

        Extract the key travel information from this content. Focus on:
        1. Tourist attractions and landmarks
        2. Popular places to visit
        3. Travel tips and recommendations

        Website content:
        ${extractedText.slice(0, 8000)}

        Provide a concise summary of the travel information from this website.

        Also mention the url (comma separated) at the end of the reponse like this :
        1. {url1}
        2. {url2}
`;

      // Use the model with streaming disabled to avoid chunk parsing issues
      const model = await loadChatModel(configuration.queryModel, {
        streaming: false,
      });

      // Call the model with the simplified prompt
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
    } catch (error: unknown) {
      console.error("[FLOW] Error in scrape tool:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `Error scraping website: ${errorMessage}. Please try a different URL or search tool.`;
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
