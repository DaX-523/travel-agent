import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { MongoClient } from "mongodb";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { z } from "zod";

const mongoClient = new MongoClient(process.env.MONGO_URL as string)

const llm = new ChatOpenAI({
  model: 'gpt-4o-min',
  temperature: 0.7
})