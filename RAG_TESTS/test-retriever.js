require("dotenv").config();
const { makeRetriever } = require("../dist/utils/retrieval");

const log = (...args) => console.error(...args);

// Print environment variables to debug
log("Environment variables:");
log("- PINECONE_INDEX_NAME:", process.env.PINECONE_INDEX_NAME);
console.log("Environment variables:");
console.log("- PINECONE_INDEX_NAME:", process.env.PINECONE_INDEX_NAME);
console.log("- COHERE_API_KEY exists:", !!process.env.COHERE_API_KEY);

async function testRetriever() {
  try {
    console.log("Testing retriever...");
    const retriever = await makeRetriever({
      configurable: {
        threadId: "test-thread",
        embeddingModel: "cohere/embed-english-v3.0",
        searchKwargs: { k: 3 },
      },
    });

    console.log("Retriever created. Executing search...");

    // Try different queries
    const queries = [
      "tourist attractions in Delhi",
      "historical monuments in India",
      "famous temples in South India",
    ];

    for (const query of queries) {
      console.log(`\n\nExecuting query: "${query}"`);
      try {
        console.log("Calling getRelevantDocuments...");
        const results = await retriever.getRelevantDocuments(query);
        console.log(`Found ${results.length} results for "${query}"`);

        results.forEach((doc, i) => {
          console.log(`\nResult ${i + 1}:`);
          console.log(`Name: ${doc.metadata.name}`);
          console.log(`Type: ${doc.metadata.type}`);
          console.log(
            `Location: ${doc.metadata.city}, ${doc.metadata.state} (${doc.metadata.zone})`
          );
          console.log(`Rating: ${doc.metadata.googleReviewRating}`);
          console.log(`Score: ${doc.metadata.score}`);
          console.log(`Snippet: ${doc.pageContent.substring(0, 100)}...`);
        });
      } catch (error) {
        console.error(`Error executing query "${query}":`, error);
        console.error(error.stack);
      }
    }
  } catch (error) {
    console.error("Error testing retriever:", error);
    console.error(error.stack);
  }
}

console.log("Starting test retriever script...");
testRetriever()
  .then(() => console.log("Test completed"))
  .catch((err) => {
    console.error("Unhandled error:", err);
    console.error(err.stack);
  });
