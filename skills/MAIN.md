---
name: foundry-mcp
description: MCP server integration for FoundryVTT virtual tabletop. Use when working with FoundryVTT data via MCP tools including get_actors, get_items, get_scenes, get_journals, modify_document, create_document, delete_document, and other foundry-* prefixed tools. Covers document types (Actor, Item, Scene, JournalEntry, Token, ActiveEffect, etc.), CRUD operations, filtering with where clauses, and game-system-specific data structures.
---

# FoundryMCP Skill

MCP server for direct FoundryVTT WebSocket communication. No modules or headless browsers required.

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

### File Management

| Tool | Purpose |
|------|---------|
| `upload_file` | Upload a file to FoundryVTT (from URL or base64 data) |
| `browse_files` | Browse files and directories in FoundryVTT's file system |

#### `upload_file`

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

#### `browse_files`

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

## FoundryVTT Document Types

### Primary Documents (World-Level)

Stored in world database, accessible via `game.actors`, `game.items`, etc.

| Type | Description | Common Fields |
|------|-------------|---------------|
| **Actor** | Characters, NPCs, vehicles | `name`, `type`, `img`, `system`, `items`, `effects`, `prototypeToken` |
| **Item** | Equipment, features, spells | `name`, `type`, `img`, `system`, `effects` |
| **Scene** | Maps with tokens, lights, walls | `name`, `background`, `tokens`, `lights`, `walls`, `drawings` |
| **JournalEntry** | Notes, handouts | `name`, `pages[]` (each page has `type`, `text`, `src`) |
| **Folder** | Organization | `name`, `type`, `parent`, `sorting` |
| **RollTable** | Random tables | `name`, `results[]`, `formula` |
| **Playlist** | Audio | `name`, `sounds[]`, `playing` |
| **Macro** | Automation scripts | `name`, `type`, `command` |
| **Cards** | Card decks | `name`, `type`, `cards[]` |
| **Combat** | Active encounters | `scene`, `combatants[]`, `round`, `turn` |
| **ChatMessage** | Chat log | `content`, `speaker`, `whisper` |
| **User** | Accounts | `name`, `role`, `character` |

### Embedded Documents (Nested in Parents)

| Type | Parent | Purpose |
|------|--------|---------|
| **Token** | Scene | Actor representation on map |
| **AmbientLight** | Scene | Light sources |
| **AmbientSound** | Scene | Audio regions |
| **Tile** | Scene | Background images/props |
| **Drawing** | Scene | Freehand drawings |
| **Wall** | Scene | Vision/movement barriers |
| **Note** | Scene | Map pins linked to journals |
| **MeasuredTemplate** | Scene | Spell/ability templates |
| **ActiveEffect** | Actor/Item | Buffs, conditions, modifications |
| **Combatant** | Combat | Participant in encounter |
| **PlaylistSound** | Playlist | Individual audio track |
| **TableResult** | RollTable | Single table entry |
| **JournalEntryPage** | JournalEntry | Content page (text, image, PDF) |

### Key Relationships

```
Actor
├── items[] (owned Item documents)
├── effects[] (ActiveEffect documents)
└── prototypeToken (default Token settings)

Scene
├── tokens[] (Token documents, may link to Actors)
├── lights[] (AmbientLight)
├── sounds[] (AmbientSound)
├── walls[] (Wall)
├── tiles[] (Tile)
├── drawings[] (Drawing)
├── notes[] (Note → JournalEntry)
└── templates[] (MeasuredTemplate)

Token
├── actorId → Actor (linked tokens share actor data)
└── delta (unlinked tokens store ActorDelta with overrides)
```

## Working with Game Systems

Document schemas vary by game system. The `system` field contains system-specific data.

### Discovery Pattern

Always inspect existing documents before creating/modifying:

```json
// Step 1: Get an example document
{ "tool": "get_actor", "name": "Example NPC" }

// Step 2: Examine the system field structure
// Step 3: Create/modify using discovered schema
```

### Common System Fields

**D&D 5e (dnd5e):**
```
Actor.system.attributes.hp.value/max
Actor.system.abilities.str.value
Actor.system.skills.acr.value
Item.system.damage.parts[]
Item.system.quantity
```

**Pathfinder 2e (pf2e):**
```
Actor.system.attributes.hp.value/max
Actor.system.abilities.str.mod
Actor.system.skills.acrobatics.rank
```

**Werewolf: The Forsaken (wod5e):**
```
Actor.system.health.value/max
Actor.system.willpower.value/max
Actor.system.essence.value/max (for spirits)
Actor.system.attributes.*.value
```

## Common Operations

### Filter Actors by Folder
```json
{
  "tool": "get_actors",
  "where": { "folder": "folderId123" },
  "requested_fields": ["name", "type", "system.attributes.hp"]
}
```

### Create Token on Scene

Tokens are embedded in Scenes. Modify the scene to add tokens:
```json
{
  "tool": "modify_document",
  "type": "Scene",
  "_id": "sceneId",
  "updates": [{
    "tokens": [{
      "actorId": "actorId",
      "x": 500,
      "y": 500,
      "name": "Token Name"
    }]
  }]
}
```

### Update Embedded Document

For embedded documents, use dot notation or nested objects:
```json
{
  "tool": "modify_document",
  "type": "Actor",
  "_id": "actorId",
  "updates": [{
    "items": [{ "_id": "itemId", "system.quantity": 5 }]
  }]
}
```

### Bulk Operations

All manipulation tools accept arrays:
```json
{
  "tool": "create_document",
  "type": "Item",
  "data": [
    { "name": "Sword", "type": "weapon" },
    { "name": "Shield", "type": "armor" }
  ]
}
```

## Creating Drawings

Drawings are embedded in Scenes. Use raw WebSocket format via `modifyDocument`:

