/**
 * Define the configurable parameters for the agent.
 */
import { RunnableConfig } from "@langchain/core/runnables";
import {
  RESPONSE_SYSTEM_PROMPT_TEMPLATE,
  QUERY_SYSTEM_PROMPT_TEMPLATE,
  MAIN_PROMPT,
} from "./prompts";
import { Annotation } from "@langchain/langgraph";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { initChatModel } from "langchain/chat_models/universal";

/**
 * typeof ConfigurationAnnotation.State class for indexing and retrieval operations.
 *
 * This annotation defines the parameters needed for configuring the indexing and
 * retrieval processes, including user identification, embedding model selection,
 * retriever provider choice, and search parameters.
 */
export const IndexConfigurationAnnotation = Annotation.Root({
  /**
   * Unique identifier for the user chat.
   */
  thread_id: Annotation<string>,

  /**
   * Name of the embedding model to use. Must be a valid embedding model name.
   */
  embeddingModel: Annotation<string>,

  /**
   * The vector store provider to use for retrieval.
   */
  retrieverProvider: Annotation<"pinecone">,

  /**
   * Additional keyword arguments to pass to the search function of the retriever.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  searchKwargs: Annotation<Record<string, any>>,
});

/**
 * Create an typeof IndexConfigurationAnnotation.State instance from a RunnableConfig object.
 *
 * @param config - The configuration object to use.
 * @returns An instance of typeof IndexConfigurationAnnotation.State with the specified configuration.
 */
export function ensureIndexConfiguration(
  config: RunnableConfig | undefined = undefined
): typeof IndexConfigurationAnnotation.State {
  const configurable = (config?.configurable || {}) as Partial<
    typeof IndexConfigurationAnnotation.State
  >;
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
export const ConfigurationAnnotation = Annotation.Root({
  ...IndexConfigurationAnnotation.spec,
  /**
   * The system prompt used for generating responses.
   */
  responseSystemPromptTemplate: Annotation<string>,

  /**
   * The language model used for generating responses. Should be in the form: provider/model-name.
   */
  responseModel: Annotation<string>,

  /**
   * The system prompt used for processing and refining queries.
   */
  querySystemPromptTemplate: Annotation<string>,

  /**
   * The language model used for processing and refining queries. Should be in the form: provider/model-name.
   */
  queryModel: Annotation<string>,
  /**
   * The main prompt template to use for the agent's interactions.
   *
   * Expects two template literals: ${info} and ${topic}.
   */
  prompt: Annotation<string>,

  /**
   * The maximum number of search results to return for each search query.
   */
  maxSearchResults: Annotation<number>,

  /**
   * The maximum number of times the Info tool can be called during a single interaction.
   */
  maxInfoToolCalls: Annotation<number>,

  /**
   * The maximum number of interaction loops allowed before the agent terminates.
   */
  maxLoops: Annotation<number>,

  thread_id: Annotation<string>,
});

/**
 * Create a typeof ConfigurationAnnotation.State instance from a RunnableConfig object.
 *
 * @param config - The configuration object to use.
 * @returns An instance of typeof ConfigurationAnnotation.State with the specified configuration.
 */
export function ensureConfiguration(
  config: RunnableConfig | undefined = undefined
): typeof ConfigurationAnnotation.State {
  const indexConfig = ensureIndexConfiguration(config);
  const configurable = (config?.configurable || {}) as Partial<
    typeof ConfigurationAnnotation.State
  >;

  return {
    ...indexConfig,
    responseSystemPromptTemplate:
      configurable.responseSystemPromptTemplate ||
      RESPONSE_SYSTEM_PROMPT_TEMPLATE,
    responseModel: configurable.responseModel || "groq/llama3-70b-8192",
    querySystemPromptTemplate:
      configurable.querySystemPromptTemplate || QUERY_SYSTEM_PROMPT_TEMPLATE,
    queryModel: configurable.queryModel || "groq/llama3-70b-8192",
    prompt: configurable.prompt ?? MAIN_PROMPT,
    maxSearchResults: configurable.maxSearchResults ?? 5,
    maxInfoToolCalls: configurable.maxInfoToolCalls ?? 3,
    maxLoops: configurable.maxLoops ?? 6,
    thread_id: configurable.thread_id ?? Date.now().toString(),
  };
}

/**
 * Load a chat model from a fully specified name.
 * @param fullySpecifiedName - String in the format 'provider/model' or 'provider/account/provider/model'.
 * @returns A Promise that resolves to a BaseChatModel instance.
 */
export async function loadChatModel(
  fullySpecifiedName: string,
  options: { streaming?: boolean } = {}
): Promise<BaseChatModel> {
  const index = fullySpecifiedName.indexOf("/");
  if (index === -1) {
    // If there's no "/", assume it's just the model
    return await initChatModel(fullySpecifiedName, options);
  } else {
    const provider = fullySpecifiedName.slice(0, index);
    const model = fullySpecifiedName.slice(index + 1);
    return await initChatModel(model, {
      modelProvider: provider,
      streaming: options.streaming ?? false, // Default to false for streaming
    });
  }
}
