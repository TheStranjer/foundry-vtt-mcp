---
name: foundry-mcp
description: MCP server integration for FoundryVTT virtual tabletop. Use when working with FoundryVTT data via MCP tools. This is the main skill file — see the Related Skills table below to load additional context for scenes, compendia, game systems, and more.
---

# FoundryMCP Skill

MCP server for direct FoundryVTT WebSocket communication. No modules or headless browsers required.

## Related Skills

| If the task involves... | See skill |
|------------------------|-----------|
| Scenes, maps, tokens, walls, lights, drawings, visual canvas elements | `skills/scenes-and-canvas.md` |
| Compendia, file uploads, browsing assets | `skills/compendia-and-files.md` |
| Character sheets, system-specific data, document types & relationships | `skills/game-systems.md` |

## MCP Tools Reference

### Document Retrieval

Two tools read every collection; `collection` selects it.

| `collection` | Returns |
|--------------|---------|
| `actors` | Characters, NPCs, creatures |
| `items` | Items, equipment, abilities |
| `scenes` | Maps and battle scenes |
| `journal` | Journal entries and notes |
| `folders` | Organizational folders |
| `users` | User accounts |
| `macros` | Automation macros |
| `cards` | Card decks |
| `playlists` | Audio playlists |
| `tables` | Rollable tables |
| `combats` | Combat encounters |
| `messages` | Chat messages |
| `settings` | World settings |

#### `get_documents`

Returns `{ total, offset, returned, next_offset, documents }` (`next_offset` is `null` on the last page).

- `collection` (required): One of the collections above
- `limit` (int): Page size (default 100, max 1000)
- `offset` (int): Documents to skip (default 0); pass `next_offset` for the next page
- `max_length` (int): Byte budget for the page's documents (default 200000; `0` = no limit). If the first document alone exceeds it, `documents` is empty and `oversized` `{ _id, name, bytes }` names it; fetch it with `requested_fields` or `get_document`
- `requested_fields` (string[]): Fields to return (always includes `_id`, `name`). Omitted/empty returns summary fields only (`_id`, `name`, `type`, `folder`, `folder_name`; messages `timestamp` (ISO 8601), `speaker.alias`, `author` (user name), `author_id`, `preview`; settings `key`; users `role`). Explicit fields return raw stored values. `["*"]` returns full documents
- `where` (object): Filter by field values (AND logic)
- `sort` (`messages` only): `"newest"` (default) or `"oldest"`, by `timestamp`
- `pack` (string): Compendium pack `id`; only for `actors`, `items`, `scenes`, `journal`, `macros`, `cards`, `playlists`, `tables` (rejected for the rest)

#### `get_document`

**Parameters:**
- `collection` (required): One of the collections above
- `id` or `_id`: Document ID
- `name`: Document name (one of `id`, `_id`, `name` is required)
- `requested_fields`: Optional field filter (without it, the full document is returned)
- `pack` (string): Compendium pack `id`, same collections as in `get_documents`

### Document Manipulation

#### `create_document`
```json
{
  "type": "Actor",
  "data": [{ "name": "Goblin", "type": "npc" }]
}
```

#### `modify_document`
```json
{
  "type": "Actor",
  "_id": "abc123",
  "updates": [{ "system.attributes.hp.value": 25 }]
}
```

#### `delete_document`
```json
{
  "type": "Item",
  "ids": ["id1", "id2"]
}
```

**Valid `type` values:**
- Primary: `Actor`, `Item`, `Scene`, `JournalEntry`, `Folder`, `User`, `Playlist`, `Macro`, `RollTable`, `Cards`, `ChatMessage`
- Embedded: `Combat`, `Combatant`, `ActiveEffect`, `Drawing`, `MeasuredTemplate`, `Note`, `Tile`, `Token`, `Wall`, `AmbientLight`, `AmbientSound`

### Instance Management

| Tool | Purpose |
|------|---------|
| `show_credentials` | List configured Foundry instances |
| `choose_foundry_instance` | Switch active instance by `_id` or `item_order` |
| `get_world` | Get world metadata (title, system, version) |
| `get_compendiums` | List compendium packs; pass a pack `id` as `pack` to `get_documents`/`get_document` to read from it |

## Best Practices

1. **Inspect before modify**: Use `get_document` to understand document structure before changes
2. **Use `requested_fields`**: List tools return summary fields by default; request the fields you need, or `["*"]` for full documents
3. **Use `where` filtering**: Query efficiently instead of fetching all documents
4. **Preserve existing data**: When updating, only include fields you want to change
5. **Check `type` field**: Actors and Items have subtypes that affect available fields
6. **Handle embedded docs carefully**: Some require parent document updates, others have direct tools
7. **Use nested objects for embedded item updates**: When updating items via an Actor's `items[]` array, always use nested object syntax (`{"system": {"label": "X"}}`) — dot notation (`"system.label": "X"`) is silently ignored

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Unknown field | Inspect existing document to discover correct path |
| Update ignored | Check field path matches system schema |
| Permission denied | Verify MCP user has ownership of document |
| Large response or empty `documents` with `oversized` | Page with `limit`/`offset`, narrow `requested_fields`, or fetch the document with `get_document` |
| Document not found | Try both `id` and `name` parameters |
| Embedded item update silently ignored | Use nested object syntax in `items[]`, not dot notation. `{"system": {"value": 3}}` works; `{"system.value": 3}` does not. |