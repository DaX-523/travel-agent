"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = callAgent;
exports.getApp = getApp;
const langgraph_1 = require("@langchain/langgraph");
const mongodb_1 = require("mongodb");
const messages_1 = require("@langchain/core/messages");
const tools_1 = require("@langchain/core/tools");
// import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
const zod_1 = require("zod");
const langgraph_checkpoint_mongodb_1 = require("@langchain/langgraph-checkpoint-mongodb");
const util_1 = require("./utils/util");
const configuration_1 = require("./utils/configuration");
const retrieval_1 = require("./utils/retrieval");
const state_1 = require("./utils/state");
const tools_2 = require("./utils/tools");
const prompts_1 = require("./utils/prompts");
require("dotenv/config");
const constants_1 = require("./utils/constants");
let app;
const client = new mongodb_1.MongoClient(process.env.MONGODB_ATLAS_URI);
function callAgentModel(state, config) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        console.log("[FLOW] Starting callAgentModel node");
        const configuration = (0, configuration_1.ensureConfiguration)(config);
        // First, define the info tool. This uses the user-provided
        // json schema to define the research targets
        // We pass an empty function because we will not actually invoke this tool.
        // We are just using it for formatting.
        const infoTool = (0, tools_1.tool)(() => __awaiter(this, void 0, void 0, function* () { }), {
            name: "Info",
            description: "Call this when you have gathered all the relevant info",
            schema: state.extractionSchema,
        });
        // Next, load the model
        const rawModel = yield (0, configuration_1.loadChatModel)(configuration.queryModel);
        if (!rawModel.bindTools) {
            throw new Error("Chat model does not support tool binding");
        }
        const model = rawModel.bindTools([...tools_2.MODEL_TOOLS, infoTool], {
            tool_choice: "any",
        });
        // Format the schema into the configurable system prompt
        const p = configuration.prompt
            .replace("{info}", JSON.stringify(state.extractionSchema, null, 2))
            .replace("{topic}", state.topic);
        const messages = [{ role: "user", content: p }, ...state.messages];
        // Next, we'll call the model.
        const response = yield model.invoke(messages);
        const responseMessages = [response];
        // After calling the model
        console.log("[FLOW] Agent model called, processing response");
        // If the model has collected enough information to fill out
        // the provided schema, great! It will call the "Info" tool
        let info;
        if (((response === null || response === void 0 ? void 0 : response.tool_calls) && ((_a = response.tool_calls) === null || _a === void 0 ? void 0 : _a.length)) || 0) {
            console.log(`[FLOW] Tool calls detected: ${(_b = response.tool_calls) === null || _b === void 0 ? void 0 : _b.map((tc) => tc.name).join(", ")}`);
            for (const tool_call of response.tool_calls || []) {
                if (tool_call.name === "Info") {
                    console.log("[FLOW] Info tool called - agent has finished collecting information");
                    info = tool_call.args;
                    // If info was called, the agent is submitting a response.
                    // (it's not actually a function to call, it's a schema to extract)
                    // To ensure that the graph doesn'tend up in an invalid state
                    // (where the AI has called tools but no tool message has been provided)
                    // we will drop any extra tool_calls.
                    response.tool_calls = (_c = response.tool_calls) === null || _c === void 0 ? void 0 : _c.filter((tool_call) => tool_call.name === "Info");
                    break;
                }
            }
        }
        else {
            console.log("[FLOW] No tool calls detected, prompting agent to use tools");
            responseMessages.push(new messages_1.HumanMessage("Please respond by calling one of the provided tools."));
        }
        return {
            messages: responseMessages,
            info,
            // This increments the step counter.
            // We configure a max step count to avoid infinite research loops
            loopStep: 1,
        };
    });
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
function reflect(state, config) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        console.log("[FLOW] Starting reflect node to evaluate collected info");
        const configuration = (0, configuration_1.ensureConfiguration)(config);
        const presumedInfo = state.info; // The current extracted result
        const lm = state.messages[state.messages.length - 1];
        if (!(lm._getType() === "ai")) {
            throw new Error(`${reflect.name} expects the last message in the state to be an AI message with tool calls. Got: ${lm._getType()}`);
        }
        const lastMessage = lm;
        // Load the configured model & provide the reflection/critique schema
        const rawModel = yield (0, configuration_1.loadChatModel)(configuration.queryModel);
        const boundModel = rawModel.withStructuredOutput(util_1.InfoIsSatisfactory);
        // Template in the conversation history:
        const p = configuration.prompt
            .replace("{info}", JSON.stringify(state.extractionSchema, null, 2))
            .replace("{topic}", state.topic);
        const messages = [
            { role: "user", content: p },
            ...state.messages.slice(0, -1),
        ];
        const p1 = constants_1.checker_prompt.replace("{presumed_info}", JSON.stringify(presumedInfo !== null && presumedInfo !== void 0 ? presumedInfo : {}, null, 2));
        messages.push({ role: "user", content: p1 });
        // Call the model
        const response = yield boundModel.invoke(messages);
        // console.log("reflect response", response, presumedInfo);
        // Find travel information in messages to include in the final response
        const messageHistory = state.messages;
        let travelInfo = "";
        // Go through previous tool messages to find search results
        for (let i = messageHistory.length - 1; i >= 0; i--) {
            const message = messageHistory[i];
            if (message._getType() === "tool" &&
                message.name === "search_tool" &&
                typeof message.content === "string") {
                travelInfo = message.content;
                console.log("[FLOW] Found search_tool results to include in final response");
                break;
            }
        }
        // If search results not found, look for scrapeWebsite results
        if (!travelInfo) {
            // Try to extract content from scrapeWebsite results
            const scrapedContent = [];
            for (let i = messageHistory.length - 1; i >= 0; i--) {
                const message = messageHistory[i];
                if (message._getType() === "tool" &&
                    message.name === "scrapeWebsite" &&
                    typeof message.content === "string") {
                    scrapedContent.push(message.content);
                    if (scrapedContent.length >= 3)
                        break; // Get content from up to 3 websites
                }
            }
            console.log("[FLOW] Scraped content foound : ", scrapedContent);
            if (scrapedContent.length > 0) {
                // Extract location names from the scraped content
                const locationRegex = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*(?:\s(?:Islands?|Mountains?|National\s+Park|Beach|City))?)\b/g;
                const allContent = scrapedContent.join(" ");
                let locations = [];
                let match;
                while ((match = locationRegex.exec(allContent)) !== null) {
                    if (!["The", "This", "These", "Those", "Some", "Many", "All"].includes(match[0])) {
                        locations.push(match[0]);
                    }
                }
                // Remove duplicates and get top locations
                locations = [...new Set(locations)].slice(0, 5);
                // Create a formatted response based on the topic and extracted locations
                const query = state.topic;
                console.log("[FLOW] Creating formatted response from scraped content for:", query);
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
                    }
                    else {
                        travelInfo += `5. **Natural Attractions**: Explore the diverse landscapes and natural wonders of ${destination}.\n\n`;
                        travelInfo += `6. **Cultural Experiences**: Immerse yourself in local traditions, cuisine, and cultural activities.\n\n`;
                        travelInfo += `7. **Best Time to Visit**: Consider visiting during the dry season for optimal weather conditions.\n\n`;
                        travelInfo += `8. **Local Transportation**: Get around efficiently using local transportation options available throughout the region.\n\n`;
                    }
                }
                else {
                    // Not enough specific locations found, use template format
                    travelInfo = `Here are the top places to visit in ${destination}:
        
        ${constants_1.fallBackTemplate}
`;
                }
                // Add source references
                travelInfo += "Based on analyzed content from multiple travel websites.";
            }
            else {
                // Create a generic formatted response based on the topic
                const query = state.topic;
                console.log("[FLOW] Creating generic formatted response for:", query);
                travelInfo = `Here are the top places to visit in ${query}:
      
      ${constants_1.fallBackTemplate}
`;
            }
        }
        if (response.is_satisfactory && presumedInfo) {
            console.log("[FLOW] Info deemed satisfactory by reflection");
            // Now we return the actual travel information alongside the success message
            return {
                info: presumedInfo,
                messages: [
                    new messages_1.ToolMessage({
                        tool_call_id: ((_b = (_a = lastMessage.tool_calls) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.id) || "",
                        content: travelInfo,
                        name: "Info",
                        artifact: response,
                        status: "success",
                    }),
                ],
            };
        }
        else {
            console.log("[FLOW] Info deemed unsatisfactory, feedback: " +
                (response.improvement_instructions
                    ? response.improvement_instructions.substring(0, 100)
                    : "No specific feedback"));
            return {
                messages: [
                    new messages_1.ToolMessage({
                        tool_call_id: ((_d = (_c = lastMessage.tool_calls) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.id) || "",
                        content: `Unsatisfactory response:\n${response.improvement_instructions}`,
                        name: "Info",
                        artifact: response,
                        status: "error",
                    }),
                ],
            };
        }
    });
}
/**
 * Determines the next step in the research process based on the agent's last action.
 *
 * @param state - The current state of the research process.
 * @returns "reflect" if the agent has called the "Info" tool to submit findings,
 *          "tools" if the agent has called any other tool or no tool at all.
 */
