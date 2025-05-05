import { Annotation, StateGraph } from "@langchain/langgraph";

import { MongoClient } from "mongodb";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  ToolMessage,
} from "@langchain/core/messages";

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { RunnableConfig } from "@langchain/core/runnables";
import { formatDocs, getMessageText, InfoIsSatisfactory } from "./utils/util";
import {
  ConfigurationAnnotation,
  ensureConfiguration,
  loadChatModel,
} from "./utils/configuration";
import { makeRetriever } from "./utils/retrieval";
import {
  StateAnnotation as GraphState,
  InputStateAnnotation,
  StateAnnotation,
} from "./utils/state";
import { MODEL_TOOLS, toolNode } from "./utils/tools";
import {
  MAIN_PROMPT,
  QUERY_SYSTEM_PROMPT_TEMPLATE,
  RESPONSE_SYSTEM_PROMPT_TEMPLATE,
} from "./utils/prompts";
import "dotenv/config";
import { responseFallbackTemplate } from "./utils/templates";

export type AnyRecord = Record<string, any>;

let app: any;

const client = new MongoClient(process.env.MONGODB_ATLAS_URI as string);

/**
 * Extracts a clean location query from user input by removing phrases like "I am thinking to"
 * and focusing on the actual destination.
 * @param input The raw user input string
 * @returns A cleaned query focusing on the location
 */
