require("dotenv").config();
const { makeRetriever } = require("../dist/utils/retrieval");

async function testAgentRetriever() {
  try {
    console.error("Creating retriever...");
    const retriever = await makeRetriever({
      configurable: {
        threadId: "test-thread",
        embeddingModel: "cohere/embed-english-v3.0",
        searchKwargs: { k: 3 },
      },
    });

    console.error("Testing query...");
    const query = "tourist attractions in Delhi";
    const results = await retriever.getRelevantDocuments(query);

    console.error(`Found ${results.length} results`);
    results.forEach((doc, i) => {
      console.error(`\nResult ${i + 1}:`);
      console.error(`Name: ${doc.metadata.name}`);
      console.error(`Type: ${doc.metadata.type}`);
      console.error(`Location: ${doc.metadata.city}, ${doc.metadata.state}`);
      console.error(
        `Has lowercase fields: ${!!doc.metadata.name && !!doc.metadata.type}`
      );
    });

    console.error("Test completed");
  } catch (error) {
    console.error("Error in test:", error);
  }
}

testAgentRetriever().catch((err) => console.error("Unhandled error:", err));
