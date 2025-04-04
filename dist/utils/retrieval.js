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
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeRetriever = makeRetriever;
require("dotenv/config");
// import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
const pinecone_1 = require("@langchain/pinecone");
// import { MongoClient } from "mongodb";
const configuration_1 = require("./configuration");
const pinecone_2 = require("@pinecone-database/pinecone");
const cohere_1 = require("@langchain/cohere");
const documents_1 = require("@langchain/core/documents");
/**
 * Extract state name from a query if present
 * For example "places to visit in Assam" would return "Assam"
 */
function extractStateFromQuery(query) {
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
function convertMetadata(metadata) {
    const result = Object.assign({}, metadata);
    // Add lowercase versions of capitalized fields
    const fieldMap = {
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
function makePineconeRetriever(configuration) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Initialize Pinecone
            console.log("Initializing Pinecone");
            const pinecone = new pinecone_2.Pinecone();
            const indexName = process.env.PINECONE_INDEX_NAME;
            if (!indexName) {
                throw new Error("PINECONE_INDEX_NAME environment variable is not defined");
            }
            const index = pinecone.index(indexName);
            // Check stats first
            console.log("Checking index stats");
            const stats = yield index.describeIndexStats();
            console.log("Stats:", stats);
            // Create embeddings model
            console.log("Creating Cohere embeddings model");
            const embeddings = new cohere_1.CohereEmbeddings({
                model: "embed-english-v3.0",
            });
            // Get namespace
            const places = index.namespace("places");
            // Create PineconeStore for fallback
            console.log("Creating PineconeStore for fallback");
            const vectorStore = yield pinecone_1.PineconeStore.fromExistingIndex(embeddings, {
                pineconeIndex: index,
                namespace: "places",
                textKey: "text",
            });
            // Create retriever
            console.log("Creating smart retriever with state filtering capabilities");
            const searchKwargs = configuration.searchKwargs || {};
            const k = searchKwargs.k || 10;
            // Define getRelevantDocuments function
            const getRelevantDocuments = (query) => __awaiter(this, void 0, void 0, function* () {
                console.log(`Querying with: "${query}"`);
                try {
                    // Check if there's a state mentioned in the query
                    const state = extractStateFromQuery(query);
                    if (state) {
                        console.log(`Detected state in query: "${state}"`);
                        try {
                            // Generate vector embedding for the query
                            const queryVector = yield embeddings.embedQuery(query);
                            // Try to do a hybrid search with state filter
                            console.log(`Performing filtered search for state: "${state}"`);
                            const filterResults = yield places.query({
                                vector: queryVector,
                                topK: k,
                                includeMetadata: true,
                                filter: {
                                    State: { $eq: state },
                                },
                            });
                            if (filterResults.matches && filterResults.matches.length > 0) {
                                console.log(`Found ${filterResults.matches.length} results with state filter`);
                                // Convert to Document format
                                return filterResults.matches.map((match) => {
                                    const metadata = match.metadata || {};
                                    return new documents_1.Document({
                                        pageContent: metadata.text || "",
                                        metadata: Object.assign({ id: match.id, score: match.score }, convertMetadata(metadata)),
                                    });
                                });
                            }
                            else {
                                console.log(`No results found with state filter "${state}", using fallback`);
                            }
                        }
                        catch (filterError) {
                            console.error("Error with filtered search:", filterError);
                        }
                    }
                }
                catch (err) {
                    console.error("Error in state extraction:", err);
                }
                // If we didn't find results with filter, do regular search
                console.log("Performing regular vector search as fallback");
                // Create fallback retriever
                const fallbackRetriever = vectorStore.asRetriever({ k });
                const docs = yield fallbackRetriever.getRelevantDocuments(query);
                // Convert metadata formats
                return docs.map((doc) => {
                    return new documents_1.Document({
                        pageContent: doc.pageContent,
                        metadata: convertMetadata(doc.metadata),
                    });
                });
            });
            // Return the retriever
            return {
                getRelevantDocuments,
                invoke: (query) => __awaiter(this, void 0, void 0, function* () {
                    return getRelevantDocuments(query);
                }),
            };
        }
        catch (error) {
            console.error("Error creating Pinecone retriever:", error);
            // Create a dummy retriever that returns empty results
            console.log("Using fallback empty retriever");
            return {
                getRelevantDocuments: () => __awaiter(this, void 0, void 0, function* () { return []; }),
                invoke: () => __awaiter(this, void 0, void 0, function* () { return []; }),
            };
        }
    });
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
function makeTextEmbeddings(modelName) {
    const index = modelName.indexOf("/");
    // If there's no slash, use the modelName as is
    if (index === -1) {
        return new cohere_1.CohereEmbeddings({ model: "embed-english-v3.0" });
    }
    // Otherwise, extract provider and model
    const provider = modelName.slice(0, index);
    const model = modelName.slice(index + 1);
    // For now, we only support Cohere embeddings
    if (provider.toLowerCase() === "cohere") {
        return new cohere_1.CohereEmbeddings({ model });
    }
    // Default to Cohere's english embedding model
    return new cohere_1.CohereEmbeddings({ model: "embed-english-v3.0" });
}
/**
 * Create a retriever based on the configuration
 */
function makeRetriever(config) {
    return __awaiter(this, void 0, void 0, function* () {
        const configuration = (0, configuration_1.ensureConfiguration)(config);
        console.log("Using configuration:", configuration);
        return makePineconeRetriever(configuration);
    });
}
