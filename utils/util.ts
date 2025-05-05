import {
  BaseMessage,
  MessageContent,
  MessageContentComplex,
} from "@langchain/core/messages";
import { Document } from "@langchain/core/documents";
import { z } from "zod";

export function getMessageText(msg: BaseMessage): string {
  /** Get the text content of a message. */
  // console.log(msg);
  const content = msg.content;
  if (typeof content === "string") {
    return content;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // console.log(content);
    const txts = (content as any[]).map((c) =>
      typeof c === "string" ? c : c.text || ""
    );
    return txts.join("").trim();
  }
}

export function formatDoc(doc: Document): string {
  const metadata = doc.metadata || {};

  // Normalize case for important fields
  const name = metadata.name || metadata.Name || "";
  const type = metadata.type || metadata.Type || "";
  const city = metadata.city || metadata.City || "";
  const state = metadata.state || metadata.State || "";
  const country = metadata.country || metadata.Country || "";
  const zone = metadata.zone || metadata.Zone || "";

  // Create a highlighted header with important metadata
  let header = "";
  if (name) {
    header += `NAME: ${name}\n`;
  }
  if (type) {
    header += `TYPE: ${type}\n`;
  }
  if (city || state || country) {
    header += `LOCATION: ${[city, state, country]
      .filter(Boolean)
      .join(", ")}\n`;
  }
  if (zone) {
    header += `REGION: ${zone}\n`;
  }

  // Add header separator if we have any header content
  if (header) {
    header += "---\n";
  }

  // Include full metadata as attributes
  const metaAttrs = Object.entries(metadata)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");

  return `<document${metaAttrs}>\n${header}${doc.pageContent}\n</document>`;
}

export function formatDocs(docs?: Document[]): string {
  /**Format a list of documents as XML. */
  if (!docs || docs.length === 0) {
    return "<documents></documents>";
  }
  const formatted = docs.map(formatDoc).join("\n");
  return `<documents>\n${formatted}\n</documents>`;
}

function getSingleTextContent(content: MessageContentComplex) {
  if (content?.type === "text") {
    return content.text;
  } else if (content.type === "array") {
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
export function getTextContent(content: MessageContent): string {
  if (typeof content === "string") {
    return content;
  } else if (Array.isArray(content)) {
    return content.map(getSingleTextContent).join(" ");
  }
  return "";
}

export const InfoIsSatisfactory = z.object({
  reason: z
    .array(z.string())
    .describe(
      "First, provide reasoning for why this is either good or bad as a final result. Must include at least 3 reasons."
    ),
  is_satisfactory: z
    .boolean()
    .describe(
      "After providing your reasoning, provide a value indicating whether the result is satisfactory. If not, you will continue researching."
    ),
  improvement_instructions: z
    .string()
    .optional()
    .describe(
      "If the result is not satisfactory, provide clear and specific instructions on what needs to be improved or added to make the information satisfactory. This should include details on missing information, areas that need more depth, or specific aspects to focus on in further research."
    ),
});

export const decayFunc = (max: number) => {
  const initialPercent = 0.8; // 80% when max = 10
  const decayRate = 0.01; // Smaller = slower decay

  // Apply exponential decay starting from max = 10
  const effectiveMax = Math.max(max, 10); // Ensure it doesn't go below 10
  const percentage =
    initialPercent * Math.exp(-decayRate * (effectiveMax - 10));

  const selected = percentage * max;
  return Math.round(selected); // or use Math.floor/ceil as needed
};
