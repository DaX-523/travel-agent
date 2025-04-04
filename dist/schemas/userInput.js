"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const userInputSchema = zod_1.z.object({
    country: zod_1.z.string(),
    state: zod_1.z.string(),
    city: zod_1.z.string(),
    tourDays: zod_1.z.number(),
    pax: zod_1.z.number(),
    budget: zod_1.z.object({
        stays: zod_1.z.number(),
        food: zod_1.z.number(),
        travelToDestination: zod_1.z.number(),
        shopping: zod_1.z.number(),
        miscellaneous: zod_1.z.number(),
    })
});
exports.default = userInputSchema;
