 
 import {z} from "zod"

 const llmOuputSchema = z.object({
      destination: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      budget: z.number(),
      interests: z.array(z.string()),
      travelStyle: z.string(),
      accommodationType: z.string(),
      transportationType: z.string(),
      numberOfTravelers: z.number(),
      specialRequirements: z.string().optional()
    });

    export type LLMOutput = z.infer<typeof llmOuputSchema>

    export default llmOuputSchema