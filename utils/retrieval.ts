import "dotenv/config";

// import { Client } from "@elastic/elasticsearch";
// import { ElasticVectorSearch } from "@langchain/community/vectorstores/elasticsearch";
import { RunnableConfig } from "@langchain/core/runnables";
import { VectorStoreRetriever } from "@langchain/core/vectorstores";
// import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { PineconeStore } from "@langchain/pinecone";
// import { MongoClient } from "mongodb";
import { ensureConfiguration } from "./configuration";
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import { Embeddings } from "@langchain/core/embeddings";
import { CohereEmbeddings } from "@langchain/cohere";
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

async function makePineconeRetriever(
  configuration: ReturnType<typeof ensureConfiguration>,
  embeddingModel: Embeddings
): Promise<VectorStoreRetriever> {
  const indexName = process.env.PINECONE_INDEX_NAME;
  if (!indexName) {
    throw new Error("PINECONE_INDEX_NAME environment variable is not defined");
  }
  const pinecone = new PineconeClient();
  const pineconeIndex = pinecone.Index(indexName!);
  const vectorStore = await PineconeStore.fromExistingIndex(embeddingModel, {
    pineconeIndex,
  });

  const searchKwargs = configuration.searchKwargs || {};
  const filter = {
    ...searchKwargs,
    threadId: configuration.threadId,
  };

  return vectorStore.asRetriever({ filter });
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

function makeTextEmbeddings(modelName: string): Embeddings {
  /**
   * Connect to the configured text encoder.
   */
  const index = modelName.indexOf("/");
  let provider, model;
  if (index === -1)
    throw new Error(`Unsupported embedding provider: ${provider}`);

  return new CohereEmbeddings({ model });
}

export async function makeRetriever(
  config: RunnableConfig
): Promise<VectorStoreRetriever> {
  const configuration = ensureConfiguration(config);
  const embeddingModel = makeTextEmbeddings(configuration.embeddingModel);

  const threadId = configuration.threadId;
  if (!threadId) {
    throw new Error("Please provide a valid threadId in the configuration.");
  }

  return makePineconeRetriever(configuration, embeddingModel);
}
