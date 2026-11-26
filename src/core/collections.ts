export interface DocumentTypeConfig {
  singular: string;
  plural: string;
  collection: string;
  description: string;
  /** Foundry document class name (Actor, Folder, ChatMessage, ...). */
  documentName: string;
  /** Whether documents of this type can live in a compendium pack. */
  packable: boolean;
  /** Fields a list read returns when `requested_fields` is absent or empty (`["*"]` returns everything). */
  summaryFields: string[];
  /** Fields fetched for a summary read only to derive summary output; they are not returned themselves. */
  summaryFetchFields?: string[];
  /** Field a list read can be ordered by (newest/oldest), when the collection has a natural order. */
  sortField?: string;
}

const DEFAULT_SUMMARY_FIELDS = ["_id", "name", "type", "folder"];

/** Single source of truth for the world collections the get_documents and get_document tools read. */
export const DOCUMENT_TYPES: DocumentTypeConfig[] = [
  { singular: "actor", plural: "actors", collection: "actors", description: "actor", documentName: "Actor", packable: true, summaryFields: [...DEFAULT_SUMMARY_FIELDS] },
  { singular: "item", plural: "items", collection: "items", description: "item", documentName: "Item", packable: true, summaryFields: [...DEFAULT_SUMMARY_FIELDS] },
  { singular: "folder", plural: "folders", collection: "folders", description: "folder", documentName: "Folder", packable: false, summaryFields: [...DEFAULT_SUMMARY_FIELDS] },
  { singular: "user", plural: "users", collection: "users", description: "user", documentName: "User", packable: false, summaryFields: ["_id", "name", "role"] },
  { singular: "scene", plural: "scenes", collection: "scenes", description: "scene", documentName: "Scene", packable: true, summaryFields: ["_id", "name", "folder", "active"] },
  { singular: "journal", plural: "journals", collection: "journal", description: "journal entry", documentName: "JournalEntry", packable: true, summaryFields: ["_id", "name", "folder"] },
  { singular: "macro", plural: "macros", collection: "macros", description: "macro", documentName: "Macro", packable: true, summaryFields: [...DEFAULT_SUMMARY_FIELDS] },
  { singular: "card", plural: "cards", collection: "cards", description: "card", documentName: "Cards", packable: true, summaryFields: [...DEFAULT_SUMMARY_FIELDS] },
  { singular: "playlist", plural: "playlists", collection: "playlists", description: "playlist", documentName: "Playlist", packable: true, summaryFields: ["_id", "name", "folder", "playing"] },
  { singular: "table", plural: "tables", collection: "tables", description: "table", documentName: "RollTable", packable: true, summaryFields: ["_id", "name", "folder"] },
  { singular: "combat", plural: "combats", collection: "combats", description: "combats", documentName: "Combat", packable: false, summaryFields: ["_id", "scene", "round", "turn", "active"] },
  { singular: "message", plural: "messages", collection: "messages", description: "messages", documentName: "ChatMessage", packable: false, summaryFields: ["_id", "timestamp", "speaker.alias", "author"], summaryFetchFields: ["content"], sortField: "timestamp" },
  { singular: "setting", plural: "settings", collection: "settings", description: "settings", documentName: "Setting", packable: false, summaryFields: ["_id", "key"] },
];

/**
 * Foundry document class for each world collection the get_documents and get_document tools read, derived from
 * DOCUMENT_TYPES. Lets a read ask the server for one document type (modifyDocument "get")
 * instead of pulling the whole world payload and filtering it locally.
 */
export const COLLECTION_DOCUMENT_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  DOCUMENT_TYPES.map((config) => [config.collection, config.documentName])
);

/**
 * Server-side query for a single document lookup. Foundry matches the query
 * fields exactly, so an id or _id becomes `{_id}` and a name becomes `{name}`.
 * Precedence (id, then _id, then name) matches getDocument's local lookup.
 */
export function buildIdentifierQuery(identifier: {
  id?: string;
  _id?: string;
  name?: string;
}): Record<string, string> | null {
  const docId = identifier.id ?? identifier._id;
  if (docId) {
    return { _id: docId };
  }
  if (identifier.name) {
    return { name: identifier.name };
  }
  return null;
}

/**
 * The part of a `where` filter the server can apply itself: top-level keys with a string,
 * number or boolean value, which Foundry matches exactly like filterDocumentsByWhere does.
 * Anything else (null, objects, dotted keys) stays client-side only. Callers still run the
 * local filter afterwards, so this only cuts what travels over the socket.
 */
export function whereToServerQuery(where: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where ?? {})) {
    if (!key.includes(".") && ["string", "number", "boolean"].includes(typeof value)) {
      query[key] = value;
    }
  }
  return query;
}

/**
 * The fields to ask Foundry's index for (`index: true, indexFields`) when a read requests
 * specific fields, or null when none are requested (the full documents are fetched).
 * Always includes `_id` and `name`, since the output contract always returns them. Also
 * includes every `where` key so the local filter can see it; filterDocumentFields drops
 * those afterwards unless they were requested.
 */
export function buildIndexFields(
  requestedFields: string[] | null | undefined,
  where?: Record<string, unknown> | null
): string[] | null {
  if (!requestedFields || requestedFields.length === 0) {
    return null;
  }
  return [...new Set(["_id", "name", ...requestedFields, ...Object.keys(where ?? {})])];
}

/** The summary field set for a world collection (default set for unknown collections). */
export function summaryFieldsForCollection(collection: string): string[] {
  return DOCUMENT_TYPES.find((config) => config.collection === collection)?.summaryFields ?? DEFAULT_SUMMARY_FIELDS;
}

/** Extra fields a summary read fetches to derive its output (messages: `content`, for `preview`). */
export function summaryFetchFieldsForCollection(collection: string): string[] {
  return DOCUMENT_TYPES.find((config) => config.collection === collection)?.summaryFetchFields ?? [];
}

/** The summary field set for a Foundry document class name (default set for unknown classes). */
export function summaryFieldsForDocumentName(documentName: string): string[] {
  return DOCUMENT_TYPES.find((config) => config.documentName === documentName)?.summaryFields ?? DEFAULT_SUMMARY_FIELDS;
}

/** The field a collection's list read can be ordered by, or null when it has none. */
export function sortFieldForCollection(collection: string): string | null {
  return DOCUMENT_TYPES.find((config) => config.collection === collection)?.sortField ?? null;
}

/**
 * The fields a read should return: null (full documents) for `["*"]`, the caller's
 * fields when given, otherwise `defaults` (null for the singular tools, which return
 * full documents by default).
 */
export function resolveRequestedFields(
  requested: string[] | null | undefined,
  defaults: string[] | null = null
): string[] | null {
  if (!requested || requested.length === 0) {
    return defaults;
  }
  return requested.includes("*") ? null : requested;
}
