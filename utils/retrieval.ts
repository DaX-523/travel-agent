import "dotenv/config";

// import { Client } from "@elastic/elasticsearch";
// import { ElasticVectorSearch } from "@langchain/community/vectorstores/elasticsearch";
import { RunnableConfig } from "@langchain/core/runnables";
import { VectorStoreRetriever } from "@langchain/core/vectorstores";
// import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { PineconeStore } from "@langchain/pinecone";
// import { MongoClient } from "mongodb";
import { ensureConfiguration } from "./configuration";
import { Pinecone } from "@pinecone-database/pinecone";
import { Embeddings } from "@langchain/core/embeddings";
import { CohereEmbeddings } from "@langchain/cohere";
import { Document } from "@langchain/core/documents";
// import { OpenAIEmbeddings } from "@langchain/openai";

// retriever for elastic search
// async function makeElasticRetriever(
//   configuration: ReturnType<typeof ensureConfiguration>,
//   embeddingModel: Embeddings
// ): Promise<VectorStoreRetriever> {
//   const elasticUrl = process.env.ELASTICSEARCH_URL;
//   if (!elasticUrl) {
//     throw new Error("ELASTICSEARCH_URL environment variable is not defined");
//   }

//   let auth: { username: string; password: string } | { apiKey: string };
//   if (configuration.retrieverProvider === "elastic-local") {
//     const username = process.env.ELASTICSEARCH_USER;
//     const password = process.env.ELASTICSEARCH_PASSWORD;
//     if (!username || !password) {
//       throw new Error(
//         "ELASTICSEARCH_USER or ELASTICSEARCH_PASSWORD environment variable is not defined"
//       );
//     }
//     auth = { username, password };
//   } else {
//     const apiKey = process.env.ELASTICSEARCH_API_KEY;
//     if (!apiKey) {
//       throw new Error(
//         "ELASTICSEARCH_API_KEY environment variable is not defined"
//       );
//     }
//     auth = { apiKey };
//   }

//   const client = new Client({
//     node: elasticUrl,
//     auth,
//   });

//   const vectorStore = new ElasticVectorSearch(embeddingModel, {
//     client,
//     indexName: "langchain_index",
//   });
//   const searchKwargs = configuration.searchKwargs || {};
//   const filter = {
//     ...searchKwargs,
//     user_id: configuration.userId,
//   };

//   return vectorStore.asRetriever({ filter });
// }

/**
 * Interface for a retriever that can be used as a fallback
 */
interface SimpleRetriever {
  getRelevantDocuments(query: string): Promise<Document[]>;
  invoke(query: string): Promise<Document[]>;
}

/**
 * Type definitions for Pinecone API responses
 */
interface PineconeMatch {
  id: string;
  score?: number;
  metadata?: Record<string, any>;
  values?: number[];
}

interface PineconeResponse {
  matches?: PineconeMatch[];
  namespace?: string;
  usage?: {
    readUnits?: number;
  };
}

/**
 * Extract state name from a query if present
 * For example "places to visit in Assam" would return "Assam"
 */
function extractStateFromQuery(query: string): string | null {
  // List of Indian states to check for
  const indianStates = [
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chhattisgarh",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "West Bengal",
    "Delhi",
    "Jammu and Kashmir",
    "Ladakh",
    "Andaman and Nicobar Islands",
    "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Lakshadweep",
    "Puducherry",
  ];

  // Check if any state is mentioned in the query
  for (const state of indianStates) {
    if (query.toLowerCase().includes(state.toLowerCase())) {
      return state;
    }
  }

  return null;
}

/**
 * Convert metadata to standardized format with lowercase field names
 */
function convertMetadata(metadata: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = { ...metadata };

  // Add lowercase versions of capitalized fields
  const fieldMap: Record<string, string> = {
    Name: "name",
    Type: "type",
    City: "city",
    State: "state",
    Zone: "zone",
  };

  for (const [capitalField, lowercaseField] of Object.entries(fieldMap)) {
    if (metadata[capitalField] !== undefined) {
      result[lowercaseField] = metadata[capitalField];
    }
  }

  return result;
}

/**
 * Creates a retriever that uses Pinecone for vector search
 * This implementation uses filters for state-specific queries
 */
