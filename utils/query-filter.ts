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
  type: z.enum(["greeting", "non_travel", "travel"]),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
});

/**
 * Use LLM to analyze the type of query
 */
export async function modelAnalyzeQuery(
  query: string
): Promise<z.infer<typeof QueryClassification>> {
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
} {
  return {
    isOffTopic: isOffTopicQuery(query),
    isSimple: isSimpleQuery(query),
    isGreeting: isGreeting(query),
  };
}
