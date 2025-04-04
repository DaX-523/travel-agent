require("dotenv").config();
const { Pinecone } = require("@pinecone-database/pinecone");
const { CohereEmbeddings } = require("@langchain/cohere");

const log = (...args) => console.error(...args);

async function directTest() {
  // Check env vars
  log("Environment:");
  log("- PINECONE_INDEX_NAME:", process.env.PINECONE_INDEX_NAME);
  log("- PINECONE_API_KEY exists:", !!process.env.PINECONE_API_KEY);
  log("- COHERE_API_KEY exists:", !!process.env.COHERE_API_KEY);

  try {
    // Initialize Pinecone client
    log("\nInitializing Pinecone...");
    const pc = new Pinecone();

    log("Creating index client...");
    const index = pc.index(process.env.PINECONE_INDEX_NAME);

    // Check index stats
    log("\nChecking index stats...");
    const stats = await index.describeIndexStats();
    log("Total records:", stats.totalRecordCount);
    log("Namespaces:", Object.keys(stats.namespaces || {}));
    log("Places records:", stats.namespaces?.places?.recordCount);

    // Run a test query
    log("\nCreating embedding...");
    const embedder = new CohereEmbeddings({ model: "embed-english-v3.0" });
    const vector = await embedder.embedQuery("tourist attractions in Delhi");
    log("Query vector length:", vector.length);

    // Execute query
    log("\nExecuting query...");
    const namespace = index.namespace("places");
    const results = await namespace.query({
      vector,
      topK: 3,
      includeMetadata: true,
    });

    log("Query response:");
    log("- matches:", results.matches?.length);

    if (results.matches?.length) {
      log("\nMatch details:");
      for (const match of results.matches) {
        log(`\nID: ${match.id}`);
        log(`Score: ${match.score}`);
        log(
          `Metadata: ${JSON.stringify(
            {
              name: match.metadata?.Name,
              city: match.metadata?.City,
              type: match.metadata?.Type,
            },
            null,
            2
          )}`
        );
      }
    } else {
      log("No matches found");
    }
  } catch (error) {
    log("Error during test:", error);
    throw error;
  }
}

directTest().catch((err) => {
  log("Error in direct test:", err);
  process.exit(1);
});
