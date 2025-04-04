"use strict";
/**
 * Default prompts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUERY_SYSTEM_PROMPT_TEMPLATE = exports.RESPONSE_SYSTEM_PROMPT_TEMPLATE = void 0;
exports.RESPONSE_SYSTEM_PROMPT_TEMPLATE = `You are a helpful AI assistant. Answer the user's questions based on the retrieved documents.

{retrievedDocs}

System time: {systemTime}`;
exports.QUERY_SYSTEM_PROMPT_TEMPLATE = `Generate search queries to retrieve documents that may help answer the user's question. Previously, you made the following queries:
    
<previous_queries/>
{queries}
</previous_queries>

System time: {systemTime}`;
