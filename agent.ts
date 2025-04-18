import { Annotation, StateGraph } from "@langchain/langgraph";

import { MongoClient } from "mongodb";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  ToolMessage,
} from "@langchain/core/messages";

import { tool } from "@langchain/core/tools";
// import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { z } from "zod";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
// import { CohereEmbeddings } from "@langchain/cohere";
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
import {
  checker_prompt,
  complexPatterns,
  fallBackTemplate,
} from "./utils/constants";
import {
  analyzeQuery,
  handleGreeting,
  POLITE_REJECTION_MESSAGE,
} from "./utils/query-filter";

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
  const messages = [{ role: "user", content: p }, ...state.messages];

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
        if (scrapedContent.length >= 3) break; // Get content from up to 3 websites
      }
    }
    console.log("[FLOW] Scraped content foound : ", scrapedContent);
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
        
        ${fallBackTemplate}
`;
      }

      // Add source references
      travelInfo += "Based on analyzed content from multiple travel websites.";
    } else {
      // Create a generic formatted response based on the topic
      const query = state.topic;
      console.log("[FLOW] Creating generic formatted response for:", query);
      travelInfo = `Here are the top places to visit in ${query}:
      
      ${fallBackTemplate}
`;
    }
  }

  if (response.is_satisfactory && presumedInfo) {
    console.log("[FLOW] Info deemed satisfactory by reflection");

    // Now we return the actual travel information alongside the success message
    return {
      info: presumedInfo,
      messages: [
        new ToolMessage({
          tool_call_id: lastMessage.tool_calls?.[0]?.id || "",
          content: travelInfo,
          name: "Info",
          artifact: response,
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
          artifact: response,
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
 * Determines the next node after query generation based on the complexity and type of the query.
 *
 * @param state - The current state of the workflow.
 * @returns "retrieve" for simple factual queries that can be directly answered with vector retrieval,
 *          "callAgentModel" for complex queries requiring reasoning or multi-step planning.
 */
function routeAfterQueryGen(
  state: typeof StateAnnotation.State
): "retrieve" | "callAgentModel" {
  const query = state.queries[state.queries.length - 1];

  // Simple detection of complex queries needing agent reasoning

  // If the query matches any complex pattern, route to agent
  if (complexPatterns.some((pattern) => pattern.test(query))) {
    console.log("[FLOW] Complex query detected: Routing to callAgentModel");
    return "callAgentModel";
  }

  // For simple factual queries, use direct retrieval
  console.log("[FLOW] Simple factual query detected: Routing to retrieve");
  return "retrieve";
}

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
    const SearchQuery = z.object({
      query: z.string().describe("Search the indexed documents for a query."),
    });
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

  return { retrievedDocs: docs };
}

async function respond(
  state: typeof GraphState.State,
  config: RunnableConfig
): Promise<typeof GraphState.Update> {
  console.log("[FLOW] Starting respond node");
  const configuration = ensureConfiguration(config);

  // Get the query and check document relevance
  const query = state.queries[state.queries.length - 1];
  const retrievedDocs = formatDocs(state.retrievedDocs);

  // Check if documents contain relevant information about the query
  const containsQuery = query
    .toLowerCase()
    .split(" ")
    .filter(
      (word) =>
        word.length > 3 &&
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
        ].includes(word)
    );

  const isRelevant =
    state.retrievedDocs.length > 0 &&
    containsQuery.some((keyword) =>
      retrievedDocs.toLowerCase().includes(keyword.toLowerCase())
    );

  console.log(`[FLOW] Query keywords: ${containsQuery.join(", ")}`);
  console.log(`[FLOW] Documents relevant to query: ${isRelevant}`);

  // If documents are not relevant, route to agent for web search
  if (!isRelevant) {
    console.log(
      "[FLOW] Retrieved documents not relevant to query, routing to search tool"
    );
    return {
      messages: [
        new HumanMessage({
          content: `The information in our database doesn't match what you're looking for regarding "${query}". Please use the search_tool to find this information on the web.`,
        }),
      ],
    };
  }

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

// Modify the routeAfterRetrieve function
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

function makeGraph() {
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
}

export default async function callAgent(query: string, threadId: string) {
  try {
    // Analyze the query using our utility function
    const { isOffTopic, isSimple, isGreeting } = analyzeQuery(query);

    // If query is off-topic, return polite rejection message
    if (isOffTopic) {
      return POLITE_REJECTION_MESSAGE;
    }

    // If it's a simple greeting, handle it directly
    if (isGreeting) {
      return await handleGreeting(query);
    }

    // If it's a simple query but not a greeting, handle with basic model
    if (isSimple) {
      const model = await loadChatModel("openai/gpt-4o");
      const response = await model.invoke([
        {
          role: "system",
          content:
            "You are a friendly travel assistant. For conversational greetings like 'hello', 'thank you', etc., respond naturally and briefly. For any substantive questions not related to travel, tourism, vacations, destinations, or hospitality, politely decline with: 'I'm specialized in travel assistance and can only provide information about destinations, accommodations, attractions, and travel planning. For questions outside travel-related topics, please consult a general-purpose assistant.' DO NOT attempt to answer non-travel questions.",
        },
        new HumanMessage({
          content: query,
        }),
      ]);
      return response.content;
    }

    // console.log("query", query);
    const db = client.db("AI-Travel-Agent");
    const collection = db.collection("places");
    if (!app) {
      makeGraph();
    }
    if (query === "[FLOW]initialize") {
      makeGraph();
      return "Graph Initiated";
    }

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
          responseModel: "openai/gpt-4o",
          querySystemPromptTemplate: QUERY_SYSTEM_PROMPT_TEMPLATE,
          queryModel: "openai/gpt-4o",
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

export async function getApp() {
  // Return existing app if already initialized
  if (app) return app;

  try {
    console.log("[LANGGRAPH] Initializing app...");

    // Create a dummy query to initialize everything
    const dummyQuery = "[FLOW]initialize";
    const dummyThreadId = "initialization-thread";

    // This will initialize the app variable
    await callAgent(dummyQuery, dummyThreadId);

    // Make sure app is properly initialized with required configurable fields
    if (!app) {
      makeGraph();
    }

    console.log("[LANGGRAPH] App initialized successfully");
    return app;
  } catch (error) {
    console.error("[LANGGRAPH] Error initializing app:", error);
    throw error;
  }
}
