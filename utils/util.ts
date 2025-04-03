import { BaseMessage } from "@langchain/core/messages";
import { Document } from "@langchain/core/documents";

export function getMessageText(msg: BaseMessage): string {
  /** Get the text content of a message. */
  const content = msg.content;
  if (typeof content === "string") {
    return content;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txts = (content as any[]).map((c) =>
      typeof c === "string" ? c : c.text || ""
    );
    return txts.join("").trim();
  }
}

export function formatDoc(doc: Document): string {
  const metadata = doc.metadata || {};
  const meta = Object.entries(metadata)
    .map(([k, v]) => ` ${k}=${v}`)
    .join("");
  const metaStr = meta ? ` ${meta}` : "";

  return `<document${metaStr}>\n${doc.pageContent}\n</document>`;
}

export function formatDocs(docs?: Document[]): string {
  /**Format a list of documents as XML. */
  if (!docs || docs.length === 0) {
    return "<documents></documents>";
  }
  const formatted = docs.map(formatDoc).join("\n");
  return `<documents>\n${formatted}\n</documents>`;
}
