"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMessageText = getMessageText;
exports.formatDoc = formatDoc;
exports.formatDocs = formatDocs;
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
