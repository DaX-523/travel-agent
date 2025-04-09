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
            app.get("/", (req, res) => {
                res.send("LangGraph Agent Server");
            });
            app.post("/chat", (req, res) => __awaiter(this, void 0, void 0, function* () {
                const initialMessage = req.body.message;
                const threadId = Date.now().toString();
                if (!initialMessage)
                    return res.status(400).json({ message: "Error Bad Request" });
                try {
                    const response = yield (0, agent_1.default)(initialMessage, threadId);
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
                    // For simple queries, use the built-in isSimpleQuery in callAgent
                    const isSimpleQuery = (query) => {
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
                        if (conversationalPatterns.some((pattern) => pattern.test(query))) {
                            return true;
                        }
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
                        ];
                        const words = query.toLowerCase().split(/\s+/);
                        const containsTravelTerms = travelRelatedTerms.some((term) => query.toLowerCase().includes(term.toLowerCase()));
                        return !containsTravelTerms && words.length < 10;
                    };
                    if (isSimpleQuery(initialMessage)) {
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
                                    content: "You are a friendly travel assistant. For non-travel related queries, respond naturally and briefly. Don't mention travel unless the user asks about it.",
                                },
                                {
                                    role: "user",
                                    content: initialMessage,
                                },
                            ],
                            stream: true,
                        });
                        // Set headers for SSE
                        res.setHeader("Content-Type", "text/event-stream");
                        res.setHeader("Cache-Control", "no-cache");
                        res.setHeader("Connection", "keep-alive");
                        try {
                            // Stream the response
                            for (var _k = true, stream_1 = __asyncValues(stream), stream_1_1; stream_1_1 = yield stream_1.next(), _a = stream_1_1.done, !_a; _k = true) {
                                _c = stream_1_1.value;
                                _k = false;
                                const chunk = _c;
                                const content = ((_h = (_g = chunk.choices[0]) === null || _g === void 0 ? void 0 : _g.delta) === null || _h === void 0 ? void 0 : _h.content) || "";
                                if (content) {
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
                    // Set headers for SSE
                    res.setHeader("Content-Type", "text/event-stream");
                    res.setHeader("Cache-Control", "no-cache");
                    res.setHeader("Connection", "keep-alive");
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
                    return;
                }
                catch (error) {
                    console.error("Error starting conversation:", error);
                    res.status(500).json({ error: "Internal server error" });
                }
            }));
            app.post("/stream/:threadId", (req, res) => __awaiter(this, void 0, void 0, function* () {
                const { threadId } = req.params;
                const { message } = req.body;
                try {
                    const response = yield (0, agent_1.default)(message, threadId);
                    res.json({ response });
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
