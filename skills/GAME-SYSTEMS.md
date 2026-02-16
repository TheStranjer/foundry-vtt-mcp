---
name: foundry-gamesystems
description: Reference for FoundryVTT document types, game system data structures, and common operations. Use when working with document type relationships (Actor, Item, Scene, etc.), system-specific fields (D&D 5e, PF2e, WoD5e), filtering by folder, bulk operations, or embedded document updates via FoundryMCP tools.
---

<!-- Sub-skill: Document Types, Game Systems, and Common Operations -->

# Document Types, Game Systems & Common Operations

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

 ### Update Embedded Document
 
When updating embedded items through a parent document's `items[]` array, **always use nested object syntax** — never dot notation.

Dot notation (`"system.value": 3`) is silently ignored when used inside the `items[]` array of a parent document update. The update will appear to succeed (no error returned) but the field will not change. This applies to all embedded document arrays (`items[]`, `tokens[]`, `lights[]`, etc.) when updated through the parent.

+#### Correct — nested objects (batch, any number of items):
 ```json
 {
   "tool": "modify_document",
   "type": "Actor",
   "_id": "actorId",
   "updates": [{
    "items": [
      { "_id": "itemId1", "system": { "quantity": 5 } },
      { "_id": "itemId2", "system": { "label": "Alertness", "value": 3 } }
    ]
  }]
}
```

#### Wrong — dot notation (silently ignored):
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

#### Alternative — `parent_uuid` (works with either notation, but one item at a time):
```json
{
  "tool": "modify_document",
  "type": "Item",
  "_id": "itemId",
  "parent_uuid": "Actor.actorId",
  "updates": [{ "system.quantity": 5 }]
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
