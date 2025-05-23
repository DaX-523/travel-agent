# Travel Agent Backend

A sophisticated travel recommendation and planning backend system powered by AI and vector databases.

## Features

- 🧠 **AI-powered travel agent**: Intelligent conversational agent that assists with travel planning
- 🔎 **Semantic search**: Find places and travel information using natural language queries
- 🌐 **Web scraping integration**: Gather fresh travel data from online sources
- 🔄 **RAG (Retrieval Augmented Generation)**: Combines knowledge base with generative AI responses
- 🧩 **Multi-tool LLM agents**: Capable of using different tools to accomplish complex tasks
- 👤 **User authentication**: JWT-based authentication system with secure password handling
- 💾 **Data persistence**: Store conversation history and travel recommendations
- 📈 **Vector search**: Semantic similarity search for travel destinations and information
- 🤖 **Streaming responses**: Real-time AI responses with streamed output
- 📊 **Structured data extraction**: Convert unstructured text into structured travel data
- 🔄 **Thread management**: Maintain separate conversation contexts for different users

## Technologies

- 🔧 **TypeScript**: Strongly typed JavaScript for robust backend development
- 📦 **Express.js**: Web server framework for handling HTTP requests
- 🗄️ **MongoDB Atlas**: Cloud database for storing application data
- 📊 **Pinecone**: Vector database for efficient similarity search
- 🔍 **Pinecone Vector Search**: Vector database for semantic search capabilities
- 🤖 **LangChain**: Framework for building LLM applications
- 🔗 **LangGraph.js**: Framework for building complex AI agent workflows
- 🔐 **JWT (JSON Web Tokens)**: For secure user authentication
- 🔒 **bcrypt**: For secure password hashing
- 📄 **Zod**: Schema validation for structured data
- 🤖 **Groq LLMs**: Multiple AI model integrations
- 🌐 **CORS**: Cross-Origin Resource Sharing for secure API access

## Local Development Setup

### Prerequisites

- Node.js (v16+)
- MongoDB Atlas account
- Pinecone account
- API keys for LLM providers (Groq, etc.)

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```
# MongoDB
MONGODB_ATLAS_URI=your_mongodb_connection_string

# Pinecone
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=your_pinecone_index_name

# LLM API Keys
ANTHROPIC_API_KEY=your_anthropic_api_key
COHERE_API_KEY=your_cohere_api_key
GROQ_API_KEY=your_groq_api_key

# Authentication
JWT_SECRET=your_jwt_secret_key
```

### Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd travel-agent
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Seed the database:

   ```bash
   npm run seed
   ```

4. Build the project:

   ```bash
   npm run build
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

The server will start at `http://localhost:3000` (or the port specified in your environment variables).

## API Endpoints

### Authentication

- `POST /auth/register` - Register a new user
- `POST /auth/login` - Login a user

### Conversations

- `POST /chat` - Send a message to the AI travel agent
- `GET /threads` - Get user's conversation threads
- `GET /threads/:threadId` - Get messages in a specific thread

## Data Seeding

The project includes data seeding functionality to populate the database with travel information. Run:

```bash
npm run seed
```

This will use the seed-db.ts script to:

1. Connect to MongoDB and Pinecone
2. Load travel data from CSV files
3. Generate embeddings for semantic search
4. Store the data in vector databases

## Architecture

The application uses LangGraph to orchestrate a complex workflow:

1. User query analysis
2. Context retrieval from vector databases
3. Web search for fresh information
4. Web scraping for detailed content
5. Response generation with structured data
6. Thread management and persistence
