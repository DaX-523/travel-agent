import { z } from "zod";

export const PlaceSchema = z.object({
  id: z.string().describe("Unique identifier for the place"),
  Zone: z.string().describe("Geographical zone of the place"),
  State: z.string().describe("State where the place is located"),
  City: z.string().describe("City where the place is located"),
  Name: z.string().describe("Name of the place"),
  Type: z.string().describe("Type of establishment"),
  EstablishmentYear: z
    .union([
      z.number().int().max(new Date().getFullYear()),
      z.literal("Unknown"),
    ])
    .describe("Year when the place was established"),
  timeNeededToVisit: z
    .number()
    .positive()
    .describe("Time needed to visit in hours"),
  googleReviewRating: z
    .number()
    .min(0)
    .max(5)
    .describe("Google review rating out of 5"),
  entranceFeeInINR: z
    .number()
    .nonnegative()
    .describe("Entrance fee in Indian Rupees"),
  airportWith50kmRadius: z
    .string()
    .describe("Is there any nearest airport within 50km radius"),
  weeklyOff: z.string().describe("Weekly off day(s)"),
  Significance: z
    .string()
    .describe("Historical or cultural significance of the place"),
  dslrAllowed: z.string().describe("Whether DSLR cameras are allowed"),
  numberOfGoogleReviews: z
    .number()
    .nonnegative()
    .describe("Number of Google reviews in lakhs"),
  bestTimeToVisit: z.string().describe("Best time of year to visit"),
});

export type Place = z.infer<typeof PlaceSchema>;
