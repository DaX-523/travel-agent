import llmOuputSchema, { LLMOutput } from "../schemas/llmOutput";

export async function createItinerarySummary(plan: LLMOutput): Promise<string> {
  return new Promise((resolve) => {
    const parsedPlan: LLMOutput = llmOuputSchema.parse(plan);

    const summary = `${
      parsedPlan.numberOfTravelers
    } traveler(s) planning a trip to ${parsedPlan.destination} 
from ${parsedPlan.startDate} to ${parsedPlan.endDate}.
Budget: ${parsedPlan.budget} Rupees
Interests: ${parsedPlan.interests.join(", ")}
Travel Style: ${parsedPlan.travelStyle}
Accommodation: ${parsedPlan.accommodationType}
Transportation: ${parsedPlan.transportationType}
${
  parsedPlan.specialRequirements
    ? `Special Requirements: ${parsedPlan.specialRequirements}`
    : ""
}`;

    resolve(summary);
  });
}
