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
