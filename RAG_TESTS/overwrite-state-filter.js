require("dotenv").config();
const fs = require("fs");
const path = require("path");

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

async function testDirectStateFilter() {
  try {
    const { Pinecone } = require("@pinecone-database/pinecone");
    const { CohereEmbeddings } = require("@langchain/cohere");
    const { Document } = require("@langchain/core/documents");

    // Setup test
    console.log("Running direct state filter test...");
    const query = "places to visit in Assam";
    const state = extractStateFromQuery(query);
    console.log(`Extracted state from query: ${state}`);

    // Initialize Pinecone
    console.log("Initializing Pinecone...");
    const pinecone = new Pinecone();
    const indexName = process.env.PINECONE_INDEX_NAME;
    if (!indexName) {
      throw new Error("PINECONE_INDEX_NAME is required");
    }

    const index = pinecone.index(indexName);
    const namespace = index.namespace("places");

    // Create embedding
    console.log("Creating embedding...");
    const embeddings = new CohereEmbeddings({
      model: "embed-english-v3.0",
    });
    const vector = await embeddings.embedQuery(query);

    // Search with filter
    console.log(`Searching for places in ${state}...`);
    const results = await namespace.query({
      vector,
      topK: 10,
      includeMetadata: true,
      filter: {
        State: { $eq: state },
      },
    });

    console.log(`Found ${results.matches?.length || 0} places in ${state}`);

    if (results.matches?.length) {
      results.matches.forEach((match, i) => {
        const metadata = match.metadata || {};
        console.log(`\nResult ${i + 1}:`);
        console.log(`ID: ${match.id}`);
        console.log(`Name: ${metadata.Name}`);
        console.log(`Type: ${metadata.Type}`);
        console.log(`Location: ${metadata.City}, ${metadata.State}`);
      });
    }

    // Create a patch for dist/utils/retrieval.js
    console.log("\nCreating patch for dist/utils/retrieval.js...");
    const distFilePath = path.join(__dirname, "dist", "utils", "retrieval.js");

    if (!fs.existsSync(distFilePath)) {
      console.error("Dist file not found:", distFilePath);
      return;
    }

    let content = fs.readFileSync(distFilePath, "utf8");

    // Add state extraction function
    const stateExtractionFunction = `
function extractStateFromQuery(query) {
  const indianStates = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", 
    "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", 
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", 
    "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", 
    "Uttarakhand", "West Bengal", "Delhi"
  ];
  
  for (const state of indianStates) {
    if (query.toLowerCase().includes(state.toLowerCase())) {
      return state;
    }
  }
  
  return null;
}
`;

    // Find position to insert the function (before makePineconeRetriever)
    const insertPosition = content.indexOf(
      "async function makePineconeRetriever"
    );
    if (insertPosition === -1) {
      console.error("Could not find insertion point in dist file");
      return;
    }

    // Update the getRelevantDocuments function to include state filtering
    const retrievalCodeToReplace = `getRelevantDocuments: async (query) => {
                console.log(\`Querying with: "\${query}"\`);
                const docs = await originalRetriever.getRelevantDocuments(query);
                console.log(\`Found \${docs.length} documents\`);
                return docs.map(convertPineconeMetadata);
            },`;

    const newRetrievalCode = `getRelevantDocuments: async (query) => {
                console.log(\`Querying with: "\${query}"\`);
                
                // Check if there's a state mentioned in the query
                const state = extractStateFromQuery(query);
                if (state) {
                    console.log(\`Detected state in query: "\${state}"\`);
                    
                    try {
                        // Try to do a hybrid search with state filter
                        console.log(\`Performing filtered search for state: "\${state}"\`);
                        const places = index.namespace("places");
                        
                        // Generate vector embedding for the query
                        const queryVector = await embeddings.embedQuery(query);
                        
                        // Search with filter
                        const filterResults = await places.query({
                            vector: queryVector,
                            topK: searchKwargs.k || 10,
                            includeMetadata: true,
                            filter: {
                                State: { $eq: state }
                            }
                        });
                        
                        if (filterResults.matches && filterResults.matches.length > 0) {
                            console.log(\`Found \${filterResults.matches.length} results with state filter\`);
                            
                            // Convert to Document format
                            const docs = filterResults.matches.map(match => {
                                const metadata = match.metadata || {};
                                const doc = new documents_1.Document({
                                    pageContent: metadata.text || "",
                                    metadata: Object.assign({
                                        id: match.id,
                                        score: match.score
                                    }, metadata)
                                });
                                
                                // Add lowercase fields
                                if (metadata.Name) doc.metadata.name = metadata.Name;
                                if (metadata.Type) doc.metadata.type = metadata.Type;
                                if (metadata.City) doc.metadata.city = metadata.City;
                                if (metadata.State) doc.metadata.state = metadata.State;
                                if (metadata.Zone) doc.metadata.zone = metadata.Zone;
                                
                                return doc;
                            });
                            
                            return docs;
                        } else {
                            console.log(\`No results found with state filter "\${state}", using fallback\`);
                        }
                    } catch (filterError) {
                        console.error('Error with filtered search:', filterError);
                    }
                }
                
                // If we didn't find results with filter, do regular search
                console.log('Performing regular vector search');
                const docs = await originalRetriever.getRelevantDocuments(query);
                
                // Add lowercase fields to all documents
                docs.forEach(doc => {
                    const metadata = doc.metadata;
                    if (metadata.Name) doc.metadata.name = metadata.Name;
                    if (metadata.Type) doc.metadata.type = metadata.Type;
                    if (metadata.City) doc.metadata.city = metadata.City;
                    if (metadata.State) doc.metadata.state = metadata.State;
                    if (metadata.Zone) doc.metadata.zone = metadata.Zone;
                });
                
                console.log(\`Found \${docs.length} documents with regular search\`);
                return docs;
            },`;

    // Insert the state extraction function and update getRelevantDocuments
    content =
      content.slice(0, insertPosition) +
      stateExtractionFunction +
      content.slice(insertPosition);
    content = content.replace(retrievalCodeToReplace, newRetrievalCode);

    // Write the updated content back to the file
    fs.writeFileSync(distFilePath, content, "utf8");
    console.log("Successfully patched dist/utils/retrieval.js");
  } catch (error) {
    console.error("Error in test:", error);
  }
}

// Run the test
testDirectStateFilter().catch((err) => console.error("Unhandled error:", err));
