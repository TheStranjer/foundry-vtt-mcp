// server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { FoundryClient } from "./foundry-client.js";

// Create the Foundry client instance
const foundryClient = new FoundryClient();

// Create server instance
const server = new Server(
  {
    name: "foundry-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_actor",
        description: "Get an actor from FoundryVTT",
        inputSchema: {
          type: "object",
          properties: {
            actorId: {
              type: "string",
              description: "The ID of the actor to retrieve",
            },
          },
          required: ["actorId"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_actor") {
    if (!foundryClient.isConnected()) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Not connected to FoundryVTT server",
          },
        ],
        isError: true,
      };
    }
    // TODO: Implement actual WebSocket message to get actor data
    return {
      content: [
        {
          type: "text",
          text: `Actor data for ${args?.actorId} (connected to ${foundryClient.getHostname()})`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start the server
async function main() {
  // Connect to FoundryVTT first
  console.error("Connecting to FoundryVTT...");
  await foundryClient.connect();
  console.error(`Connected to FoundryVTT at ${foundryClient.getHostname()}`);

  // Start the MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("FoundryVTT MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});