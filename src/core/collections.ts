export interface DocumentTypeConfig {
  singular: string;
  plural: string;
  collection: string;
  description: string;
  /** Foundry document class name (Actor, Folder, ChatMessage, ...). */
  documentName: string;
  /** Whether documents of this type can live in a compendium pack. */
  packable: boolean;
}

/** Single source of truth for the world collections the get_* tools read. */
export const DOCUMENT_TYPES: DocumentTypeConfig[] = [
  { singular: "actor", plural: "actors", collection: "actors", description: "actor", documentName: "Actor", packable: true },
  { singular: "item", plural: "items", collection: "items", description: "item", documentName: "Item", packable: true },
  { singular: "folder", plural: "folders", collection: "folders", description: "folder", documentName: "Folder", packable: false },
  { singular: "user", plural: "users", collection: "users", description: "user", documentName: "User", packable: false },
  { singular: "scene", plural: "scenes", collection: "scenes", description: "scene", documentName: "Scene", packable: true },
  { singular: "journal", plural: "journals", collection: "journal", description: "journal entry", documentName: "JournalEntry", packable: true },
  { singular: "macro", plural: "macros", collection: "macros", description: "macro", documentName: "Macro", packable: true },
  { singular: "card", plural: "cards", collection: "cards", description: "card", documentName: "Cards", packable: true },
  { singular: "playlist", plural: "playlists", collection: "playlists", description: "playlist", documentName: "Playlist", packable: true },
  { singular: "table", plural: "tables", collection: "tables", description: "table", documentName: "RollTable", packable: true },
  { singular: "combat", plural: "combats", collection: "combats", description: "combats", documentName: "Combat", packable: false },
  { singular: "message", plural: "messages", collection: "messages", description: "messages", documentName: "ChatMessage", packable: false },
  { singular: "setting", plural: "settings", collection: "settings", description: "settings", documentName: "Setting", packable: false },
];

/**
 * Foundry document class for each world collection the get_* tools read, derived from
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
