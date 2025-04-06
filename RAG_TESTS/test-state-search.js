require("dotenv").config();
const { makeRetriever } = require("../dist/utils/retrieval");

async function testStateSearch() {
  try {
    console.log("Creating retriever...");
    const retriever = await makeRetriever({
      configurable: {
        threadId: "test-thread",
        embeddingModel: "cohere/embed-english-v3.0",
        searchKwargs: { k: 10 },
      },
    });

    console.log("Testing query for Assam...");
    const query = "places to visit in Assam";
    const results = await retriever.getRelevantDocuments(query);

    console.log(`Found ${results.length} results`);

    // Count places actually in Assam
    const assamPlaces = results.filter((doc) => doc.metadata.State === "Assam");
    console.log(
      `Places actually in Assam: ${assamPlaces.length} out of ${results.length}`
    );

    // Show all results with state information
    results.forEach((doc, i) => {
      console.log(`\nResult ${i + 1}:`);
      console.log(`Name: ${doc.metadata.Name}`);
      console.log(`Type: ${doc.metadata.Type}`);
      console.log(`Location: ${doc.metadata.City}, ${doc.metadata.State}`);
      console.log(`Zone: ${doc.metadata.Zone}`);
      console.log(
        `Is in Assam: ${doc.metadata.State === "Assam" ? "YES" : "NO"}`
      );

      // Print a short snippet of content
      console.log("Content snippet:");
      console.log(doc.pageContent.substring(0, 100) + "...");
    });

    console.log("\nTest completed");
  } catch (error) {
    console.log("Error in test:", error);
  }
}

testStateSearch().catch((err) => console.log("Unhandled error:", err));
