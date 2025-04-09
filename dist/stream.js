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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamAgent = streamAgent;
const messages_1 = require("@langchain/core/messages");
const agent_1 = require("./agent");
const prompts_1 = require("./utils/prompts");
/**
 * Streams the agent's response to a callback function
 *
 * @param query - The user's query
 * @param threadId - The conversation thread ID
 * @param callback - Function to call with each chunk of streamed text
 */
function streamAgent(query, threadId, callback) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        var _d, _e, _f, _g;
        try {
            console.log(`[STREAM] Starting streaming for query: "${query}" (threadId: ${threadId})`);
            const app = yield (0, agent_1.getApp)();
            // Set up the initial state
            const initialState = {
                topic: query,
                messages: [new messages_1.HumanMessage({ content: query })],
                queries: [query],
                info: {},
                extractionSchema: {},
            };
            // Configuration with thread ID
            const config = {
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
            };
            console.log("[STREAM] Setting up stream with combined streaming modes");
            // Use all available stream modes to ensure we capture everything
            const streamOptions = {
                // Stream modes: "values" | "updates" | "debug" | "messages"
                streamMode: ["messages", "values", "updates", "debug"],
            };
            // Get the stream
            const stream = yield app.stream(initialState, config, streamOptions);
            console.log("[STREAM] Stream created, starting iteration");
            let chunkCount = 0;
            let finalResponse = null;
            try {
                // Use the stream method to stream messages
                for (var _h = true, stream_1 = __asyncValues(stream), stream_1_1; stream_1_1 = yield stream_1.next(), _a = stream_1_1.done, !_a; _h = true) {
                    _c = stream_1_1.value;
                    _h = false;
                    const chunk = _c;
                    chunkCount++;
                    console.log(`[STREAM] Received chunk #${chunkCount}:`, JSON.stringify(chunk, null, 2).substring(0, 200) + "...");
                    // Try different properties based on what might be available
                    let content = null;
                    // Debug full chunk structure
                    console.log("[STREAM] Chunk keys:", Object.keys(chunk));
                    // Check for known content structures
                    // If it's a message chunk (content property)
                    if ((_d = chunk.value) === null || _d === void 0 ? void 0 : _d.content) {
                        content = String(chunk.value.content);
                        console.log("[STREAM] Found content in chunk.value.content");
                    }
                    // Updates mode - look for messages in updates
                    else if (((_e = chunk.updates) === null || _e === void 0 ? void 0 : _e.messages) && chunk.updates.messages.length > 0) {
                        const lastMessage = chunk.updates.messages[chunk.updates.messages.length - 1];
                        if (lastMessage && lastMessage.content) {
                            content = String(lastMessage.content);
                            console.log("[STREAM] Found content in chunk.updates.messages");
                        }
                    }
                    // Values mode - look for messages in state
                    else if (((_f = chunk.state) === null || _f === void 0 ? void 0 : _f.messages) && chunk.state.messages.length > 0) {
                        const lastMessage = chunk.state.messages[chunk.state.messages.length - 1];
                        if (lastMessage && lastMessage.content) {
                            content = String(lastMessage.content);
                            console.log("[STREAM] Found content in chunk.state.messages");
                        }
                    }
                    // Look for token property (some LLMs use this)
                    else if (chunk.token) {
                        content = String(chunk.token);
                        console.log("[STREAM] Found content in chunk.token");
                    }
                    // Look for node_output for node execution results
                    else if (chunk.node_output) {
                        try {
                            // Try to stringify the node output if it's an object
                            content =
                                typeof chunk.node_output === "object"
                                    ? JSON.stringify(chunk.node_output)
                                    : String(chunk.node_output);
                            console.log("[STREAM] Found content in chunk.node_output");
                        }
                        catch (e) {
                            console.log("[STREAM] Error stringifying node_output:", e);
                        }
                    }
                    // If there's content in this chunk
                    if (content) {
                        console.log(`[STREAM] Sending chunk content (${content.length} chars):`, content.substring(0, 50) + (content.length > 50 ? "..." : ""));
                        callback(content);
                    }
                    // No content found in this chunk
                    else {
                        // Check for final messages in the state
                        if (((_g = chunk.state) === null || _g === void 0 ? void 0 : _g.messages) && chunkCount > 2) {
                            // This might be a final state chunk, try to get the last message
                            const messages = chunk.state.messages;
                            if (messages.length > 0) {
                                const lastMsg = messages[messages.length - 1];
                                if (lastMsg &&
                                    lastMsg.content &&
                                    lastMsg._getType &&
                                    lastMsg._getType() === "ai") {
                                    finalResponse = String(lastMsg.content);
                                    console.log("[STREAM] Found final response in state.messages:", finalResponse.substring(0, 50) +
                                        (finalResponse.length > 50 ? "..." : ""));
                                }
                            }
                        }
                        // Last resort: Try to log and analyze the entire chunk
                        console.log("[STREAM] Could not extract content from chunk. Full chunk:", JSON.stringify(chunk));
                    }
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (!_h && !_a && (_b = stream_1.return)) yield _b.call(stream_1);
                }
                finally { if (e_1) throw e_1.error; }
            }
            // If we found a final response but couldn't stream it properly, send it at the end
            if (finalResponse && chunkCount <= 3) {
                console.log("[STREAM] Sending final response as a single chunk");
                callback(finalResponse);
            }
            console.log(`[STREAM] Streaming completed, processed ${chunkCount} chunks`);
        }
        catch (error) {
            console.error("[STREAM] Error during streaming:", error);
            throw error;
        }
    });
}
