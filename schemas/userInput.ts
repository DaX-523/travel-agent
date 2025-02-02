import {z} from "zod"

const userInputSchema = z.object({
country : z.string(),
state : z.string(),
city : z.string(),
tourDays : z.number(),
pax : z.number(),
budget: z.object({
    stays: z.number(),
    food: z.number(),
    travelToDestination: z.number(),
    shopping : z.number(),
    miscellaneous: z.number(),
})
})

export type UserInput = z.infer<typeof userInputSchema>

export default userInputSchema