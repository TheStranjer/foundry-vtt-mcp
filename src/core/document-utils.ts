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
}

/** Shared read pipeline: where filter, then field filter. */
export function shapeDocuments(
  docs: Record<string, unknown>[],
  shape: DocumentShape
): Record<string, unknown>[] {
  const requestedFields = shape.requestedFields ?? null;
  return filterDocumentsByWhere(docs, shape.where ?? null).map((doc) =>
    filterDocumentFields(doc, requestedFields)
  );
}

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;
/** Byte budget for one page of documents when `max_length` is omitted. */
export const DEFAULT_MAX_LENGTH = 200000;

export interface PageParams {
  limit: number;
  offset: number;
  /** Byte budget for the page's documents; 0 means no limit. */
  maxLength: number;
}

function toInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : null;
}

/**
 * Apply the paging defaults: limit 100 clamped to 1..1000, offset 0 (never negative),
 * max_length 200000 when omitted, and 0 (or a negative value) for no limit.
 */
export function resolvePageParams(input?: {
  limit?: number | null;
  offset?: number | null;
  maxLength?: number | null;
}): PageParams {
  const limit = toInteger(input?.limit);
  const offset = toInteger(input?.offset);
  const maxLength = toInteger(input?.maxLength);
  return {
    limit: limit === null ? DEFAULT_LIMIT : Math.min(Math.max(limit, 1), MAX_LIMIT),
    offset: offset === null ? 0 : Math.max(offset, 0),
    maxLength: maxLength === null ? DEFAULT_MAX_LENGTH : Math.max(maxLength, 0),
  };
}

export interface OversizedDocument {
  _id: unknown;
  name: unknown;
  bytes: number;
}

export interface DocumentPage {
  total: number;
  offset: number;
  returned: number;
  next_offset: number | null;
  documents: Record<string, unknown>[];
  oversized?: OversizedDocument;
  hint?: string;
}

/**
 * Take documents in order while they fit the byte budget (the size of their JSON array),
 * stopping at the first one that doesn't. Each document is serialised once. When the very
 * first document alone exceeds the budget, nothing is taken and it is reported as oversized.
 */
export function fitToBudget(
  docs: Record<string, unknown>[],
  maxLength: number
): { documents: Record<string, unknown>[]; oversized: OversizedDocument | null } {
  if (!maxLength || maxLength <= 0) {
    return { documents: docs, oversized: null };
  }

  let used = 2; // "[]"
  let count = 0;
  for (const doc of docs) {
    const bytes = Buffer.byteLength(JSON.stringify(doc), "utf-8");
    const next = used + bytes + (count > 0 ? 1 : 0);
    if (next > maxLength) {
      if (count === 0) {
        return { documents: [], oversized: { _id: doc._id, name: doc.name ?? null, bytes } };
      }
      break;
    }
    used = next;
    count++;
  }
  return { documents: docs.slice(0, count), oversized: null };
}

/**
 * Build the list-tool envelope for one page. `candidates` are the documents the page starts
 * with (already cut to `limit` by the caller), `total` is the count after the where filter and
 * `offset` is the position of `candidates[0]` within that filtered list.
 */
export function buildPage(
  candidates: Record<string, unknown>[],
  total: number,
  offset: number,
  maxLength: number
): DocumentPage {
  const { documents, oversized } = fitToBudget(candidates, maxLength);
  // An oversized first document is skipped over, so the next page starts just after it.
  const end = oversized ? offset + 1 : offset + documents.length;
  const page: DocumentPage = {
    total,
    offset,
    returned: documents.length,
    next_offset: end < total ? end : null,
    documents,
  };
  if (oversized) {
    page.oversized = oversized;
    page.hint =
      `Document ${String(oversized._id)} is ${oversized.bytes} bytes, over the max_length budget of ${maxLength}. ` +
      `Fetch it with requested_fields (to pick only the fields you need) or with get_document; ` +
      `then continue with offset=${offset + 1}.`;
  }
  return page;
}

/** Page a fully loaded, where-filtered document list: slice by offset/limit, then apply the budget. */
export function pageDocuments(docs: Record<string, unknown>[], params: PageParams): DocumentPage {
  return buildPage(docs.slice(params.offset, params.offset + params.limit), docs.length, params.offset, params.maxLength);
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
