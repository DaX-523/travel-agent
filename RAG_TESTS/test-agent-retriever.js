require("dotenv").config();
const path = require("path");
const util = require("util");

// Configure console logging for better debugging
console.errorOrig = console.error;
console.error = function () {
  const args = Array.from(arguments);
  const stack = new Error().stack.split("\n")[2].trim();
  console.errorOrig(`[${new Date().toISOString()}] [${stack}]`, ...args);
};

console.log = console.error;

// Print environment information
console.log("Node.js version:", process.version);
console.log("Current directory:", process.cwd());
console.log("Script path:", __filename);
console.log("Environment variables:");
console.log("- PINECONE_INDEX_NAME:", process.env.PINECONE_INDEX_NAME);
console.log("- PINECONE_API_KEY exists:", !!process.env.PINECONE_API_KEY);
console.log("- COHERE_API_KEY exists:", !!process.env.COHERE_API_KEY);

// Debug require resolution
console.log("Resolving retrieval module path...");
try {
  const modulePathDist = path.resolve("./dist/utils/retrieval.js");
  console.log("Module path dist:", modulePathDist);
  console.log("Module exists:", require("fs").existsSync(modulePathDist));
} catch (err) {
  console.log("Error checking module path:", err);
}

// Load the makeRetriever function
let makeRetriever;
try {
  console.log("Requiring retrieval module...");
  const retrieval = require("../dist/utils/retrieval");
  console.log("Module exports:", Object.keys(retrieval));
  makeRetriever = retrieval.makeRetriever;
  console.log("makeRetriever loaded:", !!makeRetriever);
} catch (error) {
  console.error("Error loading retrieval module:", error);
  process.exit(1);
}

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

    console.log("Retriever created:", util.inspect(retriever, { depth: 1 }));

    // Try a simple query
    const query = "tourist attractions in Delhi";
    console.log(`\nExecuting query: "${query}"`);

    try {
      console.log("Calling getRelevantDocuments...");
      const results = await retriever.getRelevantDocuments(query);
      console.log(`Found ${results.length} results`);

      results.forEach((doc, i) => {
        console.log(`\nResult ${i + 1}:`);

        // Test lowercase fields - this should work now
        console.log(`Name: ${doc.metadata.name}`);
        console.log(`Type: ${doc.metadata.type}`);
        console.log(`Location: ${doc.metadata.city}, ${doc.metadata.state}`);

        // The score isn't directly from the DB but from the search response
        console.log(
          "Has score property:",
          doc.metadata.hasOwnProperty("score")
        );

        // Show the key count which should include both original and normalized fields
        console.log("Metadata keys:", Object.keys(doc.metadata).length);
        console.log("First 5 keys:", Object.keys(doc.metadata).slice(0, 5));
      });
    } catch (error) {
      console.error(`Error executing query:`, error);
    }
  } catch (error) {
    console.error("Error testing retriever:", error);
  }
}

console.log("Starting test retriever script...");
testRetriever()
  .then(() => console.log("Test completed"))
  .catch((err) => {
    console.error("Unhandled error:", err);
  });
