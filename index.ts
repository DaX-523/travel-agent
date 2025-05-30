import "dotenv/config";
import express, { Request, Response } from "express";
import { MongoClient, ObjectId } from "mongodb";
import callAgent, { app as agentApp } from "./agent";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { authenticateToken } from "./middleware/auth";
import {
  modelAnalyzeQuery,
  handleGreeting,
  handleNonTravelQuery,
  handleConversationHistoryQuery,
} from "./utils/query-filter";

const app = express();
app.use(express.json());
app.use(cors());
// Initialize MongoDB client
const client = new MongoClient(process.env.MONGODB_ATLAS_URI as string);

// Define user interface
interface User {
  _id?: ObjectId;
  email: string;
  password: string;
  name: string;
  createdAt: Date;
}

// Add this interface at the top of the file, after imports
interface ErrorWithFailedGeneration {
  error?: {
    error?: {
      failed_generation?: string;
      code?: string;
      message?: string;
    };
  };
  failed_generation?: string;
  message?: string;
}

// Add a utility function to handle extracting text from potentially complex content
function extractTextFromMessageContent(content: any): string {
  if (typeof content === "string") {
    return content;
  } else if (Array.isArray(content)) {
    // If it's an array of content parts, extract text from each part
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        } else if (part && typeof part === "object" && "text" in part) {
          return part.text;
        }
        return "";
      })
      .join("");
  } else if (content && typeof content === "object") {
    // If it's an object with text property
    if ("text" in content) {
      return content.text;
    }
  }
  return String(content);
}

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
    const usersCollection = db.collection("users");

    // Middleware to ensure collections exist
    await db
      .createCollection("messages", {})
      .catch(() => console.log("Messages collection already exists"));
    await db
      .createCollection("threads", {})
      .catch(() => console.log("Threads collection already exists"));
    await db
      .createCollection("users", {})
      .catch(() => console.log("Users collection already exists"));

    // Helper function to save messages and update thread info
    async function saveMessage(
      threadId: string,
      role: "user" | "assistant",
      content: string,
      userId?: string
    ) {
      const timestamp = new Date();

      // Save the message
      await messagesCollection.insertOne({
        threadId,
        role,
        content,
        timestamp,
        userId,
      });

      // Update or create thread info
      await threadsCollection.updateOne(
        { threadId },
        {
          $set: {
            lastActivity: timestamp,
            lastMessage:
              content.substring(0, 100) + (content.length > 100 ? "..." : ""),
            userId,
          },
          $setOnInsert: {
            threadId,
            createdAt: timestamp,
          },
        },
        { upsert: true }
      );
    }

    // Authentication Routes
    app.post("/auth/register", async (req: Request, res: Response) => {
      try {
        const { email, password, name } = req.body;

        // Validate input
        if (!email || !password || !name) {
          return res.status(400).json({
            error:
              "Missing required fields: email, password, and name are required",
          });
        }

        // Check if email already exists
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.status(409).json({ error: "Email already registered" });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create new user
        const newUser: User = {
          email,
          password: hashedPassword,
          name,
          createdAt: new Date(),
        };

        // Insert user into database
        const result = await usersCollection.insertOne(newUser);

        // Generate JWT token
        const token = jwt.sign(
          { id: result.insertedId },
          process.env.JWT_SECRET || "default_jwt_secret",
          { expiresIn: "10h" }
        );

        // Return success response with token
        res.status(201).json({
          message: "User registered successfully",
          token,
          user: {
            id: result.insertedId,
            email,
            name,
          },
        });
      } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ error: "Registration failed" });
      }
    });

    app.post("/auth/login", async (req: Request, res: Response) => {
      try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
          return res.status(400).json({
            error: "Missing required fields: email and password are required",
          });
        }

        // Find user
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(401).json({ error: "Invalid credentials" });
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
          return res.status(401).json({ error: "Invalid credentials" });
        }

        // Generate JWT token
        const token = jwt.sign(
          { id: user._id },
          process.env.JWT_SECRET || "default_jwt_secret",
          { expiresIn: "10h" }
        );

        // Return success response with token
        res.json({
          message: "Login successful",
          token,
          user: {
            id: user._id,
            email: user.email,
            name: user.name,
          },
        });
      } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Login failed" });
      }
    });

    // Protected route example
    app.get(
      "/auth/user",
      authenticateToken,
      async (req: Request, res: Response) => {
        try {
          const userId = (req as any).user.id;

          // Get user data without password
          const user = await usersCollection.findOne(
            { _id: new ObjectId(userId) },
            { projection: { password: 0 } }
          );

          if (!user) {
            return res.status(404).json({ error: "User not found" });
          }

          res.json({ user });
        } catch (error) {
          console.error("Error fetching user data:", error);
          res.status(500).json({ error: "Failed to fetch user data" });
        }
      }
    );

    app.get("/", (req: Request, res: Response) => {
      res.send("LangGraph Agent Server");
    });

    // New endpoint to get all threads - protected with authentication
    app.get(
      "/threads",
      authenticateToken,
      async (req: Request, res: Response) => {
        try {
          const userId = (req as any).user.id;

          // Get only threads created by this user
          const threads = await threadsCollection
            .find({ userId })
            .sort({ lastActivity: -1 })
            .toArray();

          res.json({ threads });
        } catch (error) {
          console.error("Error fetching threads:", error);
          res.status(500).json({ error: "Failed to fetch threads" });
        }
      }
    );

    // New endpoint to get messages for a specific thread - protected with authentication
    app.get(
      "/threads/:threadId",
      authenticateToken,
      async (req: Request, res: Response) => {
        const { threadId } = req.params;
        const userId = (req as any).user.id;

        try {
          // Get thread info and verify ownership
          const thread = await threadsCollection.findOne({ threadId });

          if (!thread) {
            return res.status(404).json({ error: "Thread not found" });
          }

          // Check if this thread belongs to the requesting user
          if (thread.userId && thread.userId !== userId) {
            return res
              .status(403)
              .json({ error: "Access denied: You don't own this thread" });
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
      }
    );

    app.post(
      "/stream",
      authenticateToken,
      async (req: Request, res: Response) => {
        const initialMessage = req.body.prompt;
        if (!initialMessage) {
          res.status(400).json({ error: "No message provided" });
          return;
        }

        try {
          // Get userId from authenticated request
          const userId = (req as any).user.id;

          // Get the thread_id from the query parameters or create a new one
          const thread_id = req.body.threadId || Date.now().toString();

          // Save user message with userId
          await saveMessage(thread_id, "user", initialMessage, userId);

          // Use LLM-based query classification
          const queryAnalysis = await modelAnalyzeQuery(initialMessage);
          console.log("[API] Query analysis:", queryAnalysis);

          let fullResponse = "";
          // Handle different query types
          if (queryAnalysis.type === "greeting") {
            // For greetings, use a simple model response
            console.log("[API] Handling greeting query");
            const { ChatGroq } = await import("@langchain/groq");
            const model = new ChatGroq({
              model: "llama-3.3-70b-versatile",
              apiKey: process.env.GROQ_API_KEY,
            }).bind({
              response_format: { type: "text" },
            });

            const response = await model.invoke([
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

            fullResponse = extractTextFromMessageContent(response.content);

            // Save assistant message with userId
            await saveMessage(thread_id, "assistant", fullResponse, userId);

            // Return complete response
            return res.json({
              threadId: thread_id,
              response: fullResponse,
            });
          } else if (queryAnalysis.type === "non_travel") {
            // For non-travel queries, use a simple model with rejection message
            console.log("[API] Handling non-travel query");
            const { ChatGroq } = await import("@langchain/groq");
            const model = new ChatGroq({
              model: "llama-3.3-70b-versatile",
              apiKey: process.env.GROQ_API_KEY,
            }).bind({
              response_format: { type: "text" },
            });

            const response = await model.invoke([
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

            fullResponse = extractTextFromMessageContent(response.content);

            // Save assistant message with userId
            await saveMessage(thread_id, "assistant", fullResponse, userId);

            // Return complete response
            return res.json({
              threadId: thread_id,
              response: fullResponse,
            });
          } else if (queryAnalysis.type === "conversation_history") {
            // For conversation history queries, retrieve and summarize past messages
            console.log("[API] Handling conversation history query");

            // Get the history summary (non-streaming first)
            const historySummary = await handleConversationHistoryQuery(
              initialMessage,
              thread_id,
              client
            );

            // Return it directly instead of streaming
            const { ChatGroq } = await import("@langchain/groq");
            const model = new ChatGroq({
              model: "llama-3.3-70b-versatile",
              apiKey: process.env.GROQ_API_KEY,
            }).bind({
              response_format: { type: "text" },
            });

            const response = await model.invoke([
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

            fullResponse = extractTextFromMessageContent(response.content);

            // Save assistant message with userId
            await saveMessage(thread_id, "assistant", fullResponse, userId);

            // Return complete response
            return res.json({
              threadId: thread_id,
              response: fullResponse,
            });
          }

          // For travel queries, use the full agent
          console.log("[API] Processing travel query through LangGraph agent");

          // Call the agent and get the full response at once
          try {
            // Call the agent - with our new error handling in callAgent,
            // this should now return content even when there are certain errors
            try {
              fullResponse = await callAgent(client, initialMessage, thread_id);
            } catch (error: any) {
              // If the error contains a specific message property with content, use that
              if (error?.error?.error?.failed_generation) {
                console.log("[API] Extracting response from error object");
                fullResponse = error.error.error.failed_generation;
              } else {
                // Otherwise rethrow
                throw error;
              }
            }

            // Process fullResponse as before, looking for indications a search is needed
            if (
              fullResponse.includes("search_tool(") ||
              fullResponse.includes("Please use the search_tool") ||
              fullResponse.includes(
                "I couldn't find any relevant information"
              ) ||
              fullResponse.includes(
                "I apologize, but the retrieved documents"
              ) ||
              fullResponse.includes("The retrieved documents are about")
            ) {
              console.log(
                "[API] Response indicates search is needed, enforcing search"
              );

              // Extract the destination/query from the response
              let searchQuery = initialMessage;

              // Try to find a more specific search query from the response
              const queryMatch = fullResponse.match(
                /search_tool\s*\(\s*["'](.+?)["']\s*\)/
              );
              if (queryMatch && queryMatch[1]) {
                searchQuery = queryMatch[1];
              } else {
                // Look for location in the initial query
                const locationMatch = initialMessage.match(
                  /(?:in|about)\s+([A-Za-z\s]+)(?:\s|$)/i
                );
                if (locationMatch && locationMatch[1]) {
                  searchQuery = `Places to travel in ${locationMatch[1].trim()}`;
                }
              }

              console.log(`[API] Forcing search with query: "${searchQuery}"`);

              // Force a direct search_tool call with explicit search instruction
              const searchMessage = `I need information about ${searchQuery}. Please use the search_tool to find this information. Do not tell me you will search, actually perform the search immediately.`;

              fullResponse = await callAgent(client, searchMessage, thread_id);
            }

            // Save assistant message with userId
            await saveMessage(thread_id, "assistant", fullResponse, userId);

            // Return complete response
            return res.json({
              threadId: thread_id,
              response: fullResponse,
            });
          } catch (error) {
            console.error("Error in conversation:", error);
            // If all else fails, look for useful content in the error object
            let errorMessage = "Error in conversation";

            // Cast the error to our interface
            const typedError = error as ErrorWithFailedGeneration;

            // Try to find content in different possible error structures
            const possibleContent =
              typedError?.error?.error?.failed_generation ||
              typedError?.failed_generation ||
              typedError?.message ||
              JSON.stringify(error);

            if (
              possibleContent &&
              typeof possibleContent === "string" &&
              possibleContent.length > 100
            ) {
              // If we find something that looks like travel content, use it
              errorMessage = possibleContent;
              await saveMessage(thread_id, "assistant", errorMessage, userId);
            }

            // Return the best response we could find, or the error
            return res.json({
              threadId: thread_id,
              response: errorMessage,
            });
          }
        } catch (error) {
          console.error("Error starting conversation:", error);
          res.status(500).json({ error: "Error starting conversation" });
        }
      }
    );

    //LEGACY APIS (NO STREAMING)
    app.post(
      "/v1/chat",
      authenticateToken,
      async (req: Request, res: Response) => {
        const initialMessage = req.body.message;
        const threadId = Date.now().toString();
        const userId = (req as any).user.id;

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
            console.log(
              "[CHAT] Processing travel query through LangGraph agent"
            );

            // Try to call the agent with our improved error handling
            try {
              response = await callAgent(client, initialMessage, threadId);
            } catch (error: any) {
              // Check if the error contains useful information
              const typedError = error as ErrorWithFailedGeneration;

              if (typedError?.error?.error?.failed_generation) {
                console.log("[CHAT] Extracting response from error object");
                response = typedError.error.error.failed_generation;
              } else {
                // If not a recognized error format, rethrow
                throw error;
              }
            }

            // Process response if needed to handle search
            if (
              response.includes("search_tool(") ||
              response.includes("Please use the search_tool") ||
              response.includes("I couldn't find any relevant information") ||
              response.includes("I apologize, but the retrieved documents") ||
              response.includes("The retrieved documents are about")
            ) {
              console.log(
                "[CHAT] Response indicates search is needed, enforcing search"
              );

              // Extract the destination/query from the response
              let searchQuery = initialMessage;

              // Try to find a more specific search query from the response
              const queryMatch = response.match(
                /search_tool\s*\(\s*["'](.+?)["']\s*\)/
              );
              if (queryMatch && queryMatch[1]) {
                searchQuery = queryMatch[1];
              } else {
                // Look for location in the initial query
                const locationMatch = initialMessage.match(
                  /(?:in|about)\s+([A-Za-z\s]+)(?:\s|$)/i
                );
                if (locationMatch && locationMatch[1]) {
                  searchQuery = `Places to travel in ${locationMatch[1].trim()}`;
                }
              }

              console.log(`[CHAT] Forcing search with query: "${searchQuery}"`);

              // Force a direct search_tool call with explicit search instruction
              const searchMessage = `I need information about ${searchQuery}. Please use the search_tool to find this information. Do not tell me you will search, actually perform the search immediately.`;

              try {
                response = await callAgent(client, searchMessage, threadId);
              } catch (searchError: any) {
                // If there's an error with search, try to extract content from the error
                const typedSearchError =
                  searchError as ErrorWithFailedGeneration;
                if (typedSearchError?.error?.error?.failed_generation) {
                  response = typedSearchError.error.error.failed_generation;
                } else {
                  throw searchError;
                }
              }
            }
          }

          // Save the messages for future reference
          await saveMessage(threadId, "user", initialMessage, userId);
          await saveMessage(threadId, "assistant", response, userId);

          res.json({ threadId, response });
        } catch (error) {
          console.error("Error starting conversation:", error);

          // Try to extract useful information from the error
          let errorMessage = "Internal server error";
          const typedError = error as ErrorWithFailedGeneration;

          const possibleContent =
            typedError?.error?.error?.failed_generation ||
            typedError?.failed_generation ||
            typedError?.message ||
            JSON.stringify(error);

          if (
            possibleContent &&
            typeof possibleContent === "string" &&
            (possibleContent.includes("Malaysia") ||
              possibleContent.length > 200)
          ) {
            errorMessage = possibleContent;
          }

          res.json({
            threadId,
            response:
              errorMessage.length > 100
                ? errorMessage
                : "I apologize, but I encountered an error while processing your request. Please try again.",
          });
        }
      }
    );

    app.post(
      "/v1/chat/:threadId",
      authenticateToken,
      async (req: Request, res: Response) => {
        const { threadId } = req.params;
        const { message } = req.body;
        const userId = (req as any).user.id;

        if (!message)
          return res.status(400).json({ message: "Error Bad Request" });

        try {
          // Verify the thread belongs to this user
          const thread = await threadsCollection.findOne({ threadId });
          if (thread && thread.userId && thread.userId !== userId) {
            return res
              .status(403)
              .json({ error: "Access denied: You don't own this thread" });
          }

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

            // Try to call the agent with our improved error handling
            try {
              response = await callAgent(client, message, threadId);
            } catch (error: any) {
              // Check if the error contains useful information
              const typedError = error as ErrorWithFailedGeneration;

              if (typedError?.error?.error?.failed_generation) {
                console.log("[CHAT] Extracting response from error object");
                response = typedError.error.error.failed_generation;
              } else {
                // If not a recognized error format, rethrow
                throw error;
              }
            }

            // Process response if needed to handle search
            if (
              response.includes("search_tool(") ||
              response.includes("Please use the search_tool") ||
              response.includes("I couldn't find any relevant information") ||
              response.includes("I apologize, but the retrieved documents") ||
              response.includes("The retrieved documents are about")
            ) {
              console.log(
                "[CHAT] Response indicates search is needed, enforcing search"
              );

              // Extract the destination/query from the response
              let searchQuery = message;

              // Try to find a more specific search query from the response
              const queryMatch = response.match(
                /search_tool\s*\(\s*["'](.+?)["']\s*\)/
              );
              if (queryMatch && queryMatch[1]) {
                searchQuery = queryMatch[1];
              } else {
                // Look for location in the initial query
                const locationMatch = message.match(
                  /(?:in|about)\s+([A-Za-z\s]+)(?:\s|$)/i
                );
                if (locationMatch && locationMatch[1]) {
                  searchQuery = `Places to travel in ${locationMatch[1].trim()}`;
                }
              }

              console.log(`[CHAT] Forcing search with query: "${searchQuery}"`);

              // Force a direct search_tool call with explicit search instruction
              const searchMessage = `I need information about ${searchQuery}. Please use the search_tool to find this information. Do not tell me you will search, actually perform the search immediately.`;

              try {
                response = await callAgent(client, searchMessage, threadId);
              } catch (searchError: any) {
                // If there's an error with search, try to extract content from the error
                const typedSearchError =
                  searchError as ErrorWithFailedGeneration;
                if (typedSearchError?.error?.error?.failed_generation) {
                  response = typedSearchError.error.error.failed_generation;
                } else {
                  throw searchError;
                }
              }
            }
          }

          // Save the messages for future reference
          await saveMessage(threadId, "user", message, userId);
          await saveMessage(threadId, "assistant", response, userId);

          res.json({ response });
        } catch (error) {
          console.error("Error in chat:", error);

          // Try to extract useful information from the error
          let errorMessage = "Internal server error";
          const typedError = error as ErrorWithFailedGeneration;

          const possibleContent =
            typedError?.error?.error?.failed_generation ||
            typedError?.failed_generation ||
            typedError?.message ||
            JSON.stringify(error);

          if (
            possibleContent &&
            typeof possibleContent === "string" &&
            (possibleContent.includes("Malaysia") ||
              possibleContent.length > 200)
          ) {
            errorMessage = possibleContent;
          }

          res.json({
            response:
              errorMessage.length > 100
                ? errorMessage
                : "I apologize, but I encountered an error while processing your request. Please try again.",
          });
        }
      }
    );

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
