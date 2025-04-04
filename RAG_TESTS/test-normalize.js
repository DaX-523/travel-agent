require("dotenv").config();
const { makeRetriever } = require("../dist/utils/retrieval");
const util = require("util");

async function testNormalization() {
  console.error("Testing retriever with metadata normalization");

  try {
    // Create retriever
    console.error("Creating retriever...");
    const retriever = await makeRetriever({
      configurable: {
        threadId: "test-thread",
        embeddingModel: "cohere/embed-english-v3.0",
        searchKwargs: { k: 3 },
      },
    });

    // Test query
    const query = "tourist attractions in Delhi";
    console.error(`\nExecuting query: "${query}"`);

    // Get documents
    const docs = await retriever.getRelevantDocuments(query);
    console.error(`Found ${docs.length} results`);

    // Display documents with both capitalized and lowercase fields
    docs.forEach((doc, i) => {
      console.error(`\nResult ${i + 1}:`);

      // Check original capitalized fields
      console.error("Original capitalized fields:");
      console.error(`Name: ${doc.metadata.Name}`);
      console.error(`Type: ${doc.metadata.Type}`);
      console.error(`City: ${doc.metadata.City}`);
      console.error(`State: ${doc.metadata.State}`);

      // Check normalized lowercase fields
      console.error("\nNormalized lowercase fields:");
      console.error(`name: ${doc.metadata.name}`);
      console.error(`type: ${doc.metadata.type}`);
      console.error(`city: ${doc.metadata.city}`);
      console.error(`state: ${doc.metadata.state}`);

      // Print page content snippet
      console.error("\nContent snippet:");
      console.error(doc.pageContent.substring(0, 100) + "...");
    });

    console.error("\nTest completed successfully");
  } catch (error) {
    console.error("Error in test:", error);
  }
}

// Run the test
testNormalization().catch((err) => console.error("Unhandled error:", err));
