// server.ts
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { FoundryClient } from "./foundry-client.js";
import { createToolDefinitions, createToolHandler } from "./server-tools.js";

// Get the directory of this file to locate INSTRUCTIONS.md
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read instructions from INSTRUCTIONS.md
function loadInstructions(): string {
  try {
    // Look for INSTRUCTIONS.md in the project root (one level up from build/)
    const instructionsPath = path.join(__dirname, "..", "INSTRUCTIONS.md");
    return fs.readFileSync(instructionsPath, "utf-8");
  } catch (error) {
    console.error("[FoundryMCP] Warning: Could not load INSTRUCTIONS.md:", error);
    return "";
  }
}

// Create the Foundry client instance
const foundryClient = new FoundryClient();


// Load instructions for MCP clients
const instructions = loadInstructions();

// Create server instance
const server = new Server(
  {
    name: "foundry-mcp",
    version: "0.1.0",
    instructions: instructions || undefined,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: createToolDefinitions() };
});

server.setRequestHandler(CallToolRequestSchema, createToolHandler(foundryClient));

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