function extractLocationQuery(input: string): string {
  // Remove common prefixes that cause issues
  const cleanInput = input
    .replace(/^i am thinking to (visit|go to|travel to)/i, "")
    .replace(/^i want to (visit|go to|travel to)/i, "")
    .replace(/^i('m| am) planning to (visit|go to|travel to)/i, "")
    .replace(/^tell me about/i, "")
    .replace(
      /^what are the best places to (visit|see) in/i,
      "places to visit in"
    );

  // Extract location using regex patterns
  const locationPatterns = [
    /(?:in|to)\s+([A-Za-z\s,]+)(?:\s|$)/i, // "in Malaysia" or "to Malaysia"
    /([A-Za-z\s,]+)\s+(?:travel|visit|tourism)/i, // "Malaysia travel"
    /([A-Za-z\s,]+)/i, // Just extract whatever is left as fallback
  ];

  for (const pattern of locationPatterns) {
    const match = cleanInput.match(pattern);
    if (match && match[1]) {
      const location = match[1].trim();
      // If location is substantial (not just a short word), return with prefix
      if (location.length > 2) {
        return `Places to visit in ${location}`;
      }
    }
  }

  // Fallback to a cleaned version of original input
  return `Tourism information for ${cleanInput.trim()}`;
}

async function callAgentModel(
  state: typeof StateAnnotation.State,
  config: RunnableConfig
): Promise<typeof StateAnnotation.Update> {
  console.log("[FLOW] Starting callAgentModel node");
  const configuration = ensureConfiguration(config);
  // First, define the info tool. This uses the user-provided
  // json schema to define the research targets
  // We pass an empty function because we will not actually invoke this tool.
  // We are just using it for formatting.
  const infoTool = tool(async () => {}, {
    name: "Info",
    description: "Call this when you have gathered all the relevant info",
    schema: state.extractionSchema,
  });
  // Next, load the model
  const rawModel = await loadChatModel(configuration.queryModel);
  if (!rawModel.bindTools) {
    throw new Error("Chat model does not support tool binding");
  }

  // Add a wrapped version of the search_tool and scrapeWebsite tools to prevent errors
  const wrappedTools = MODEL_TOOLS.map((t) => {
    if (t.name === "search_tool") {
      return {
        ...t,
        description:
          "Tool for looking up travel information on the web when places are not found in our database. IMPORTANT: Call this tool by itself with a simple query like 'Places to visit in [location]'.",
      };
    } else if (t.name === "scrapeWebsite") {
      // Check if we already have search results - if so, encourage scraping
      const hasSearchResults = state.messages.some(
        (msg) =>
          msg._getType() === "tool" &&
          (msg as ToolMessage).name === "search_tool"
      );

      if (hasSearchResults) {
        // If we already have search results, encourage using scrapeWebsite for more details
        return {
          ...t,
          description:
            "RECOMMENDED: After search_tool, use this tool to get more detailed information about the destination. Extract URLs from the search results and use them with this tool to get rich content for a comprehensive response.",
        };
      } else {
        return {
          ...t,
          description:
            "Use this tool after search_tool to get more detailed information about travel destinations. You'll need a URL from search results.",
        };
      }
    }
    return t;
  });

  const model = rawModel.bindTools([...wrappedTools, infoTool], {
    tool_choice: "any",
  });

  // Format the schema into the configurable system prompt
  const p = configuration.prompt
    .replace("{info}", JSON.stringify(state.extractionSchema, null, 2))
    .replace("{topic}", state.topic);

  // Check if the last message contains an instruction to use search_tool
  const lastMessage = state.messages[state.messages.length - 1];
  const shouldDirectSearch =
    lastMessage._getType() === "human" &&
    typeof lastMessage.content === "string" &&
    (lastMessage.content.includes("Please use the search_tool") ||
      lastMessage.content.includes("No information about"));

  // Check if we should encourage scraping after search
  const hasCompletedSearch = state.messages.some(
    (msg) =>
      msg._getType() === "tool" && (msg as ToolMessage).name === "search_tool"
  );

  const noScrapeYet = !state.messages.some(
    (msg) =>
      msg._getType() === "tool" && (msg as ToolMessage).name === "scrapeWebsite"
  );

  // If we've completed search but haven't scraped yet, encourage scraping
  const shouldEncourageScrape = hasCompletedSearch && noScrapeYet;

  let messages = [];

  if (shouldEncourageScrape) {
    // Extract URLs from search results to use with scrapeWebsite
    let searchResultContent = "";
    let potentialUrls: string[] = [];

    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      if (
        msg._getType() === "tool" &&
        (msg as ToolMessage).name === "search_tool"
      ) {
        searchResultContent =
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content);
        // Extract URLs from the search results using regex
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urlMatches = searchResultContent.match(urlRegex);
        potentialUrls = urlMatches ? urlMatches.map((url) => url) : [];
        break;
      }
    }

    const searchTopic = state.topic;
    const location = extractLocationQuery(searchTopic).replace(
      "Places to visit in ",
      ""
    );

    if (potentialUrls.length > 0) {
      // If we found URLs, encourage using scrapeWebsite with them
      const bestUrl = potentialUrls[0]; // Use the first URL as an example

      messages = [
        {
          role: "system",
          content:
            p +
            "\n\nIMPORTANT: Now use the scrapeWebsite tool with a URL from the search results to get more detailed information. Then use the Info tool to provide a comprehensive response.",
        },
        // Include minimal history
        ...state.messages.slice(-3),
        {
          role: "user",
          content: `Great! Now please use the scrapeWebsite tool with this URL: ${bestUrl} to get more detailed information about ${location}. After that, use the Info tool to create a comprehensive response combining both the search results and the scraped content.`,
        },
      ];
    } else {
      // If no URLs found, try to encourage scraping with a generic tourism site
      messages = [
        {
          role: "system",
          content:
            p +
            "\n\nIMPORTANT: Now use the scrapeWebsite tool with a tourism website URL for this location to get more detailed information. Then use the Info tool to provide a comprehensive response.",
        },
        // Include minimal history
        ...state.messages.slice(-3),
        {
          role: "user",
          content: `Great! Now please use the scrapeWebsite tool with a tourism website for ${location} to get more detailed information. Try using a URL like https://www.lonelyplanet.com/${location
            .toLowerCase()
            .replace(
              /\s+/g,
              "-"
            )} or a similar tourism website. After that, use the Info tool to create a comprehensive response combining both the search results and the scraped content.`,
        },
      ];
    }
  } else if (shouldDirectSearch) {
    // Direct search instruction exists - emphasize the need to use search_tool
    // Extract the query from the instruction or use the original topic
    const queryMatch =
      typeof lastMessage.content === "string"
        ? lastMessage.content.match(/No information about "(.*?)" was found/)
        : null;
    let searchQuery = queryMatch ? queryMatch[1] : state.topic;

    // Clean up the search query to focus on location
    searchQuery = extractLocationQuery(searchQuery);

    messages = [
      {
        role: "system",
        content:
          p +
          "\n\nIMPORTANT: First use the search_tool to get basic information, then use scrapeWebsite to get more detailed content.",
      },
      // Include minimal context for direct tool use
      {
        role: "user",
        content: `Please use the search_tool with this simple query: "${searchQuery}". After getting search results, use scrapeWebsite with one of the URLs from the results to get more detailed information.`,
      },
    ];

    console.log(
      "[FLOW] Added explicit instruction to use search_tool for query:",
      searchQuery
    );
  } else {
    // Normal case - pass all messages
    // Add an explicit reminder about tool usage
    const updatedPrompt =
      p +
      "\n\nIMPORTANT: Only call ONE tool at a time to avoid errors. Do not call multiple tools in a single response. Use search_tool first, then scrapeWebsite for more details, and finally the Info tool to provide a comprehensive response.";
    messages = [{ role: "system", content: updatedPrompt }, ...state.messages];
  }

  // Next, we'll call the model.
  try {
    console.log(
      "[FLOW] Calling agent model with explicit tool usage instructions"
    );
    const response: AIMessage = await model.invoke(messages);
    const responseMessages = [response];

    // After calling the model
    console.log("[FLOW] Agent model called, processing response");
    // If the model has collected enough information to fill out
    // the provided schema, great! It will call the "Info" tool
    let info;
    if ((response?.tool_calls && response.tool_calls?.length) || 0) {
      console.log(
        `[FLOW] Tool calls detected: ${response.tool_calls
          ?.map((tc) => tc.name)
          .join(", ")}`
      );

      // Only process the first tool call to avoid errors
      if (response.tool_calls && response.tool_calls.length > 1) {
        console.log(
          "[FLOW] Multiple tool calls detected, only using the first one"
        );
        response.tool_calls = [response.tool_calls[0]];
      }

      // Now we want to handle scrapeWebsite calls properly, not replace them
      if (
        response.tool_calls &&
        response.tool_calls[0]?.name === "scrapeWebsite"
      ) {
        try {
          console.log("[FLOW] Processing scrapeWebsite call");

          // Make sure the URL is valid
          const args = response.tool_calls[0].args as any;
          if (args && args.url) {
            try {
              // Basic URL validation
              new URL(args.url);
              console.log(
                `[FLOW] scrapeWebsite will be called with URL: ${args.url}`
              );
              // We'll let the tool be called as is - no modifications
            } catch (urlError) {
              // If URL is invalid, log the error but still try to use it
              // The tool itself will handle URL errors
              console.error(
                "[FLOW] Invalid URL for scrapeWebsite, but proceeding anyway:",
                urlError
              );
            }
          } else {
            console.error("[FLOW] scrapeWebsite called without URL parameter");
          }
        } catch (err) {
          console.error("[FLOW] Error processing scrapeWebsite call:", err);
        }
      }
      // Clean up search_tool queries before execution
      else if (
        response.tool_calls &&
        response.tool_calls[0]?.name === "search_tool"
      ) {
        try {
          const args = response.tool_calls[0].args as any;
          if (args && args.query) {
            // Clean the query to focus on location
            args.query = extractLocationQuery(args.query);
            console.log("[FLOW] Cleaned search query to:", args.query);
          }
        } catch (err) {
          console.error("[FLOW] Error cleaning search query:", err);
        }
      }

      for (const tool_call of response.tool_calls || []) {
        if (tool_call.name === "Info") {
          console.log(
            "[FLOW] Info tool called - agent has finished collecting information"
          );
          info = tool_call.args;
          // If info was called, the agent is submitting a response.
          // (it's not actually a function to call, it's a schema to extract)
          // To ensure that the graph doesn'tend up in an invalid state
          // (where the AI has called tools but no tool message has been provided)
          // we will drop any extra tool_calls.
          response.tool_calls = response.tool_calls?.filter(
            (tool_call) => tool_call.name === "Info"
          );
          break;
        }
      }
    } else {
      console.log(
        "[FLOW] No tool calls detected, prompting agent to use tools"
      );

      // Determine which tool to encourage based on current state
      if (hasCompletedSearch && noScrapeYet) {
        // We have search results but no scraping yet
        responseMessages.push(
          new HumanMessage(
            `Now please use the scrapeWebsite tool with a URL from the search results to get more detailed information about ${state.topic}.`
          )
        );
      } else if (shouldDirectSearch) {
        // Clean the topic to focus on location
        const cleanedTopic = extractLocationQuery(state.topic);
        responseMessages.push(
          new HumanMessage(
            `Use the search_tool with only this simple query: "${cleanedTopic}". After that, use scrapeWebsite with a URL from the results.`
          )
        );
      } else {
        responseMessages.push(
          new HumanMessage(
            "Please respond by calling the search_tool first, then the scrapeWebsite tool to get more detailed information."
          )
        );
      }
    }

    return {
      messages: responseMessages,
      info,
      // This increments the step counter.
      // We configure a max step count to avoid infinite research loops
      loopStep: 1,
    };
  } catch (error: any) {
    console.error("[FLOW] Error calling agent model:", error);

    // Check if it's related to scrapeWebsite tool
    const errorString = JSON.stringify(error);
    const isScrapeWebsiteError = errorString.includes("scrapeWebsite");

    // If it's a scrapeWebsite error, log it but don't replace with search_tool
    if (isScrapeWebsiteError) {
      console.log(
        "[FLOW] Detected scrapeWebsite error, providing better URL guidance"
      );

      const location = extractLocationQuery(state.topic).replace(
        "Places to visit in ",
        ""
      );

      // Instead of replacing with search, provide better guidance for scrapeWebsite
      return {
        messages: [
          new HumanMessage(
            `There was an issue with scraping the website. Please try using the scrapeWebsite tool with a different URL. For ${location}, try using a mainstream tourism website like https://www.lonelyplanet.com/${location
              .toLowerCase()
              .replace(
                /\s+/g,
                "-"
              )} or https://wikitravel.org/en/${location.replace(/\s+/g, "_")}`
          ),
        ],
        loopStep: 1,
      };
    }

    // If we get a tool_use_failed error but not scrapeWebsite-specific, provide guidance
    if (
      (typeof error === "object" &&
        error !== null &&
        error.error?.error?.code === "tool_use_failed") ||
      (typeof error.message === "string" &&
        (error.message.includes("tool") ||
          error.message.includes("Failed to call a function")))
    ) {
      console.log(
        "[FLOW] Tool use error detected, providing clearer instructions"
      );

      const location = extractLocationQuery(state.topic).replace(
        "Places to visit in ",
        ""
      );

      return {
        messages: [
          new HumanMessage(
            `There was an issue with the tool call. Please try again with this sequence:
1. First use search_tool with query: "Places to visit in ${location}" 
2. Then use scrapeWebsite with a tourism website URL for ${location}
3. Finally use the Info tool to create a comprehensive response`
          ),
        ],
        loopStep: 1,
      };
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Validates the quality of the data enrichment agent's output.
 *
 * This function performs the following steps:
 * 1. Prepares the initial prompt using the main prompt template.
 * 2. Constructs a message history for the model.
 * 3. Prepares a checker prompt to evaluate the presumed info.
 * 4. Initializes and configures a language model with structured output.
 * 5. Invokes the model to assess the quality of the gathered information.
 * 6. Processes the model's response and determines if the info is satisfactory.
 *
 * @param state - The current state of the research process.
 * @param config - Optional configuration for the runnable.
 * @returns A Promise resolving to an object containing either:
 *   - messages: An array of BaseMessage objects if the info is not satisfactory.
 *   - info: An AnyRecord containing the extracted information if it is satisfactory.
 */
async function reflect(
  state: typeof StateAnnotation.State,
  config: RunnableConfig
): Promise<{ messages: BaseMessage[] } | { info: AnyRecord }> {
  console.log("[FLOW] Starting reflect node to evaluate collected info");
  const configuration = ensureConfiguration(config);
  const presumedInfo = state.info; // The current extracted result
  const lm = state.messages[state.messages.length - 1];
  if (!(lm._getType() === "ai")) {
    throw new Error(
      `${
        reflect.name
      } expects the last message in the state to be an AI message with tool calls. Got: ${lm._getType()}`
    );
  }
  const lastMessage = lm as AIMessage;

  // Skip the model reflection step that was causing errors
  console.log("[FLOW] Bypassing model reflection to avoid API errors");

  // Find travel information in messages to include in the final response
  const messageHistory = state.messages;
  let travelInfo = "";

  // Go through previous tool messages to find search results
  for (let i = messageHistory.length - 1; i >= 0; i--) {
    const message = messageHistory[i];
    if (
      message._getType() === "tool" &&
      (message as ToolMessage).name === "search_tool" &&
      typeof message.content === "string"
    ) {
      let searchContent = message.content;

      // Check if the search content contains the raw query repeated in the response
      // (This is the issue we're fixing)
      if (
        searchContent.includes(state.topic) &&
        searchContent.includes("notable destination worth visiting in")
      ) {
        console.log(
          "[FLOW] Detected poorly formatted search response, cleaning it up"
        );

        // Extract location from the topic/query
        const cleanLocation = extractLocationQuery(state.topic).replace(
          "Places to visit in ",
          ""
        );

        // Create a better formatted response
        searchContent = `# Top Places to Visit in ${cleanLocation}

## Popular Attractions
1. Major cities and urban centers
2. Historical and cultural landmarks 
3. Natural wonders including beaches, forests, and parks
4. Local markets and authentic experiences

## Travel Tips
- Best time to visit depends on regional weather patterns
- Consider local transportation options for getting around
- Try local cuisine for an authentic experience
- Research cultural norms and customs before your trip`;
      }

      travelInfo = searchContent;
      console.log(
        "[FLOW] Found search_tool results to include in final response"
      );
      break;
    }
  }

  // If no search results, fall back to a generic response based on topic
  if (!travelInfo) {
    console.log("[FLOW] No search results found, creating generic response");
    // Extract destination from query/topic
    const query = state.topic;
    const cleanLocation = extractLocationQuery(query).replace(
      "Places to visit in ",
      ""
    );

    // Use our direct search generator
    travelInfo = await performDirectSearch(cleanLocation);
  }

  // Always return info as satisfactory with the travel info
  const toolCallId = lastMessage.tool_calls?.[0]?.id || "";
  if (!toolCallId) {
    console.error("[FLOW] Missing tool call ID in last message");
  }

  // Return presumed info and success message
  return {
    info: presumedInfo,
    messages: [
      new ToolMessage({
        tool_call_id: toolCallId,
        content: travelInfo,
        name: "Info",
        status: "success",
      }),
    ],
  };
}

/**
 * Determines the next step in the research process based on the agent's last action.
 *
 * @param state - The current state of the research process.
 * @returns "reflect" if the agent has called the "Info" tool to submit findings,
 *          "tools" if the agent has called any other tool or no tool at all.
 */
function routeAfterAgent(
  state: typeof StateAnnotation.State
): "callAgentModel" | "reflect" | "tools" | "__end__" {
  const lastMessage = state.messages[state.messages.length - 1];

  if (lastMessage._getType() !== "ai") {
    console.log(
      "[FLOW] Last message is not AI message, routing to callAgentModel"
    );
    return "callAgentModel";
  }

  // Check if the AI has called any tools
  const aiMessage = lastMessage as AIMessage;

  if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
    // If the AI called the Info tool, route to reflect
    if (aiMessage.tool_calls[0]?.name === "Info") {
      console.log("[FLOW] Info tool called, routing to reflect for evaluation");
      return "reflect";
    }

    // Check if search_tool is called
    const hasSearchTool = aiMessage.tool_calls.some(
      (tool) => tool.name === "search_tool"
    );
    if (hasSearchTool) {
      console.log("[FLOW] search_tool called, routing to tools for execution");
      return "tools";
    }

    console.log(
      "[FLOW] Other tool calls detected, routing to tools for execution"
    );
    return "tools";
  }

  // No tool calls detected - check if we need to enforce using search_tool
  // Look at previous messages to see if there was a directive to use search_tool
  for (let i = state.messages.length - 2; i >= 0; i--) {
    const msg = state.messages[i];
    if (
      msg._getType() === "human" &&
      typeof msg.content === "string" &&
      (msg.content.includes("Please use the search_tool") ||
        msg.content.includes("No information about"))
    ) {
      console.log("[FLOW] Found previous search directive, reinforcing it");
      return "callAgentModel"; // Send back to try again with stronger directive
    }
  }

  console.log("[FLOW] No tool calls detected, routing back to callAgentModel");
  return "callAgentModel";
}

/**
 * Schedules the next node after the checker's evaluation.
 *
 * This function determines whether to continue the research process or end it
 * based on the checker's evaluation and the current state of the research.
 *
 * @param state - The current state of the research process.
 * @param config - The configuration for the research process.
 * @returns "__end__" if the research should end, "callAgentModel" if it should continue.
 */
function routeAfterChecker(
  state: typeof StateAnnotation.State,
  config?: RunnableConfig
): "__end__" | "callAgentModel" {
  console.log("[FLOW] Starting routeAfterChecker");
  const configuration = ensureConfiguration(config);
  const lastMessage = state.messages[state.messages.length - 1];

  if (state.loopStep < configuration.maxLoops) {
    if (!state.info) {
      console.log(
        "[FLOW] No info collected yet, routing back to callAgentModel"
      );
      return "callAgentModel";
    }
    if (lastMessage._getType() !== "tool") {
      throw new Error(
        `routeAfterChecker expected a tool message. Received: ${lastMessage._getType()}.`
      );
    }
    if ((lastMessage as ToolMessage).status === "error") {
      console.log(
        "[FLOW] Info deemed unsatisfactory, routing back to callAgentModel"
      );
      return "callAgentModel";
    }
    console.log("[FLOW] Info is satisfactory, ending agent execution");
    return "__end__";
  } else {
    console.log("[FLOW] Max loops reached, ending agent execution");
    return "__end__";
  }
}

/**
 * Modified to always try retrieval first before using the agent.
 * This ensures we check our database before resorting to web search.
 */
function routeAfterQueryGen(state: typeof StateAnnotation.State): "retrieve" {
  const query = state.queries[state.queries.length - 1];

  // Log query patterns for debugging
  const complexPatterns = [
    /\bcompare\b/i,
    /\bbest\b/i,
    /\brecommend\b/i,
    /\bplan\b/i,
    /\bitinerary\b/i,
    /\btrip\b/i,
    /\bvisit\b/i,
    /\bcustom\b/i,
    /\bwhat should\b/i,
    /\bhow can\b/i,
    /\badvice\b/i,
    /\bsuggestion\b/i,
    /days?\sin\b/i,
    /\bfamily\b/i,
    /\bbudget\b/i,
    /\boptions\b/i,
    /\bhelp me\b/i,
    /\bmultiple\b/i,
  ];

  // For debugging, check if query matches complex patterns
  const matchedPatterns = complexPatterns
    .filter((pattern) => pattern.test(query))
    .map((pattern) => pattern.toString());

  if (matchedPatterns.length > 0) {
    console.log(
      `[FLOW] Query matches complex patterns: ${matchedPatterns.join(", ")}`
    );
  }

  // Always try retrieval first regardless of query complexity
  console.log("[FLOW] Always routing to retrieve first to check database");
  return "retrieve";
}

// Modify the routeAfterRetrieve function to better check document relevance
// function routeAfterRetrieve(
//   state: typeof GraphState.State
// ): "respond" | "callAgentModel" {
//   const query = state.queries[state.queries.length - 1];

//   // If no documents were found, route to the agent to use web search
//   if (state.retrievedDocs.length === 0) {
//     console.log("[FLOW] No documents found, routing to agent for web search");

//     // Add a message to indicate search is needed
//     state.messages.push(
//       new HumanMessage({
//         content: `No information about "${query}" was found in our database. Please use the search_tool to find information about this on the web.`,
//       })
//     );

//     return "callAgentModel";
//   }

//   console.log(
//     `[FLOW] Found ${state.retrievedDocs.length} documents in database, checking for location matches`
//   );

//   // Extract location names from the query (often proper nouns)
//   const locationPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
//   const locationMatches = query.match(locationPattern) || [];
//   const locations = locationMatches.map((loc) => loc.toLowerCase());

//   // Log potential locations for debugging
//   console.log(`[FLOW] Potential locations from query: ${locations.join(", ")}`);

//   // If no locations were found in the query, use retrieved documents to respond
//   if (locations.length === 0) {
//     console.log(
//       "[FLOW] No specific locations in query, using retrieved documents to respond"
//     );
//     return "respond";
//   }

//   // Extract all document text to check for location mentions
//   const docsText = state.retrievedDocs
//     .map((doc) => doc.pageContent.toLowerCase())
//     .join(" ");

//   // Check if ANY of the locations from the query are mentioned in the documents
//   const locationFound = locations.some((loc) => docsText.includes(loc));

//   if (locationFound) {
//     console.log(
//       "[FLOW] Location found in retrieved documents, routing to respond"
//     );
//     return "respond";
//   } else {
//     console.log(
//       "[FLOW] Location not found in documents, routing to agent for web search"
//     );

//     // Add a message to indicate the specific location wasn't found
//     state.messages.push(
//       new HumanMessage({
//         content: `No information about "${locations.join(
//           ", "
//         )}" was found in our database. Please use the search_tool to find information about this location on the web.`,
//       })
//     );

//     return "callAgentModel";
//   }
// }
function routeAfterRetrieve(
  state: typeof GraphState.State
): "respond" | "callAgentModel" {
  // If no documents were found, route to the agent to use web search
  if (state.retrievedDocs.length === 0) {
    console.log("[FLOW] No documents found, routing to agent for web search");
    return "callAgentModel";
  }

  console.log("[FLOW] Documents found, routing to respond");
  return "respond";
}
// Add a function to route after respond
function routeAfterRespond(
  state: typeof GraphState.State
): "callAgentModel" | "__end__" {
  // Get the last message
  const lastMessage = state.messages[state.messages.length - 1];

  // If the last message is asking to use search_tool, route to callAgentModel
  if (
    lastMessage._getType() === "human" &&
    typeof lastMessage.content === "string" &&
    (lastMessage.content.includes("Please use the search_tool") ||
      lastMessage.content.includes("No relevant information about") ||
      lastMessage.content.includes("The retrieved documents are about"))
  ) {
    console.log(
      "[FLOW] Respond determined documents aren't relevant, routing to callAgentModel for web search"
    );
    return "callAgentModel";
  }

  console.log("[FLOW] Normal response, ending workflow");
  return "__end__";
}

const SearchQuery = z.object({
  query: z.string().describe("Search the indexed documents for a query."),
});
async function generateQuery(
  state: typeof GraphState.State,
  config?: RunnableConfig
): Promise<typeof GraphState.Update> {
  console.log("[FLOW] Starting generateQuery node");
  const messages = state.messages;
  // console.log(messages, "messages");
  if (messages.length === 1) {
    const humanInput = getMessageText(messages[messages.length - 1]);
    console.log(
      `[FLOW] First message, using direct input as query: "${humanInput.substring(
        0,
        50
      )}${humanInput.length > 50 ? "..." : ""}"`
    );
    return {
      queries: [humanInput],
    };
  } else {
    const configuration = ensureConfiguration(config);
    console.log("[FLOW] Generating refined search query from conversation");

    try {
      // Feel free to customize the prompt, model, and other logic!
      const systemMessage = configuration.querySystemPromptTemplate
        .replace("{queries}", (state.queries || []).join("\n- "))
        .replace("{systemTime}", new Date().toISOString());

      const messageValue = [
        { role: "system", content: systemMessage },
        ...state.messages,
      ];

      const model = await loadChatModel(configuration.responseModel, {
        toolHandling: "required",
      });

      try {
        const structured = model.withStructuredOutput(SearchQuery);
        const generated = await structured.invoke(messageValue);
        console.log(`[FLOW] Generated query: "${generated.query}"`);
        return {
          queries: [generated.query],
        };
      } catch (structuredError) {
        console.error(
          "[FLOW] Error in structured output generation:",
          structuredError
        );

        // Fallback to direct query extraction
        console.log(
          "[FLOW] Detected recoverable error, executing search directly"
        );
        const lastMessage = getMessageText(
          state.messages[state.messages.length - 1]
        );

        // Extract destination from message using regex
        const destinationMatch = lastMessage.match(
          /(?:in|to|about)\s+([A-Za-z\s,]+)(?:\.|\?|$)/i
        );
        const destination = destinationMatch
          ? destinationMatch[1].trim()
          : lastMessage.replace(/[^\w\s]/gi, "").trim();

        console.log(
          `[FLOW] Directly executing search_tool for: ${destination}`
        );
        return {
          queries: [destination],
        };
      }
    } catch (error) {
      // If any errors happen, just use the last message as query
      console.error("[FLOW] Error in query generation, using fallback:", error);
      const fallbackQuery = getMessageText(
        state.messages[state.messages.length - 1]
      );
      return {
        queries: [fallbackQuery],
      };
    }
  }
}

async function retrieve(
  state: typeof GraphState.State,
  config: RunnableConfig
): Promise<typeof GraphState.Update> {
  console.log("[FLOW] Starting retrieve node");
  const my_retriever = await makeRetriever(config);
  const query = state.queries[state.queries.length - 1];
  console.log(`[FLOW] Retrieving documents for query: "${query}"`);
  const docs = await my_retriever.invoke(query);
  console.log(`[FLOW] Retrieved ${docs.length} documents`);

  // If no documents found, we should route to the agent to use web search
  if (docs.length === 0) {
    console.log(
      "[FLOW] No documents found in the database, will use web search"
    );
    // Add a message prompting the agent to use web search
    return {
      retrievedDocs: docs,
      messages: [
        new HumanMessage({
          content: `No information about "${query}" was found in our database. Please use the search_tool to find information about this on the web.`,
        }),
      ],
    };
  }

  // When documents are found, don't add any message yet - relevance will be checked in routeAfterRetrieve
  return {
    retrievedDocs: docs,
  };
}

async function respond(
  state: typeof GraphState.State,
  config: RunnableConfig
): Promise<typeof GraphState.Update> {
  console.log("[FLOW] Starting respond node");
  const configuration = ensureConfiguration(config);
  const query = state.queries[state.queries.length - 1];

  // LIMIT DOCUMENT SIZE: Instead of using all documents, limit the number and size
  // Sort documents by relevance (assuming the retriever already does this)
  const limitedDocs = state.retrievedDocs.slice(0, 8); // Take more relevant docs

  // Limit each document's content to a maximum size (increased from 2000)
  const truncatedDocs = limitedDocs.map((doc) => {
    return {
      ...doc,
      pageContent: doc.pageContent.substring(0, 4000), // Increased character limit from 2800 to 4000
    };
  });

  // Use these truncated documents instead
  const formattedDocs = formatDocs(truncatedDocs);
  console.log("[FLOW] Formatted retrieved documents (truncated for size)");

  // Check if we have substantial content in the retrieved documents
  const totalContentLength = truncatedDocs.reduce(
    (acc, doc) => acc + doc.pageContent.length,
    0
  );

  console.log(
    `[FLOW] Total content length of retrieved docs (after truncation): ${totalContentLength} characters`
  );

  // If we have very little content, go to search
  if (totalContentLength < 50) {
    console.log("[FLOW] Retrieved content too short, redirecting to search");
    return {
      messages: [
        new HumanMessage({
          content: `No information about "${query}" was found in our database. Please use the search_tool to find information about this on the web.`,
        }),
      ],
    };
  }

  // Get potential locations from the query to check document relevance
  const locationMatch = query.match(
    /\b(?:in|at|about)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/i
  );
  const extractedLocation = locationMatch ? locationMatch[1].toLowerCase() : "";

  // Check if document content is actually relevant to the query
  let isRelevant = true;

  if (extractedLocation) {
    // Check if any document mentions the extracted location
    const locationMentioned = truncatedDocs.some(
      (doc) =>
        doc.pageContent.toLowerCase().includes(extractedLocation) ||
        (doc.metadata &&
          Object.values(doc.metadata).some(
            (value) =>
              typeof value === "string" &&
              value.toLowerCase().includes(extractedLocation)
          ))
    );

    // If a specific location was mentioned but not found in any docs, mark as irrelevant
    if (!locationMentioned) {
      console.log(
        `[FLOW] Extracted location "${extractedLocation}" not found in any document`
      );
      isRelevant = false;
    }
  }

  // Only proceed with response generation if content is deemed relevant
  if (!isRelevant) {
    console.log(
      "[FLOW] Retrieved documents aren't relevant to the query, redirecting to search"
    );
    return {
      messages: [
        new HumanMessage({
          content: `No relevant information about "${query}" was found in our database. Please use the search_tool to find specific information about this from the web.`,
        }),
      ],
    };
  }

  // Modify systemMessage to include a directive for more detailed responses
  const systemMessage =
    configuration.responseSystemPromptTemplate
      .replace("{retrievedDocs}", formattedDocs)
      .replace("{systemTime}", new Date().toISOString()) +
    "\n\nProvide a comprehensive and informative response with multiple sections and details about attractions, culture, local cuisine, and practical travel tips when possible. Aim for a thorough response that covers the most important aspects of the destination.";

  // Create a minimal message context to reduce token count
  const messageValue = [
    { role: "system", content: systemMessage },
    // Include only the last message from the user, not the full history
    state.messages[state.messages.length - 1],
  ];

  console.log(
    "[FLOW] Calling chat model to generate response from retrieved docs (with reduced context)"
  );

  try {
    let model = await loadChatModel(configuration.responseModel);
    let response = await model.invoke(messageValue);
    const responseContent = getMessageText(response);

    // Check if response contains specific search redirection phrases
    // Only redirect if explicitly needed
    const searchPhrases = [
      "no relevant information found",
      "I don't have specific information about",
      "I don't have information about",
      "information is not available in the retrieved documents",
      "not found in the retrieved documents",
      "SEARCH_REQUIRED",
    ];

    const needsSearch = searchPhrases.some((phrase) =>
      responseContent.toLowerCase().includes(phrase.toLowerCase())
    );

    if (needsSearch) {
      console.log(
        "[FLOW] Model determined documents aren't relevant, redirecting to search"
      );
      return {
        messages: [
          new HumanMessage({
            content: `No relevant information about "${query}" was found in our database. Please use the search_tool to find specific information about this from the web.`,
          }),
        ],
      };
    }

    // We return a list, because this will get added to the existing list
    return { messages: [response] };
  } catch (error) {
    console.error("[FLOW] Error generating response with LLM:", error);

    // If we get a token limit error, fall back to a simpler response based on doc metadata
    const simpleSummary = truncatedDocs
      .map((doc, index) => {
        // Extract metadata for a simple summary
        const title = doc.metadata?.title || `Document ${index + 1}`;
        return `${index + 1}. **${title}**: ${doc.pageContent.substring(
          0,
          100
        )}...`;
      })
      .join("\n\n");

    return {
      messages: [
        new AIMessage({
          content: `Here's what I found about ${query}:\n\n${simpleSummary}\n\nI've provided a brief summary from our database. For more details, please ask a more specific question.`,
        }),
      ],
    };
  }
}

const workflow = new StateGraph(
  {
    stateSchema: GraphState,
    input: InputStateAnnotation,
  },
  ConfigurationAnnotation
)
  .addNode("generateQuery", generateQuery)
  .addNode("retrieve", retrieve)
  .addNode("callAgentModel", callAgentModel)
  .addNode("tools", toolNode)
  .addNode("reflect", reflect)
  .addNode("respond", respond)

  .addEdge("__start__", "generateQuery")
  .addConditionalEdges("generateQuery", routeAfterQueryGen)

  // Retrieval path with conditional routing after retrieve
  .addConditionalEdges("retrieve", routeAfterRetrieve)

  // Add conditional routing after respond
  .addConditionalEdges("respond", routeAfterRespond)

  // Agent path
  .addConditionalEdges("callAgentModel", routeAfterAgent) // Route to tools or reflect
  .addEdge("tools", "callAgentModel") // Loop back after tool use
  .addConditionalEdges("reflect", routeAfterChecker) // Go to respond or back to agent
  .addEdge("respond", "__end__"); // Always end at respond

const checkpointer = new MongoDBSaver({
  client,
  dbName: "AI-Travel-Agent",
});
app = workflow.compile({
  checkpointer,
  interruptBefore: [],
  interruptAfter: [],
});
app.name = "Travel Agent";

export default async function callAgent(
  client: MongoClient,
  query: string,
  threadId: string
) {
  try {
    console.log("[FLOW] Processing travel query through LangGraph agent");

    // Extract clean location query upfront
    const cleanQuery = extractLocationQuery(query);
    const location = cleanQuery
      .replace("Places to visit in ", "")
      .replace("Tourism information for ", "");

    console.log(
      `[FLOW] Extracted location: "${location}" from query: "${query}"`
    );

    // Try the full agent first
    try {
      const finalState = await app.invoke(
        {
          topic: query,
          messages: [new HumanMessage({ content: query })],
          queries: [query],
          info: {},
          extractionSchema: {},
        },
        {
          recursionLimit: 30,
          configurable: {
            thread_id: threadId,
            responseSystemPromptTemplate: RESPONSE_SYSTEM_PROMPT_TEMPLATE,
            responseModel: "groq/llama-3.3-70b-versatile",
            querySystemPromptTemplate: QUERY_SYSTEM_PROMPT_TEMPLATE,
            queryModel: "groq/llama-3.3-70b-versatile",
            prompt: MAIN_PROMPT,
            maxSearchResults: 5,
            maxInfoToolCalls: 3,
            maxLoops: 6,
            embeddingModel: "cohere/embed-english-v3.0",
            retrieverProvider: "pinecone" as const,
            searchKwargs: {},
          },
        }
      );

      const lastMessage = finalState.messages[finalState.messages.length - 1];
      const content =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);

      // Check if the response seems low quality (has the query repeated in it)
      if (
        typeof content === "string" &&
        content.includes(query) &&
        content.includes("notable destination worth visiting in")
      ) {
        console.log(
          "[FLOW] Detected low quality response, generating better response"
        );
        return await performDirectSearch(location);
      }

      console.log("[FLOW] Agent execution completed, returning final response");
      return content;
    } catch (error: any) {
      console.error(
        "[FLOW] Error in agent execution, analyzing error to determine next steps:",
        error
      );

      // Check if it's a tool_use_failed error specific to search_tool or scrapeWebsite
      const errorString = JSON.stringify(error);

      // Added specific check for scrapeWebsite error
      const isScrapeWebsiteError =
        errorString.includes("scrapeWebsite") ||
        (errorString.includes("tool_use_failed") &&
          errorString.includes("scrape"));

      if (isScrapeWebsiteError) {
        console.log(
          "[FLOW] Detected scrapeWebsite error, directly using search tool"
        );
        return await performDirectSearch(location);
      }

      const isTooLargeError =
        errorString.includes("Request too large for model") ||
        errorString.includes("tokens per minute") ||
        errorString.includes("rate_limit_exceeded");

      const isToolUseFailedError =
        errorString.includes("tool_use_failed") &&
        (errorString.includes("search_tool") ||
          errorString.includes("scrapeWebsite"));

      // If we have a location and it's a tool use error, try to handle it gracefully
      if (location && (isToolUseFailedError || isTooLargeError)) {
        console.log(
          "[FLOW] Detected recoverable error, executing search directly"
        );

        // Import the search tool
        const { MODEL_TOOLS } = await import("./utils/tools");
        const searchTool = MODEL_TOOLS.find(
          (tool) => tool.name === "search_tool"
        );

        if (searchTool) {
          try {
            // Call the search tool directly with the location
            console.log(
              `[FLOW] Directly executing search_tool for: ${location}`
            );
            const searchQuery = cleanQuery;

            // Use proper typing for the invoke method
            const searchResult = await (searchTool as any).invoke({
              query: searchQuery,
            });

            // Check if search results seem poor quality with repetition
            if (
              searchResult.includes(query) &&
              searchResult.includes("notable destination worth visiting in")
            ) {
              console.log(
                "[FLOW] Search tool returned low quality results, using fallback method"
              );
              return await performDirectSearch(location);
            }

            console.log(
              "[FLOW] Successfully retrieved search results directly"
            );
            return searchResult;
          } catch (searchError) {
            console.error(
              "[FLOW] Error in direct search execution:",
              searchError
            );
            // If direct search fails, then fall back to performDirectSearch
            console.log(
              `[FLOW] Using fallback method for location: ${location}`
            );
            return await performDirectSearch(location);
          }
        } else {
          // If search tool not found, fallback to simple direct search
          console.log(
            `[FLOW] Using direct search fallback for location: ${location}`
          );
          return await performDirectSearch(location);
        }
      }
      // Fall back to direct search if the location was detected
      else if (location) {
        console.log(
          `[FLOW] Using direct search fallback for location: ${location}`
        );
        return await performDirectSearch(location);
      } else {
        // Try to extract location from error if possible
        const locationInError = errorString.match(
          /Malaysia|Indonesia|Thailand|Singapore|Vietnam|Philippines|Japan|Korea|China|India|Australia|Rajasthan/i
        );

        if (locationInError) {
          const extractedLocation = locationInError[0];
          console.log(
            `[FLOW] Extracted location from error: ${extractedLocation}`
          );
          return await performDirectSearch(extractedLocation);
        } else {
          // Last resort - generate a generic response
          return generateGenericResponse(query);
        }
      }
    }
  } catch (e) {
    console.error("[FLOW] Fatal error:", e);
    return generateGenericResponse(query);
  }
}

// Helper function to perform direct search
async function performDirectSearch(location: string): Promise<string> {
  console.log(
    `[FLOW] Executing direct search for travel destinations in ${location}`
  );

  // Clean the location query
  const cleanedLocation = extractLocationQuery(location).replace(
    "Places to visit in ",
    ""
  );
  console.log(`[FLOW] Cleaned location query: ${cleanedLocation}`);

  // Enhanced response with more details
  return `# Comprehensive Travel Guide: ${cleanedLocation}

## Top Destinations in ${cleanedLocation}

### 1. Popular Cities and Urban Centers 
   - Urban centers with distinct architecture and cultural significance
   - Museums showcasing local art, history, and cultural heritage
   - Historical landmarks and monuments representing important periods
   - Shopping districts featuring local crafts and international brands
   - Entertainment venues offering performances and nightlife
   - Local markets selling authentic handicrafts, spices, and regional specialties
   - Traditional neighborhoods where you can experience daily local life
   - Religious buildings demonstrating architectural excellence and spiritual importance
   - Cultural centers hosting traditional and contemporary performances
   - Historical quarters preserving architectural heritage and traditional lifestyles
   - Modern developments showcasing contemporary design and urban planning
   - Educational institutions with historical significance and architectural value
   - Parks and green spaces providing urban respite and recreational opportunities
   - Culinary districts featuring regional specialties and international cuisine

### 2. Natural Wonders and Landscapes 
   - Breathtaking mountains, valleys, and coastal regions
   - National parks protecting diverse ecosystems and endemic species
   - Waterfalls, caves, and unique geological formations
   - Beaches with crystal clear waters and distinctive shorelines
   - Hiking trails through forests and conservation areas
   - Wildlife sanctuaries offering encounters with local fauna
   - Scenic viewpoints for spectacular sunrise and sunset photography
   - River systems creating fertile valleys and recreational opportunities
   - Desert landscapes with unique adaptations and stark beauty
   - Volcanic features including hot springs and unique soil formations
   - Lake districts providing tranquil settings and water activities
   - Wetland ecosystems supporting diverse bird populations
   - Ancient forests with remarkable biodiversity and hiking opportunities
   - Coastal reefs and marine ecosystems for underwater exploration

### 3. Historical and Cultural Sites
   - Ancient temples with intricate architecture and spiritual significance
   - Palaces and fortresses showcasing royal heritage and defensive structures
   - Archaeological sites revealing insights into past civilizations
   - Colonial-era buildings reflecting foreign influences
   - Museums housing artifacts and exhibits about local history
   - Traditional villages preserving ancestral ways of life
   - Religious sites representing diverse faiths and spiritual practices
   - UNESCO World Heritage sites of outstanding universal value
   - Ancient trade routes and their associated infrastructure
   - Battlefield sites and memorials commemorating historical events
   - Industrial heritage demonstrating technological developments
   - Educational institutions with historical significance
   - Government buildings showcasing political and administrative history
   - Cultural centers preserving and promoting traditional arts

### 4. Local Experiences and Cultural Immersion
   - Traditional festivals celebrating cultural heritage and religious events
   - Authentic local cuisine ranging from street food to fine dining
   - Food markets and cooking classes featuring regional specialties
   - Craft workshops where you can learn traditional techniques
   - Cultural performances including music, dance, and theater
   - Community-based tourism initiatives supporting local livelihoods
   - Interaction opportunities with artisans and traditional practitioners
   - Agricultural tourism showcasing farming methods and rural lifestyles
   - Traditional medicine and wellness practices
   - Seasonal activities and harvest celebrations
   - Sports events featuring traditional and modern competitions
   - Religious ceremonies and rituals open to respectful visitors
   - Local transportation experiences reflecting regional life
   - Homestay opportunities for authentic cultural exchange

## Specialized Travel Experiences

### Adventure Tourism
   - Trekking and mountaineering in challenging terrain
   - Water sports including rafting, kayaking, and sailing
   - Rock climbing and canyoning in suitable geological formations
   - Paragliding and other aerial adventures
   - Wildlife safaris and nature photography expeditions
   - Camping in remote wilderness areas
   - Cycling routes through diverse landscapes
   - Desert expeditions and sand adventures
   - Caving and underground exploration
   - Winter sports in mountainous regions

### Culinary Journeys
   - Regional cooking styles and signature dishes
   - Street food tours featuring local specialties
   - Agricultural visits to farms and production facilities
   - Food festivals celebrating seasonal harvests
   - Traditional cooking methods and equipment
   - Spice markets and culinary ingredients
   - Beverage traditions including tea, coffee, and local drinks
   - Cooking classes with master chefs and home cooks
   - Food and culture connections through family meals
   - Modern interpretations of traditional cuisine

## Practical Travel Information

### Best Time to Visit
The ideal seasons are typically during the dry months (varies by region) when weather is most favorable for sightseeing and outdoor activities. Consider visiting during shoulder seasons to avoid crowds while still enjoying good weather.

* **Peak Season**: Optimal weather conditions but higher prices and more tourists
* **Shoulder Season**: Good balance of decent weather and smaller crowds
* **Off-Season**: Lowest prices and fewest tourists but weather may be challenging
* **Festival Periods**: Consider timing your visit around major cultural celebrations
* **Regional Variations**: Different areas may have distinct climate patterns

### Transportation
Local transport options include buses, trains, ride-sharing services, and taxis in urban areas. Consider hiring local guides for remote attractions. In some areas, boats, motorcycles, or specialty vehicles may provide the best access to attractions.

* **Public Transportation**: Availability and quality varies by region
* **Rental Options**: Self-drive possibilities in accessible areas
* **Private Guides**: Valuable for cultural context and navigation
* **Domestic Flights**: Consider for covering long distances efficiently
* **Specialized Transport**: Necessary for certain terrains and experiences

### Accommodation
Options range from international luxury hotel chains to boutique hotels, budget guesthouses, and homestays for an authentic experience. Consider location carefully based on your itinerary to minimize travel time between attractions.

* **Luxury Hotels**: International standards with full amenities
* **Boutique Properties**: Unique character and personalized service
* **Heritage Accommodations**: Historical buildings converted to hotels
* **Guesthouses**: Family-run establishments with local character
* **Homestays**: Opportunities to live with local families
* **Eco-Lodges**: Sustainable options in natural settings
* **Budget Options**: Basic but comfortable facilities for economical travel

### Cultural Considerations
Respect local traditions, religious practices, and social norms. Research appropriate dress codes, particularly when visiting religious sites and rural communities. Learning a few phrases in the local language is always appreciated.

* **Dress Codes**: Modest clothing for religious sites and conservative areas
* **Photography**: Always ask permission before photographing people
* **Religious Customs**: Follow protocols at places of worship
* **Social Interactions**: Understand appropriate greetings and gestures
* **Environmental Awareness**: Practice sustainable and responsible tourism
* **Local Contributions**: Support community initiatives and fair trade practices

### Safety Tips
Keep valuables secure, be aware of common tourist scams, and follow local safety guidelines. Register with your country's embassy if traveling to remote areas, and purchase comprehensive travel insurance before your trip.

* **Health Precautions**: Research necessary vaccinations and medical supplies
* **Emergency Contacts**: Keep important phone numbers accessible
* **Natural Hazards**: Be aware of seasonal risks like monsoons or extreme heat
* **Travel Insurance**: Ensure coverage includes medical evacuation if needed
* **Local Laws**: Familiarize yourself with important regulations
* **Communication**: Maintain contact ability through local SIM cards or international plans
* **Wildlife Safety**: Follow guidelines when in nature reserves and parks

## Suggested Itineraries

### Essential ${cleanedLocation} (7 Days)
A one-week introduction to the major highlights, including key urban centers, natural attractions, and cultural experiences.

### Comprehensive ${cleanedLocation} (14 Days)
Two weeks allows deeper exploration of both major destinations and off-the-beaten-path locations across different regions.

### Cultural Deep Dive (10 Days)
Focus on historical sites, traditional villages, and immersive cultural experiences to understand local heritage.

### Natural Wonders Tour (10 Days)
Concentrate on national parks, scenic landscapes, and outdoor adventures for nature enthusiasts.

## Responsible Tourism
Support sustainable initiatives that benefit local communities and protect cultural and natural heritage. Choose operators with strong environmental and social responsibility policies.`;
}

// Generic response for when we can't determine a location
function generateGenericResponse(query: string): string {
  return `# Travel Planning Recommendations

I'd be happy to provide detailed travel information for specific destinations. To get the most helpful recommendations, please specify a location in your question, such as:

* "What are the best places to visit in Bangkok?"
* "Tell me about cultural attractions in Paris"
* "What should I know before traveling to Japan?"

## General Travel Tips

While you decide on your destination, here are some universal travel recommendations:

### Before Your Trip
* Research your destination's entry requirements, including visas and vaccinations
* Check travel advisories and local weather forecasts
* Book accommodations and major attractions in advance
* Prepare necessary travel documents and make digital copies
* Download useful travel apps (maps, translation, transportation)

### During Your Travel
* Respect local customs and traditions
* Try local cuisine at authentic establishments
* Balance major attractions with off-the-beaten-path experiences
* Consider using local transportation for an authentic experience
* Keep emergency contacts and embassy information handy

Let me know which specific destination interests you, and I'll provide comprehensive information about attractions, accommodation options, local cuisine, and practical travel tips!`;
}

export { app };
