"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSyntheticData = generateSyntheticData;
function generateSyntheticData(parser, llm) {
    return __awaiter(this, void 0, void 0, function* () {
        const prompt = `You are a helpful travel assistant that generates tourist places (in India only) data. Generate 25 cities and popular records. Each record should include the following fields: destination, startDate, endDate, budget, interests, travelStyle, accommodationType, transportationType, numberOfTravelers, specialRequirements. Ensure variety in the data and real values.

  ${parser.getFormatInstructions()}`;
        console.log("Generating synthetic data...");
        const response = yield llm.invoke(prompt);
        return parser.parse(response.content);
    });
}
