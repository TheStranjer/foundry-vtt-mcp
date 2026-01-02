# FoundryMCP - AI Agent Instructions

You are connected to a FoundryVTT game world via the FoundryMCP server. This server provides direct WebSocket access to FoundryVTT, allowing you to read and modify game data.

## First Steps - Check for GM Instructions

**Before taking any action in the world, always check for a journal entry named "AGENTS", "AI Instructions", "Agent Instructions", or similar.** This journal may contain world-specific instructions from the GM about:

- What you are and are not allowed to do
- Specific rules or conventions for this world
- Character relationships and plot information you should know
- Naming conventions or organizational structures
- Any restrictions on modifying certain documents

To find this journal:
```
get_journals with where: {"name": "AGENTS"} or search journal names for instruction-related keywords
```

If such a document exists, read it carefully and follow any instructions it contains. The GM's instructions always take precedence over general guidelines.

## Available Document Types

You can read and manipulate these document collections:

| Collection | Description |
|------------|-------------|
| `actors` | Characters, NPCs, monsters, vehicles - any entity with a character sheet |
| `items` | Equipment, spells, features, abilities - things that can be owned |
| `scenes` | Maps and locations with tokens, walls, lighting |
| `journal` | Notes, handouts, lore, session logs - rich text documents |
| `folders` | Organizational folders for all document types |
| `users` | Player and GM accounts |
| `macros` | Executable scripts and commands |
| `cards` | Card decks and hands |
| `playlists` | Music and sound playlists |
| `tables` | Rollable tables for random generation |
| `combats` | Active combat encounters |
| `messages` | Chat log messages |
| `settings` | World and system configuration |

## Reading Documents

### List All Documents
Use `get_actors`, `get_items`, `get_journals`, etc. to retrieve all documents of a type.

**Important parameters:**
- `max_length`: Limit response size in bytes (documents removed until under limit)
- `requested_fields`: Only return specific fields (always includes `_id` and `name`)
- `where`: Filter by field values (AND logic)

Example - Get all NPCs:
```json
{"where": {"type": "npc"}}
```

Example - Get actors in a specific folder:
```json
{"where": {"folder": "folder_id_here"}}
```

### Get Single Document
Use `get_actor`, `get_item`, `get_journal`, etc. with:
- `id` or `_id`: The document's unique identifier
- `name`: The document's display name

**Always inspect a document before modifying it** to understand its structure.

## Document Schemas

**Document schemas vary significantly between game systems** (D&D 5e, Pathfinder 2e, Savage Worlds, etc.). The `system` field contains system-specific data with different structures.

Before creating or modifying documents:
1. Use `get_*` tools to retrieve an existing document of the same type
2. Examine its structure, especially the `system` field
3. Use that structure as a template for your modifications

## Modifying Documents

Use `modify_document` with:
- `type`: Document class name (case-sensitive): `Actor`, `Item`, `Scene`, `JournalEntry`, `Folder`, etc.
- `_id`: The document's unique identifier
- `updates`: Array of update objects with fields to modify

Example - Update an actor's HP:
```json
{
  "type": "Actor",
  "_id": "abc123",
  "updates": [{"system": {"attributes": {"hp": {"value": 25}}}}]
}
```

## Creating Documents

Use `create_document` with:
- `type`: Document class name
- `data`: Array of document data objects

Always provide at minimum a `name` field. Copy structure from existing documents.

## Deleting Documents

Use `delete_document` with:
- `type`: Document class name
- `ids`: Array of `_id` values to delete

**Deletions are permanent and cannot be undone. Use with extreme caution.**

## Multiple Foundry Instances

If multiple Foundry servers are configured:
- `show_credentials`: See available instances and which is active
- `choose_foundry_instance`: Switch to a different instance by `item_order` or `_id`

## Best Practices

1. **Read before writing**: Always inspect documents before modifying them
2. **Check for AGENTS journal**: Look for GM instructions before taking actions
3. **Respect permissions**: The server operates under the configured user's permissions
4. **Be conservative**: Make minimal changes to accomplish the task
5. **Preserve data**: When updating, only change the specific fields needed
6. **Handle large worlds**: Use `max_length` and `requested_fields` to limit response sizes
7. **Understand the system**: Different game systems have different data structures

## Common Tasks

### Finding Information
1. Check `get_journals` for lore, session notes, and GM guidance
2. Use `get_actors` with `where` filters to find specific characters
3. Use `get_folders` to understand the world's organization

### Character Management
1. Get the actor: `get_actor` with name or id
2. Inspect current values in the `system` field
3. Use `modify_document` with the correct field paths

### Creating Content
1. Find an existing document of the same type
2. Copy its structure as a template
3. Use `create_document` with appropriate data

### World Navigation
1. `get_world` for world metadata (title, system, version)
2. `get_folders` to understand organization
3. `get_scenes` for available maps/locations

## Error Handling

- "Not connected to FoundryVTT server": The connection was lost; try the operation again
- "Document not found": Check the ID/name spelling
- Permission errors: The configured user may not have access to that document

## Security Note

This server authenticates as a specific FoundryVTT user. Your actions are limited by that user's permissions and will appear in Foundry's audit trail under that user's name. Always act responsibly and within the bounds of what the GM has authorized.
