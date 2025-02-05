import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { MongoClient } from "mongodb";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { z } from "zod";
import llmOuputSchema, { LLMOutput } from "./schemas/llmOutput";
import { generateSyntheticData } from "./utils/generateSyntheticData";
import { createItinerarySummary } from "./utils/createItinerarySummary";

const mongoClient = new MongoClient(process.env.MONGO_URL as string)

const llm = new ChatOpenAI({
  model: 'gpt-4o-mini',
  temperature: 0.7
})

const parser = StructuredOutputParser.fromZodSchema(z.array(llmOuputSchema))


async function seedDB () : Promise<void> {
try {
    await mongoClient.connect();
    await mongoClient.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
    const db = mongoClient.db("AI-Travel-Agent");
    const collection = db.collection("places");
    await collection.deleteMany({});
    
    const syntheticData = await generateSyntheticData(parser, llm);
    const recordsWithSummaries = await Promise.all(
      syntheticData.map(async (record) => ({
        pageContent: await createItinerarySummary(record),
        metadata: {...record},
      }))
    );
    
    for (const record of recordsWithSummaries) {
      await MongoDBAtlasVectorSearch.fromDocuments(
        [record],
        new OpenAIEmbeddings(),
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
