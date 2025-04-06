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
exports.ConfigurationAnnotation = exports.IndexConfigurationAnnotation = void 0;
exports.ensureIndexConfiguration = ensureIndexConfiguration;
exports.ensureConfiguration = ensureConfiguration;
exports.loadChatModel = loadChatModel;
const prompts_1 = require("./prompts");
const langgraph_1 = require("@langchain/langgraph");
const universal_1 = require("langchain/chat_models/universal");
/**
 * typeof ConfigurationAnnotation.State class for indexing and retrieval operations.
 *
 * This annotation defines the parameters needed for configuring the indexing and
 * retrieval processes, including user identification, embedding model selection,
 * retriever provider choice, and search parameters.
 */
exports.IndexConfigurationAnnotation = langgraph_1.Annotation.Root({
    /**
     * Unique identifier for the user chat.
     */
    thread_id: (langgraph_1.Annotation),
    /**
     * Name of the embedding model to use. Must be a valid embedding model name.
     */
    embeddingModel: (langgraph_1.Annotation),
    /**
     * The vector store provider to use for retrieval.
     */
    retrieverProvider: (langgraph_1.Annotation),
    /**
     * Additional keyword arguments to pass to the search function of the retriever.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    searchKwargs: (langgraph_1.Annotation),
});
/**
 * Create an typeof IndexConfigurationAnnotation.State instance from a RunnableConfig object.
 *
 * @param config - The configuration object to use.
 * @returns An instance of typeof IndexConfigurationAnnotation.State with the specified configuration.
 */
function ensureIndexConfiguration(config = undefined) {
    const configurable = ((config === null || config === void 0 ? void 0 : config.configurable) || {});
    return {
        thread_id: configurable.thread_id || Date.now().toString(), // Give a default user for shared docs
        embeddingModel: configurable.embeddingModel || "cohere/embed-english-v3.0",
        retrieverProvider: configurable.retrieverProvider || "pinecone",
        searchKwargs: configurable.searchKwargs || {},
    };
}
/**
 * The complete configuration for the agent.
 */
exports.ConfigurationAnnotation = langgraph_1.Annotation.Root(Object.assign(Object.assign({}, exports.IndexConfigurationAnnotation.spec), { 
    /**
     * The system prompt used for generating responses.
     */
    responseSystemPromptTemplate: (langgraph_1.Annotation), 
    /**
     * The language model used for generating responses. Should be in the form: provider/model-name.
     */
    responseModel: (langgraph_1.Annotation), 
    /**
     * The system prompt used for processing and refining queries.
     */
    querySystemPromptTemplate: (langgraph_1.Annotation), 
    /**
     * The language model used for processing and refining queries. Should be in the form: provider/model-name.
     */
    queryModel: (langgraph_1.Annotation), 
    /**
     * The main prompt template to use for the agent's interactions.
     *
     * Expects two template literals: ${info} and ${topic}.
     */
    prompt: (langgraph_1.Annotation), 
    /**
     * The maximum number of search results to return for each search query.
     */
    maxSearchResults: (langgraph_1.Annotation), 
    /**
     * The maximum number of times the Info tool can be called during a single interaction.
     */
    maxInfoToolCalls: (langgraph_1.Annotation), 
    /**
     * The maximum number of interaction loops allowed before the agent terminates.
     */
    maxLoops: (langgraph_1.Annotation), thread_id: (langgraph_1.Annotation) }));
/**
 * Create a typeof ConfigurationAnnotation.State instance from a RunnableConfig object.
 *
 * @param config - The configuration object to use.
 * @returns An instance of typeof ConfigurationAnnotation.State with the specified configuration.
 */
function ensureConfiguration(config = undefined) {
    var _a, _b, _c, _d, _e;
    const indexConfig = ensureIndexConfiguration(config);
    const configurable = ((config === null || config === void 0 ? void 0 : config.configurable) || {});
    return Object.assign(Object.assign({}, indexConfig), { responseSystemPromptTemplate: configurable.responseSystemPromptTemplate ||
            prompts_1.RESPONSE_SYSTEM_PROMPT_TEMPLATE, responseModel: configurable.responseModel || "openai/gpt-4o", querySystemPromptTemplate: configurable.querySystemPromptTemplate || prompts_1.QUERY_SYSTEM_PROMPT_TEMPLATE, queryModel: configurable.queryModel || "openai/gpt-4o", prompt: (_a = configurable.prompt) !== null && _a !== void 0 ? _a : prompts_1.MAIN_PROMPT, maxSearchResults: (_b = configurable.maxSearchResults) !== null && _b !== void 0 ? _b : 5, maxInfoToolCalls: (_c = configurable.maxInfoToolCalls) !== null && _c !== void 0 ? _c : 3, maxLoops: (_d = configurable.maxLoops) !== null && _d !== void 0 ? _d : 6, thread_id: (_e = configurable.thread_id) !== null && _e !== void 0 ? _e : Date.now().toString() });
}
/**
 * Load a chat model from a fully specified name.
 * @param fullySpecifiedName - String in the format 'provider/model' or 'provider/account/provider/model'.
 * @returns A Promise that resolves to a BaseChatModel instance.
 */
function loadChatModel(fullySpecifiedName) {
    return __awaiter(this, void 0, void 0, function* () {
        const index = fullySpecifiedName.indexOf("/");
        if (index === -1) {
            // If there's no "/", assume it's just the model
            return yield (0, universal_1.initChatModel)(fullySpecifiedName);
        }
        else {
            const provider = fullySpecifiedName.slice(0, index);
            const model = fullySpecifiedName.slice(index + 1);
            return yield (0, universal_1.initChatModel)(model, { modelProvider: provider });
        }
    });
}