function routeAfterAgent(state) {
    var _a;
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage._getType() !== "ai") {
        console.log("[FLOW] Last message is not AI message, routing to callAgentModel");
        return "callAgentModel";
    }
    if (lastMessage.tool_calls && ((_a = lastMessage.tool_calls[0]) === null || _a === void 0 ? void 0 : _a.name) === "Info") {
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
function routeAfterChecker(state, config) {
    console.log("[FLOW] Starting routeAfterChecker");
    const configuration = (0, configuration_1.ensureConfiguration)(config);
    const lastMessage = state.messages[state.messages.length - 1];
    if (state.loopStep < configuration.maxLoops) {
        if (!state.info) {
            console.log("[FLOW] No info collected yet, routing back to callAgentModel");
            return "callAgentModel";
        }
        if (lastMessage._getType() !== "tool") {
            throw new Error(`routeAfterChecker expected a tool message. Received: ${lastMessage._getType()}.`);
        }
        if (lastMessage.status === "error") {
            console.log("[FLOW] Info deemed unsatisfactory, routing back to callAgentModel");
            return "callAgentModel";
        }
        console.log("[FLOW] Info is satisfactory, ending agent execution");
        return "__end__";
    }
    else {
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
function routeAfterQueryGen(state) {
    const query = state.queries[state.queries.length - 1];
    // Simple detection of complex queries needing agent reasoning
    // If the query matches any complex pattern, route to agent
    if (constants_1.complexPatterns.some((pattern) => pattern.test(query))) {
        console.log("[FLOW] Complex query detected: Routing to callAgentModel");
        return "callAgentModel";
    }
    // For simple factual queries, use direct retrieval
    console.log("[FLOW] Simple factual query detected: Routing to retrieve");
    return "retrieve";
}
function generateQuery(state, config) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("[FLOW] Starting generateQuery node");
        const messages = state.messages;
        // console.log(messages, "messages");
        if (messages.length === 1) {
            const humanInput = (0, util_1.getMessageText)(messages[messages.length - 1]);
            console.log(`[FLOW] First message, using direct input as query: "${humanInput.substring(0, 50)}${humanInput.length > 50 ? "..." : ""}"`);
            return {
                queries: [humanInput],
            };
        }
        else {
            const configuration = (0, configuration_1.ensureConfiguration)(config);
            console.log("[FLOW] Generating refined search query from conversation");
            const SearchQuery = zod_1.z.object({
                query: zod_1.z.string().describe("Search the indexed documents for a query."),
            });
            // Feel free to customize the prompt, model, and other logic!
            const systemMessage = configuration.querySystemPromptTemplate
                .replace("{queries}", (state.queries || []).join("\n- "))
                .replace("{systemTime}", new Date().toISOString());
            const messageValue = [
                { role: "system", content: systemMessage },
                ...state.messages,
            ];
            const model = (yield (0, configuration_1.loadChatModel)(configuration.responseModel)).withStructuredOutput(SearchQuery);
            const generated = yield model.invoke(messageValue);
            console.log(`[FLOW] Generated query: "${generated.query}"`);
            return {
                queries: [generated.query],
            };
        }
    });
}
function retrieve(state, config) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("[FLOW] Starting retrieve node");
        const my_retriever = yield (0, retrieval_1.makeRetriever)(config);
        const query = state.queries[state.queries.length - 1];
        console.log(`[FLOW] Retrieving documents for query: "${query}"`);
        const docs = yield my_retriever.invoke(query);
        console.log(`[FLOW] Retrieved ${docs.length} documents`);
        // If no documents found, we should route to the agent to use web search
        if (docs.length === 0) {
            console.log("[FLOW] No documents found in the database, will use web search");
            // Add a message prompting the agent to use web search
            return {
                retrievedDocs: docs,
                messages: [
                    new messages_1.HumanMessage({
                        content: `No information about "${query}" was found in our database. Please use the search_tool to find information about this on the web.`,
                    }),
                ],
            };
        }
        return { retrievedDocs: docs };
    });
}
function respond(state, config) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("[FLOW] Starting respond node");
        const configuration = (0, configuration_1.ensureConfiguration)(config);
        // Get the query and check document relevance
        const query = state.queries[state.queries.length - 1];
        const retrievedDocs = (0, util_1.formatDocs)(state.retrievedDocs);
        // Check if documents contain relevant information about the query
        const containsQuery = query
            .toLowerCase()
            .split(" ")
            .filter((word) => word.length > 3 &&
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
            ].includes(word));
        const isRelevant = state.retrievedDocs.length > 0 &&
            containsQuery.some((keyword) => retrievedDocs.toLowerCase().includes(keyword.toLowerCase()));
        console.log(`[FLOW] Query keywords: ${containsQuery.join(", ")}`);
        console.log(`[FLOW] Documents relevant to query: ${isRelevant}`);
        // If documents are not relevant, route to agent for web search
        if (!isRelevant) {
            console.log("[FLOW] Retrieved documents not relevant to query, routing to search tool");
            return {
                messages: [
                    new messages_1.HumanMessage({
                        content: `The information in our database doesn't match what you're looking for regarding "${query}". Please use the search_tool to find this information on the web.`,
                    }),
                ],
            };
        }
        const model = yield (0, configuration_1.loadChatModel)(configuration.responseModel);
        // Feel free to customize the prompt, model, and other logic!
        const systemMessage = configuration.responseSystemPromptTemplate
            .replace("{retrievedDocs}", retrievedDocs)
            .replace("{systemTime}", new Date().toISOString());
        const messageValue = [
            { role: "system", content: systemMessage },
            ...state.messages,
        ];
        const response = yield model.invoke(messageValue);
        console.log("[FLOW] Response generated successfully");
        // We return a list, because this will get added to the existing list
        return { messages: [response] };
    });
}
// Modify the routeAfterRetrieve function
function routeAfterRetrieve(state) {
    // If no documents were found, route to the agent to use web search
    if (state.retrievedDocs.length === 0) {
        console.log("[FLOW] No documents found, routing to agent for web search");
        return "callAgentModel";
    }
    console.log("[FLOW] Documents found, routing to respond");
    return "respond";
}
// Add a function to route after respond
function routeAfterRespond(state) {
    // Get the last message
    const lastMessage = state.messages[state.messages.length - 1];
    // If the last message is asking to use search_tool, route to callAgentModel
    if (lastMessage._getType() === "human" &&
        typeof lastMessage.content === "string" &&
        lastMessage.content.includes("Please use the search_tool")) {
        console.log("[FLOW] Respond asking to use search_tool, routing to callAgentModel");
        return "callAgentModel";
    }
    console.log("[FLOW] Normal response, ending workflow");
    return "__end__";
}
function makeGraph() {
    const workflow = new langgraph_1.StateGraph({
        stateSchema: state_1.StateAnnotation,
        input: state_1.InputStateAnnotation,
    }, configuration_1.ConfigurationAnnotation)
        .addNode("generateQuery", generateQuery)
        .addNode("retrieve", retrieve)
        .addNode("callAgentModel", callAgentModel)
        .addNode("tools", tools_2.toolNode)
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
    const checkpointer = new langgraph_checkpoint_mongodb_1.MongoDBSaver({
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
function callAgent(query, threadId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Enhanced detection of simple queries that don't need tools
            const isSimpleQuery = (query) => {
                // Greetings and common conversational phrases
                const conversationalPatterns = [
                    /^hi\b/i,
                    /^hello\b/i,
                    /^hey\b/i,
                    /^good (morning|afternoon|evening)\b/i,
                    /^how are you\b/i,
                    /^what's up\b/i,
                    /^thanks?\b/i,
                    /^thank you\b/i,
                    /^bye\b/i,
                    /^goodbye\b/i,
                    /^see you\b/i,
                ];
                // If it matches any conversational pattern, it's a simple query
                if (conversationalPatterns.some((pattern) => pattern.test(query))) {
                    return true;
                }
                // Check if query is related to travel
                const travelRelatedTerms = [
                    "travel",
                    "trip",
                    "vacation",
                    "hotel",
                    "flight",
                    "restaurant",
                    "destination",
                    "tour",
                    "visit",
                    "place",
                    "attraction",
                    "city",
                    "country",
                    "where",
                    "when",
                    "ticket",
                    "booking",
                    "reserve",
                    "beach",
                    "mountain",
                    "museum",
                    "park",
                    "resort",
                ];
                // If the query doesn't contain any travel-related terms,
                // and is relatively short, consider it a simple query
                const words = query.toLowerCase().split(/\s+/);
                const containsTravelTerms = travelRelatedTerms.some((term) => query.toLowerCase().includes(term.toLowerCase()));
                // Short queries without travel terms are likely simple conversational queries
                return !containsTravelTerms && words.length < 10;
            };
            // If it's a simple query, respond directly without using tools
            if (isSimpleQuery(query)) {
                const model = yield (0, configuration_1.loadChatModel)("openai/gpt-4o");
                const response = yield model.invoke([
                    {
                        role: "system",
                        content: "You are a friendly travel assistant. For non-travel related queries, respond naturally and briefly. Don't mention travel unless the user asks about it.",
                    },
                    new messages_1.HumanMessage({
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
            // Now using the searchTool from utils/tools.ts
            // const tools = [lookupTool, ...MODEL_TOOLS];
            // const toolNode1 = new ToolNode<typeof GraphState.State>(tools);
            // const chatModel = new ChatOpenAI({
            //   model: "gpt-4o",
            //   temperature: 0.7,
            // }).bindTools(tools);
            const finalState = yield app.invoke({
                topic: query,
                messages: [new messages_1.HumanMessage({ content: query })],
                queries: [query],
                info: {},
                extractionSchema: {},
            }, {
                recursionLimit: 30,
                configurable: {
                    thread_id: threadId,
                    responseSystemPromptTemplate: prompts_1.RESPONSE_SYSTEM_PROMPT_TEMPLATE,
                    responseModel: "openai/gpt-4o",
                    querySystemPromptTemplate: prompts_1.QUERY_SYSTEM_PROMPT_TEMPLATE,
                    queryModel: "openai/gpt-4o",
                    prompt: prompts_1.MAIN_PROMPT,
                    maxSearchResults: 5,
                    maxInfoToolCalls: 3,
                    maxLoops: 6,
                    embeddingModel: "cohere/embed-english-v3.0",
                    retrieverProvider: "pinecone",
                    searchKwargs: {},
                },
            });
            console.log(finalState.messages[finalState.messages.length - 1].content);
            return finalState.messages[finalState.messages.length - 1].content;
        }
        catch (error) {
            console.error(error);
            process.exit(1);
        }
    });
}
function getApp() {
    return __awaiter(this, void 0, void 0, function* () {
        // Return existing app if already initialized
        if (app)
            return app;
        try {
            console.log("[LANGGRAPH] Initializing app...");
            // Create a dummy query to initialize everything
            const dummyQuery = "[FLOW]initialize";
            const dummyThreadId = "initialization-thread";
            // This will initialize the app variable
            yield callAgent(dummyQuery, dummyThreadId);
            // Make sure app is properly initialized with required configurable fields
            if (!app) {
                makeGraph();
            }
            console.log("[LANGGRAPH] App initialized successfully");
            return app;
        }
        catch (error) {
            console.error("[LANGGRAPH] Error initializing app:", error);
            throw error;
        }
    });
}
