export interface PackSummary {
  id: string;
  label: string;
  type: string;
  packageType?: string;
  packageName?: string;
  system?: string;
}

function asPackList(packs: unknown): Record<string, unknown>[] {
  return Array.isArray(packs) ? (packs as Record<string, unknown>[]) : [];
}

/**
 * Summarize the compendium packs from the world payload, optionally keeping only packs
 * that hold a given document type (e.g. "Item"). Drops the bulky `index` and `folders` keys.
 */
export function summarizePacks(packs: unknown, documentName?: string | null): PackSummary[] {
  const wanted = documentName?.toLowerCase();

  return asPackList(packs)
    .filter((pack) => !wanted || String(pack.type ?? "").toLowerCase() === wanted)
    .map((pack) => {
      const summary: PackSummary = {
        id: String(pack.id ?? ""),
        label: String(pack.label ?? ""),
        type: String(pack.type ?? ""),
      };
      if (pack.packageType !== undefined) summary.packageType = String(pack.packageType);
      if (pack.packageName !== undefined) summary.packageName = String(pack.packageName);
      if (pack.system !== undefined) summary.system = String(pack.system);
      return summary;
    });
}

/**
 * Check that a compendium pack exists and holds the requested document type.
 * Returns an error message, or null when the pack can be read.
 *
 * Foundry itself answers an unknown pack with an opaque crash
 * ("Cannot read properties of undefined (reading 'packData')"), so this is checked up front.
 */
export function validatePackAccess(
  packs: unknown,
  packId: string,
  documentName: string
): string | null {
  const pack = asPackList(packs).find((candidate) => candidate.id === packId);

  if (!pack) {
    return `Compendium pack "${packId}" not found. Use get_compendiums to list the available packs.`;
  }

  if (pack.type !== documentName) {
    return `Compendium pack "${packId}" holds ${String(pack.type)} documents, not ${documentName}.`;
  }

  return null;
}
