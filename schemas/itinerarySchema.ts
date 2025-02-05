import {z} from 'zod'

const itinerarySchema = z.object({
  tourDays: z.number(),
  cheapestTravelPlan: z.object({
    mode: z.string(),
    cost: z.number(),
    details: z.string().optional()
  }),
  cheapestStayPlan: z.object({
    type: z.string(), 
    cost: z.number(),
    location: z.string(),
    details: z.string().optional()
  }),
  itinerary: z.array(z.object({
    day: z.number(),
    activities: z.array(z.object({
      time: z.string(),
      description: z.string(),
      location: z.string(),
      cost: z.number()
    }))
  })),
  overallBudget: z.object({
    travel: z.number(),
    accommodation: z.number(),
    activities: z.number(),
    food: z.number(),
    total: z.number()
  }),
  additionalActivities: z.array(z.object({
    name: z.string(),
    description: z.string(),
    cost: z.number(),
    duration: z.string()
  })).optional()
})

export type Itinerary = z.infer<typeof itinerarySchema>

export default itinerarySchema;