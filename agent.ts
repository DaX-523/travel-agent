import { Annotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { MongoClient } from "mongodb";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { tool } from "@langchain/core/tools";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { z } from "zod";
import { ChatAnthropic } from "@langchain/anthropic";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";

export default async function callAgent(
  client: MongoClient,
  query: string,
  thread_id: string
) {
  try {
    const db = client.db("AI-Travel-Agent");
    const collection = db.collection("places");
    const GraphState = Annotation.Root({
      messages: Annotation<BaseMessage[]>({
        reducer: (left: BaseMessage[], right: BaseMessage | BaseMessage[]) => {
          if (Array.isArray(right)) return left.concat(right);
          return left.concat([right]);
        },
      }),
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
          new OpenAIEmbeddings(),
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
    const tools = [lookupTool];
    const toolNode = new ToolNode<typeof GraphState.State>(tools);

    const chatModel = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0.7,
    }).bindTools(tools);

    async function callModel(state: typeof GraphState.State) {
      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          `You are a helpful AI assistant, collaborating with other assistants. Use the provided tools to progress towards answering the question. If you are unable to fully answer, that's OK, another assistant with different tools will help where you left off. Execute what you can to make progress. If you or any of the other assistants have the final answer or deliverable, prefix your response with FINAL ANSWER so the team knows to stop. You have access to the following tools: {tool_names}.\n{system_message}\nCurrent time: {time}.`,
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
      .addNode("agent", callModel)
      .addNode("tools", toolNode)
      .addEdge("__start__", "agent")
      .addConditionalEdges("agent", shouldContinue)
      .addEdge("tools", "agent");

    const checkpointer = new MongoDBSaver({
      client,
      dbName: "AI-Travel-Agent",
    });
    const app = workflow.compile({ checkpointer });
    const finalState = await app.invoke(
      {
        messages: [new HumanMessage(query)],
      },
      {
        recursionLimit: 15,
        configurable: { thread_id },
      }
    );
    console.log(finalState.messages[finalState.messages.length - 1].content);
    return finalState.messages[finalState.messages.length - 1].content;
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
