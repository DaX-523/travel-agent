"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const mongodb_1 = require("mongodb");
const agent_1 = __importStar(require("./agent"));
const messages_1 = require("@langchain/core/messages");
const cors_1 = __importDefault(require("cors"));
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)());
// Initialize MongoDB client
const client = new mongodb_1.MongoClient(process.env.MONGODB_ATLAS_URI);
function startServer() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield client.connect();
            yield client.db("admin").command({ ping: 1 });
            console.log("Pinged your deployment. You successfully connected to MongoDB!");
            // Access the messages collection
            const db = client.db("AI-Travel-Agent");
            const messagesCollection = db.collection("messages");
            const threadsCollection = db.collection("threads");
            // Middleware to ensure collections exist
            yield db
                .createCollection("messages", {})
                .catch(() => console.log("Messages collection already exists"));
            yield db
                .createCollection("threads", {})
                .catch(() => console.log("Threads collection already exists"));
            app.get("/", (req, res) => {
                res.send("LangGraph Agent Server");
            });
            // New endpoint to get all threads
            app.get("/threads", (req, res) => __awaiter(this, void 0, void 0, function* () {
                try {
                    // Get all threads with most recent activity first
                    const threads = yield threadsCollection
                        .find({})
                        .sort({ lastActivity: -1 })
                        .toArray();
                    res.json({ threads });
                }
                catch (error) {
                    console.error("Error fetching threads:", error);
                    res.status(500).json({ error: "Failed to fetch threads" });
                }
            }));
            // New endpoint to get messages for a specific thread
            app.get("/threads/:threadId", (req, res) => __awaiter(this, void 0, void 0, function* () {
                const { threadId } = req.params;
                try {
                    // Get thread info
                    const thread = yield threadsCollection.findOne({ threadId });
                    if (!thread) {
                        return res.status(404).json({ error: "Thread not found" });
                    }
                    // Get messages for this thread
                    const messages = yield messagesCollection
                        .find({ threadId })
                        .sort({ timestamp: 1 })
                        .toArray();
                    res.json({
                        thread,
                        messages,
                    });
                }
                catch (error) {
                    console.error("Error fetching thread messages:", error);
                    res.status(500).json({ error: "Failed to fetch thread messages" });
                }
            }));
            // Helper function to save messages and update thread info
            function saveMessage(threadId, role, content) {
                return __awaiter(this, void 0, void 0, function* () {
                    const timestamp = new Date();
                    // Save the message
                    yield messagesCollection.insertOne({
                        threadId,
                        role,
                        content,
                        timestamp,
                    });
                    // Update or create thread info
                    yield threadsCollection.updateOne({ threadId }, {
                        $set: {
                            lastActivity: timestamp,
                            lastMessage: content.substring(0, 100) + (content.length > 100 ? "..." : ""),
                        },
                        $setOnInsert: {
                            threadId,
                            createdAt: timestamp,
                        },
                    }, { upsert: true });
                });
            }
            app.post("/chat", (req, res) => __awaiter(this, void 0, void 0, function* () {
                const initialMessage = req.body.message;
                const threadId = Date.now().toString();
                if (!initialMessage)
                    return res.status(400).json({ message: "Error Bad Request" });
                try {
                    const response = yield (0, agent_1.default)(initialMessage, threadId);
                    // Save messages to database
                    yield saveMessage(threadId, "user", initialMessage);
                    yield saveMessage(threadId, "assistant", response);
                    res.json({ threadId, response });
                }
                catch (error) {
                    console.error("Error starting conversation:", error);
                    res.status(500).json({ error: "Internal server error" });
                }
            }));
            app.post("/chat/:threadId", (req, res) => __awaiter(this, void 0, void 0, function* () {
                const { threadId } = req.params;
                const { message } = req.body;
                try {
                    const response = yield (0, agent_1.default)(message, threadId);
                    // Save messages to database
                    yield saveMessage(threadId, "user", message);
                    yield saveMessage(threadId, "assistant", response);
                    res.json({ response });
                }
                catch (error) {
                    console.error("Error in chat:", error);
                    res.status(500).json({ error: "Internal server error" });
                }
            }));
            app.post("/stream", (req, res) => __awaiter(this, void 0, void 0, function* () {
                var _a, e_1, _b, _c, _d, e_2, _e, _f;
                var _g, _h, _j;
                const initialMessage = req.body.prompt;
                const threadId = req.body.threadId || Date.now().toString();
                if (!initialMessage)
                    return res.status(400).json({ message: "Error Bad Request" });
                try {
                    // Set headers for SSE
                    res.setHeader("Content-Type", "text/event-stream");
                    res.setHeader("Cache-Control", "no-cache");
                    res.setHeader("Connection", "keep-alive");
                    // Send the threadId immediately to the client
                    res.write(`data: ${JSON.stringify({ threadId })}\n\n`);
                    // Save user message
                    yield saveMessage(threadId, "user", initialMessage);
                    let fullResponse = "";
                    // Check for completely non-travel related queries
                    const nonTravelKeywords = [
                        "programming",
                        "code",
                        "software",
                        "algorithm",
                        "math",
                        "equation",
                        "theorem",
                        "calculation",
                        "physics",
                        "chemistry",
                        "biology",
                        "medicine",
                        "disease",
                        "politics",
                        "election",
                        "government",
                        "policy",
                        "recipe",
                        "cook",
                        "bake",
                        "food",
                        "stock",
                        "invest",
                        "trading",
                        "crypto",
                        "homework",
                        "assignment",
                        "problem",
                        "dating",
                        "relationship",
                        "gaming",
                        "video game",
                        "philosophy",
                        "history",
                        "war",
                        "battle",
                        "ancient",
                        "computer",
                        "technology",
                        "device",
                        "gadget",
                        "sports",
                        "football",
                        "basketball",
                        "baseball",
                        "write",
                        "essay",
                        "paper",
                        "report",
                    ];
                    // Travel related terms to check for
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
                        "tourist",
                        "sightseeing",
                        "explore",
                        "adventure",
                        "guide",
                        "itinerary",
                    ];
                    // Simple greeting patterns that are acceptable
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
                    // Check if query is a greeting
                    const isGreeting = conversationalPatterns.some((pattern) => pattern.test(initialMessage));
                    // Check if query contains non-travel keywords
                    const containsNonTravelKeywords = nonTravelKeywords.some((keyword) => initialMessage.toLowerCase().includes(keyword.toLowerCase()));
                    // Check if query contains travel-related terms
                    const containsTravelTerms = travelRelatedTerms.some((term) => initialMessage.toLowerCase().includes(term.toLowerCase()));
                    const words = initialMessage.toLowerCase().split(/\s+/);
                    // If it's a non-travel query, return the appropriate message
                    if (!isGreeting &&
                        (containsNonTravelKeywords ||
                            (words.length > 5 && !containsTravelTerms))) {
                        const response = "I'm specialized in travel assistance and can only provide information about destinations, accommodations, attractions, and travel planning. For questions outside travel-related topics, please consult a general-purpose assistant.";
                        // Stream the response
                        fullResponse = response;
                        res.write(`data: ${JSON.stringify({ text: response })}\n\n`);
                        res.write("data: [DONE]\n\n");
                        res.end();
                        // Save assistant response
                        yield saveMessage(threadId, "assistant", fullResponse);
                        return;
                    }
                    // For simple queries, use the built-in isSimpleQuery in callAgent
                    const isSimpleQuery = isGreeting || (!containsTravelTerms && words.length < 10);
                    if (isSimpleQuery) {
                        // Handle simple queries directly
                        const { OpenAI } = yield Promise.resolve().then(() => __importStar(require("openai")));
                        const openai = new OpenAI({
                            apiKey: process.env.OPENAI_API_KEY,
                        });
                        const stream = yield openai.chat.completions.create({
                            model: "gpt-4o",
                            messages: [
                                {
                                    role: "system",
                                    content: "You are a friendly travel assistant. For conversational greetings like 'hello', 'thank you', etc., respond naturally and briefly. For any substantive questions not related to travel, tourism, vacations, destinations, or hospitality, politely decline with: 'I'm specialized in travel assistance and can only provide information about destinations, accommodations, attractions, and travel planning. For questions outside travel-related topics, please consult a general-purpose assistant.' DO NOT attempt to answer non-travel questions.",
                                },
                                {
                                    role: "user",
                                    content: initialMessage,
                                },
                            ],
                            stream: true,
                        });
                        try {
                            // Stream the response
                            for (var _k = true, stream_1 = __asyncValues(stream), stream_1_1; stream_1_1 = yield stream_1.next(), _a = stream_1_1.done, !_a; _k = true) {
                                _c = stream_1_1.value;
                                _k = false;
                                const chunk = _c;
                                const content = ((_h = (_g = chunk.choices[0]) === null || _g === void 0 ? void 0 : _g.delta) === null || _h === void 0 ? void 0 : _h.content) || "";
                                if (content) {
                                    fullResponse += content;
                                    res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
                                }
                            }
                        }
                        catch (e_1_1) { e_1 = { error: e_1_1 }; }
                        finally {
                            try {
                                if (!_k && !_a && (_b = stream_1.return)) yield _b.call(stream_1);
                            }
                            finally { if (e_1) throw e_1.error; }
                        }
                        res.write("data: [DONE]\n\n");
                        res.end();
                        // Save assistant response
                        yield saveMessage(threadId, "assistant", fullResponse);
                        return;
                    }
                    // If it's a travel-related query, use the LangGraph agent
                    const app = yield (0, agent_1.getApp)();
                    const finalState = app.streamEvents({
                        messages: [new messages_1.HumanMessage(initialMessage)],
                    }, {
                        streamMode: "updates",
                        version: "v2",
                        configurable: {
                            thread_id: threadId,
                        },
                    });
                    try {
                        // Stream the response
                        for (var _l = true, finalState_1 = __asyncValues(finalState), finalState_1_1; finalState_1_1 = yield finalState_1.next(), _d = finalState_1_1.done, !_d; _l = true) {
                            _f = finalState_1_1.value;
                            _l = false;
                            const chunk = _f;
                            if (chunk.event === "on_chat_model_stream" && ((_j = chunk.data) === null || _j === void 0 ? void 0 : _j.chunk)) {
                                // This handles streaming tokens from the model
                                const content = chunk.data.chunk.content || "";
                                if (content) {
                                    fullResponse += content;
                                    res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
                                }
                            }
                        }
                    }
                    catch (e_2_1) { e_2 = { error: e_2_1 }; }
                    finally {
                        try {
                            if (!_l && !_d && (_e = finalState_1.return)) yield _e.call(finalState_1);
                        }
                        finally { if (e_2) throw e_2.error; }
                    }
                    res.write("data: [DONE]\n\n");
                    res.end();
                    // Save assistant response
                    yield saveMessage(threadId, "assistant", fullResponse);
                    return;
                }
                catch (error) {
                    console.error("Error starting conversation:", error);
                    res.status(500).json({ error: "Internal server error" });
                }
            }));
            app.post("/stream/:threadId", (req, res) => __awaiter(this, void 0, void 0, function* () {
                var _a, e_3, _b, _c, _d, e_4, _e, _f;
                var _g, _h, _j;
                const { threadId } = req.params;
                const message = req.body.prompt;
                if (!message) {
                    return res.status(400).json({ message: "Error Bad Request" });
                }
                try {
                    // Set headers for SSE
                    res.setHeader("Content-Type", "text/event-stream");
                    res.setHeader("Cache-Control", "no-cache");
                    res.setHeader("Connection", "keep-alive");
                    // Send the threadId confirmation back to the client
                    res.write(`data: ${JSON.stringify({ threadId })}\n\n`);
                    // Save user message
                    yield saveMessage(threadId, "user", message);
                    let fullResponse = "";
                    // Check for completely non-travel related queries
                    const nonTravelKeywords = [
                        "programming",
                        "code",
                        "software",
                        "algorithm",
                        "math",
                        "equation",
                        "theorem",
                        "calculation",
                        "physics",
                        "chemistry",
                        "biology",
                        "medicine",
                        "disease",
                        "politics",
                        "election",
                        "government",
                        "policy",
                        "recipe",
                        "cook",
                        "bake",
                        "food",
                        "stock",
                        "invest",
                        "trading",
                        "crypto",
                        "homework",
                        "assignment",
                        "problem",
                        "dating",
                        "relationship",
                        "gaming",
                        "video game",
                        "philosophy",
                        "history",
                        "war",
                        "battle",
                        "ancient",
                        "computer",
                        "technology",
                        "device",
                        "gadget",
                        "sports",
                        "football",
                        "basketball",
                        "baseball",
                        "write",
                        "essay",
                        "paper",
                        "report",
                    ];
                    // Travel related terms to check for
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
                        "tourist",
                        "sightseeing",
                        "explore",
                        "adventure",
                        "guide",
                        "itinerary",
                    ];
                    // Simple greeting patterns that are acceptable
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
                    // Check if query is a greeting
                    const isGreeting = conversationalPatterns.some((pattern) => pattern.test(message));
                    // Check if query contains non-travel keywords
                    const containsNonTravelKeywords = nonTravelKeywords.some((keyword) => message.toLowerCase().includes(keyword.toLowerCase()));
                    // Check if query contains travel-related terms
                    const containsTravelTerms = travelRelatedTerms.some((term) => message.toLowerCase().includes(term.toLowerCase()));
                    const words = message.toLowerCase().split(/\s+/);
                    // If it's a non-travel query, return the appropriate message
                    if (!isGreeting &&
                        (containsNonTravelKeywords ||
                            (words.length > 5 && !containsTravelTerms))) {
                        const response = "I'm specialized in travel assistance and can only provide information about destinations, accommodations, attractions, and travel planning. For questions outside travel-related topics, please consult a general-purpose assistant.";
                        // Stream the response
                        fullResponse = response;
                        res.write(`data: ${JSON.stringify({ text: response })}\n\n`);
                        res.write("data: [DONE]\n\n");
                        res.end();
                        // Save assistant response
                        yield saveMessage(threadId, "assistant", fullResponse);
                        return;
                    }
                    // Simple queries are handled by the model
                    const isSimpleQuery = isGreeting || (!containsTravelTerms && words.length < 10);
                    if (isSimpleQuery) {
                        // Handle simple queries directly with the OpenAI API
                        const { OpenAI } = yield Promise.resolve().then(() => __importStar(require("openai")));
                        const openai = new OpenAI({
                            apiKey: process.env.OPENAI_API_KEY,
                        });
                        const stream = yield openai.chat.completions.create({
                            model: "gpt-4o",
                            messages: [
                                {
                                    role: "system",
                                    content: "You are a friendly travel assistant. For conversational greetings, respond naturally and briefly.",
                                },
                                {
                                    role: "user",
                                    content: message,
                                },
                            ],
                            stream: true,
                        });
                        try {
                            // Stream the response
                            for (var _k = true, stream_2 = __asyncValues(stream), stream_2_1; stream_2_1 = yield stream_2.next(), _a = stream_2_1.done, !_a; _k = true) {
                                _c = stream_2_1.value;
                                _k = false;
                                const chunk = _c;
                                const content = ((_h = (_g = chunk.choices[0]) === null || _g === void 0 ? void 0 : _g.delta) === null || _h === void 0 ? void 0 : _h.content) || "";
                                if (content) {
                                    fullResponse += content;
                                    res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
                                }
                            }
                        }
                        catch (e_3_1) { e_3 = { error: e_3_1 }; }
                        finally {
                            try {
                                if (!_k && !_a && (_b = stream_2.return)) yield _b.call(stream_2);
                            }
                            finally { if (e_3) throw e_3.error; }
                        }
                        res.write("data: [DONE]\n\n");
                        res.end();
                        // Save assistant response
                        yield saveMessage(threadId, "assistant", fullResponse);
                        return;
                    }
                    // Get the app instance
                    const app = yield (0, agent_1.getApp)();
                    // Stream the response using the existing thread
                    const finalState = app.streamEvents({
                        messages: [new messages_1.HumanMessage(message)],
                    }, {
                        streamMode: "updates",
                        version: "v2",
                        configurable: {
                            thread_id: threadId,
                        },
                    });
                    try {
                        // Stream the response
                        for (var _l = true, finalState_2 = __asyncValues(finalState), finalState_2_1; finalState_2_1 = yield finalState_2.next(), _d = finalState_2_1.done, !_d; _l = true) {
                            _f = finalState_2_1.value;
                            _l = false;
                            const chunk = _f;
                            if (chunk.event === "on_chat_model_stream" && ((_j = chunk.data) === null || _j === void 0 ? void 0 : _j.chunk)) {
                                // This handles streaming tokens from the model
                                const content = chunk.data.chunk.content || "";
                                if (content) {
                                    fullResponse += content;
                                    res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
                                }
                            }
                        }
                    }
                    catch (e_4_1) { e_4 = { error: e_4_1 }; }
                    finally {
                        try {
                            if (!_l && !_d && (_e = finalState_2.return)) yield _e.call(finalState_2);
                        }
                        finally { if (e_4) throw e_4.error; }
                    }
                    res.write("data: [DONE]\n\n");
                    res.end();
                    // Save assistant response
                    yield saveMessage(threadId, "assistant", fullResponse);
                }
                catch (error) {
                    console.error("Error in chat:", error);
                    res.status(500).json({ error: "Internal server error" });
                }
            }));
            const PORT = process.env.PORT || 3003;
            app.listen(PORT, () => {
                console.log(`Server running on port ${PORT}`);
            });
        }
        catch (error) {
            console.error("Error connecting to MongoDB:", error);
            process.exit(1);
        }
    });
}
startServer();
