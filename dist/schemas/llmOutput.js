"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const llmOuputSchema = zod_1.z.object({
    destination: zod_1.z.string(),
    startDate: zod_1.z.string(),
    endDate: zod_1.z.string(),
    budget: zod_1.z.number(),
    interests: zod_1.z.array(zod_1.z.string()),
    travelStyle: zod_1.z.string(),
    accommodationType: zod_1.z.string(),
    transportationType: zod_1.z.string(),
    numberOfTravelers: zod_1.z.number(),
    specialRequirements: zod_1.z.string().optional()
});
exports.default = llmOuputSchema;
