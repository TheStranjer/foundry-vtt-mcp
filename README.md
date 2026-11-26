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

## Compatibility

Works with **FoundryVTT v13 and v14**. The server detects the Foundry generation automatically (via `GET /api/status`) and uses the correct session-binding method for that version — v14 changed how the WebSocket session is authenticated, and both are handled transparently with no configuration needed.

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

## Skills

The `./skills` directory contains LLM skills for this project. Currently the only skill there is `MAIN.skill`, and all users should install it because it includes the FoundryVTT-specific guidance and workflows. We welcome PRs that add skills for specific game systems, FoundryVTT modules, or other targeted use cases.

## Configuration

### Credentials File

Create a file at `config/foundry_credentials.json`:

```json
[
  {
    "_id": "my-campaign",
    "hostname": "your-foundry-server.com",
    "userid": "your-user-id",
    "password": "your-password"
  },
  {
    "_id": "test-world",
    "hostname": "test.foundry-server.com",
    "username": "Gamemaster",
    "password": "test-password"
  }
]
```

**Fields:**
- `_id` - A user-defined identifier for this credential entry (used to switch between instances)
- `hostname` - The domain/IP of your FoundryVTT server
- `userid` - Your Foundry user document ID (find by inspecting Users in Foundry admin panel)
- `username` - Your Foundry user name
  - Give `userid`, `username`, or both. If only one is given, the other is looked up from the world's user list before logging in. If both are given, they are used as-is. Name lookup is exact first, then case-insensitive.
- `password` - Your Foundry user password
- `allow_insecure_tls` - Optional. Set to `true` only for a trusted Foundry server with a self-signed certificate. Defaults to `false`.

Disabling TLS verification makes the connection vulnerable to interception. Prefer a trusted certificate when one is available.

You can configure multiple Foundry instances and switch between them at runtime using the `choose_foundry_instance` tool.

### Environment Variable

Override the default credentials path by setting:

```bash
export FOUNDRY_CREDENTIALS=/path/to/credentials.json
```

### WebSocket Logging

Set `WEBSOCKETS_DIRECTORY` to log every WebSocket frame, in full, to `ws_session_<id>.log` files in that directory (one per process start). Logging is off when it is unset. Two optional variables cap the log:

- `WEBSOCKETS_MAX_FILES` - Maximum number of `ws_session_*.log` files kept in the directory. Defaults to `1000`. Whenever a new file is opened, the oldest files beyond the limit are deleted (ordered by the timestamp in the file name, then by modification time). Other files in the directory are never touched, and neither is the file being written.
- `WEBSOCKETS_MAX_FILE_BYTES` - Maximum size of one log file. Defaults to `10485760` (10 MB). When the next entry would push the file past the limit, the session continues in `ws_session_<id>_part2.log`, `_part3`, and so on, each with a short header. Entries are never split: a single entry larger than the limit gets a part file to itself. Part files count toward `WEBSOCKETS_MAX_FILES`.

A missing, non-numeric or non-positive value falls back to its default, with a warning on stderr.

