import { LLMOutput } from "../schemas/llmOutput";

export async function generateSyntheticData(parser: any, llm: any): Promise<LLMOutput[]> {
  const prompt = `You are a helpful travel assistant that generates tourist places (in India only) data. Generate 20 states and popular records. Each record should include the following fields: destination, startDate, endDate, budget, interests, travelStyle, accommodationType, transportationType, numberOfTravelers, specialRequirements. Ensure variety in the data and real values.

  ${parser.getFormatInstructions()}`;

  console.log("Generating synthetic data...");

  const response = await llm.invoke(prompt);
  return parser.parse(response.content as string);
}