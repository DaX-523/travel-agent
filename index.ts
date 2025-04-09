import "dotenv/config";
import express from "express";
import { Request, Response } from "express";
import { MongoClient } from "mongodb";
import callAgent, { getApp } from "./agent";
import { HumanMessage } from "@langchain/core/messages";
import { LangChainAdapter } from "ai";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// Initialize MongoDB client
const client = new MongoClient(process.env.MONGODB_ATLAS_URI as string);

async function startServer() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    app.get("/", (req: Request, res: Response) => {
      res.send("LangGraph Agent Server");
    });

    app.post("/chat", async (req: Request, res: Response) => {
      const initialMessage = req.body.message;
      const threadId = Date.now().toString();
      if (!initialMessage)
        return res.status(400).json({ message: "Error Bad Request" });
      try {
        const response = await callAgent(initialMessage, threadId);
        res.json({ threadId, response });
      } catch (error) {
        console.error("Error starting conversation:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.post("/chat/:threadId", async (req: Request, res: Response) => {
      const { threadId } = req.params;
      const { message } = req.body;
      try {
        const response = await callAgent(message, threadId);
        res.json({ response });
      } catch (error) {
        console.error("Error in chat:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });
    app.post("/stream", async (req: Request, res: Response) => {
      const initialMessage = req.body.prompt;
      const threadId = req.body.threadId || Date.now().toString();
      if (!initialMessage)
        return res.status(400).json({ message: "Error Bad Request" });
      try {
        // For simple queries, use the built-in isSimpleQuery in callAgent
        const isSimpleQuery = (query: string): boolean => {
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
          const containsTravelTerms = travelRelatedTerms.some((term) =>
            query.toLowerCase().includes(term.toLowerCase())
          );

          return !containsTravelTerms && words.length < 10;
        };

        if (isSimpleQuery(initialMessage)) {
          // Handle simple queries directly
          const { OpenAI } = await import("openai");
          const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
          });

          const stream = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              {
                role: "system",
                content:
                  "You are a friendly travel assistant. For non-travel related queries, respond naturally and briefly. Don't mention travel unless the user asks about it.",
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

          // Stream the response
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
            }
          }

          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        // If it's a travel-related query, use the LangGraph agent
        const app = await getApp();
        const finalState = app.streamEvents(
          {
            messages: [new HumanMessage(initialMessage)],
          },
          {
            streamMode: "updates",
            version: "v2",
            configurable: {
              thread_id: threadId,
            },
          }
        );

        // Set headers for SSE
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        // Stream the response
        for await (const chunk of finalState) {
          if (chunk.event === "on_chat_model_stream" && chunk.data?.chunk) {
            // This handles streaming tokens from the model
            const content = chunk.data.chunk.content || "";
            if (content) {
              res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
            }
          }
        }

        res.write("data: [DONE]\n\n");
        res.end();
        return;
      } catch (error) {
        console.error("Error starting conversation:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.post("/stream/:threadId", async (req: Request, res: Response) => {
      const { threadId } = req.params;
      const { message } = req.body;
      try {
        const response = await callAgent(message, threadId);
        res.json({ response });
      } catch (error) {
        console.error("Error in chat:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    const PORT = process.env.PORT || 3003;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
}

startServer();
