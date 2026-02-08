---
name: foundry-compendia
description: Reference for FoundryVTT compendium management and file operations. Use when creating/deleting compendium packs, adding/updating/deleting documents in compendia, uploading files, or browsing the FoundryVTT file system via FoundryMCP tools.
---

<!-- Sub-skill: Compendia and File Management -->

# Compendia & File Management

## Compendium Management

| Tool | Purpose |
|------|---------|
| `create_compendium` | Create a new Compendium pack |
| `delete_compendium` | Delete a Compendium pack |

### `create_compendium`

Create a new Compendium pack in the current world.

**Parameters:**
- `label` (required): Display name (e.g., `"My NPCs"`)
- `type` (required): Document type (`"Actor"`, `"Item"`, `"Scene"`, `"JournalEntry"`, `"Macro"`, `"Playlist"`, `"RollTable"`, `"Cards"`, `"Adventure"`)

**Example:**
```json
{
  "tool": "create_compendium",
  "label": "Custom Monsters",
  "type": "Actor"
}
```

**Response:**
```json
{
  "request": {
    "action": "create",
    "data": {
      "label": "Custom Monsters",
      "type": "Actor",
      "name": "custom-monsters",
      "id": "world.custom-monsters",
      ...
    }
  },
  "result": { ... }
}
```

### `delete_compendium`

Delete a Compendium pack. **This permanently removes all documents in the compendium.**

**Parameters:**
- `name` (required): The compendium name (not label). This is the slugified version (e.g., `"custom-monsters"` for label `"Custom Monsters"`).

**Example:**
```json
{
  "tool": "delete_compendium",
  "name": "custom-monsters"
}
```

## File Management

| Tool | Purpose |
|------|---------|
| `upload_file` | Upload a file to FoundryVTT (from URL or base64 data) |
| `browse_files` | Browse files and directories in FoundryVTT's file system |

### `upload_file`

Upload files to FoundryVTT. Exactly one of `url` or `image_data` must be provided (XOR logic).

**Parameters:**
- `target` (required): Directory path (e.g., `"worlds/myworld/assets/avatars"`)
- `filename` (required): Filename including extension (e.g., `"goblin.png"`)
- `url`: URL to download file from (cannot use with `image_data`)
- `image_data`: Base64-encoded file content (cannot use with `url`)

**Example - Upload from URL:**
```json
{
  "tool": "upload_file",
  "target": "worlds/myworld/assets/avatars",
  "filename": "hero-portrait.png",
  "url": "https://example.com/image.png"
}
```

**Example - Upload base64 data:**
```json
{
  "tool": "upload_file",
  "target": "worlds/myworld/assets/tokens",
  "filename": "custom-token.png",
  "image_data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
}
```

### `browse_files`

Browse the FoundryVTT file system to discover directories and files.

**Parameters:**
- `target` (required): Directory path to browse (e.g., `"worlds/myworld/assets"`)
- `type`: File type filter (default: `"image"`)
- `extensions`: Array of extensions to filter (default: image extensions)

**Example - Browse with defaults:**
```json
{
  "tool": "browse_files",
  "target": "worlds/myworld/assets"
}
```

**Response:**
```json
{
  "target": "worlds/myworld/assets",
  "private": false,
  "gridSize": null,
  "dirs": ["worlds/myworld/assets/avatars", "worlds/myworld/assets/scenes"],
  "privateDirs": [],
  "files": ["worlds/myworld/assets/logo.png"],
  "extensions": [".apng", ".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".tiff", ".webp"]
}
```

**Example - Browse for audio files:**
```json
{
  "tool": "browse_files",
  "target": "worlds/myworld/sounds",
  "type": "audio",
  "extensions": [".mp3", ".wav", ".ogg"]
}
```

## Working with Compendia

Compendia are persistent document collections that exist outside the world's active documents. They're useful for organizing content, sharing between worlds, and reducing memory usage.

### Compendium IDs

Compendium IDs follow the format `{package}.{name}`:
- **World compendia**: `world.my-compendium`
- **System compendia**: `dnd5e.monsters`
- **Module compendia**: `my-module.items`

### Adding Documents to a Compendium

Use `create_document` with the `pack` field in the operation to create documents directly in a compendium:

```json
{
  "tool": "create_document",
  "type": "Actor",
  "data": [
    {
      "name": "Goblin Warrior",
      "type": "npc",
      "system": { ... }
    }
  ],
  "pack": "world.custom-monsters"
}
```

The `pack` field specifies which compendium to add the document to. Without it, documents are created in the world.

### Updating Documents in a Compendium

Use `modify_document` with the `pack` field:

```json
{
  "tool": "modify_document",
  "type": "Actor",
  "_id": "abc123",
  "updates": [{ "name": "Goblin Champion" }],
  "pack": "world.custom-monsters"
}
```

### Deleting Documents from a Compendium

Use `delete_document` with the `pack` field:

```json
{
  "tool": "delete_document",
  "type": "Actor",
  "ids": ["abc123"],
  "pack": "world.custom-monsters"
}
```

### Key Points

- The `pack` field tells Foundry to operate on a compendium instead of the world
- Compendium documents don't appear in `get_actors`, `get_items`, etc. (those only show world documents)
- All documents in a compendium must be of the same type (specified when creating the compendium)
- World compendia use the `world.` prefix
- Deleting a compendium removes all its documents permanently
