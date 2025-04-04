require("dotenv").config();
const { Pinecone } = require("@pinecone-database/pinecone");
const { CohereEmbeddings } = require("@langchain/cohere");
const { PineconeStore } = require("@langchain/pinecone");

async function runSimpleTest() {
  console.error("Starting simple test");

  try {
    // Initialize Pinecone
    console.error("Initializing Pinecone");
    const pinecone = new Pinecone();
    const indexName = process.env.PINECONE_INDEX_NAME;
    const index = pinecone.index(indexName);

    // Check stats first
    console.error("Checking index stats");
    const stats = await index.describeIndexStats();
    console.error("Stats:", stats);

    // Create embeddings model
    console.error("Creating embeddings model");
    const embeddings = new CohereEmbeddings({
      model: "embed-english-v3.0",
    });

    // Create VectorStore
    console.error("Creating PineconeStore");
    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex: index,
      namespace: "places",
      textKey: "text",
    });

    // Create retriever
    console.error("Creating retriever");
    const retriever = vectorStore.asRetriever({
      k: 3,
    });

    // Test with simple query
    console.error("Testing with query");
    const query = "tourist attractions in Delhi";
    const docs = await retriever.getRelevantDocuments(query);

    console.error(`Found ${docs.length} results`);
    docs.forEach((doc, i) => {
      console.error(`\nResult ${i + 1}:`);
      console.error(`PageContent: ${doc.pageContent.substring(0, 100)}...`);
      console.error(`Metadata: ${JSON.stringify(doc.metadata, null, 2)}`);
    });
  } catch (error) {
    console.error("Error in simple test:", error);
  }
}

runSimpleTest()
  .then(() => console.error("Test completed"))
  .catch((err) => console.error("Unhandled error:", err));
