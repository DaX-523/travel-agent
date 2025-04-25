import { HumanMessage } from "@langchain/core/messages";
import { loadChatModel } from "./configuration";
import { z } from "zod";
import { ANALYZE_PROMPT, NON_TRAVEL_QUERY_PROMPT } from "./prompts";

// Common travel-related terms
export const TRAVEL_RELATED_TERMS = [
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

// Non-travel keywords that indicate off-topic queries
export const NON_TRAVEL_KEYWORDS = [
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

// Simple greeting patterns
export const GREETING_PATTERNS = [
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

export const POLITE_REJECTION_MESSAGE =
  "I'm specialized in travel assistance and can only provide information about destinations, accommodations, attractions, and travel planning. For questions outside travel-related topics, please consult a general-purpose assistant.";

/**
 * Checks if a query is a simple greeting pattern
 */
export function isGreeting(query: string): boolean {
  return GREETING_PATTERNS.some((pattern) => pattern.test(query));
}

/**
 * Checks if query contains any non-travel keywords
 */
export function containsNonTravelTerms(query: string): boolean {
  return NON_TRAVEL_KEYWORDS.some((keyword) =>
    query.toLowerCase().includes(keyword.toLowerCase())
  );
}

/**
 * Checks if query contains any travel-related terms
 */
export function containsTravelTerms(query: string): boolean {
  return TRAVEL_RELATED_TERMS.some((term) =>
    query.toLowerCase().includes(term.toLowerCase())
  );
}

/**
 * Determines if a query is off-topic (not related to travel)
 */
export function isOffTopicQuery(query: string): boolean {
  // If it's a greeting, it's acceptable
  if (isGreeting(query)) return false;

  const words = query.toLowerCase().split(/\s+/);

  // If it contains non-travel keywords or is a longer query without travel terms,
  // it's likely off-topic
  return (
    containsNonTravelTerms(query) ||
    (words.length > 5 && !containsTravelTerms(query))
  );
}

/**
 * Determines if a query is simple enough to handle without the agent tooling
 */
export function isSimpleQuery(query: string): boolean {
  const words = query.toLowerCase().split(/\s+/);
  return (
    isGreeting(query) || (!containsTravelTerms(query) && words.length < 10)
  );
}

// Define schema for query classification
const QueryClassification = z.object({
  type: z.enum(["greeting", "non_travel", "travel", "conversation_history"]),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
});

// Conversation history request patterns
export const CONVERSATION_HISTORY_PATTERNS = [
  /previous conversation/i,
  /chat history/i,
  /what did (we|I) (talk|say|discuss) about/i,
  /what (did you tell me|have we discussed)/i,
  /remember our conversation/i,
  /recall what we discussed/i,
  /what were we talking about/i,
  /summarize our chat/i,
  /what have I asked you/i,
  /what did we talk about/i,
  // More patterns for robustness
  /do (you )?(remember|recall) (what|which|the) (questions?|things?|topics?) (I|we) (asked|discussed|talked about|mentioned)/i,
  /can (you )?(remember|recall) (our|the|this|that) (conversation|chat|discussion)/i,
  /what (questions?|things?|topics?) (did )?(I|we) (ask|discuss|talk about|mention)/i,
  /what did (I|we) (ask|say) (to you|you|earlier|before|previously)/i,
  /history/i,
  /(show|tell) me (what|the) (we|I) (discussed|talked about)/i,
  /what have we (talked|spoken|chatted) about/i,
  /what was our (conversation|discussion|chat) about/i,
  /do you know what (I|we) (said|asked|talked about) (earlier|before|previously)/i,
  /(repeat|list) (the )?(questions|topics) (I|we) (asked|discussed)/i,
];

/**
 * Checks if a query is asking about conversation history
 */
export function isConversationHistoryQuery(query: string): boolean {
  return CONVERSATION_HISTORY_PATTERNS.some((pattern) => pattern.test(query));
}

/**
 * Use LLM to analyze the type of query
 */
export async function modelAnalyzeQuery(
  query: string
): Promise<z.infer<typeof QueryClassification>> {
  // First check for conversation history queries using pattern matching
  // This has highest priority to ensure we don't misclassify as greeting
  if (isConversationHistoryQuery(query)) {
    return {
      type: "conversation_history",
      confidence: 0.95,
      explanation: "Query is asking about previous conversations",
    };
  }

  // Simple heuristic pre-check for memory/recollection related terms
  // These could be conversation history queries that our patterns missed
  const memoryTerms = [
    "remember",
    "recall",
    "memory",
    "mentioned",
    "earlier",
    "before",
    "previously",
    "told me",
    "said",
    "asked",
  ];

  const containsMemoryTerms = memoryTerms.some((term) =>
    query.toLowerCase().includes(term.toLowerCase())
  );

  // If we find memory terms, give it a more careful check
  if (
    containsMemoryTerms &&
    query.toLowerCase().includes("you") &&
    query.length < 60 &&
    query.includes("?")
  ) {
    // Likely a conversation recall question that our patterns missed
    return {
      type: "conversation_history",
      confidence: 0.85,
      explanation: "Query appears to be asking about previous interactions",
    };
  }

  const model = await loadChatModel("groq/llama3-70b-8192");
  const boundModel = model.withStructuredOutput(QueryClassification);

  const response = await boundModel.invoke([
    {
      role: "system",
      content: ANALYZE_PROMPT,
    },
    new HumanMessage({
      content: query,
    }),
  ]);

  // Additional safety check - if the response might be conversation history but was classified
  // as something else with low confidence, override it
  if (
    response.type !== "conversation_history" &&
    response.confidence < 0.7 &&
    containsMemoryTerms
  ) {
    return {
      type: "conversation_history",
      confidence: 0.75,
      explanation:
        "Likely asking about previous conversations based on memory terms",
    };
  }

  return response;
}

/**
 * Handle a simple greeting with the chat model directly
 */
export async function handleGreeting(query: string): Promise<string> {
  const model = await loadChatModel("groq/llama3-70b-8192");
  const response = await model.invoke([
    {
      role: "system",
      content:
        "You are a friendly travel assistant. For conversational greetings, respond naturally and briefly.",
    },
    new HumanMessage({
      content: query,
    }),
  ]);
  return response.content as string;
}

/**
 * Handle a non-travel query with a polite rejection
 */
export async function handleNonTravelQuery(query: string): Promise<string> {
  const model = await loadChatModel("groq/llama3-70b-8192");
  const response = await model.invoke([
    {
      role: "system",
      content: NON_TRAVEL_QUERY_PROMPT,
    },
    new HumanMessage({
      content: query,
    }),
  ]);
  return response.content as string;
}

/**
 * Comprehensive query analysis to determine how to handle it
 * @returns An object with analysis results
 */
export function analyzeQuery(query: string): {
  isOffTopic: boolean;
  isSimple: boolean;
  isGreeting: boolean;
  isConversationHistory: boolean;
} {
  return {
    isOffTopic: isOffTopicQuery(query),
    isSimple: isSimpleQuery(query),
    isGreeting: isGreeting(query),
    isConversationHistory: isConversationHistoryQuery(query),
  };
}

/**
 * Handle a request for conversation history
 * @param query The user's query about conversation history
 * @param threadId The current thread ID
 * @param client The MongoDB client
 */
export async function handleConversationHistoryQuery(
  query: string,
  threadId: string,
  client: any
): Promise<string> {
  // If no threadId is provided, return a default message
  if (!threadId) {
    return "I don't have any record of our previous conversations. This appears to be our first interaction.";
  }

  try {
    // Connect to the messages collection
    const db = client.db("AI-Travel-Agent");
    const messagesCollection = db.collection("messages");

    // Fetch messages for this thread, sorted by timestamp
    const messages = await messagesCollection
      .find({ threadId })
      .sort({ timestamp: 1 })
      .toArray();

    if (!messages || messages.length === 0) {
      return "I don't have any record of our previous conversations. This appears to be our first interaction.";
    }

    // Define message type for TypeScript
    interface MessageType {
      role: string;
      content: string;
      threadId: string;
      timestamp: number;
    }

    // Skip the current query when summarizing
    const previousMessages = messages.filter(
      (msg: MessageType) => !(msg.role === "user" && msg.content === query)
    );

    if (previousMessages.length === 0) {
      return "I don't have any record of our previous conversations. This appears to be our first interaction.";
    }

    // Load the model for summarization
    const model = await loadChatModel("groq/llama3-70b-8192");

    // Create a summary of the conversation
    const conversation = previousMessages
      .map((msg: MessageType) => `${msg.role.toUpperCase()}: ${msg.content}`)
      .join("\n\n");

    const summary = await model.invoke([
      {
        role: "system",
        content:
          "You are a helpful assistant that summarizes conversations about travel. Provide a clear, concise summary of the main topics discussed in the conversation history. Focus on travel destinations, recommendations, and specific information shared. Don't mention timestamps or message IDs. Frame your response as 'Based on our previous conversation, we discussed...'",
      },
      {
        role: "user",
        content: `Summarize this conversation: \n\n${conversation}`,
      },
    ]);

    return summary.content as string;
  } catch (error) {
    console.error("Error retrieving conversation history:", error);
    return "I'm sorry, I encountered an error while trying to retrieve our conversation history.";
  }
}