async function makePineconeRetriever(
  configuration: ReturnType<typeof ensureConfiguration>
): Promise<SimpleRetriever> {
  try {
    // Initialize Pinecone
    console.log("Initializing Pinecone");
    const pinecone = new Pinecone();
    const indexName = process.env.PINECONE_INDEX_NAME;
    if (!indexName) {
      throw new Error(
        "PINECONE_INDEX_NAME environment variable is not defined"
      );
    }
    const index = pinecone.index(indexName);

    // Check stats first
    console.log("Checking index stats");
    const stats = await index.describeIndexStats();
    console.log("Stats:", stats);

    // Create embeddings model
    console.log("Creating Cohere embeddings model");
    const embeddings = new CohereEmbeddings({
      model: "embed-english-v3.0",
    });

    // Get namespace
    const places = index.namespace("places");

    // Create PineconeStore for fallback
    console.log("Creating PineconeStore for fallback");
    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex: index,
      namespace: "places",
      textKey: "text",
    });

    // Create retriever
    console.log("Creating smart retriever with state filtering capabilities");
    const searchKwargs = configuration.searchKwargs || {};
    const k = searchKwargs.k || 10;

    // Define getRelevantDocuments function
    const getRelevantDocuments = async (query: string): Promise<Document[]> => {
      console.log(`Querying with: "${query}"`);

      try {
        // Check if there's a state mentioned in the query
        const state = extractStateFromQuery(query);
        if (state) {
          console.log(`Detected state in query: "${state}"`);

          try {
            // Generate vector embedding for the query
            const queryVector = await embeddings.embedQuery(query);

            // Try to do a hybrid search with state filter
            console.log(`Performing filtered search for state: "${state}"`);
            const filterResults = await places.query({
              vector: queryVector,
              topK: k,
              includeMetadata: true,
              filter: {
                State: { $eq: state },
              },
            });

            if (filterResults.matches && filterResults.matches.length > 0) {
              console.log(
                `Found ${filterResults.matches.length} results with state filter`
              );

              // Convert to Document format
              return filterResults.matches.map((match) => {
                const metadata = match.metadata || {};
                return new Document({
                  pageContent: (metadata.text as string) || "",
                  metadata: {
                    id: match.id,
                    score: match.score,
                    ...convertMetadata(metadata),
                  },
                });
              });
            } else {
              console.log(
                `No results found with state filter "${state}", using fallback`
              );
            }
          } catch (filterError) {
            console.error("Error with filtered search:", filterError);
          }
        }
      } catch (err) {
        console.error("Error in state extraction:", err);
      }

      // If we didn't find results with filter, do regular search
      console.log("Performing regular vector search as fallback");

      // Create fallback retriever
      const fallbackRetriever = vectorStore.asRetriever({ k });
      const docs = await fallbackRetriever.getRelevantDocuments(query);

      // Convert metadata formats
      return docs.map((doc) => {
        return new Document({
          pageContent: doc.pageContent,
          metadata: convertMetadata(doc.metadata),
        });
      });
    };

    // Return the retriever
    return {
      getRelevantDocuments,
      invoke: async (query: string) => {
        return getRelevantDocuments(query);
      },
    };
  } catch (error) {
    console.error("Error creating Pinecone retriever:", error);

    // Create a dummy retriever that returns empty results
    console.log("Using fallback empty retriever");
    return {
      getRelevantDocuments: async () => [],
      invoke: async () => [],
    };
  }
}

// retriever for mongodb vector search
// async function makeMongoDBRetriever(
//   configuration: ReturnType<typeof ensureConfiguration>,
//   embeddingModel: Embeddings
// ): Promise<VectorStoreRetriever> {
//   if (!process.env.MONGODB_URI) {
//     throw new Error("MONGODB_URI environment variable is not defined");
//   }
//   const client = new MongoClient(process.env.MONGODB_URI);
//   const namespace = `langgraph_retrieval_agent.${configuration.userId}`;
//   const [dbName, collectionName] = namespace.split(".");
//   const collection = client.db(dbName).collection(collectionName);
//   const vectorStore = new MongoDBAtlasVectorSearch(embeddingModel, {
//     collection: collection,
//     textKey: "text",
//     embeddingKey: "embedding",
//     indexName: "vector_index",
//   });
//   const searchKwargs = { ...configuration.searchKwargs };
//   searchKwargs.preFilter = {
//     ...searchKwargs.preFilter,
//     user_id: { $eq: configuration.userId },
//   };
//   return vectorStore.asRetriever({ filter: searchKwargs });
// }

/**
 * Creates an embedding model based on the provided model name
 * Format: provider/model or just model (defaults to Cohere)
 */
function makeTextEmbeddings(modelName: string): Embeddings {
  const index = modelName.indexOf("/");

  // If there's no slash, use the modelName as is
  if (index === -1) {
    return new CohereEmbeddings({ model: "embed-english-v3.0" });
  }

  // Otherwise, extract provider and model
  const provider = modelName.slice(0, index);
  const model = modelName.slice(index + 1);

  // For now, we only support Cohere embeddings
  if (provider.toLowerCase() === "cohere") {
    return new CohereEmbeddings({ model });
  }

  // Default to Cohere's english embedding model
  return new CohereEmbeddings({ model: "embed-english-v3.0" });
}

/**
 * Create a retriever based on the configuration
 */
export async function makeRetriever(
  config: RunnableConfig
): Promise<SimpleRetriever> {
  const configuration = ensureConfiguration(config);
  console.log("Using configuration:", configuration);

  return makePineconeRetriever(configuration);
}