```bash
export WEBSOCKETS_DIRECTORY=/path/to/ws-logs
export WEBSOCKETS_MAX_FILES=500
export WEBSOCKETS_MAX_FILE_BYTES=5242880
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

### Document Retrieval

Two tools read every collection. `collection` is one of `actors`, `items`, `folders`, `users`, `scenes`, `journal`, `macros`, `cards`, `playlists`, `tables`, `combats`, `messages`, `settings`.

#### `get_documents`

Lists the documents of a collection from the connected world, one page at a time.

**Response:** `{ total, offset, returned, next_offset, documents }`. `total` is the count after the `where` filter; `next_offset` is the `offset` of the next page, or `null` when nothing is left. When `total` is 0 and `where` is set, the response also has `where_hint`: for each `where` key, the sorted distinct values that exist in the collection or pack (at most 20, then `"+N more"`; `_id` shows `"unique per document"`).

**Parameters:**
- `collection` (string, required): The collection to list.
- `limit` (integer, optional): Page size. Defaults to 100, maximum 1000.
- `offset` (integer, optional): Number of documents to skip. Defaults to 0. Pass `next_offset` from the previous response to read the next page.
- `max_length` (integer, optional): Byte budget for the page's documents. Defaults to 200000; `0` means no limit. The page is filled in order and stops at the first document that does not fit (`next_offset` points at it). If the page's first document alone exceeds the budget, `documents` is empty and `oversized` (`{ _id, name, bytes }`) names it, with a hint to fetch it using `requested_fields` or `get_document`.
- `requested_fields` (string[], optional): Specific fields to include. Supports dot-notation for nested fields (e.g. `system.attributes.hp`). Always includes `_id` and `name`. If omitted or empty, only summary fields are returned: `_id`, `name`, `type`, `folder` by default; `_id`, `timestamp`, `speaker.alias`, `author` for messages; `_id`, `key` for settings; `_id`, `name`, `role` for users. Use `["*"]` for full documents. See [Selecting nested fields](#selecting-nested-fields) below.
- `sort` (string, optional, `messages` only): `"newest"` (default) or `"oldest"`, ordered by `timestamp`.
- `where` (object, optional): Filter documents by field values. See [Filtering with `where`](#filtering-with-where) below.
- `pack` (string, optional): Read from a compendium pack instead of the world (e.g. `my-module.items`). Only available for `actors`, `items`, `scenes`, `journal`, `macros`, `cards`, `playlists` and `tables` (other collections are rejected), and the pack must hold that document type. Use [`get_compendiums`](#get_compendiums) to find pack IDs. `limit`, `offset`, `max_length`, `requested_fields` and `where` work the same way on compendium results.

#### `get_document`

Retrieves a single document of a collection by ID or name.

**Parameters:**
- `collection` (string, required): The collection to read.
- `id` (string): Document ID. At least one of `id`, `_id` and `name` is required.
- `_id` (string): Document ID (alias)
- `name` (string): Document name
- `requested_fields` (string[], optional): Specific fields to include. Supports dot-notation for nested fields (e.g. `system.attributes.hp`). Always includes `_id` and `name`. If omitted, all fields are returned. See [Selecting nested fields](#selecting-nested-fields) below.
- `pack` (string, optional): Read the document from a compendium pack instead of the world. Same collections and rules as `get_documents`.

### World Metadata

#### `get_world`

Get world metadata from FoundryVTT (title, system, version, etc.), excluding document collections like actors or items. Use `get_documents` for collection data.

#### `get_compendiums`

List the compendium packs in the world (`id`, `label`, document `type`, owning package). Pass a pack's `id` as the `pack` parameter of `get_documents` or `get_document` to read its documents.

**Parameters:**
- `type` (string, optional): Only list packs holding this document type (e.g. `Item`, `Actor`, `JournalEntry`). Case-insensitive.

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

### Instance Management

#### `show_credentials`

Show all configured Foundry credentials without revealing passwords. Returns the `_id`, `hostname`, `userid`, `item_order` (zero-based index), and `currently_active` status for each credential entry.

**Example response:**
```json
[
  {
    "_id": "my-campaign",
    "hostname": "your-foundry-server.com",
    "userid": "abc123",
    "item_order": 0,
    "currently_active": true
  },
  {
    "_id": "test-world",
    "hostname": "test.foundry-server.com",
    "userid": "def456",
    "item_order": 1,
    "currently_active": false
  }
]
```

#### `choose_foundry_instance`

Switch to a different Foundry instance. Disconnects from the current instance (if any) and connects to the specified one.

**Parameters (at least one required):**
- `item_order` (integer): Zero-based index of the credential in the array
- `_id` (string): The user-defined identifier for the credential entry

**Example - Switch by item_order:**
```json
{
  "item_order": 1
}
```

**Example - Switch by _id:**
```json
{
  "_id": "test-world"
}
```

## Tips

### Understanding Document Structure

Document schemas vary significantly between game systems (D&D 5e, Pathfinder, etc.). Use `get_document` to inspect existing documents before attempting to modify or create new ones.

### Filtering with `where`

`get_documents` supports the `where` parameter for filtering results. The `where` parameter accepts an object with key-value pairs that documents must match.

**How it works:**
- Each key-value pair in `where` is a condition that must be satisfied
- All conditions use **AND logic** - a document must match ALL conditions to be included
- Values are compared using strict equality

**Example - Get actors in a specific folder:**
```json
{
  "where": {
    "folder": "abcd1234"
  }
}
```

**Example - Get NPC actors in a specific folder:**
```json
{
  "where": {
    "folder": "abcd1234",
    "type": "npc"
  }
}
```
This returns only actors where `folder` equals `"abcd1234"` AND `type` equals `"npc"`.

**Example - Get items of a specific type:**
```json
{
  "where": {
    "type": "weapon"
  }
}
```

**Example - Combine with other parameters:**
```json
{
  "where": {
    "folder": "abcd1234"
  },
  "requested_fields": ["name", "type", "system.quantity"],
  "max_length": 5000
}
```

**Common filter fields:**
- `folder` - Filter by folder ID
- `type` - Filter by document subtype (e.g., "npc", "character" for actors; "weapon", "armor" for items)
- `ownership` - Filter by ownership settings
- Any top-level field on the document can be used as a filter key

### Selecting nested fields

`requested_fields` accepts dot-notation paths, so you can pull a single nested value instead of a whole subtree. Requesting `system` on a character-heavy game system can return tens of kilobytes; requesting `system.attributes.hp` returns just what you asked for.

```json
{
  "name": "Bezaliel",
  "requested_fields": ["system.age", "system.attributes_physical.strength", "img"]
}
```

```json
{
  "system": {
    "age": 52,
    "attributes_physical": { "strength": { "value": 1, "final": 1 } }
  },
  "img": "worlds/my-world/assets/bezaliel.jpg",
  "_id": "jJ10LA0URnIaLu7g",
  "name": "Bezaliel"
}
```

Specifics worth knowing:

- **The result keeps its nesting.** A request for `system.age` comes back as `{"system": {"age": 52}}`, not as a flat `"system.age"` key, so the shape matches the document you'd get from an unfiltered request.
- **Paths sharing a parent merge.** `["system.age", "system.sex"]` returns both under a single `system` object.
- **A broader path wins over a narrower one.** Requesting both `system.attributes_physical` and `system.attributes_physical.strength` returns the full `attributes_physical` object.
- **Literal keys take precedence.** If a document genuinely has a key named `"system.age"`, that value is returned as-is and the path is not traversed.
- **Missing paths are skipped silently.** `system.nonexistent.path` is omitted from the response rather than erroring, and it does not affect the other requested fields.
- **Arrays are opaque.** You can request an array (`system.progress`), but you cannot index into one — `system.progress.0.name` resolves to nothing.
- **`where` does not support dot-notation.** It matches top-level fields only, so `requested_fields` and `where` follow different rules in the same request.

### Response Size Management

List tools never return a whole large collection at once. Each response is one page (100 documents and 200000 bytes at most by default) of summary fields, and `next_offset` tells you where to continue:

```json
{
  "limit": 50,
  "offset": 100,
  "max_length": 10000,
  "requested_fields": ["name", "type", "system.attributes.hp"]
}
```

`max_length` is a byte budget for the page's documents. The page is filled in order and ends at the first document that does not fit, so a smaller budget gives shorter pages, never missing documents: keep following `next_offset`. If the first document alone is over the budget, you get `documents: []` plus `oversized` (`_id`, `name`, `bytes`) and `next_offset` pointing at that document; fetch it with `requested_fields` or `get_document`, then continue from `offset + 1`. `max_length: 0` removes the budget. Narrowing `requested_fields` shrinks every document, so the two combine well.

## How It Works

1. **Version detection**: Queries `/api/status` to detect the Foundry generation (v13 vs v14), which determines how the session binds to the socket
2. **Authentication**: Authenticates with FoundryVTT using the same HTTP POST flow as the official client
3. **WebSocket Connection**: Establishes a persistent Socket.IO/Engine.IO connection, binding the session the way that version expects (query parameter on v13, session cookie on v14), then waits for Foundry to confirm the bound session before issuing requests
4. **Message Exchange**: Exchanges JSON messages using Foundry's native protocol, replying to Engine.IO keepalive pings to hold the connection open
5. **Automatic Reconnection**: Handles connection drops and re-authenticates as needed

## License

MIT
