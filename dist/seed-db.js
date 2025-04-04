"use strict";
//this can be used if you are using custom embedding models
// for now this agent is integrated with pinecone which provides own llama embedding model under the hood
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const output_parsers_1 = require("@langchain/core/output_parsers");
const mongodb_1 = require("mongodb");
const mongodb_2 = require("@langchain/mongodb");
const zod_1 = require("zod");
const fs_1 = __importDefault(require("fs"));
const csv_parser_1 = __importDefault(require("csv-parser"));
const llmOutput_1 = __importDefault(require("./schemas/llmOutput"));
const generateSyntheticData_1 = require("./utils/generateSyntheticData");
const createItinerarySummary_1 = require("./utils/createItinerarySummary");
require("dotenv/config");
const cohere_1 = require("@langchain/cohere");
const pinecone_1 = require("@pinecone-database/pinecone");
const createChunks_1 = __importDefault(require("./utils/createChunks"));
const mongoClient = new mongodb_1.MongoClient(process.env.MONGODB_ATLAS_URI);
const llm = new cohere_1.ChatCohere({
    model: "command-r-plus",
    temperature: 0.7,
});
const parser = output_parsers_1.StructuredOutputParser.fromZodSchema(zod_1.z.array(llmOutput_1.default));
//Function to seed data in mongoDB Atlas vector
function seedDB() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield mongoClient.connect();
            yield mongoClient.db("admin").command({ ping: 1 });
            console.log("Pinged your deployment. You successfully connected to MongoDB!");
            const db = mongoClient.db("AI-Travel-Agent");
            const collection = db.collection("places");
            yield collection.deleteMany({});
            const syntheticData = yield (0, generateSyntheticData_1.generateSyntheticData)(parser, llm);
            const recordsWithSummaries = yield Promise.all(syntheticData.map((record) => __awaiter(this, void 0, void 0, function* () {
                return ({
                    pageContent: yield (0, createItinerarySummary_1.createItinerarySummary)(record),
                    metadata: Object.assign({}, record),
                });
            })));
            for (const record of recordsWithSummaries) {
                yield mongodb_2.MongoDBAtlasVectorSearch.fromDocuments([record], new cohere_1.CohereEmbeddings({ model: "embed-english-v3.0" }), {
                    collection,
                    indexName: "vector_index",
                    textKey: "embedding_text",
                    embeddingKey: "embedding",
                });
                // console.log("Successfully processed & saved record:", record.metadata.employee_id);
            }
            console.log("Database seeding completed");
        }
        catch (error) {
            console.error("Error seeding database:", error);
        }
        finally {
            yield mongoClient.close();
        }
    });
}
function seedPineconeDB() {
    return __awaiter(this, void 0, void 0, function* () {
        const indexName = process.env.PINECONE_INDEX_NAME;
        if (!indexName) {
            throw new Error("PINECONE_INDEX_NAME environment variable is not defined");
        }
        const pinecone = new pinecone_1.Pinecone();
        const namespace = pinecone.index(indexName).namespace("places");
        const records = [];
        // Read CSV file
        fs_1.default.createReadStream("./data/Top Indian Places to Visit.csv")
            .pipe((0, csv_parser_1.default)())
            .on("data", (row) => {
            let EstablishmentYear;
            if (Number.isNaN(Number(row["Establishment Year"])))
                EstablishmentYear = row["Establishment Year"];
            else
                EstablishmentYear = Number(row["Establishment Year"]);
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
            const placeDescription = `${row.Name} is a ${row.Type} located in ${row.City}, ${row.State}, in the ${row.Zone} zone of India. 
        It ${typeof EstablishmentYear === "number"
                ? `was established in ${EstablishmentYear}`
                : `has an ${EstablishmentYear} establishment year`}.
        This ${row.Type} has a Google rating of ${row["Google review rating"]} based on ${row["Number of google review in lakhs"]} lakh reviews.
        Visitors typically need about ${row["time needed to visit in hrs"]} hours to fully explore this place.
        The entrance fee is ${row["Entrance Fee in INR"]} INR.
        ${row.Significance ? `Significance: ${row.Significance}` : ""}
        ${row["Airport with 50km Radius"] === "Yes"
                ? `There is no airport within 50km of radius.`
                : "No major airports are within 50km radius."}
        ${row["Weekly Off"] !== "None"
                ? `Weekly off day: ${row["Weekly Off"]}.`
                : "Open all days of the week."}
        ${row["DSLR Allowed"] === "Yes"
                ? "DSLR cameras are allowed at this location."
                : row["DSLR Allowed"] === "No"
                    ? "DSLR cameras are not permitted at this location."
                    : ""}
        The best time to visit this place is during ${row["Best Time to visit"]}.
        ${row.Type === "Historical Monument"
                ? "This historical site showcases India's rich cultural heritage and architectural excellence."
                : `${row.Type === "Temple"
                    ? "This religious site holds spiritual significance and attracts devotees and tourists alike."
                    : `${row.Type === "Wildlife Sanctuary" ||
                        row.Type === "National Park"
                        ? "This natural reserve is home to diverse flora and fauna, offering a glimpse into India's biodiversity."
                        : `This place is suitable for people who likes ${row.Type} types of places.`}`}`}
        ${description}
        This destination attracts ${Number(+row["time needed to visit in hrs"]) > 3
                ? "visitors who enjoy spending substantial time exploring attractions"
                : "tourists looking for quick yet meaningful experiences"}.
        With ${Number(+row["Entrance Fee in INR"]) > 500
                ? "a premium entrance fee"
                : Number(+row["Entrance Fee in INR"]) > 100
                    ? "a moderate entrance fee"
                    : "an affordable entrance fee"}, it's ${Number(+row["Entrance Fee in INR"]) === 0 ? "free to access and" : ""} suitable for ${Number(+row["Entrance Fee in INR"]) < 200
                ? "budget travelers"
                : "those willing to invest in quality experiences"}.`;
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
            .on("end", () => __awaiter(this, void 0, void 0, function* () {
            const BATCH_SIZE = Math.floor(records.length / 4);
            const chunks = (0, createChunks_1.default)(records, BATCH_SIZE);
            console.log("CSV file successfully processed.");
            for (const chunk of chunks) {
                yield namespace.upsertRecords(chunk);
            }
            console.log("Data successfully upserted into Pinecone.");
            console.log("Indexing....");
            yield new Promise((resolve) => setTimeout(resolve, 5000));
            console.log("Data successfully indexed.");
        }));
    });
}
seedPineconeDB()
    .then()
    .catch((err) => console.error(err));
