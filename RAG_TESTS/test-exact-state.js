require("dotenv").config();
const { Pinecone } = require("@pinecone-database/pinecone");

async function testExactState() {
  try {
    console.error("Connecting to Pinecone...");
    const pinecone = new Pinecone();
    const indexName = process.env.PINECONE_INDEX_NAME;

    if (!indexName) {
      throw new Error("PINECONE_INDEX_NAME is required");
    }

    const index = pinecone.index(indexName);

    // First check index stats to see what we have
    console.error("Getting index stats...");
    const stats = await index.describeIndexStats();
    console.error("Index stats:", stats);

    // Get the places namespace
    const namespace = index.namespace("places");

    // Do a direct fetch for Assam records
    console.error('\nAttempting direct text search for "Assam"...');
    const textResults = await namespace.query({
      vector: Array(1024).fill(0), // Dummy vector, won't affect text search
      topK: 20,
      includeMetadata: true,
      filter: {
        State: { $eq: "Assam" },
      },
    });

    console.error(
      `Found ${
        textResults.matches?.length || 0
      } exact matches for State = "Assam"`
    );

    if (textResults.matches && textResults.matches.length > 0) {
      textResults.matches.forEach((match, i) => {
        console.error(`\nAssam Result ${i + 1}:`);
        console.error(`ID: ${match.id}`);
        console.error(`Name: ${match.metadata?.Name}`);
        console.error(`Type: ${match.metadata?.Type}`);
        console.error(
          `Location: ${match.metadata?.City}, ${match.metadata?.State}`
        );
      });
    }

    console.error("\nTest completed");
  } catch (error) {
    console.error("Error in test:", error);
  }
}

testExactState().catch((err) => console.error("Unhandled error:", err));