```json
["modifyDocument", {
  "type": "Drawing",
  "action": "create",
  "operation": {
    "parentUuid": "Scene.YOUR_SCENE_ID",
    "data": [{ /* drawing object */ }],
    "render": true
  }
}]
```

### Drawing Object Structure

All drawings share these defaults (override as needed):

| Field | Default | Notes |
|-------|---------|-------|
| `x`, `y` | required | Position in pixels |
| `author` | required | User ID |
| `fillType` | `0` | 0=none, 1=solid, 2=pattern |
| `fillColor` | `"#ffffff"` | |
| `fillAlpha` | `0.5` | |
| `strokeWidth` | `8` | |
| `strokeColor` | `"#ffffff"` | |
| `strokeAlpha` | `1` | |
| `sort` | `1` | Shapes with a higher value are displayed on top of shapes with a lower value |
| `bezierFactor` | `0.5` | Curve smoothing (0=sharp corners) |
| `hidden` | `false` | GM-only visibility |
| `locked` | `false` | Prevent editing |

### Shape Types

The `shape` object determines geometry:

**Rectangle** (`shape.type: "r"`):
```json
"shape": { "type": "r", "width": 200, "height": 100, "points": [] }
```

**Ellipse** (`shape.type: "e"`):
```json
"shape": { "type": "e", "width": 200, "height": 100, "points": [] }
```

**Polygon** (`shape.type: "p"`):
```json
"shape": { "type": "p", "width": 738, "height": 263, "points": [0,0, 737,50, 387,262, 0,0] }
```
Points are flattened `[x1,y1, x2,y2, ...]` relative to drawing origin. Close polygon by repeating first point.

**Freehand** (polygon with smoothing):
```json
"shape": { "type": "p", "points": [0,166, 54,182, 400,222, ...] }
// + "bezierFactor": 0.5 for curve smoothing
```

### Text Drawings

Text uses a rectangle shape with `text` field:

```json
{
  "shape": { "type": "r", "width": 300, "height": 100, "points": [] },
  "text": "Your text here",
  "fontFamily": "Signika",
  "fontSize": 48,
  "textColor": "#ffffff",
  "textAlpha": 1
}
```

### Updating Drawings

```json
["modifyDocument", {
  "type": "Drawing",
  "action": "update",
  "operation": {
    "parentUuid": "Scene.YOUR_SCENE_ID",
    "updates": [{ "_id": "DRAWING_ID", "text": "New text" }],
    "diff": true,
    "render": true
  }
}]
```

## Setting Images on Documents

Setting an image (avatar, background, texture, etc.) is typically a **two-step process**:
1. **Upload the image** using `upload_file` to get it into FoundryVTT's file system
2. **Assign the image** to the document using `modify_document`

**Important**: Before uploading, use `browse_files` to discover the directory structure and find (or identify where to create) the appropriate folder.

### Actor Images

Actors use the `img` field for their portrait/avatar:

```json
["modifyDocument", {
  "type": "Actor",
  "action": "update",
  "operation": {
    "parent": null,
    "pack": null,
    "updates": [{
      "img": "worlds/myworld/assets/avatars/character-portrait.jpg",
      "_id": "ACTOR_ID"
    }],
    "action": "update",
    "diff": true,
    "render": true
  }
}]
```

### Scene Images

Scenes have three different image properties, each set differently:

| Property | Format | Purpose |
|----------|--------|---------|
| `background` | Object with `src` | Main scene background image |
| `foreground` | String path | Overlay image above tokens |
| `thumb` | Base64 data URL | Thumbnail preview |

```json
["modifyDocument", {
  "type": "Scene",
  "action": "update",
  "operation": {
    "updates": [{
      "background": {
        "src": "worlds/myworld/assets/maps/dungeon.jpeg"
      },
      "foreground": "worlds/myworld/assets/maps/fog-overlay.png",
      "thumb": "data:image/webp;base64,UklGR...",
      "_id": "SCENE_ID"
    }],
    "action": "update",
    "diff": true,
    "render": true,
    "thumb": ["SCENE_ID"]
  }
}]
```

**Note**: The `thumb` array in the operation tells Foundry which scenes need thumbnail regeneration.

### Drawing Images (Textures)

Drawings use the `texture` field for image fills. To display the image without color tinting or transparency:

| Field | Required Value | Purpose |
|-------|---------------|---------|
| `fillType` | `2` | Pattern/texture fill (0=none, 1=solid, 2=pattern) |
| `fillColor` | `"#ffffff"` | White prevents color tinting |
| `fillAlpha` | `1` | Full opacity |
| `texture` | Path string | Image file path |

```json
["modifyDocument", {
  "type": "Drawing",
  "action": "update",
  "operation": {
    "pack": null,
    "updates": [{
      "fillType": 2,
      "fillColor": "#ffffff",
      "fillAlpha": 1,
      "texture": "worlds/myworld/assets/textures/stone-floor.png",
      "_id": "DRAWING_ID"
    }],
    "action": "update",
    "diff": true,
    "render": true,
    "parentUuid": "Scene.SCENE_ID"
  }
}]
```

**Warning**: If you omit any of these settings:
- Without `fillType: 2`: The texture won't display at all
- Without `fillColor: "#ffffff"`: The image will have a color tint
- Without `fillAlpha: 1`: The image will be semi-transparent

### Typical Workflow

1. **Browse to find the right directory**:
   ```json
   { "tool": "browse_files", "target": "worlds/myworld/assets" }
   ```

2. **Upload the image**:
   ```json
   {
     "tool": "upload_file",
     "target": "worlds/myworld/assets/avatars",
     "filename": "new-character.png",
     "url": "https://example.com/image.png"
   }
   ```

3. **Assign to the document** using the appropriate field for the document type.

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