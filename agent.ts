import { Annotation, StateGraph } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { MongoClient } from "mongodb";
import { Document } from "@langchain/core/documents";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { tool } from "@langchain/core/tools";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { z } from "zod";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { CohereEmbeddings } from "@langchain/cohere";
import { RunnableConfig } from "@langchain/core/runnables";
import { formatDocs, getMessageText } from "./utils/util";
import { ensureConfiguration, loadChatModel } from "./utils/configuration";
import { makeRetriever } from "./utils/retrieval";

export default async function callAgent(
  client: MongoClient,
  query: string,
  threadId: string
) {
  try {
    console.log("query", query);
    const db = client.db("AI-Travel-Agent");
    const collection = db.collection("places");
    const GraphState = Annotation.Root({
      messages: Annotation<BaseMessage[]>({
        reducer: (left: BaseMessage[], right: BaseMessage | BaseMessage[]) => {
          if (Array.isArray(right)) return left.concat(right);
          return left.concat([right]);
        },
        default: () => [],
      }),
      queries: Annotation<string[], string | string[]>({
        reducer: (left: string[], right: string | string[]) => {
          if (Array.isArray(right)) return left.concat(right);
          return left.concat([right]);
        },
        default: () => [],
      }),
      retrievedDocs: Annotation<Document[]>,
    });

    const lookupTool = tool(
      async ({ query, n = 10 }) => {
        console.log("Lookup Tool");
        const dbConfig = {
          collection,
          indexName: "vector_index",
          textKey: "embedding_text",
          embeddingKey: "embedding",
        };

        const vectorStore = new MongoDBAtlasVectorSearch(
          new CohereEmbeddings({ model: "embed-english-v3.0" }),
          dbConfig
        );
        const result = await vectorStore.similaritySearchWithScore(query, n);

        return JSON.stringify(result);
      },
      {
        name: "places_lookup",
        description: "Place to search for the agent for suitale search results",
        schema: z.object({
          query: z.string().describe("The Search Query"),
          n: z
            .number()
            .optional()
            .default(10)
            .describe("Number of results to return"),
        }),
      }
    );
    const searchTool = tool(async () => {}, {
      name: "search_tool",
      description: "Tool for lookup in web.",
    });
    const tools = [lookupTool, searchTool];
    const toolNode = new ToolNode<typeof GraphState.State>(tools);

    const chatModel = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0.7,
    }).bindTools(tools);
    const SearchQuery = z.object({
      query: z.string().describe("Search the indexed documents for a query."),
    });
    async function generateQuery(
      state: typeof GraphState.State,
      config?: RunnableConfig
    ): Promise<typeof GraphState.Update> {
      const messages = state.messages;
      if (messages.length === 1) {
        const humanInput = getMessageText(messages[messages.length - 1]);
        return {
          queries: [humanInput],
        };
      } else {
        const configuration = ensureConfiguration(config);
        // Feel free to customize the prompt, model, and other logic!
        const systemMessage = configuration.querySystemPromptTemplate
          .replace("{queries}", (state.queries || []).join("\n- "))
          .replace("{systemTime}", new Date().toISOString());

        const messageValue = [
          { role: "system", content: systemMessage },
          ...state.messages,
        ];
        const model = (
          await loadChatModel(configuration.responseModel)
        ).withStructuredOutput(SearchQuery);

        const generated = await model.invoke(messageValue);
        return {
          queries: [generated.query],
        };
      }
    }

    async function retrieve(
      state: typeof GraphState.State,
      config: RunnableConfig
    ): Promise<typeof GraphState.Update> {
      const my_retriever = await makeRetriever(config);
      const query = state.queries[state.queries.length - 1];
      const docs = await my_retriever.invoke(query);
      console.log("docs", docs);
      return { retrievedDocs: docs };
    }

    async function respond(
      state: typeof GraphState.State,
      config: RunnableConfig
    ): Promise<typeof GraphState.Update> {
      const configuration = ensureConfiguration(config);

      const model = await loadChatModel(configuration.responseModel);

      const retrievedDocs = formatDocs(state.retrievedDocs);
      // Feel free to customize the prompt, model, and other logic!
      console.log("docs2", retrievedDocs);
      const systemMessage = configuration.responseSystemPromptTemplate
        .replace("{retrievedDocs}", retrievedDocs)
        .replace("{systemTime}", new Date().toISOString());
      const messageValue = [
        { role: "system", content: systemMessage },
        ...state.messages,
      ];
      const response = await model.invoke(messageValue);
      // We return a list, because this will get added to the existing list
      return { messages: [response] };
    }

    async function callModel(state: typeof GraphState.State) {
      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          `You are a helpful AI assistant, collaborating with other assistants. Use the provided tools to progress towards answering the question. If you are unable to fully answer, that's OK, another assistant with different tools will help where you left off. Execute what you can to make progress. If you or any of the other assistants have the final answer or deliverable, prefix your response with FINAL ANSWER so the team knows to stop. If no relevant locations are found in the database, clearly inform the user instead of making assumptions. You have access to the following tools: {tool_names}.\n{system_message}\nCurrent time: {time}.`,
        ],
        new MessagesPlaceholder("messages"),
      ]);

      const formattedPrompt = await prompt.formatMessages({
        system_message: "You are a helpful Travel Agent.",
        time: new Date().toISOString(),
        tool_names: tools.map((tool) => tool.name).join(", "),
        messages: state.messages,
      });
      const result = await chatModel.invoke(formattedPrompt);
      return { messages: [result] };
    }
    //raw toolsCondition
    function shouldContinue(state: typeof GraphState.State): string {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1] as AIMessage;

      if (
        lastMessage &&
        lastMessage.tool_calls &&
        lastMessage.tool_calls.length > 0
      )
        return "tools";
      return "__end__";
    }

    const workflow = new StateGraph(GraphState)
      .addNode("generateQuery", generateQuery)
      .addNode("retrieve", retrieve)
      .addNode("respond", respond)
      .addEdge("__start__", "generateQuery")
      .addEdge("generateQuery", "retrieve")
      .addEdge("retrieve", "respond");

    const checkpointer = new MongoDBSaver({
      client,
      dbName: "AI-Travel-Agent",
    });
    const app = workflow.compile({
      checkpointer,
      interruptBefore: [],
      interruptAfter: [],
    });
    app.name = "Travel Agent";
    const finalState = await app.invoke(
      {
        messages: [new HumanMessage({ content: query })],
        queries: [query],
      },
      {
        recursionLimit: 15,
        configurable: { thread_id: threadId },
      }
    );
    console.log(finalState.messages[finalState.messages.length - 1].content);
    return finalState.messages[finalState.messages.length - 1].content;
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
