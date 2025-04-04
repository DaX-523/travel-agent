require("dotenv").config();
const { Pinecone } = require("@pinecone-database/pinecone");
const { CohereEmbeddings } = require("@langchain/cohere");
const { Document } = require("@langchain/core/documents");

async function extractStateFromQuery(query) {
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
  ];

  // Check if any state is mentioned in the query
  for (const state of indianStates) {
    if (query.toLowerCase().includes(state.toLowerCase())) {
      return state;
    }
  }

  return null;
}

async function testStateFilter() {
  try {
    console.log("Testing state filter implementation");

    // Extract state from query
    const query = "places to visit in Assam";
    const state = await extractStateFromQuery(query);
    console.log(`Extracted state from query: ${state}`);

    // Initialize Pinecone
    console.log("Initializing Pinecone...");
    const pinecone = new Pinecone();
    const indexName = process.env.PINECONE_INDEX_NAME;
    if (!indexName) {
      throw new Error("PINECONE_INDEX_NAME is required");
    }
    const index = pinecone.index(indexName);

    // Get places namespace
    const places = index.namespace("places");

    // Create embeddings
    console.log("Creating embedding for query...");
    const embeddings = new CohereEmbeddings({
      model: "embed-english-v3.0",
    });
    const queryVector = await embeddings.embedQuery(query);
    console.log(`Generated embedding vector of length: ${queryVector.length}`);

    // Test filter search
    if (state) {
      console.log(`\nPerforming filtered search for state: "${state}"...`);
      const filterResults = await places.query({
        vector: queryVector,
        topK: 10,
        includeMetadata: true,
        filter: {
          State: { $eq: state },
        },
      });

      console.log(
        `Found ${filterResults.matches?.length || 0} results with state filter`
      );

      if (filterResults.matches && filterResults.matches.length > 0) {
        // Show results
        console.log("\nFiltered search results:");
        filterResults.matches.forEach((match, i) => {
          const metadata = match.metadata || {};
          console.log(`\nResult ${i + 1}:`);
          console.log(`ID: ${match.id}`);
          console.log(`Name: ${metadata.Name}`);
          console.log(`Type: ${metadata.Type}`);
          console.log(`Location: ${metadata.City}, ${metadata.State}`);
          console.log(`Score: ${match.score}`);
        });
      }
    }

    // Test regular search
    console.log("\nPerforming regular search (no filter)...");
    const regularResults = await places.query({
      vector: queryVector,
      topK: 10,
      includeMetadata: true,
    });

    console.log(
      `Found ${regularResults.matches?.length || 0} results with regular search`
    );

    if (regularResults.matches && regularResults.matches.length > 0) {
      // Count places actually in Assam
      const assamPlaces = regularResults.matches.filter(
        (match) => match.metadata && match.metadata.State === "Assam"
      );
      console.log(
        `Places actually in Assam: ${assamPlaces.length} out of ${regularResults.matches.length}`
      );

      // Show first 3 results
      console.log("\nRegular search first 3 results:");
      regularResults.matches.slice(0, 3).forEach((match, i) => {
        const metadata = match.metadata || {};
        console.log(`\nResult ${i + 1}:`);
        console.log(`ID: ${match.id}`);
        console.log(`Name: ${metadata.Name}`);
        console.log(`Type: ${metadata.Type}`);
        console.log(`Location: ${metadata.City}, ${metadata.State}`);
        console.log(`Score: ${match.score}`);
      });
    }

    console.log("\nTest completed");
  } catch (error) {
    console.error("Error in test:", error);
  }
}

testStateFilter().catch((err) => console.error("Unhandled error:", err));
