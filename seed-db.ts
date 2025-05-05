//this can be used if you are using custom embedding models
// for now this agent is integrated with pinecone which provides own llama embedding model under the hood

import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { MongoClient } from "mongodb";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { z } from "zod";
import fs from "fs";
import csv from "csv-parser";
import llmOuputSchema, { LLMOutput } from "./schemas/llmOutput";
import { generateSyntheticData } from "./utils/generateSyntheticData";
import { createItinerarySummary } from "./utils/createItinerarySummary";
import "dotenv/config";
import { ChatCohere, CohereEmbeddings } from "@langchain/cohere";
import { Pinecone, RecordMetadata } from "@pinecone-database/pinecone";
import { Place } from "./schemas/placeSchema";
import { PineconeRecord } from "@pinecone-database/pinecone";
import createChunks from "./utils/createChunks";
const mongoClient = new MongoClient(process.env.MONGODB_ATLAS_URI as string);

const llm = new ChatCohere({
  model: "command-r-plus",
  temperature: 0.7,
});

const parser = StructuredOutputParser.fromZodSchema(z.array(llmOuputSchema));

// Define an interface for the record format expected by Pinecone's integrated embeddings
interface IntegratedEmbeddingRecord {
  id: string;
  text: string; // This should match your field_map in Pinecone
  metadata: Record<string, any>;
}

// Define an interface for Pinecone records with automatic text embedding
export interface PineconeTextRecord {
  _id: string;
  text: string; // Field for automatic embedding
  [key: string]: any; // Allow additional metadata fields
}

//Function to seed data in mongoDB Atlas vector
async function seedDB(): Promise<void> {
  try {
    await mongoClient.connect();
    await mongoClient.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
    const db = mongoClient.db("AI-Travel-Agent");
    const collection = db.collection("places");
    await collection.deleteMany({});

    const syntheticData = await generateSyntheticData(parser, llm);
    const recordsWithSummaries = await Promise.all(
      syntheticData.map(async (record) => ({
        pageContent: await createItinerarySummary(record),
        metadata: { ...record },
      }))
    );

    for (const record of recordsWithSummaries) {
      await MongoDBAtlasVectorSearch.fromDocuments(
        [record],
        new CohereEmbeddings({ model: "embed-english-v3.0" }),
        {
          collection,
          indexName: "vector_index",
          textKey: "embedding_text",
          embeddingKey: "embedding",
        }
      );
      // console.log("Successfully processed & saved record:", record.metadata.employee_id);
    }
    console.log("Database seeding completed");
  } catch (error) {
    console.error("Error seeding database:", error);
  } finally {
    await mongoClient.close();
  }
}

