"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaceSchema = void 0;
const zod_1 = require("zod");
exports.PlaceSchema = zod_1.z.object({
    id: zod_1.z.string().describe("Unique identifier for the place"),
    Zone: zod_1.z.string().describe("Geographical zone of the place"),
    State: zod_1.z.string().describe("State where the place is located"),
    City: zod_1.z.string().describe("City where the place is located"),
    Name: zod_1.z.string().describe("Name of the place"),
    Type: zod_1.z.string().describe("Type of establishment"),
    EstablishmentYear: zod_1.z
        .union([zod_1.z.number().int().max(new Date().getFullYear()), zod_1.z.string()])
        .describe("Year when the place was established"),
    timeNeededToVisit: zod_1.z
        .number()
        .positive()
        .describe("Time needed to visit in hours"),
    googleReviewRating: zod_1.z
        .number()
        .min(0)
        .max(5)
        .describe("Google review rating out of 5"),
    entranceFeeInINR: zod_1.z
        .number()
        .nonnegative()
        .describe("Entrance fee in Indian Rupees"),
    airportWith50kmRadius: zod_1.z
        .string()
        .describe("Is there any nearest airport within 50km radius"),
    weeklyOff: zod_1.z.string().describe("Weekly off day(s)"),
    Significance: zod_1.z
        .string()
        .describe("Historical or cultural significance of the place"),
    dslrAllowed: zod_1.z.string().describe("Whether DSLR cameras are allowed"),
    numberOfGoogleReviews: zod_1.z
        .number()
        .nonnegative()
        .describe("Number of Google reviews in lakhs"),
    bestTimeToVisit: zod_1.z.string().describe("Best time of year to visit"),
});
