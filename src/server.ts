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
        name: "get_actors",
        description: "Get all actors from FoundryVTT",
        inputSchema: {
          type: "object",
          properties: {
            max_length: {
              type: "integer",
              description:
                "Maximum number of bytes the JSON response can be. Actors are removed one by one until under this limit. If 0, undefined, or null, there is no limit.",
            },
            requested_fields: {
              type: "array",
              items: { type: "string" },
              description:
                "Array of field names to include in each actor object. Always includes _id and name. If empty, undefined, or null, all fields are included.",
            },
          },
          required: [],
        },
      },
      {
        name: "get_actor",
        description: "Get a specific actor from FoundryVTT by id, _id, or name",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The id of the actor to retrieve",
            },
            _id: {
              type: "string",
              description: "The _id of the actor to retrieve",
            },
            name: {
              type: "string",
              description: "The name of the actor to retrieve",
            },
            requested_fields: {
              type: "array",
              items: { type: "string" },
              description:
                "Array of field names to include in the actor object. Always includes _id and name. If empty, undefined, or null, all fields are included.",
            },
          },
          required: [],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_actors") {
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

    try {
      const maxLength = args?.max_length as number | undefined;
      const requestedFields = args?.requested_fields as string[] | undefined;

      const actors = await foundryClient.getActors({
        maxLength: maxLength || null,
        requestedFields: requestedFields || null,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(actors),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching actors: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

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

    try {
      const id = args?.id as string | undefined;
      const _id = args?._id as string | undefined;
      const actorName = args?.name as string | undefined;
      const requestedFields = args?.requested_fields as string[] | undefined;

      if (!id && !_id && !actorName) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Must provide at least one of: id, _id, or name",
            },
          ],
          isError: true,
        };
      }

      const actor = await foundryClient.getActor(
        { id, _id, name: actorName },
        { requestedFields: requestedFields || null }
      );

      if (!actor) {
        return {
          content: [
            {
              type: "text",
              text: "Actor not found",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(actor),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching actor: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
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