export function filterWorldData(
  worldData: Record<string, unknown>,
  excludeCollections: string[]
): Record<string, unknown> {
  const filteredWorld: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(worldData)) {
    if (!excludeCollections.includes(key)) {
      filteredWorld[key] = value;
    }
  }
  return filteredWorld;
}

/** The part of the world payload that get_world, get_compendiums and pack reads use. */
export interface WorldSnapshot {
  /** World metadata with the modules slimmed and the bulky keys dropped. */
  world: Record<string, unknown>;
  /** The compendium packs, each without its bulky `index` and `folders`. */
  packs: Record<string, unknown>[];
}

/** Pack fields that summarizePacks and validatePackAccess never read. */
const PACK_BULK_KEYS = ["index", "folders"];

/** The module fields get_world returns. */
const MODULE_KEYS = ["id", "title", "description", "authors", "url", "version"];

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    picked[key] = source[key];
  }
  return picked;
}

/**
 * Reduce a full world payload to what the cache keeps. Document collections, `packs`,
 * `model`, `template` and `system` (the keys in `droppedKeys`) are left out of `world`;
 * the payload itself is not retained.
 */
export function buildWorldSnapshot(
  worldData: Record<string, unknown>,
  droppedKeys: readonly string[]
): WorldSnapshot {
  const world = filterWorldData(worldData, [...droppedKeys]);

  if (Array.isArray(world.modules)) {
    world.modules = (world.modules as Record<string, unknown>[]).map((item) =>
      pick(item, MODULE_KEYS)
    );
  }

  const packs = Array.isArray(worldData.packs)
    ? (worldData.packs as Record<string, unknown>[]).map((pack) => {
        const slim = { ...pack };
        for (const key of PACK_BULK_KEYS) delete slim[key];
        return slim;
      })
    : [];

  return { world, packs };
}
