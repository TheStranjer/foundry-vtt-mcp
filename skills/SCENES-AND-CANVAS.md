---
name: foundry-scenes
description: Detailed field reference for FoundryVTT scenes, tokens, walls, lights, drawings, and canvas elements. Use when creating or modifying Scene documents, Token properties, AmbientLight/Wall configuration, Drawing objects, or setting images on documents via FoundryMCP tools.
---

<!-- Sub-skill: Scenes, Tokens, Walls, Lights, Drawings, and Canvas Elements -->

# Scenes & Canvas Elements

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
