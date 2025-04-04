require("dotenv").config();
const { Pinecone } = require("@pinecone-database/pinecone");
const { CohereEmbeddings } = require("@langchain/cohere");
const { Document } = require("@langchain/core/documents");

// Function to extract state from query
function extractStateFromQuery(query) {
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
    "Delhi",
  ];

  for (const state of indianStates) {
    if (query.toLowerCase().includes(state.toLowerCase())) {
      return state;
    }
  }

  return null;
}

// Function to convert metadata to standardized format
function convertMetadata(metadata) {
  const result = { ...metadata };

  // Add lowercase versions of capitalized fields
  const fieldMap = {
    Name: "name",
    Type: "type",
    City: "city",
    State: "state",
    Zone: "zone",
  };

  for (const [capitalField, lowercaseField] of Object.entries(fieldMap)) {
    if (metadata[capitalField] !== undefined) {
      result[lowercaseField] = metadata[capitalField];
    }
  }

  return result;
}

async function finalTest() {
  try {
    console.log("=== Running final state filter test ===");

    // Test queries with states
    const queries = [
      "places to visit in Assam",
      "tourist attractions in Karnataka",
      "historical sites in Delhi",
    ];

    for (const query of queries) {
      console.log(`\n------------------------------`);
      console.log(`Testing query: "${query}"`);

      // Extract state
      const state = extractStateFromQuery(query);
      console.log(`Extracted state: ${state || "None"}`);

      if (!state) {
        console.log("No state detected in query, skipping test");
        continue;
      }

      // Initialize Pinecone
      console.log("Initializing Pinecone...");
      const pinecone = new Pinecone();
      const indexName = process.env.PINECONE_INDEX_NAME;
      if (!indexName) {
        throw new Error("PINECONE_INDEX_NAME environment variable not defined");
      }

      // Get namespace for places
      console.log(`Connecting to index "${indexName}", namespace "places"...`);
      const index = pinecone.index(indexName);
      const places = index.namespace("places");

      // Create embeddings
      console.log("Creating embedding for query...");
      const embeddings = new CohereEmbeddings({
        model: "embed-english-v3.0",
      });
      const queryVector = await embeddings.embedQuery(query);

      // Query with state filter
      console.log(`Querying places in ${state}...`);
      const results = await places.query({
        vector: queryVector,
        topK: 10,
        includeMetadata: true,
        filter: {
          State: { $eq: state },
        },
      });

      // Process results
      console.log(`Found ${results.matches?.length || 0} places in ${state}`);

      if (results.matches && results.matches.length > 0) {
        // Convert to Document format with consistent metadata
        const docs = results.matches.map((match) => {
          const metadata = match.metadata || {};
          return new Document({
            pageContent: metadata.text || "",
            metadata: {
              id: match.id,
              score: match.score,
              ...convertMetadata(metadata),
            },
          });
        });

        // Display results
        console.log("\nResults:");
        docs.forEach((doc, i) => {
          console.log(`\nResult ${i + 1}:`);
          console.log(`Name: ${doc.metadata.name}`);
          console.log(`Type: ${doc.metadata.type}`);
          console.log(`Location: ${doc.metadata.city}, ${doc.metadata.state}`);
          console.log(`Score: ${doc.metadata.score}`);
          console.log(
            `Content (first 100 chars): ${doc.pageContent.substring(0, 100)}...`
          );
        });
      }
    }

    console.log("\n=== Test completed ===");
  } catch (error) {
    console.error("Error in test:", error);
  }
}

// Run the test
finalTest().catch((err) => console.error("Unhandled error:", err));
