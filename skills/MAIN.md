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

### Document Retrieval (Collections)

| Tool | Returns |
|------|---------|
| `get_actors` | Characters, NPCs, creatures |
| `get_items` | Items, equipment, abilities |
| `get_scenes` | Maps and battle scenes |
| `get_journals` | Journal entries and notes |
| `get_folders` | Organizational folders |
| `get_users` | User accounts |
| `get_macros` | Automation macros |
| `get_cards` | Card decks |
| `get_playlists` | Audio playlists |
| `get_tables` | Rollable tables |
| `get_combats` | Combat encounters |
| `get_messages` | Chat messages |
| `get_settings` | World settings |

**Common Parameters:**
- `max_length` (int): Truncate response to N bytes
- `requested_fields` (string[]): Return only these fields (always includes `_id`, `name`)
- `where` (object): Filter by field values (AND logic)

### Document Retrieval (Single)

Same names without `s` suffix: `get_actor`, `get_item`, `get_scene`, etc.

**Parameters (one required):**
- `id` or `_id`: Document ID
- `name`: Document name
- `requested_fields`: Optional field filter

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

## Best Practices

1. **Inspect before modify**: Use `get_*` tools to understand document structure before changes
2. **Use `requested_fields`**: Limit response size for large collections
3. **Use `where` filtering**: Query efficiently instead of fetching all documents
4. **Preserve existing data**: When updating, only include fields you want to change
5. **Check `type` field**: Actors and Items have subtypes that affect available fields
6. **Handle embedded docs carefully**: Some require parent document updates, others have direct tools

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Unknown field | Inspect existing document to discover correct path |
| Update ignored | Check field path matches system schema |
| Permission denied | Verify MCP user has ownership of document |
| Large response | Use `max_length` and `requested_fields` |
| Document not found | Try both `id` and `name` parameters |
