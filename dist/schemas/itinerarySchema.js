"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const itinerarySchema = zod_1.z.object({
    tourDays: zod_1.z.number(),
    cheapestTravelPlan: zod_1.z.object({
        mode: zod_1.z.string(),
        cost: zod_1.z.number(),
        details: zod_1.z.string().optional()
    }),
    cheapestStayPlan: zod_1.z.object({
        type: zod_1.z.string(),
        cost: zod_1.z.number(),
        location: zod_1.z.string(),
        details: zod_1.z.string().optional()
    }),
    itinerary: zod_1.z.array(zod_1.z.object({
        day: zod_1.z.number(),
        activities: zod_1.z.array(zod_1.z.object({
            time: zod_1.z.string(),
            description: zod_1.z.string(),
            location: zod_1.z.string(),
            cost: zod_1.z.number()
        }))
    })),
    overallBudget: zod_1.z.object({
        travel: zod_1.z.number(),
        accommodation: zod_1.z.number(),
        activities: zod_1.z.number(),
        food: zod_1.z.number(),
        total: zod_1.z.number()
    }),
    additionalActivities: zod_1.z.array(zod_1.z.object({
        name: zod_1.z.string(),
        description: zod_1.z.string(),
        cost: zod_1.z.number(),
        duration: zod_1.z.string()
    })).optional()
});
exports.default = itinerarySchema;
