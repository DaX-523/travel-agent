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
  const model = rawModel.bindTools([...MODEL_TOOLS, infoTool], {
    tool_choice: "any",
  });

  // Format the schema into the configurable system prompt
  const p = configuration.prompt
    .replace("{info}", JSON.stringify(state.extractionSchema, null, 2))
    .replace("{topic}", state.topic);

  // If we're coming from retrieve with no results or irrelevant results,
  // add a directive to use search_tool first
  let messages = [];

  // Check if we should direct the agent to use search_tool
  const shouldDirectSearch =
    // Only add the search directive if we haven't already used search_tool
    !state.messages.some(
      (msg) =>
        msg._getType() === "tool" && (msg as ToolMessage).name === "search_tool"
    );

  if (shouldDirectSearch) {
    // Coming from retrieve with no/irrelevant results - use directive to search
    messages = [
      { role: "user", content: p },
      ...state.messages,
      {
        role: "user",
        content: `Please use the search_tool to find specific information about "${state.topic}" from the web.`,
      },
    ];
  } else {
    // Normal case - pass all messages
    messages = [{ role: "user", content: p }, ...state.messages];
  }

  // Next, we'll call the model.
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
    console.log("[FLOW] No tool calls detected, prompting agent to use tools");
    responseMessages.push(
      new HumanMessage("Please respond by calling one of the provided tools.")
    );
  }

  return {
    messages: responseMessages,
    info,
    // This increments the step counter.
    // We configure a max step count to avoid infinite research loops
    loopStep: 1,
  };
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

  // Load the configured model & provide the reflection/critique schema
  const rawModel = await loadChatModel(configuration.queryModel);
  const boundModel = rawModel.withStructuredOutput(InfoIsSatisfactory);
  // Template in the conversation history:
  const p = configuration.prompt
    .replace("{info}", JSON.stringify(state.extractionSchema, null, 2))
    .replace("{topic}", state.topic);
  const messages = [
    { role: "user", content: p },
    ...state.messages.slice(0, -1),
  ];

  const checker_prompt = `I am thinking of calling the info tool with the info below. \
Is this good? Give your reasoning as well. \
You can encourage the Assistant to look at specific URLs if that seems relevant, or do more searches.
If you don't think it is good, you should be very specific about what could be improved.

{presumed_info}`;
  const p1 = checker_prompt.replace(
    "{presumed_info}",
    JSON.stringify(presumedInfo ?? {}, null, 2)
  );
  messages.push({ role: "user", content: p1 });

  // Call the model
  const response = await boundModel.invoke(messages);
  // console.log("reflect response", response, presumedInfo);

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
      travelInfo = message.content;
      console.log(
        "[FLOW] Found search_tool results to include in final response"
      );
      break;
    }
  }

  // If search results not found, look for scrapeWebsite results
  if (!travelInfo) {
    // Try to extract content from scrapeWebsite results
    const scrapedContent: string[] = [];

    for (let i = messageHistory.length - 1; i >= 0; i--) {
      const message = messageHistory[i];
      if (
        message._getType() === "tool" &&
        (message as ToolMessage).name === "scrapeWebsite" &&
        typeof message.content === "string"
      ) {
        scrapedContent.push(message.content);
        if (scrapedContent.length >= 2) break; // Get content from up to 2 websites
      }
    }

    if (scrapedContent.length > 0) {
      // Extract location names from the scraped content
      const locationRegex =
        /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*(?:\s(?:Islands?|Mountains?|National\s+Park|Beach|City))?)\b/g;
      const allContent = scrapedContent.join(" ");
      let locations: string[] = [];

      let match;
      while ((match = locationRegex.exec(allContent)) !== null) {
        if (
          !["The", "This", "These", "Those", "Some", "Many", "All"].includes(
            match[0]
          )
        ) {
          locations.push(match[0]);
        }
      }

      // Remove duplicates and get top locations
      locations = [...new Set(locations)].slice(0, 5);

      // Create a formatted response based on the topic and extracted locations
      const query = state.topic;
      console.log(
        "[FLOW] Creating formatted response from scraped content for:",
        query
      );

      // Extract destination from query
      const destinationMatch = query.match(/in\s+(.+?)(?:\s+and|\s*$)/i);
      const destination = destinationMatch ? destinationMatch[1].trim() : query;

      travelInfo = `Here are the top places to visit in ${destination}:\n\n`;

      // Add specific locations if found
      if (locations.length >= 4) {
        travelInfo += `1. **${locations[0]}**: A must-visit destination with unique attractions and cultural experiences.\n\n`;
        travelInfo += `2. **${locations[1]}**: Explore this fascinating location known for its beauty and significance.\n\n`;
        travelInfo += `3. **${locations[2]}**: Discover the charm and attractions of this popular destination.\n\n`;
        travelInfo += `4. **${locations[3]}**: Experience the unique atmosphere and activities available here.\n\n`;

        if (locations.length >= 8) {
          travelInfo += `5. **${locations[4]}**: A perfect place to immerse yourself in local culture and traditions.\n\n`;
          travelInfo += `6. **${locations[5]}**: Enjoy the natural beauty and attractions of this remarkable destination.\n\n`;
          travelInfo += `7. **${locations[6]}**: This location offers memorable experiences and unique sights.\n\n`;
          travelInfo += `8. **${locations[7]}**: Don't miss this gem that showcases the region's diversity.\n\n`;
        } else {
          travelInfo += `5. **Natural Attractions**: Explore the diverse landscapes and natural wonders of ${destination}.\n\n`;
          travelInfo += `6. **Cultural Experiences**: Immerse yourself in local traditions, cuisine, and cultural activities.\n\n`;
          travelInfo += `7. **Best Time to Visit**: Consider visiting during the dry season for optimal weather conditions.\n\n`;
          travelInfo += `8. **Local Transportation**: Get around efficiently using local transportation options available throughout the region.\n\n`;
        }
      } else {
        // Not enough specific locations found, use template format
        travelInfo = `Here are the top places to visit in ${destination}:

${responseFallbackTemplate}`;
      }

      // Add source references
      travelInfo += "Based on analyzed content from multiple travel websites.";
    } else {
      // Create a generic formatted response based on the topic
      const query = state.topic;
      console.log("[FLOW] Creating generic formatted response for:", query);
      travelInfo = `Here are the top places to visit in ${query}:

${responseFallbackTemplate}`;
    }
  }

  if (response.is_satisfactory && presumedInfo) {
    console.log("[FLOW] Info deemed satisfactory by reflection");

    // Make sure we're creating a proper tool message with valid tool_call_id
    const toolCallId = lastMessage.tool_calls?.[0]?.id || "";
    if (!toolCallId) {
      console.error("[FLOW] Missing tool call ID in last message");
    }

    // Now we return the actual travel information alongside the success message
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
  } else {
    console.log(
      "[FLOW] Info deemed unsatisfactory, feedback: " +
        (response.improvement_instructions
          ? response.improvement_instructions.substring(0, 100)
          : "No specific feedback")
    );
    return {
      messages: [
        new ToolMessage({
          tool_call_id: lastMessage.tool_calls?.[0]?.id || "",
          content: `Unsatisfactory response:\n${response.improvement_instructions}`,
          name: "Info",
          status: "error",
        }),
      ],
    };
  }
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
  const lastMessage: AIMessage = state.messages[state.messages.length - 1];

  if (lastMessage._getType() !== "ai") {
    console.log(
      "[FLOW] Last message is not AI message, routing to callAgentModel"
    );
    return "callAgentModel";
  }

  if (lastMessage.tool_calls && lastMessage.tool_calls[0]?.name === "Info") {
    console.log("[FLOW] Info tool called, routing to reflect for evaluation");
    return "reflect";
  }

  console.log("[FLOW] Tool calls detected, routing to tools for execution");
  return "tools";
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
function routeAfterRetrieve(
  state: typeof GraphState.State
): "respond" | "callAgentModel" {
  const query = state.queries[state.queries.length - 1];

  // If no documents were found, route to the agent to use web search
  if (state.retrievedDocs.length === 0) {
    console.log("[FLOW] No documents found, routing to agent for web search");
    return "callAgentModel";
  }

  // Check document relevance by extracting key terms from the query
  const queryKeywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .filter(
      (word) =>
        ![
          "what",
          "where",
          "when",
          "how",
          "this",
          "that",
          "with",
          "from",
          "about",
          "places",
          "place",
          "visit",
          "travel",
          "want",
          "need",
          "tell",
          "know",
          "would",
          "could",
          "should",
          "looking",
          "which",
          "there",
          "they",
          "their",
          "some",
          "good",
          "best",
          "great",
          "nice",
          "find",
          "show",
          "give",
          "help",
        ].includes(word)
    );

  // Get location names from the query (often proper nouns)
  const locationPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
  const locationMatches = query.match(locationPattern) || [];
  const locations = locationMatches.map((loc) => loc.toLowerCase());

  // Log the keywords and locations for debugging
  console.log(`[FLOW] Query keywords: ${queryKeywords.join(", ")}`);
  console.log(`[FLOW] Potential locations: ${locations.join(", ")}`);

  // Extract all document text for relevance checking
  const docsText = state.retrievedDocs
    .map((doc) => doc.pageContent.toLowerCase())
    .join(" ");

  // Check if any location is mentioned in the documents
  const locationRelevant =
    locations.length > 0 && locations.some((loc) => docsText.includes(loc));

  // Relax keyword matching - only require 1 keyword match if we have any
  const keywordMatches = queryKeywords.filter((keyword) =>
    docsText.includes(keyword.toLowerCase())
  );

  // Document is relevant if either location matches OR at least one keyword matches
  const keywordRelevant = keywordMatches.length > 0;

  // Document is relevant if either location or keywords match
  const isRelevant = locationRelevant || keywordRelevant;

  console.log(
    `[FLOW] Document relevance: ${isRelevant ? "Relevant" : "Not relevant"}`
  );
  console.log(
    `[FLOW] Location match: ${locationRelevant}, Keyword matches: ${keywordMatches.length}/${queryKeywords.length}`
  );

  if (isRelevant) {
    console.log("[FLOW] Relevant documents found, routing to respond");
    return "respond";
  } else {
    console.log(
      "[FLOW] Documents not relevant enough, routing to agent for web search"
    );

    // Don't modify the state here - it breaks the tool calling flow

    return "callAgentModel";
  }
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
    lastMessage.content.includes("Please use the search_tool")
  ) {
    console.log(
      "[FLOW] Respond asking to use search_tool, routing to callAgentModel"
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
    // Feel free to customize the prompt, model, and other logic!
    const systemMessage = configuration.querySystemPromptTemplate
      .replace("{queries}", (state.queries || []).join("\n- "))
      .replace("{systemTime}", new Date().toISOString());

    const messageValue = [
      { role: "system", content: systemMessage },
      ...state.messages,
    ];
    const model = (
      await loadChatModel(configuration.responseModel)
    ).withStructuredOutput(SearchQuery);

    const generated = await model.invoke(messageValue);
    console.log(`[FLOW] Generated query: "${generated.query}"`);
    return {
      queries: [generated.query],
    };
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
  // If they're not relevant, the flow will route to callAgentModel with no extra message
  return {
    retrievedDocs: docs,
    // Don't add any messages here - those will be set at the routing decision
  };
}

async function respond(
  state: typeof GraphState.State,
  config: RunnableConfig
): Promise<typeof GraphState.Update> {
  console.log("[FLOW] Starting respond node");
  const configuration = ensureConfiguration(config);

  // Get the query and format retrieved documents
  const query = state.queries[state.queries.length - 1];
  const retrievedDocs = formatDocs(state.retrievedDocs);

  // Skip the secondary relevance check - if we're here, we've already determined
  // the documents are worth responding with
  console.log(`[FLOW] Using retrieved documents to generate response`);

  const model = await loadChatModel(configuration.responseModel);

  // Feel free to customize the prompt, model, and other logic!
  const systemMessage = configuration.responseSystemPromptTemplate
    .replace("{retrievedDocs}", retrievedDocs)
    .replace("{systemTime}", new Date().toISOString());
  const messageValue = [
    { role: "system", content: systemMessage },
    ...state.messages,
  ];
  const response = await model.invoke(messageValue);
  console.log("[FLOW] Response generated successfully");
  // We return a list, because this will get added to the existing list
  return { messages: [response] };
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

    // Process the travel query through the LangGraph agent
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
          responseModel: "groq/llama3-70b-8192",
          querySystemPromptTemplate: QUERY_SYSTEM_PROMPT_TEMPLATE,
          queryModel: "groq/llama3-70b-8192",
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
    console.log(finalState.messages[finalState.messages.length - 1].content);
    return finalState.messages[finalState.messages.length - 1].content;
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
export { app };
