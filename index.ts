import "dotenv/config";
import express, { Request, Response } from "express";
import { MongoClient } from "mongodb";
import callAgent, { app as agentApp } from "./agent";
import cors from "cors";
import { HumanMessage } from "@langchain/core/messages";
import {
  modelAnalyzeQuery,
  handleGreeting,
  handleNonTravelQuery,
  handleConversationHistoryQuery,
} from "./utils/query-filter";
import {
  RESPONSE_SYSTEM_PROMPT_TEMPLATE,
  QUERY_SYSTEM_PROMPT_TEMPLATE,
  MAIN_PROMPT,
} from "./utils/prompts";

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

    app.post("/stream", async (req: Request, res: Response) => {
      const initialMessage = req.body.prompt;
      if (!initialMessage) {
        res.status(400).json({ error: "No message provided" });
        return;
      }

      try {
        // Set response headers for SSE
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        // Get the thread_id from the query parameters or create a new one
        const thread_id = req.body.threadId || Date.now().toString();

        // Send the threadId immediately to the client
        res.write(`data: ${JSON.stringify({ threadId: thread_id })}\n\n`);

        // Save user message
        await saveMessage(thread_id, "user", initialMessage);

        // Use LLM-based query classification
        const queryAnalysis = await modelAnalyzeQuery(initialMessage);
        console.log("[STREAM] Query analysis:", queryAnalysis);

        let fullResponse = "";
        // Handle different query types
        if (queryAnalysis.type === "greeting") {
          // For greetings, use a simple model response
          console.log("[STREAM] Handling greeting query");
          const { ChatGroq } = await import("@langchain/groq");
          const model = new ChatGroq({
            model: "llama3-70b-8192",
            apiKey: process.env.GROQ_API_KEY,
            streaming: true,
          }).bind({
            response_format: { type: "text" },
          });

          const stream = await model.stream([
            {
              role: "system",
              content:
                "You are a friendly travel assistant. For conversational greetings, respond naturally and briefly.",
            },
            {
              role: "user",
              content: initialMessage,
            },
          ]);

          for await (const chunk of stream) {
            const content = chunk.content || "";
            fullResponse += content;

            if (content) {
              res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
            }
          }

          res.write("data: [DONE]\n\n");
          res.end();
          await saveMessage(thread_id, "assistant", fullResponse);

          return;
        } else if (queryAnalysis.type === "non_travel") {
          // For non-travel queries, use a simple model with rejection message
          console.log("[STREAM] Handling non-travel query");
          const { ChatGroq } = await import("@langchain/groq");
          const model = new ChatGroq({
            model: "llama3-70b-8192",
            apiKey: process.env.GROQ_API_KEY,
            streaming: true,
          }).bind({
            response_format: { type: "text" },
          });

          const stream = await model.stream([
            {
              role: "system",
              content:
                "You are a friendly travel assistant. When users ask questions not related to travel, politely explain that you are specialized in travel assistance and can only provide information about destinations, accommodations, attractions, and travel planning.",
            },
            {
              role: "user",
              content: initialMessage,
            },
          ]);

          for await (const chunk of stream) {
            const content = chunk.content || "";
            fullResponse += content;

            if (content) {
              res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
            }
          }

          res.write("data: [DONE]\n\n");
          res.end();
          await saveMessage(thread_id, "assistant", fullResponse);

          return;
        } else if (queryAnalysis.type === "conversation_history") {
          // For conversation history queries, retrieve and summarize past messages
          console.log("[STREAM] Handling conversation history query");

          // Get the history summary (non-streaming first)
          const historySummary = await handleConversationHistoryQuery(
            initialMessage,
            thread_id,
            client
          );

          // Stream it back to the client
          const { ChatGroq } = await import("@langchain/groq");
          const model = new ChatGroq({
            model: "llama3-70b-8192",
            apiKey: process.env.GROQ_API_KEY,
            streaming: true,
          }).bind({
            response_format: { type: "text" },
          });

          const stream = await model.stream([
            {
              role: "system",
              content:
                "You are a helpful travel assistant providing information about past conversations.",
            },
            {
              role: "user",
              content: `Provide this exact text as your response: ${historySummary}`,
            },
          ]);

          for await (const chunk of stream) {
            const content = chunk.content || "";
            fullResponse += content;

            if (content) {
              res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
            }
          }

          res.write("data: [DONE]\n\n");
          res.end();
          await saveMessage(thread_id, "assistant", fullResponse);

          return;
        }

        // For travel queries, use the full agent
        console.log("[STREAM] Processing travel query through LangGraph agent");

        // Stream the agent's response
        try {
          // Start the conversation with the user's message
          const streamEvents = await agentApp.streamEvents(
            {
              topic: initialMessage,
              messages: [new HumanMessage({ content: initialMessage })],
              queries: [initialMessage],
              info: {},
              extractionSchema: {},
            },
            {
              recursionLimit: 30,
              streamMode: "updates",
              version: "v2",
              configurable: {
                thread_id: thread_id,
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

          // Stream the events
          for await (const event of streamEvents) {
            if (
              event.event === "on_chat_model_stream" &&
              event.data.chunk?.content
            ) {
              const content = event.data.chunk.content;
              fullResponse += content;

              res.write(
                `data: ${JSON.stringify({
                  text: content,
                })}\n\n`
              );
            }
          }

          res.write("data: [DONE]\n\n");
          res.end();
          await saveMessage(thread_id, "assistant", fullResponse);
        } catch (error) {
          console.error("Error streaming conversation:", error);
          res.write(
            `data: ${JSON.stringify({
              error: "Error streaming conversation",
            })}\n\n`
          );
          res.write("data: [DONE]\n\n");
          res.end();
        }
      } catch (error) {
        console.error("Error starting conversation:", error);
        res.status(500).json({ error: "Error starting conversation" });
      }
    });

    //LEGACY APIS (NO STREAMING)
    app.post("/v1/chat", async (req: Request, res: Response) => {
      const initialMessage = req.body.message;
      const threadId = Date.now().toString();
      if (!initialMessage)
        return res.status(400).json({ message: "Error Bad Request" });
      try {
        // Use LLM-based query classification
        const queryAnalysis = await modelAnalyzeQuery(initialMessage);
        console.log("[CHAT] Query analysis:", queryAnalysis);

        let response;

        // Handle different query types
        if (queryAnalysis.type === "greeting") {
          console.log("[CHAT] Handling greeting query");
          response = await handleGreeting(initialMessage);
        } else if (queryAnalysis.type === "non_travel") {
          console.log("[CHAT] Handling non-travel query");
          response = await handleNonTravelQuery(initialMessage);
        } else if (queryAnalysis.type === "conversation_history") {
          console.log("[CHAT] Handling conversation history query");
          response = await handleConversationHistoryQuery(
            initialMessage,
            threadId,
            client
          );
        } else {
          // For travel queries, use the full agent
          console.log("[CHAT] Processing travel query through LangGraph agent");
          response = await callAgent(client, initialMessage, threadId);
        }

        res.json({ threadId, response });
      } catch (error) {
        console.error("Error starting conversation:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.post("/v1/chat/:threadId", async (req: Request, res: Response) => {
      const { threadId } = req.params;
      const { message } = req.body;
      if (!message)
        return res.status(400).json({ message: "Error Bad Request" });

      try {
        // Use LLM-based query classification
        const queryAnalysis = await modelAnalyzeQuery(message);
        console.log("[CHAT] Thread query analysis:", queryAnalysis);

        let response;

        // Handle different query types
        if (queryAnalysis.type === "greeting") {
          console.log("[CHAT] Handling greeting query in thread");
          response = await handleGreeting(message);
        } else if (queryAnalysis.type === "non_travel") {
          console.log("[CHAT] Handling non-travel query in thread");
          response = await handleNonTravelQuery(message);
        } else if (queryAnalysis.type === "conversation_history") {
          console.log("[CHAT] Handling conversation history query in thread");
          response = await handleConversationHistoryQuery(
            message,
            threadId,
            client
          );
        } else {
          // For travel queries, use the full agent with the existing thread
          console.log(
            "[CHAT] Processing travel query through LangGraph agent with thread:",
            threadId
          );
          response = await callAgent(client, message, threadId);
        }

        res.json({ response });
      } catch (error) {
        console.error("Error in chat:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    const PORT = process.env.PORT || 3002;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
}

startServer();
