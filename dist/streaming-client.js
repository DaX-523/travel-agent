"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = StreamingClient;
const react_1 = require("ai/react");
function StreamingClient() {
    const { messages, input, handleInputChange, handleSubmit } = (0, react_1.useChat)({
        api: "/api/chat/stream",
    });
    return className = "flex flex-col w-full max-w-md py-24 mx-auto stretch" >
        className;
    "mb-4" >
        { messages, : .map((message) => key = { message, : .id }, className = {} `whitespace-pre-wrap ${message.role === "user" ? "text-blue-600" : "text-gray-600"}`) }
        >
            { message, : .content }
        < /div>;
}
/div>
    < form;
onSubmit = { handleSubmit } >
    className;
"fixed bottom-0 w-full max-w-md p-2 mb-8 border border-gray-300 rounded shadow-xl";
value = { input };
placeholder = "Say something...";
onChange = { handleInputChange }
    /  >
    /form>
    < /div>;
;
