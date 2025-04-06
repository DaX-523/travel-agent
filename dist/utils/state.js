"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateAnnotation = exports.InputStateAnnotation = exports.QueriesAnnotation = exports.MessagesAnnotation = void 0;
const langgraph_1 = require("@langchain/langgraph");
// Define reusable annotation types for shared properties
exports.MessagesAnnotation = (0, langgraph_1.Annotation)({
    reducer: (left, right) => {
        if (Array.isArray(right))
            return left.concat(right);
        return left.concat([right]);
    },
    default: () => [],
});
exports.QueriesAnnotation = (0, langgraph_1.Annotation)({
    reducer: (left, right) => {
        if (Array.isArray(right))
            return left.concat(right);
        return left.concat([right]);
    },
    default: () => [],
});
exports.InputStateAnnotation = langgraph_1.Annotation.Root({
    topic: (langgraph_1.Annotation),
    /**
     * The info state trackes the current extracted data for the given topic,
     * conforming to the provided schema.
     */
    info: (langgraph_1.Annotation),
    /**
     * The schema defines the information the agent is tasked with filling out.
     */
    extractionSchema: (langgraph_1.Annotation),
    // Use the shared annotation definitions
    messages: exports.MessagesAnnotation,
    queries: exports.QueriesAnnotation,
    // retrievedDocs: Annotation<Document[]>,
    // Feel free to add additional attributes to your state as needed.
    // Common examples include retrieved documents, extracted entities, API connections, etc.
});
/**
 * A graph's StateAnnotation defines three main thing:
 * 1. The structure of the data to be passed between nodes (which "channels" to read from/write to and their types)
 * 2. Default values each field
 * 3. Rducers for the state's. Reducers are functions that determine how to apply updates to the state.
 * See [Reducers](https://langchain-ai.github.io/langgraphjs/concepts/low_level/#reducers) for more information.
 */
exports.StateAnnotation = langgraph_1.Annotation.Root({
    /**
     * Messages track the primary execution state of the agent.
     *
     * Typically accumulates a pattern of:
     *
     * 1. HumanMessage - user input
     * 2. AIMessage with .tool_calls - agent picking tool(s) to use to collect
     *     information
     * 3. ToolMessage(s) - the responses (or errors) from the executed tools
     *
     *     (... repeat steps 2 and 3 as needed ...)
     * 4. AIMessage without .tool_calls - agent responding in unstructured
     *     format to the user.
     *
     * 5. HumanMessage - user responds with the next conversational turn.
     *
     *     (... repeat steps 2-5 as needed ... )
     *
     * Merges two lists of messages, updating existing messages by ID.
     *
     * By default, this ensures the state is "append-only", unless the
     * new message has the same ID as an existing message.
     *
     * Returns:
     *     A new list of messages with the messages from \`right\` merged into \`left\`.
     *     If a message in \`right\` has the same ID as a message in \`left\`, the
     *     message from \`right\` will replace the message from \`left\`.`
     */
    messages: exports.MessagesAnnotation,
    queries: exports.QueriesAnnotation,
    retrievedDocs: (langgraph_1.Annotation),
    topic: (langgraph_1.Annotation),
    /**
     * The info state trackes the current extracted data for the given topic,
     * conforming to the provided schema.
     */
    info: (langgraph_1.Annotation),
    /**
     * The schema defines the information the agent is tasked with filling out.
     */
    extractionSchema: (langgraph_1.Annotation),
    /**
     * Tracks the number of iterations the agent has gone through in the current session.
     * This can be used to limit the number of iterations or to track progress.
     */
    loopStep: (0, langgraph_1.Annotation)({
        reducer: (left, right) => left + right,
        default: () => 0,
    }),
    // Feel free to add additional attributes to your state as needed.
    // Common examples include retrieved documents, extracted entities, API connections, etc.
});
