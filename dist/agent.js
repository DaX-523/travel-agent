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
const langgraph_1 = require("@langchain/langgraph");
const prebuilt_1 = require("@langchain/langgraph/prebuilt");
const openai_1 = require("@langchain/openai");
const messages_1 = require("@langchain/core/messages");
const prompts_1 = require("@langchain/core/prompts");
const tools_1 = require("@langchain/core/tools");
const mongodb_1 = require("@langchain/mongodb");
const zod_1 = require("zod");
const langgraph_checkpoint_mongodb_1 = require("@langchain/langgraph-checkpoint-mongodb");
const cohere_1 = require("@langchain/cohere");
const util_1 = require("./utils/util");
const configuration_1 = require("./utils/configuration");
const retrieval_1 = require("./utils/retrieval");
function callAgent(client, query, threadId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log("query", query);
            const db = client.db("AI-Travel-Agent");
            const collection = db.collection("places");
            const GraphState = langgraph_1.Annotation.Root({
                messages: (0, langgraph_1.Annotation)({
                    reducer: (left, right) => {
                        if (Array.isArray(right))
                            return left.concat(right);
                        return left.concat([right]);
                    },
                    default: () => [],
                }),
                queries: (0, langgraph_1.Annotation)({
                    reducer: (left, right) => {
                        if (Array.isArray(right))
                            return left.concat(right);
                        return left.concat([right]);
                    },
                    default: () => [],
                }),
                retrievedDocs: (langgraph_1.Annotation),
            });
            const lookupTool = (0, tools_1.tool)((_a) => __awaiter(this, [_a], void 0, function* ({ query, n = 10 }) {
                console.log("Lookup Tool");
                const dbConfig = {
                    collection,
                    indexName: "vector_index",
                    textKey: "embedding_text",
                    embeddingKey: "embedding",
                };
                const vectorStore = new mongodb_1.MongoDBAtlasVectorSearch(new cohere_1.CohereEmbeddings({ model: "embed-english-v3.0" }), dbConfig);
                const result = yield vectorStore.similaritySearchWithScore(query, n);
                return JSON.stringify(result);
            }), {
                name: "places_lookup",
                description: "Place to search for the agent for suitale search results",
                schema: zod_1.z.object({
                    query: zod_1.z.string().describe("The Search Query"),
                    n: zod_1.z
                        .number()
                        .optional()
                        .default(10)
                        .describe("Number of results to return"),
                }),
            });
            const searchTool = (0, tools_1.tool)(() => __awaiter(this, void 0, void 0, function* () { }), {
                name: "search_tool",
                description: "Tool for lookup in web.",
            });
            const tools = [lookupTool, searchTool];
            const toolNode = new prebuilt_1.ToolNode(tools);
            const chatModel = new openai_1.ChatOpenAI({
                model: "gpt-4o",
                temperature: 0.7,
            }).bindTools(tools);
            const SearchQuery = zod_1.z.object({
                query: zod_1.z.string().describe("Search the indexed documents for a query."),
            });
            function generateQuery(state, config) {
                return __awaiter(this, void 0, void 0, function* () {
                    const messages = state.messages;
                    if (messages.length === 1) {
                        const humanInput = (0, util_1.getMessageText)(messages[messages.length - 1]);
                        return {
                            queries: [humanInput],
                        };
                    }
                    else {
                        const configuration = (0, configuration_1.ensureConfiguration)(config);
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
                        return {
                            queries: [generated.query],
                        };
                    }
                });
            }
            function retrieve(state, config) {
                return __awaiter(this, void 0, void 0, function* () {
                    const my_retriever = yield (0, retrieval_1.makeRetriever)(config);
                    const query = state.queries[state.queries.length - 1];
                    const docs = yield my_retriever.invoke(query);
                    console.log("docs", docs);
                    return { retrievedDocs: docs };
                });
            }
            function respond(state, config) {
                return __awaiter(this, void 0, void 0, function* () {
                    const configuration = (0, configuration_1.ensureConfiguration)(config);
                    const model = yield (0, configuration_1.loadChatModel)(configuration.responseModel);
                    const retrievedDocs = (0, util_1.formatDocs)(state.retrievedDocs);
                    // Feel free to customize the prompt, model, and other logic!
                    console.log("docs2", retrievedDocs);
                    const systemMessage = configuration.responseSystemPromptTemplate
                        .replace("{retrievedDocs}", retrievedDocs)
                        .replace("{systemTime}", new Date().toISOString());
                    const messageValue = [
                        { role: "system", content: systemMessage },
                        ...state.messages,
                    ];
                    const response = yield model.invoke(messageValue);
                    // We return a list, because this will get added to the existing list
                    return { messages: [response] };
                });
            }
            function callModel(state) {
                return __awaiter(this, void 0, void 0, function* () {
                    const prompt = prompts_1.ChatPromptTemplate.fromMessages([
                        [
                            "system",
                            `You are a helpful AI assistant, collaborating with other assistants. Use the provided tools to progress towards answering the question. If you are unable to fully answer, that's OK, another assistant with different tools will help where you left off. Execute what you can to make progress. If you or any of the other assistants have the final answer or deliverable, prefix your response with FINAL ANSWER so the team knows to stop. If no relevant locations are found in the database, clearly inform the user instead of making assumptions. You have access to the following tools: {tool_names}.\n{system_message}\nCurrent time: {time}.`,
                        ],
                        new prompts_1.MessagesPlaceholder("messages"),
                    ]);
                    const formattedPrompt = yield prompt.formatMessages({
                        system_message: "You are a helpful Travel Agent.",
                        time: new Date().toISOString(),
                        tool_names: tools.map((tool) => tool.name).join(", "),
                        messages: state.messages,
                    });
                    const result = yield chatModel.invoke(formattedPrompt);
                    return { messages: [result] };
                });
            }
            //raw toolsCondition
            function shouldContinue(state) {
                const messages = state.messages;
                const lastMessage = messages[messages.length - 1];
                if (lastMessage &&
                    lastMessage.tool_calls &&
                    lastMessage.tool_calls.length > 0)
                    return "tools";
                return "__end__";
            }
            const workflow = new langgraph_1.StateGraph(GraphState)
                .addNode("generateQuery", generateQuery)
                .addNode("retrieve", retrieve)
                .addNode("respond", respond)
                .addEdge("__start__", "generateQuery")
                .addEdge("generateQuery", "retrieve")
                .addEdge("retrieve", "respond");
            const checkpointer = new langgraph_checkpoint_mongodb_1.MongoDBSaver({
                client,
                dbName: "AI-Travel-Agent",
            });
            const app = workflow.compile({
                checkpointer,
                interruptBefore: [],
                interruptAfter: [],
            });
            app.name = "Travel Agent";
            const finalState = yield app.invoke({
                messages: [new messages_1.HumanMessage({ content: query })],
                queries: [query],
            }, {
                recursionLimit: 15,
                configurable: { thread_id: threadId },
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
