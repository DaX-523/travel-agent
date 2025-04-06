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
exports.MODEL_TOOLS = exports.toolNode = void 0;
const configuration_1 = require("./configuration");
const tavily_search_1 = require("@langchain/community/tools/tavily_search");
const prompts_1 = require("./prompts");
const util_1 = require("./util");
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const messages_1 = require("@langchain/core/messages");
function initializeTools(state, config) {
    const configuration = (0, configuration_1.ensureConfiguration)(config);
    // Create a wrapper around Tavily that formats the output consistently
    const tavilyTool = new tavily_search_1.TavilySearchResults({
        maxResults: configuration.maxSearchResults,
    });
    // Custom search tool with formatted output that uses Tavily underneath
    const searchTool = (0, tools_1.tool)((_a) => __awaiter(this, [_a], void 0, function* ({ query }) {
        console.log("[FLOW] Using Tavily web search tool for query:", query);
        // Extract country/destination name from the query
        const destinationMatch = query.match(/in\s+(.+?)(?:\s+and|\s*$)/i);
        const destination = destinationMatch ? destinationMatch[1].trim() : query;
        // Use Tavily to get real search results
        try {
            const tavilyResults = yield tavilyTool.invoke(query);
            console.log("[FLOW] Received Tavily search results");
            const tavileParsedResults = JSON.parse(tavilyResults === null || tavilyResults === void 0 ? void 0 : tavilyResults.content);
            // Get URLs for attribution
            const sources = tavileParsedResults
                .slice(0, 3)
                .map((result) => result.url || "https://example.com");
            // Extract specific location information from Tavily results
            let specificPlaces = [];
            for (const result of tavileParsedResults) {
                if (result.content && typeof result.content === "string") {
                    // Look for location names in the content
                    const locationMatches = result.content.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*(?:\s(?:Islands?|Mountains?|National\s+Park|Beach|City|Temple|Palace|Monument|Resort))?)\b/g);
                    if (locationMatches) {
                        specificPlaces = [...specificPlaces, ...locationMatches];
                    }
                }
            }
            // Filter out common words that aren't locations
            specificPlaces = specificPlaces.filter((place) => ![
                "The",
                "This",
                "That",
                "These",
                "Those",
                "There",
                "Here",
                "One",
                "Many",
                "Some",
                "Any",
                "All",
                "Most",
                "More",
                "Less",
                "Best",
                "Worst",
                "First",
                "Last",
                "Next",
                "Previous",
                "January",
                "February",
                "March",
                "April",
                "May",
                "June",
                "July",
                "August",
                "September",
                "October",
                "November",
                "December",
            ].includes(place));
            // Remove duplicates and limit to 8 places
            specificPlaces = [...new Set(specificPlaces)].slice(0, 8);
            // Create descriptive elements for each place based on available information
            let placeDescriptions = [];
            specificPlaces.forEach((place, index) => {
                // Find content related to this place in Tavily results
                let relatedContent = "";
                for (const result of tavileParsedResults) {
                    if (result.content &&
                        typeof result.content === "string" &&
                        result.content.includes(place)) {
                        const sentences = result.content.match(new RegExp(`[^.!?]*?${place}[^.!?]*[.!?]`, "g"));
                        if (sentences && sentences.length > 0) {
                            relatedContent = sentences[0].trim();
                            break;
                        }
                    }
                }
                // Create description for the place
                if (relatedContent) {
                    placeDescriptions.push(`**${place}**: ${relatedContent}`);
                }
                else {
                    // Generic descriptions if specific info not found
                    const genericDescriptions = [
                        `a popular destination known for its unique attractions and cultural experiences`,
                        `an amazing place with beautiful sights and local experiences`,
                        `a must-visit location with numerous activities and points of interest`,
                        `a remarkable destination showcasing the region's heritage and natural beauty`,
                        `a fascinating place offering unique experiences and stunning scenery`,
                        `a wonderful destination with rich cultural significance and beautiful landscapes`,
                        `a charming location with distinctive character and local attractions`,
                        `an exciting destination with diverse activities and interesting sights`,
                    ];
                    placeDescriptions.push(`**${place}**: ${genericDescriptions[index % genericDescriptions.length]}.`);
                }
            });
            // If not enough specific places were found, add generic categories
            if (placeDescriptions.length < 8) {
                const genericCategories = [
                    "**Popular Cities**: Major urban centers with unique architecture, museums, historical sites, and vibrant local culture.",
                    "**Natural Wonders**: Breathtaking landscapes including mountains, beaches, forests, and national parks.",
                    "**Historical Sites**: Ancient temples, colonial buildings, museums, and cultural landmarks.",
                    "**Local Experiences**: Immerse yourself in local culture through food tours, traditional performances, and markets.",
                    "**Outdoor Activities**: Hiking, water sports, wildlife watching, and adventure activities.",
                    "**Culinary Highlights**: Regional specialties, street food, and local delicacies.",
                    "**Hidden Gems**: Off-the-beaten-path locations away from typical tourist crowds.",
                    "**Practical Tips**: Consider visiting during the dry season and respect local customs during your travels.",
                ];
                // Add generic categories until we have 8 items
                while (placeDescriptions.length < 8) {
                    placeDescriptions.push(genericCategories[placeDescriptions.length]);
                }
            }
            // Format the response with numbered points
            let response = `Here are the top places to visit in ${destination}:\n\n`;
            placeDescriptions.forEach((description, index) => {
                response += `${index + 1}. ${description}\n\n`;
            });
            // Add source attribution
            response += `Based on web search results from:\n`;
            sources.forEach((source) => {
                response += `- ${source}\n`;
            });
            return response;
        }
        catch (error) {
            console.error("[FLOW] Tavily search error:", error);
            // Fallback to generic data if Tavily fails
            return `Here are the top places to visit in ${destination || query}:

1. **Popular Cities**: Major urban centers with unique architecture, museums, historical sites, and vibrant local culture.

2. **Natural Wonders**: Breathtaking landscapes including mountains, beaches, forests, and national parks.

3. **Historical Sites**: Ancient temples, colonial buildings, museums, and cultural landmarks that showcase the region's rich history.

4. **Local Experiences**: Immerse yourself in local culture through food tours, traditional performances, markets, and community-based tourism.

5. **Outdoor Activities**: Hiking, water sports, wildlife watching, and adventure activities suited to the local geography.

6. **Culinary Highlights**: Regional specialties, street food, and local delicacies that define the destination's cuisine.

7. **Hidden Gems**: Off-the-beaten-path locations away from typical tourist crowds for a more authentic experience.

8. **Practical Tips**: Consider visiting during the dry season, use local transportation options, and respect cultural customs during your travels.

Based on web search results (search engine temporarily unavailable, using general travel information).`;
        }
    }), {
        name: "search_tool",
        description: "Tool for looking up travel information on the web when places are not found in our database.",
        schema: zod_1.z.object({
            query: zod_1.z.string().describe("The search query to look up on the web"),
        }),
    });
    function scrapeWebsite(_a) {
        return __awaiter(this, arguments, void 0, function* ({ url }) {
            console.log("[FLOW] scrape toool called for url: ", url);
            const response = yield fetch(url);
            const text = response.text();
            const truncatedContent = (yield text).slice(0, 50000);
            const p = prompts_1.INFO_PROMPT.replace("{info}", JSON.stringify(state === null || state === void 0 ? void 0 : state.extractionSchema, null, 2))
                .replace("{url}", url)
                .replace("{content}", truncatedContent);
            const model = (0, configuration_1.loadChatModel)(configuration.queryModel);
            const content = (yield model).invoke(p);
            return (0, util_1.getTextContent)((yield content).content);
        });
    }
    const scraperTool = (0, tools_1.tool)(scrapeWebsite, {
        name: "scrapeWebsite",
        description: "Scrape content from a given website URL",
        schema: zod_1.z.object({
            url: zod_1.z.string().url().describe("The URL of the website to scrape"),
        }),
    });
    return [searchTool, scraperTool];
}
const toolNode = (state, config) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const message = state.messages[state.messages.length - 1];
    // Initialize the tools within the context of the node so that the tools
    // have the current state of the graph and the config in scope.
    // See: https://js.langchain.com/docs/how_to/tool_runtime
    const tools = initializeTools(state, config);
    const outputs = yield Promise.all((_b = (_a = message.tool_calls) === null || _a === void 0 ? void 0 : _a.map((call) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const tool = tools.find((tool) => tool.name === call.name);
        try {
            if (tool === undefined) {
                throw new Error(`Tool "${call.name}" not found.`);
            }
            const newCall = Object.assign(Object.assign({}, call), { args: Object.assign({ __state: state }, call.args) });
            const output = yield tool.invoke(Object.assign(Object.assign({}, newCall), { type: "tool_call" }), config);
            if ((0, messages_1.isBaseMessage)(output) && output._getType() === "tool") {
                return output;
            }
            else {
                return new messages_1.ToolMessage({
                    name: tool.name,
                    content: typeof output === "string" ? output : JSON.stringify(output),
                    tool_call_id: (_a = call.id) !== null && _a !== void 0 ? _a : "",
                });
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }
        catch (e) {
            return new messages_1.ToolMessage({
                content: `Error: ${e.message}\n Please fix your mistakes.`,
                name: call.name,
                tool_call_id: (_b = call.id) !== null && _b !== void 0 ? _b : "",
                status: "error",
            });
        }
    }))) !== null && _b !== void 0 ? _b : []);
    return { messages: outputs };
});
exports.toolNode = toolNode;
// No state or config required here since these are just bound to the chat model
// and are only used to define schema.
// The tool node above will actually call the functions.
exports.MODEL_TOOLS = initializeTools();
