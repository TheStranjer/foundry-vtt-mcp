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

### Compendium Management

| Tool | Purpose |
|------|---------|
| `create_compendium` | Create a new Compendium pack |
| `delete_compendium` | Delete a Compendium pack |

#### `create_compendium`

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

#### `delete_compendium`

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

## Scene Document Fields (Detailed)

### Top-Level Scene Properties

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Scene display name |
| `active` | boolean | Whether this scene is the currently active scene |
| `navigation` | boolean | Whether the scene appears in the top navigation bar |
| `navName` | string | Alternate name displayed in the navigation bar (if blank, uses `name`) |
| `navOrder` | number | Sort order in the navigation bar (lower = further left) |
| `width` | number | Scene canvas width in pixels |
| `height` | number | Scene canvas height in pixels |
| `padding` | number | Fractional padding around the scene (e.g., `0.25` = 25% padding on all sides). Expands the playable area beyond the background image |
| `backgroundColor` | string | Hex color shown behind the background image (e.g., `"#999999"`) |
| `thumb` | string | File path or base64 data URL for the scene thumbnail preview |
| `weather` | string | Weather effect ID applied to the scene (empty string = none) |
| `folder` | string\|null | Folder ID for organizational grouping |
| `ownership` | object | Permission mapping (`{ "default": 0 }` where 0=none, 1=limited, 2=observer, 3=owner) |
| `flags` | object | Key/value store for module-specific data |
| `_stats` | object | Metadata: `coreVersion`, `systemId`, `systemVersion`, `createdTime`, `modifiedTime`, `lastModifiedBy` |

### Scene Background (`background`)

The `background` field is a **TextureData** object controlling the main scene image:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `src` | string | `""` | Image file path or URL |
| `anchorX` | number | `0` | Horizontal anchor point (0=left, 0.5=center, 1=right) |
| `anchorY` | number | `0` | Vertical anchor point (0=top, 0.5=center, 1=bottom) |
| `offsetX` | number | `0` | Horizontal pixel offset |
| `offsetY` | number | `0` | Vertical pixel offset |
| `fit` | string | `"fill"` | How image fits: `"fill"` (stretch to fill), `"contain"` (fit within bounds), `"cover"` (fill and crop) |
| `scaleX` | number | `1` | Horizontal scale multiplier |
| `scaleY` | number | `1` | Vertical scale multiplier |
| `rotation` | number | `0` | Rotation in degrees |
| `tint` | string | `"#ffffff"` | Color tint applied to the image (white = no tint) |
| `alphaThreshold` | number | `0` | Alpha threshold for mouse interaction (0 = entire area is interactive) |

### Scene Foreground

| Field | Type | Description |
|-------|------|-------------|
| `foreground` | string\|null | File path for a foreground overlay image rendered above tokens |
| `foregroundElevation` | number\|null | Elevation level at which the foreground is rendered (tokens above this elevation appear over the foreground) |

### Initial View (`initial`)

Controls the camera position when a player first views the scene:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `x` | number\|null | `null` | Initial X camera position (null = auto-center) |
| `y` | number\|null | `null` | Initial Y camera position (null = auto-center) |
| `scale` | number\|null | `null` | Initial zoom level (null = fit to screen) |

### Grid Configuration (`grid`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | number | `1` | Grid type (see Grid Types below) |
| `size` | number | `100` | Grid cell size in pixels |
| `style` | string | `"solidLines"` | Grid visual style (e.g., `"solidLines"`, `"dottedLines"`) |
| `thickness` | number | `1` | Grid line thickness in pixels |
| `color` | string | `"#000000"` | Grid line color |
| `alpha` | number | `0.2` | Grid line opacity (0=invisible, 1=fully visible) |
| `distance` | number | varies | Distance each grid cell represents in game units |
| `units` | string | varies | Unit label (e.g., `"ft"`, `"m"`, `"sq"`) |

**Grid Types** (`grid.type`):

| Value | Constant | Description |
|-------|----------|-------------|
| `0` | GRIDLESS | No grid; free-form point-to-point measurement |
| `1` | SQUARE | Square grid with uniform cells |
| `2` | HEXODDR | Flat-topped hex grid, odd rows offset |
| `3` | HEXEVENR | Flat-topped hex grid, even rows offset |
| `4` | HEXODDQ | Pointy-topped hex grid, odd columns offset |
| `5` | HEXEVENQ | Pointy-topped hex grid, even columns offset |

