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

// Document type configurations for tool generation
interface DocumentTypeConfig {
  singular: string;      // e.g., "actor"
  plural: string;        // e.g., "actors"
  collection: string;    // e.g., "actors" (the key in world data)
  description: string;   // e.g., "actor" for descriptions
}

const DOCUMENT_TYPES: DocumentTypeConfig[] = [
  { singular: "actor", plural: "actors", collection: "actors", description: "actor" },
  { singular: "item", plural: "items", collection: "items", description: "item" },
  { singular: "folder", plural: "folders", collection: "folders", description: "folder" },
  { singular: "user", plural: "users", collection: "users", description: "user" },
  { singular: "scene", plural: "scenes", collection: "scenes", description: "scene" },
  { singular: "journal", plural: "journals", collection: "journal", description: "journal entry" },
];

// Generate tool definitions for a document type
function generateListToolDefinition(config: DocumentTypeConfig) {
  return {
    name: `get_${config.plural}`,
    description: `Get all ${config.plural} from FoundryVTT`,
    inputSchema: {
      type: "object",
      properties: {
        max_length: {
          type: "integer",
          description: `Maximum number of bytes the JSON response can be. ${config.plural.charAt(0).toUpperCase() + config.plural.slice(1)} are removed one by one until under this limit. If 0, undefined, or null, there is no limit.`,
        },
        requested_fields: {
          type: "array",
          items: { type: "string" },
          description: `Array of field names to include in each ${config.description} object. Always includes _id and name. If empty, undefined, or null, all fields are included.`,
        },
      },
      required: [],
    },
  };
}

function generateGetToolDefinition(config: DocumentTypeConfig) {
  return {
    name: `get_${config.singular}`,
    description: `Get a specific ${config.description} from FoundryVTT by id, _id, or name`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: `The id of the ${config.description} to retrieve`,
        },
        _id: {
          type: "string",
          description: `The _id of the ${config.description} to retrieve`,
        },
        name: {
          type: "string",
          description: `The name of the ${config.description} to retrieve`,
        },
        requested_fields: {
          type: "array",
          items: { type: "string" },
          description: `Array of field names to include in the ${config.description} object. Always includes _id and name. If empty, undefined, or null, all fields are included.`,
        },
      },
      required: [],
    },
  };
}

// Tool definition for modifying documents
const modifyDocumentTool = {
  name: "modify_document",
  description: `Modify a document in FoundryVTT. IMPORTANT: Before using this tool, you should first retrieve the document using the appropriate get_* tool (e.g., get_actor, get_item) to understand its current structure and field names. Document schemas vary by game system, so inspecting the document first ensures you use the correct field paths in your updates.`,
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: `The document type to modify. Valid types include: "Actor", "Item", "Scene", "JournalEntry", "Folder", "User", "Playlist", "Macro", "RollTable", "Cards", "ChatMessage", "Combat", "Combatant", "ActiveEffect", "Drawing", "MeasuredTemplate", "Note", "Tile", "Token", "Wall", "AmbientLight", "AmbientSound". The type must match Foundry's internal document class name (case-sensitive).`,
      },
      _id: {
        type: "string",
        description: `The _id of the document to modify. This is the unique identifier for the document in FoundryVTT.`,
      },
      updates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
        description: `An array of update objects to apply to the document. Each update object should contain the fields you want to modify, using nested objects to represent the document structure. The _id will be automatically added to each update object.

Example: To update an Actor's strength attribute, you might use:
[{ "system": { "attributes_physical": { "strength": { "value": 5 } } } }]

Example: To update an Item's description and quantity:
[{ "system": { "description": "A shiny sword", "quantity": 2 } }]

The exact field structure depends on the game system. Use the get_* tools first to inspect the document's current structure and determine the correct field paths.`,
      },
    },
    required: ["type", "_id", "updates"],
  },
};

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
  const tools = [
    ...DOCUMENT_TYPES.flatMap((config) => [
      generateListToolDefinition(config),
      generateGetToolDefinition(config),
    ]),
    modifyDocumentTool,
  ];

  return { tools };
});

// Helper to create error response
function errorResponse(message: string) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

// Helper to create success response
function successResponse(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Check connection for all tools
  if (!foundryClient.isConnected()) {
    return errorResponse("Error: Not connected to FoundryVTT server");
  }

  // Find matching document type
  for (const config of DOCUMENT_TYPES) {
    // Handle get_[plural] (list all)
    if (name === `get_${config.plural}`) {
      try {
        const maxLength = args?.max_length as number | undefined;
        const requestedFields = args?.requested_fields as string[] | undefined;

        const docs = await foundryClient.getDocuments(config.collection, {
          maxLength: maxLength || null,
          requestedFields: requestedFields || null,
        });

        return successResponse(docs);
      } catch (error) {
        return errorResponse(
          `Error fetching ${config.plural}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Handle get_[singular] (get one)
    if (name === `get_${config.singular}`) {
      try {
        const id = args?.id as string | undefined;
        const _id = args?._id as string | undefined;
        const docName = args?.name as string | undefined;
        const requestedFields = args?.requested_fields as string[] | undefined;

        if (!id && !_id && !docName) {
          return errorResponse("Error: Must provide at least one of: id, _id, or name");
        }

        const doc = await foundryClient.getDocument(
          config.collection,
          { id, _id, name: docName },
          { requestedFields: requestedFields || null }
        );

        if (!doc) {
          return {
            content: [{ type: "text", text: `${config.description.charAt(0).toUpperCase() + config.description.slice(1)} not found` }],
          };
        }

        return successResponse(doc);
      } catch (error) {
        return errorResponse(
          `Error fetching ${config.description}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  // Handle modify_document
  if (name === "modify_document") {
    try {
      const type = args?.type as string | undefined;
      const _id = args?._id as string | undefined;
      const updates = args?.updates as Record<string, unknown>[] | undefined;

      if (!type) {
        return errorResponse("Error: 'type' is required");
      }
      if (!_id) {
        return errorResponse("Error: '_id' is required");
      }
      if (!updates || !Array.isArray(updates)) {
        return errorResponse("Error: 'updates' must be an array of objects");
      }

      const result = await foundryClient.modifyDocument(type, _id, updates);
      return successResponse(result);
    } catch (error) {
      return errorResponse(
        `Error modifying document: ${error instanceof Error ? error.message : String(error)}`
      );
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