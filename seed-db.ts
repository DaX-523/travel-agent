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
  const records: PineconeTextRecord[] = [];

  // Read CSV file
  fs.createReadStream("./data/Top Indian Places to Visit.csv")
    .pipe(csv())
    .on("data", (row) => {
      let EstablishmentYear: number | string;

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
      const BATCH_SIZE = Math.floor(records.length / 4);
      const chunks = createChunks(records, BATCH_SIZE);
      console.log("CSV file successfully processed.");
      for (const chunk of chunks) {
        await namespace.upsertRecords(chunk);
      }
      console.log("Data successfully upserted into Pinecone.");
      console.log("Indexing....");
      await new Promise((resolve) => setTimeout(resolve, 5000));
      console.log("Data successfully indexed.");
    });
}

seedPineconeDB()
  .then()
  .catch((err) => console.error(err));
