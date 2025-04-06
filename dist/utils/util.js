"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InfoIsSatisfactory = void 0;
exports.getMessageText = getMessageText;
exports.formatDoc = formatDoc;
exports.formatDocs = formatDocs;
exports.getTextContent = getTextContent;
const zod_1 = require("zod");
function getMessageText(msg) {
    /** Get the text content of a message. */
    console.log(msg);
    const content = msg.content;
    if (typeof content === "string") {
        return content;
    }
    else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        console.log(content);
        const txts = content.map((c) => typeof c === "string" ? c : c.text || "");
        return txts.join("").trim();
    }
}
function formatDoc(doc) {
    const metadata = doc.metadata || {};
    const meta = Object.entries(metadata)
        .map(([k, v]) => ` ${k}=${v}`)
        .join("");
    const metaStr = meta ? ` ${meta}` : "";
    return `<document${metaStr}>\n${doc.pageContent}\n</document>`;
}
function formatDocs(docs) {
    /**Format a list of documents as XML. */
    if (!docs || docs.length === 0) {
        return "<documents></documents>";
    }
    const formatted = docs.map(formatDoc).join("\n");
    return `<documents>\n${formatted}\n</documents>`;
}
function getSingleTextContent(content) {
    if ((content === null || content === void 0 ? void 0 : content.type) === "text") {
        return content.text;
    }
    else if (content.type === "array") {
        return content.content.map(getSingleTextContent).join(" ");
    }
    return "";
}
/**
 * Helper function to extract text content from various message types.
 *
 * @param content - The message content to process
 * @returns The extracted text content
 */
function getTextContent(content) {
    if (typeof content === "string") {
        return content;
    }
    else if (Array.isArray(content)) {
        return content.map(getSingleTextContent).join(" ");
    }
    return "";
}
exports.InfoIsSatisfactory = zod_1.z.object({
    reason: zod_1.z
        .array(zod_1.z.string())
        .describe("First, provide reasoning for why this is either good or bad as a final result. Must include at least 3 reasons."),
    is_satisfactory: zod_1.z
        .boolean()
        .describe("After providing your reasoning, provide a value indicating whether the result is satisfactory. If not, you will continue researching."),
    improvement_instructions: zod_1.z
        .string()
        .optional()
        .describe("If the result is not satisfactory, provide clear and specific instructions on what needs to be improved or added to make the information satisfactory. This should include details on missing information, areas that need more depth, or specific aspects to focus on in further research."),
});
