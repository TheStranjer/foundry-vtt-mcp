# FoundryMCP

A lightweight MCP (Model Context Protocol) server for FoundryVTT that communicates directly via WebSockets.

## Why This Server?

Unlike other FoundryVTT MCP servers that require:
- Installing a custom module on your Foundry server
- Running a headless browser

This server **natively authenticates** with FoundryVTT and exchanges WebSocket messages directly using the same protocol as the official Foundry client. This makes it:

- **Lightweight** - No browser overhead, just direct WebSocket communication
- **Zero server-side setup** - No modules to install on your Foundry instance
- **Secure** - Uses the same authentication flow as the official client

## Security Recommendation

**Create a dedicated FoundryVTT user for each game world you want the MCP server to access.** Grant that user only the permissions you want the MCP server to have. This provides:

- Fine-grained access control
- Clear audit trail of MCP actions
- Easy revocation if needed
- Isolation between different games/worlds

## Installation

```bash
npm install
npm run build
```

## Configuration

### Credentials File

Create a file at `config/foundry_credentials.json`:

```json
[
  {
    "hostname": "your-foundry-server.com",
    "userid": "your-user-id",
    "password": "your-password"
  }
]
```

You can find your `userid` by inspecting Users in Foundry - it's the document `_id` for your user.

### Environment Variable

Override the default credentials path by setting:

```bash
export FOUNDRY_CREDENTIALS=/path/to/credentials.json
```

## Usage with MCP Clients

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "foundry": {
      "command": "node",
      "args": ["/path/to/FoundryMCP/build/server.js"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "foundry": {
      "command": "foundry-mcp"
    }
  }
}
```

## Available Tools

### Document Retrieval (List)

These tools retrieve all documents of a given type from the connected world.

| Tool | Description |
|------|-------------|
| `get_actors` | Get all actors (characters, NPCs, etc.) |
| `get_items` | Get all items |
| `get_folders` | Get all folders |
| `get_users` | Get all users |
| `get_scenes` | Get all scenes |
| `get_journals` | Get all journal entries |

**Parameters:**
- `max_length` (integer, optional): Maximum response size in bytes. Documents are removed from the response until it fits within this limit.
- `requested_fields` (string[], optional): Specific fields to include. Always includes `_id` and `name`. If omitted, all fields are returned.

### Document Retrieval (Single)

These tools retrieve a single document by ID or name.

| Tool | Description |
|------|-------------|
| `get_actor` | Get a specific actor |
| `get_item` | Get a specific item |
| `get_folder` | Get a specific folder |
| `get_user` | Get a specific user |
| `get_scene` | Get a specific scene |
| `get_journal` | Get a specific journal entry |

**Parameters (at least one required):**
- `id` (string): Document ID
- `_id` (string): Document ID (alias)
- `name` (string): Document name
- `requested_fields` (string[], optional): Specific fields to include.

### Document Manipulation

#### `modify_document`

Modify an existing document in FoundryVTT.

**Parameters:**
- `type` (string, required): Document type. Valid types:
  - Core: `Actor`, `Item`, `Scene`, `JournalEntry`, `Folder`, `User`, `Playlist`, `Macro`, `RollTable`, `Cards`, `ChatMessage`
  - Scene objects: `Combat`, `Combatant`, `ActiveEffect`, `Drawing`, `MeasuredTemplate`, `Note`, `Tile`, `Token`, `Wall`, `AmbientLight`, `AmbientSound`
- `_id` (string, required): The document's unique identifier
- `updates` (object[], required): Array of update objects with fields to modify

**Example - Update actor HP:**
```json
{
  "type": "Actor",
  "_id": "abc123",
  "updates": [{ "system": { "attributes": { "hp": { "value": 25 } } } }]
}
```

#### `create_document`

Create new documents in FoundryVTT.

**Parameters:**
- `type` (string, required): Document type to create
- `data` (object[], required): Array of document data objects

**Example - Create an item:**
```json
{
  "type": "Item",
  "data": [{ "name": "Healing Potion", "type": "consumable" }]
}
```

#### `delete_document`

Permanently delete documents from FoundryVTT. **This cannot be undone.**

**Parameters:**
- `type` (string, required): Document type to delete
- `ids` (string[], required): Array of document `_id` values to delete

**Example:**
```json
{
  "type": "Item",
  "ids": ["vlcf6AI5FaE9qjgJ", "abc123def456"]
}
```

## Tips

### Understanding Document Structure

Document schemas vary significantly between game systems (D&D 5e, Pathfinder, etc.). Use the `get_*` tools to inspect existing documents before attempting to modify or create new ones.

### Response Size Management

When working with large worlds, use `max_length` and `requested_fields` to limit response sizes:

```json
{
  "max_length": 10000,
  "requested_fields": ["name", "type", "system.attributes.hp"]
}
```

## How It Works

1. **Authentication**: The server authenticates with FoundryVTT using the same HTTP POST flow as the official client
2. **WebSocket Connection**: Establishes a persistent WebSocket connection using Socket.IO protocol
3. **Message Exchange**: Sends and receives JSON messages using Foundry's native protocol
4. **Automatic Reconnection**: Handles connection drops and re-authenticates as needed

## License

MIT
