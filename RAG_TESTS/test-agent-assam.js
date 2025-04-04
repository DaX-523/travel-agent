require("dotenv").config();
const { makeRetriever } = require("./dist/utils/retrieval");

async function testAgentAssam() {
  try {
    console.log("Testing agent retriever with Assam query...");

    // Create retriever with agent configuration
    const retriever = await makeRetriever({
      configurable: {
        threadId: "test-thread",
        embeddingModel: "cohere/embed-english-v3.0",
        searchKwargs: { k: 10 },
      },
    });

    // Test with Assam query
    const query = "places to visit in Assam";
    console.log(`\nExecuting query: "${query}"`);
    const results = await retriever.getRelevantDocuments(query);

    console.log(`\nFound ${results.length} results`);

    // Count places actually in Assam
    const assamPlaces = results.filter((doc) => doc.metadata.state === "Assam");
    console.log(
      `Places in Assam: ${assamPlaces.length} out of ${results.length}`
    );

    // Print Assam results
    if (assamPlaces.length > 0) {
      console.log("\nPlaces in Assam:");
      assamPlaces.forEach((doc, i) => {
        console.log(`\nAssam Place ${i + 1}:`);
        console.log(`Name: ${doc.metadata.name}`);
        console.log(`Type: ${doc.metadata.type}`);
        console.log(`Location: ${doc.metadata.city}, ${doc.metadata.state}`);
      });
    }

    // Print non-Assam results
    const nonAssamPlaces = results.filter(
      (doc) => doc.metadata.state !== "Assam"
    );
    if (nonAssamPlaces.length > 0) {
      console.log("\nNon-Assam Places:");
      nonAssamPlaces.forEach((doc, i) => {
        console.log(`\nOther Place ${i + 1}:`);
        console.log(`Name: ${doc.metadata.name}`);
        console.log(`Type: ${doc.metadata.type}`);
        console.log(`Location: ${doc.metadata.city}, ${doc.metadata.state}`);
      });
    }

    console.log("\nTest completed");
  } catch (error) {
    console.error("Error in test:", error);
  }
}

testAgentAssam().catch((err) => console.error("Unhandled error:", err));
