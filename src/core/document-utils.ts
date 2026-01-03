export function filterDocumentFields(
  doc: Record<string, unknown>,
  requestedFields: string[] | null
): Record<string, unknown> {
  if (!requestedFields || requestedFields.length === 0) {
    return doc;
  }

  const fieldsToInclude = new Set(requestedFields);
  fieldsToInclude.add("_id");
  fieldsToInclude.add("name");

  const filtered: Record<string, unknown> = {};
  for (const field of fieldsToInclude) {
    if (field in doc) {
      filtered[field] = doc[field];
    }
  }
  return filtered;
}

export function truncateDocuments(
  docs: Record<string, unknown>[],
  maxLength: number
): Record<string, unknown>[] {
  if (!maxLength || maxLength <= 0) {
    return docs;
  }

  let result = [...docs];
  while (result.length > 0) {
    const json = JSON.stringify(result);
    if (Buffer.byteLength(json, "utf-8") <= maxLength) {
      return result;
    }
    result.pop();
  }
  return result;
}

export function filterDocumentsByWhere(
  docs: Record<string, unknown>[],
  where: Record<string, unknown> | null
): Record<string, unknown>[] {
  if (!where || Object.keys(where).length === 0) {
    return docs;
  }

  return docs.filter((doc) => {
    for (const [key, value] of Object.entries(where)) {
      if (doc[key] !== value) {
        return false;
      }
    }
    return true;
  });
}
