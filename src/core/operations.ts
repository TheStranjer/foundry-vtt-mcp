export function buildDocumentOperation(
  base: Record<string, unknown>,
  options?: { parentUuid?: string }
): Record<string, unknown> {
  if (!options?.parentUuid) {
    return base;
  }

  return {
    ...base,
    parentUuid: options.parentUuid,
  };
}