async function seedPineconeDB() {
  const indexName = process.env.PINECONE_INDEX_NAME;
  if (!indexName) {
    throw new Error("PINECONE_INDEX_NAME environment variable is not defined");
  }
  const pinecone = new Pinecone();
  const namespace = pinecone.index(indexName).namespace("places");
  // await namespace.deleteAll();
  const records: PineconeTextRecord[] = [];
  const embeddings = new CohereEmbeddings({ model: "embed-english-v3.0" });

  console.log("1reading..");
  // Read CSV file
  fs.createReadStream("./data/Top Indian Places to Visit.csv")
    .pipe(csv())
    .on("data", (row) => {
      let EstablishmentYear: number | string;
      console.log("2reading..");
      if (Number.isNaN(Number(row["Establishment Year"])))
        EstablishmentYear = row["Establishment Year"];
      else EstablishmentYear = Number(row["Establishment Year"]);
      let description = "";
      switch (row.Zone) {
        case "Northern":
          description =
            "Northern India is known for its majestic mountains, historical monuments, and rich cultural traditions.";
          break;
        case "Southern":
          description =
            "Southern India features tropical climate, ancient temples, and distinctive cuisine.";
          break;
        case "Eastern":
          description =
            "Eastern India is characterized by lush greenery, mighty rivers, and rich tribal heritage.";
          break;
        case "Western":
          description =
            "Western India offers vibrant culture, desert landscapes, and coastal beauty.";
          break;
        case "Central":
          description =
            "Central India showcases dense forests, historical sites, and tribal cultures.";
          break;
        case "North Eastern":
          description =
            "Northeastern India is known for its scenic beauty, diverse indigenous cultures, and unique biodiversity.";
          break;
        default:
          description = "";
      }
      // Create a detailed description that will be used for embedding
      const placeDescription = `${row.Name} is a ${row.Type} located in ${
        row.City
      }, ${row.State}, in the ${row.Zone} zone of India. 
        It ${
          typeof EstablishmentYear === "number"
            ? `was established in ${EstablishmentYear}`
            : `has an ${EstablishmentYear} establishment year`
        }.
        This ${row.Type} has a Google rating of ${
        row["Google review rating"]
      } based on ${row["Number of google review in lakhs"]} lakh reviews.
        Visitors typically need about ${
          row["time needed to visit in hrs"]
        } hours to fully explore this place.
        The entrance fee is ${row["Entrance Fee in INR"]} INR.
        ${row.Significance ? `Significance: ${row.Significance}` : ""}
        ${
          row["Airport with 50km Radius"] === "Yes"
            ? `There is no airport within 50km of radius.`
            : "No major airports are within 50km radius."
        }
        ${
          row["Weekly Off"] !== "None"
            ? `Weekly off day: ${row["Weekly Off"]}.`
            : "Open all days of the week."
        }
        ${
          row["DSLR Allowed"] === "Yes"
            ? "DSLR cameras are allowed at this location."
            : row["DSLR Allowed"] === "No"
            ? "DSLR cameras are not permitted at this location."
            : ""
        }
        The best time to visit this place is during ${
          row["Best Time to visit"]
        }.
        ${
          row.Type === "Historical Monument"
            ? "This historical site showcases India's rich cultural heritage and architectural excellence."
            : `${
                row.Type === "Temple"
                  ? "This religious site holds spiritual significance and attracts devotees and tourists alike."
                  : `${
                      row.Type === "Wildlife Sanctuary" ||
                      row.Type === "National Park"
                        ? "This natural reserve is home to diverse flora and fauna, offering a glimpse into India's biodiversity."
                        : `This place is suitable for people who likes ${row.Type} types of places.`
                    }`
              }`
        }
        ${description}
        This destination attracts ${
          Number(+row["time needed to visit in hrs"]) > 3
            ? "visitors who enjoy spending substantial time exploring attractions"
            : "tourists looking for quick yet meaningful experiences"
        }.
        With ${
          Number(+row["Entrance Fee in INR"]) > 500
            ? "a premium entrance fee"
            : Number(+row["Entrance Fee in INR"]) > 100
            ? "a moderate entrance fee"
            : "an affordable entrance fee"
        }, it's ${
        Number(+row["Entrance Fee in INR"]) === 0 ? "free to access and" : ""
      } suitable for ${
        Number(+row["Entrance Fee in INR"]) < 200
          ? "budget travelers"
          : "those willing to invest in quality experiences"
      }.`;
      // Create the record with the format Pinecone expects
      records.push({
        _id: `place_${records.length + 1}`,
        text: placeDescription, // Field for automatic embedding
        Zone: row.Zone,
        State: row.State,
        City: row.City,
        Name: row.Name,
        Type: row.Type,
        EstablishmentYear,
        timeNeededToVisit: Number(row["time needed to visit in hrs"]),
        googleReviewRating: Number(row["Google review rating"]),
        entranceFeeInINR: Number(row["Entrance Fee in INR"]),
        airportWith50kmRadius: row["Airport with 50km Radius"],
        weeklyOff: row["Weekly Off"],
        Significance: row.Significance,
        dslrAllowed: row["DSLR Allowed"],
        numberOfGoogleReviews: Number(row["Number of google review in lakhs"]),
        bestTimeToVisit: row["Best Time to visit"],
      });
    })
    .on("end", async () => {
      console.log("CSV file successfully processed.");

      // Process in smaller batches to avoid overwhelming the API
      const BATCH_SIZE = 10; // Reduce batch size to avoid timeouts
      const chunks = [];

      // Create chunks of records
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        chunks.push(records.slice(i, i + BATCH_SIZE));
      }

      console.log(
        `Created ${chunks.length} chunks of approx. ${BATCH_SIZE} records each`
      );

      // Process each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(
          `Processing chunk ${i + 1}/${chunks.length} (${chunk.length} records)`
        );

        try {
          // Create vector embeddings for each record in the chunk
          const recordsWithEmbeddings = await Promise.all(
            chunk.map(async (record) => {
              try {
                // Create embedding for the text
                const embedding = await embeddings.embedQuery(record.text);

                // Return a simplified record structure
                return {
                  id: record._id,
                  values: embedding,
                  metadata: {
                    text: record.text,
                    Zone: record.Zone,
                    State: record.State,
                    City: record.City,
                    Name: record.Name,
                    Type: record.Type,
                  },
                };
              } catch (err) {
                console.error(
                  `Error creating embedding for ${record.Name}:`,
                  err
                );
                throw err;
              }
            })
          );

          // Use the REST API directly through fetch to bypass type issues
          const apiKey = process.env.PINECONE_API_KEY || "";
          const baseUrl =
            process.env.PINECONE_BASE_URL || "https://api.pinecone.io";
          const indexUrl = `${baseUrl}/vectors/upsert`;

          const response = await fetch(indexUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Api-Key": apiKey,
            },
            body: JSON.stringify({
              namespace: "places",
              index: indexName,
              vectors: recordsWithEmbeddings,
            }),
          });

          if (!response.ok) {
            throw new Error(
              `Pinecone API error: ${response.status} ${response.statusText}`
            );
          }

          console.log(`Successfully upserted chunk ${i + 1}`);

          // Wait a bit between batches to avoid rate limits
          if (i < chunks.length - 1) {
            console.log("Waiting before next batch...");
            await new Promise((resolve) => setTimeout(resolve, 2000)); // Longer wait
          }
        } catch (error) {
          console.error(`Error processing chunk ${i + 1}:`, error);
          throw error;
        }
      }

      console.log("All data successfully upserted into Pinecone.");
      console.log("Indexing....");
      await new Promise((resolve) => setTimeout(resolve, 5000));
      console.log("Data successfully indexed.");
    });
}

seedPineconeDB()
  .then(() => console.log("success"))
  .catch((err) => console.error(err));
