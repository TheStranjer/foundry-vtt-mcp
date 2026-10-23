/**
 * Foundry document class for each world collection the get_* tools read.
 * Lets a read ask the server for one document type (modifyDocument "get")
 * instead of pulling the whole world payload and filtering it locally.
 */
export const COLLECTION_DOCUMENT_NAMES: Readonly<Record<string, string>> = {
  actors: "Actor",
  items: "Item",
  folders: "Folder",
  users: "User",
  scenes: "Scene",
  journal: "JournalEntry",
  macros: "Macro",
  cards: "Cards",
  playlists: "Playlist",
  tables: "RollTable",
  combats: "Combat",
  messages: "ChatMessage",
  settings: "Setting",
};

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
