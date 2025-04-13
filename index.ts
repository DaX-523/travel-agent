import "dotenv/config";
import express from "express";
import { Request, Response } from "express";
import { MongoClient } from "mongodb";
import callAgent, { getApp } from "./agent";
import { HumanMessage } from "@langchain/core/messages";
import { LangChainAdapter } from "ai";
import cors from "cors";
import {
  analyzeQuery,
  handleGreeting,
  POLITE_REJECTION_MESSAGE,
} from "./utils/query-filter";

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

    // Access the messages collection
    const db = client.db("AI-Travel-Agent");
    const messagesCollection = db.collection("messages");
    const threadsCollection = db.collection("threads");

    // Middleware to ensure collections exist
    await db
      .createCollection("messages", {})
      .catch(() => console.log("Messages collection already exists"));
    await db
      .createCollection("threads", {})
      .catch(() => console.log("Threads collection already exists"));

    app.get("/", (req: Request, res: Response) => {
      res.send("LangGraph Agent Server");
    });

    // New endpoint to get all threads
    app.get("/threads", async (req: Request, res: Response) => {
      try {
        // Get all threads with most recent activity first
        const threads = await threadsCollection
          .find({})
          .sort({ lastActivity: -1 })
          .toArray();

        res.json({ threads });
      } catch (error) {
        console.error("Error fetching threads:", error);
        res.status(500).json({ error: "Failed to fetch threads" });
      }
    });

    // New endpoint to get messages for a specific thread
    app.get("/threads/:threadId", async (req: Request, res: Response) => {
      const { threadId } = req.params;

      try {
        // Get thread info
        const thread = await threadsCollection.findOne({ threadId });

        if (!thread) {
          return res.status(404).json({ error: "Thread not found" });
        }

        // Get messages for this thread
        const messages = await messagesCollection
          .find({ threadId })
          .sort({ timestamp: 1 })
          .toArray();

        res.json({
          thread,
          messages,
        });
      } catch (error) {
        console.error("Error fetching thread messages:", error);
        res.status(500).json({ error: "Failed to fetch thread messages" });
      }
    });

    // Helper function to save messages and update thread info
    async function saveMessage(
      threadId: string,
      role: "user" | "assistant",
      content: string
    ) {
      const timestamp = new Date();

      // Save the message
      await messagesCollection.insertOne({
        threadId,
        role,
        content,
        timestamp,
      });

      // Update or create thread info
      await threadsCollection.updateOne(
        { threadId },
        {
          $set: {
            lastActivity: timestamp,
            lastMessage:
              content.substring(0, 100) + (content.length > 100 ? "..." : ""),
          },
          $setOnInsert: {
            threadId,
            createdAt: timestamp,
          },
        },
        { upsert: true }
      );
    }

    app.post("/chat", async (req: Request, res: Response) => {
      const initialMessage = req.body.message;
      const threadId = Date.now().toString();
      if (!initialMessage)
        return res.status(400).json({ message: "Error Bad Request" });
      try {
        const response = await callAgent(initialMessage, threadId);

        // Save messages to database
        await saveMessage(threadId, "user", initialMessage);
        await saveMessage(threadId, "assistant", response as string);

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

        // Save messages to database
        await saveMessage(threadId, "user", message);
        await saveMessage(threadId, "assistant", response as string);

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
        // Set headers for SSE
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        // Send the threadId immediately to the client
        res.write(`data: ${JSON.stringify({ threadId })}\n\n`);

        // Save user message
        await saveMessage(threadId, "user", initialMessage);

        let fullResponse = "";

        // Analyze the query using our utility functions
        const { isOffTopic, isSimple, isGreeting } =
          analyzeQuery(initialMessage);

        // If it's a non-travel query, return the appropriate message
        if (isOffTopic) {
          // Stream the response
          fullResponse = POLITE_REJECTION_MESSAGE;
          res.write(`data: ${JSON.stringify({ text: fullResponse })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();

          // Save assistant response
          await saveMessage(threadId, "assistant", fullResponse);
          return;
        }

        if (isSimple) {
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
                  "You are a friendly travel assistant. For conversational greetings like 'hello', 'thank you', etc., respond naturally and briefly. For any substantive questions not related to travel, tourism, vacations, destinations, or hospitality, politely decline with: 'I'm specialized in travel assistance and can only provide information about destinations, accommodations, attractions, and travel planning. For questions outside travel-related topics, please consult a general-purpose assistant.' DO NOT attempt to answer non-travel questions.",
              },
              {
                role: "user",
                content: initialMessage,
              },
            ],
            stream: true,
          });

          // Stream the response
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              fullResponse += content;
              res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
            }
          }

          res.write("data: [DONE]\n\n");
          res.end();

          // Save assistant response
          await saveMessage(threadId, "assistant", fullResponse);
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

        // Stream the response
        for await (const chunk of finalState) {
          if (chunk.event === "on_chat_model_stream" && chunk.data?.chunk) {
            // This handles streaming tokens from the model
            const content = chunk.data.chunk.content || "";
            if (content) {
              fullResponse += content;
              res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
            }
          }
        }

        res.write("data: [DONE]\n\n");
        res.end();

        // Save assistant response
        await saveMessage(threadId, "assistant", fullResponse);
        return;
      } catch (error) {
        console.error("Error starting conversation:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.post("/stream/:threadId", async (req: Request, res: Response) => {
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
        await saveMessage(threadId, "user", message);

        let fullResponse = "";

        // Analyze the query using our utility functions
        const { isOffTopic, isSimple, isGreeting } = analyzeQuery(message);

        // If it's a non-travel query, return the appropriate message
        if (isOffTopic) {
          // Stream the response
          fullResponse = POLITE_REJECTION_MESSAGE;
          res.write(`data: ${JSON.stringify({ text: fullResponse })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();

          // Save assistant response
          await saveMessage(threadId, "assistant", fullResponse);
          return;
        }

        // Simple queries are handled by the model
        if (isSimple) {
          // Handle simple queries directly with the OpenAI API
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
                  "You are a friendly travel assistant. For conversational greetings, respond naturally and briefly.",
              },
              {
                role: "user",
                content: message,
              },
            ],
            stream: true,
          });

          // Stream the response
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              fullResponse += content;
              res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
            }
          }

          res.write("data: [DONE]\n\n");
          res.end();

          // Save assistant response
          await saveMessage(threadId, "assistant", fullResponse);
          return;
        }

        // Get the app instance
        const app = await getApp();

        // Stream the response using the existing thread
        const finalState = app.streamEvents(
          {
            messages: [new HumanMessage(message)],
          },
          {
            streamMode: "updates",
            version: "v2",
            configurable: {
              thread_id: threadId,
            },
          }
        );

        // Stream the response
        for await (const chunk of finalState) {
          if (chunk.event === "on_chat_model_stream" && chunk.data?.chunk) {
            // This handles streaming tokens from the model
            const content = chunk.data.chunk.content || "";
            if (content) {
              fullResponse += content;
              res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
            }
          }
        }

        res.write("data: [DONE]\n\n");
        res.end();

        // Save assistant response
        await saveMessage(threadId, "assistant", fullResponse);
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
