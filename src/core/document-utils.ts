function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  const owned = new WeakSet<object>();
  owned.add(filtered);
  for (const field of fieldsToInclude) {
    if (field in doc) {
      filtered[field] = doc[field];
      continue;
    }

    const path = field.split(".");

    let source: unknown = doc;
    let found = true;
    for (const segment of path) {
      if (isPlainObject(source) && segment in source) {
        source = source[segment];
      } else {
        found = false;
        break;
      }
    }
    if (!found) {
      continue;
    }

    let target = filtered;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = path[i];
      const existing = target[segment];
      if (!isPlainObject(existing)) {
        const created: Record<string, unknown> = {};
        target[segment] = created;
        owned.add(created);
      } else if (!owned.has(existing)) {
        const clone = { ...existing };
        target[segment] = clone;
        owned.add(clone);
      }
      target = target[segment] as Record<string, unknown>;
    }
    target[path[path.length - 1]] = source;
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

  const result = [...docs];
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

export interface DocumentShape {
  where?: Record<string, unknown> | null;
  requestedFields?: string[] | null;
  maxLength?: number | null;
}

/** Shared read pipeline: where filter, then field filter, then size truncation. */
export function shapeDocuments(
  docs: Record<string, unknown>[],
  shape: DocumentShape
): Record<string, unknown>[] {
  const requestedFields = shape.requestedFields ?? null;
  const filtered = filterDocumentsByWhere(docs, shape.where ?? null).map((doc) =>
    filterDocumentFields(doc, requestedFields)
  );
  return truncateDocuments(filtered, shape.maxLength ?? 0);
}

/**
 * Shared single-document lookup: find by id, then _id, then name (same precedence
 * as buildIdentifierQuery), and apply the field filter. Returns null if none match.
 */
export function pickDocument(
  docs: Record<string, unknown>[],
  identifier: { id?: string; _id?: string; name?: string },
  requestedFields: string[] | null
): Record<string, unknown> | null {
  let doc: Record<string, unknown> | undefined;

  if (identifier.id) {
    doc = docs.find((d) => d.id === identifier.id || d._id === identifier.id);
  } else if (identifier._id) {
    doc = docs.find((d) => d._id === identifier._id || d.id === identifier._id);
  } else if (identifier.name) {
    doc = docs.find((d) => d.name === identifier.name);
  }

  return doc ? filterDocumentFields(doc, requestedFields) : null;
}
