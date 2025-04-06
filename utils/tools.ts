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
        // Get URLs for attribution
        const sources = tavileParsedResults
          .slice(0, 3)
          .map(
            (result: { url?: string }) => result.url || "https://example.com"
          );

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

        // Add source attribution
        response += `Based on web search results from:\n`;
        sources.forEach((source: string) => {
          response += `- ${source}\n`;
        });

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

Based on web search results (search engine temporarily unavailable, using general travel information).`;
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
    console.log("[FLOW] scrape toool called for url: ", url);
    const response = await fetch(url);
    const text = response.text();
    const truncatedContent = (await text).slice(0, 50000);
    const p = INFO_PROMPT.replace(
      "{info}",
      JSON.stringify(state?.extractionSchema, null, 2)
    )
      .replace("{url}", url)
      .replace("{content}", truncatedContent);
    const model = loadChatModel(configuration.queryModel);
    const content = (await model).invoke(p);
    return getTextContent((await content).content);
  }
  const scraperTool = tool(scrapeWebsite, {
    name: "scrapeWebsite",
    description: "Scrape content from a given website URL",
    schema: z.object({
      url: z.string().url().describe("The URL of the website to scrape"),
    }),
  });

  return [searchTool, scraperTool];
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
