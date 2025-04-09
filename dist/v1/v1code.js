"use strict";
// async function callModel(state: typeof GraphState.State) {
//   //old (v1) tools
//   const lookupTool = tool(
//     async ({ query, n = 10 }) => {
//       console.log("Lookup Tool");
//       const dbConfig = {
//         collection,
//         indexName: "vector_index",
//         textKey: "embedding_text",
//         embeddingKey: "embedding",
//       };
//       const vectorStore = new MongoDBAtlasVectorSearch(
//         new CohereEmbeddings({ model: "embed-english-v3.0" }),
//         dbConfig
//       );
//       const result = await vectorStore.similaritySearchWithScore(query, n);
//       return JSON.stringify(result);
//     },
//     {
//       name: "places_lookup",
//       description: "Place to search for the agent for suitale search results",
//       schema: z.object({
//         query: z.string().describe("The Search Query"),
//         n: z
//           .number()
//           .optional()
//           .default(10)
//           .describe("Number of results to return"),
//       }),
//     }
//   );
//   const prompt = ChatPromptTemplate.fromMessages([
//     [
//       "system",
//       `You are a helpful AI assistant, collaborating with other assistants. Use the provided tools to progress towards answering the question. If you are unable to fully answer, that's OK, another assistant with different tools will help where you left off. Execute what you can to make progress. If you or any of the other assistants have the final answer or deliverable, prefix your response with FINAL ANSWER so the team knows to stop. If no relevant locations are found in the database, clearly inform the user instead of making assumptions. You have access to the following tools: {tool_names}.\n{system_message}\nCurrent time: {time}.`,
//     ],
//     new MessagesPlaceholder("messages"),
//   ]);
//   const formattedPrompt = await prompt.formatMessages({
//     system_message: "You are a helpful Travel Agent.",
//     time: new Date().toISOString(),
//     tool_names: tools.map((tool) => tool.name).join(", "),
//     messages: state.messages,
//   });
//   const result = await chatModel.invoke(formattedPrompt);
//   return { messages: [result] };
// }
// //raw toolsCondition
// function shouldContinue(state: typeof GraphState.State): string {
//   const messages = state.messages;
//   const lastMessage = messages[messages.length - 1] as AIMessage;
//   if (
//     lastMessage &&
//     lastMessage.tool_calls &&
//     lastMessage.tool_calls.length > 0
//   )
//     return "tools";
//   return "__end__";
// }
