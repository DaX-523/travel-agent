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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const mongodb_1 = require("mongodb");
const agent_1 = __importDefault(require("./agent"));
const app = (0, express_1.default)();
app.use(express_1.default.json());
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
                    const response = yield (0, agent_1.default)(client, initialMessage, threadId);
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
                    const response = yield (0, agent_1.default)(client, message, threadId);
                    res.json({ response });
                }
                catch (error) {
                    console.error("Error in chat:", error);
                    res.status(500).json({ error: "Internal server error" });
                }
            }));
            const PORT = process.env.PORT || 3001;
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