### Token Vision & Fog of War

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tokenVision` | boolean | `true` | When enabled, tokens with vision reveal the scene from their perspective. When disabled, the entire scene is visible |

### Fog of War (`fog`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `exploration` | boolean | `true` | Enable fog of war exploration (previously seen areas remain partially visible) |
| `overlay` | string\|null | `null` | Custom fog overlay image path |
| `colors.explored` | string\|null | `null` | Color for explored fog areas (null = default) |
| `colors.unexplored` | string\|null | `null` | Color for unexplored fog areas (null = default) |

### Environment & Lighting (`environment`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `darknessLevel` | number | `0` | Scene darkness (0=bright daylight, 1=pitch black) |
| `darknessLock` | boolean | `false` | Prevent darkness level from changing via time-of-day |
| `cycle` | boolean | `true` | Enable day/night cycle transitions |

**Global Light** (`environment.globalLight`):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Whether the scene has ambient global illumination |
| `alpha` | number | `0.5` | Global light intensity |
| `bright` | boolean | `false` | Whether global light counts as bright light |
| `color` | string\|null | `null` | Global light color (null = white) |
| `coloration` | number | `1` | Coloration technique mode |
| `luminosity` | number | `0` | Luminosity adjustment (-1 to 1) |
| `saturation` | number | `0` | Saturation adjustment (-1 to 1) |
| `contrast` | number | `0` | Contrast adjustment (-1 to 1) |
| `shadows` | number | `0` | Shadow intensity (0 to 1) |
| `darkness.min` | number | `0` | Minimum darkness level for global light to be active |
| `darkness.max` | number | `1` | Maximum darkness level for global light to be active |

**Base Environment** (`environment.base`) — adjustments when the scene is bright:

| Field | Type | Description |
|-------|------|-------------|
| `hue` | number | Color hue offset (0 to 1) |
| `intensity` | number | Light intensity adjustment |
| `luminosity` | number | Luminosity adjustment |
| `saturation` | number | Saturation adjustment |
| `shadows` | number | Shadow intensity |

**Dark Environment** (`environment.dark`) — adjustments when the scene is dark:

Same fields as `environment.base`. Applied proportionally to `darknessLevel`.

### Audio & Journal References

| Field | Type | Description |
|-------|------|-------------|
| `playlist` | string\|null | ID of a Playlist document to auto-play when this scene is active |
| `playlistSound` | string\|null | ID of a specific sound within the playlist |
| `journal` | string\|null | ID of a JournalEntry linked to this scene |
| `journalEntryPage` | string\|null | ID of a specific page within the journal |

---

## Token Document Fields (Detailed)

### Core Token Properties

| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | Unique token document ID |
| `name` | string | Token name (usually matches actor name) |
| `x` | number | X position in pixels (top-left corner of token) |
| `y` | number | Y position in pixels (top-left corner of token) |
| `elevation` | number | Vertical elevation in game units (for 3D layering/sorting) |
| `width` | number | Token width in grid units (e.g., `1` = one grid cell, `0.5` = half cell) |
| `height` | number | Token height in grid units |
| `rotation` | number | Rotation in degrees (0–360) |
| `alpha` | number | Token opacity (0=invisible, 1=fully opaque) |
| `sort` | number | Z-order sort index (higher = rendered on top) |
| `hidden` | boolean | If `true`, only visible to GM |
| `locked` | boolean | If `true`, token cannot be moved or edited |
| `lockRotation` | boolean | If `true`, prevents rotation |

### Token Texture (`texture`)

Same **TextureData** structure as `background` (see Scene Background above):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `src` | string | | Token image path or URL |
| `anchorX` | number | `0.5` | Horizontal anchor (0.5 = centered) |
| `anchorY` | number | `0.5` | Vertical anchor (0.5 = centered) |
| `offsetX` | number | `0` | Horizontal pixel offset |
| `offsetY` | number | `0` | Vertical pixel offset |
| `fit` | string | `"contain"` | Image fit mode |
| `scaleX` | number | `1` | Horizontal scale |
| `scaleY` | number | `1` | Vertical scale |
| `rotation` | number | `0` | Image rotation (independent of token rotation) |
| `tint` | string | `"#ffffff"` | Color tint (white = no tint) |
| `alphaThreshold` | number | `0.75` | Alpha threshold for click detection |

### Display Settings

**`displayName`** — When the token nameplate is visible:

| Value | Constant | Description |
|-------|----------|-------------|
| `0` | NONE | Never displayed |
| `10` | CONTROL | Only when controlling the token |
| `20` | OWNER_HOVER | When the owner hovers over it |
| `30` | HOVER | When anyone hovers over it |
| `40` | OWNER | Always visible to the owner |
| `50` | ALWAYS | Always visible to everyone |

**`displayBars`** — When resource bars (HP, etc.) are visible. Same values as `displayName`.

**`disposition`** — Token attitude, controls border color:

| Value | Constant | Border Color | Description |
|-------|----------|-------------|-------------|
| `-2` | SECRET | None | Hidden disposition; no border shown to players |
| `-1` | HOSTILE | Red | Enemy or hostile creature |
| `0` | NEUTRAL | Yellow | Neutral creature |
| `1` | FRIENDLY | Teal | Allied or friendly creature |

### Actor Link

| Field | Type | Description |
|-------|------|-------------|
| `actorId` | string | ID of the Actor this token represents |
| `actorLink` | boolean | If `true`, token shares data with the world Actor (changes sync both ways). If `false`, token is an independent copy with its own stats |
| `delta` | object | For unlinked tokens (`actorLink: false`), stores overrides to actor data. Contains `_id`, `system`, `items`, `effects`, `flags`, and optionally `name`, `type`, `img` |

**When to use linked vs unlinked:**
- **Linked** (`actorLink: true`): For unique characters (PCs, named NPCs). HP changes on the token update the actor.
- **Unlinked** (`actorLink: false`): For generic/duplicated tokens (guards, goblins). Each token instance has independent HP/stats via `delta`.

### Token Shape

| Field | Type | Description |
|-------|------|-------------|
| `shape` | number | The geometric footprint of the token. Affects how it occupies grid spaces. Common value: `4` |

### Resource Bars (`bar1`, `bar2`)

| Field | Type | Description |
|-------|------|-------------|
| `attribute` | string\|null | Dot-notation path to the actor data field to display (e.g., `"system.attributes.hp"` for D&D 5e). `null` = bar disabled |

### Token Light Emission (`light`)

Controls light that the token itself emits (e.g., a torch-bearing character):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `bright` | number | `0` | Bright light radius in game units |
| `dim` | number | `0` | Dim light radius in game units (typically 2x bright) |
| `angle` | number | `360` | Light emission angle in degrees (360 = all directions) |
| `color` | string\|null | `null` | Light color |
| `alpha` | number | `0.5` | Light intensity/opacity |
| `coloration` | number | `1` | Coloration technique |
| `luminosity` | number | `0.5` | Luminosity level |
| `saturation` | number | `0` | Saturation adjustment |
| `contrast` | number | `0` | Contrast adjustment |
| `shadows` | number | `0` | Shadow intensity |
| `attenuation` | number | `0.5` | Light falloff rate (0=no falloff, 1=maximum falloff) |
| `negative` | boolean | `false` | If `true`, creates darkness instead of light |
| `priority` | number | `0` | Rendering priority |
| `animation.type` | string\|null | `null` | Animation type (e.g., `"torch"`, `"pulse"`, `"chroma"`) |
| `animation.speed` | number | `5` | Animation speed (1–10) |
| `animation.intensity` | number | `5` | Animation intensity (1–10) |
| `animation.reverse` | boolean | `false` | Reverse animation direction |
| `darkness.min` | number | `0` | Minimum scene darkness for this light to be active |
| `darkness.max` | number | `1` | Maximum scene darkness for this light to be active |

### Token Vision/Sight (`sight`)

Controls what the token can see (requires `tokenVision: true` on the scene):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Whether this token has vision. Must be `true` for token to reveal fog of war |
| `range` | number | `0` | Vision range in game units (0 = unlimited within light) |
| `angle` | number | `360` | Field of view in degrees |
| `visionMode` | string | `"basic"` | Vision mode: `"basic"`, `"darkvision"`, `"monochromatic"`, `"tremorsense"`, `"lightAmplification"` |
| `color` | string\|null | `null` | Vision tint color |
| `attenuation` | number | `0.1` | Vision falloff rate |
| `brightness` | number | `0` | Brightness adjustment |
| `saturation` | number | `0` | Saturation adjustment |
| `contrast` | number | `0` | Contrast adjustment |

### Detection Modes (`detectionModes`)

Array of detection mode objects. Each grants the token a way to perceive its surroundings:

```json
{ "id": "basicSight", "enabled": true, "range": 30 }
```

Common modes: `"basicSight"`, `"seeInvisibility"`, `"senseInvisibility"`, `"feelTremor"`, `"seeAll"`, `"senseAll"`.

### Token Ring (`ring`)

V13 feature for token ring customization:

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether the dynamic token ring is active |
| `colors.ring` | string\|null | Custom ring color |
| `colors.background` | string\|null | Custom ring background color |
| `effects` | number | Ring visual effects bitmask (0=none, 1=enabled) |
| `subject.scale` | number | Scale of the subject within the ring |
| `subject.texture` | string\|null | Custom subject texture |

### Turn Marker (`turnMarker`)

Controls the visual indicator during combat turns:

| Field | Type | Description |
|-------|------|-------------|
| `mode` | number | Turn marker display mode (1=default) |
| `animation` | string\|null | Custom animation |
| `src` | string\|null | Custom marker image |
| `disposition` | boolean | Whether to color-code by disposition |

### Other Token Fields

| Field | Type | Description |
|-------|------|-------------|
| `occludable.radius` | number | Radius for roof occlusion (0=use token size) |
| `movementAction` | string\|null | Movement action type |
| `flags` | object | Module-specific data |
| `_movementHistory` | array | Internal: recent movement path data |
| `_regions` | array | Internal: region IDs the token currently occupies |

---

## AmbientLight Document Fields (Detailed)

Each entry in `lights[]` defines a light source placed on the scene:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `_id` | string | | Unique light document ID |
| `x` | number | | X position in pixels |
| `y` | number | | Y position in pixels |
| `elevation` | number | `0` | Vertical elevation |
| `rotation` | number | `0` | Light rotation in degrees |
| `walls` | boolean | `true` | Whether this light is blocked by walls |
| `vision` | boolean | `false` | Whether this light grants vision (like a token with sight) |
| `hidden` | boolean | `false` | GM-only visibility |
| `flags` | object | | Module-specific data |

**Light Configuration** (`config`) — same structure as Token `light` (see Token Light Emission above):
`negative`, `priority`, `alpha`, `angle`, `bright`, `dim`, `color`, `coloration`, `attenuation`, `luminosity`, `saturation`, `contrast`, `shadows`, `animation`, `darkness`.

---

## Wall Document Fields (Detailed)

Each entry in `walls[]` defines a wall segment between two points:

### Core Wall Properties

| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | Unique wall document ID |
| `c` | number[4] | Wall coordinates: `[x1, y1, x2, y2]` — start and end points in pixels |
| `dir` | number | Wall directionality. `0`=both sides, `1`=left only, `2`=right only. Determines which side of the wall the restrictions apply to |
| `flags` | object | Module-specific data |

### Restriction Types (`light`, `sight`, `sound`, `move`)

Each of these four fields controls how the wall blocks a specific sense/interaction channel. They share the same value set:

| Value | Constant | Description |
|-------|----------|-------------|
| `0` | NONE | Does not block this sense at all |
| `10` | LIMITED | Blocks at the second intersection (a token can see through one Limited wall but not two) |
| `20` | NORMAL | Fully blocks this sense |
| `30` | PROXIMITY | Only blocks outside a threshold distance (see `threshold`) |
| `40` | DISTANCE | Only blocks within a threshold distance (see `threshold`) |

**Wall type presets** combine these restrictions:

| Wall Type | `light` | `sight` | `sound` | `move` | Visual Color |
|-----------|---------|---------|---------|--------|-------------|
| Normal | 20 | 20 | 20 | 20 | Yellow |
| Terrain | 20 | 10 | 20 | 20 | Green |
| Invisible | 0 | 0 | 0 | 20 | Cyan |
| Ethereal | 20 | 20 | 0 | 0 | Light magenta |

### Door Properties

| Field | Type | Description |
|-------|------|-------------|
| `door` | number | Door type on this wall segment |
| `ds` | number | Current door state |
| `doorSound` | string\|null | Sound effect played when door opens/closes |

**Door Types** (`door`):

| Value | Constant | Description |
|-------|----------|-------------|
| `0` | NONE | Not a door |
| `1` | DOOR | Regular door (visible icon for players to interact with) |
| `2` | SECRET | Secret door (no icon visible to players; appears as a normal wall) |

**Door States** (`ds`):

| Value | Constant | Description |
|-------|----------|-------------|
| `0` | CLOSED | Door is closed; wall restrictions are active |
| `1` | OPEN | Door is open; movement, vision, and sound pass freely |
| `2` | LOCKED | Door is closed and locked; cannot be opened without GM intervention |

### Wall Threshold (`threshold`)

For Proximity/Distance restriction types:

| Field | Type | Description |
|-------|------|-------------|
| `light` | number\|null | Distance threshold for light restriction |
| `sight` | number\|null | Distance threshold for sight restriction |
| `sound` | number\|null | Distance threshold for sound restriction |
| `attenuation` | boolean | Whether the effect attenuates (fades) with distance |

### Wall Animation (`animation`)

| Field | Type | Description |
|-------|------|-------------|
| `animation` | string\|null | Door animation type (e.g., `"swing"`, `"slide"`, `"ascend"`, `"descend"`, `"swivel"`) |

---

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