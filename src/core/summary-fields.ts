/** Longest preview, in characters, before it is cut and "…" is appended. */
export const PREVIEW_MAX_LENGTH = 120;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const BLOCK_TAG = /<\/?(?:p|div|br|hr|li|ul|ol|h[1-6]|tr|td|th|table|blockquote|section|article|header|footer)\b[^>]*>/gi;
const ANY_TAG = /<\/?[a-zA-Z][^>]*>/g;
const COMMENT = /<!--[\s\S]*?-->/g;

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (match, dec, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? match;
    const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Message HTML as plain text: tags removed (block tags become a space), entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  const stripped = html.replace(COMMENT, " ").replace(BLOCK_TAG, " ").replace(ANY_TAG, "");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}

/** The plain text of `content`, cut to about PREVIEW_MAX_LENGTH characters with "…"; "" when there is none. */
export function makePreview(content: unknown): string {
  if (typeof content !== "string") return "";
  const text = htmlToText(content);
  if (text.length <= PREVIEW_MAX_LENGTH) return text;
  let cut = text.slice(0, PREVIEW_MAX_LENGTH);
  // Don't leave half of a surrogate pair at the cut.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** Epoch milliseconds as ISO 8601 UTC; any other value is returned as it is. */
export function toIsoTimestamp(value: unknown): unknown {
  if (typeof value !== "number") return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/**
 * The readable summary of a chat message built from its raw fetched fields: ISO `timestamp`,
 * `author` as the user's name (when known) next to `author_id`, and a `preview` of `content`
 * (left out when empty). `content` itself is not returned.
 */
export function summarizeMessage(
  doc: Record<string, unknown>,
  userNames: ReadonlyMap<string, string>
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key === "content") continue;
    if (key === "timestamp") {
      summary[key] = toIsoTimestamp(value);
    } else if (key === "author" && typeof value === "string") {
      summary.author = userNames.get(value) ?? value;
      summary.author_id = value;
    } else {
      summary[key] = value;
    }
  }
  const preview = makePreview(doc.content);
  if (preview) summary.preview = preview;
  return summary;
}

/** `doc` with `folder_name` inserted after `folder` when the folder id is known; unchanged otherwise. */
export function withFolderName(
  doc: Record<string, unknown>,
  folderNames: ReadonlyMap<string, string>
): Record<string, unknown> {
  const folder = doc.folder;
  const name = typeof folder === "string" ? folderNames.get(folder) : undefined;
  if (name === undefined) return doc;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    result[key] = value;
    if (key === "folder") result.folder_name = name;
  }
  return result;
}

/** Map of `_id` to `name` from an index read of `_id, name`. */
export function buildNameMap(docs: Record<string, unknown>[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const doc of docs) {
    if (typeof doc._id === "string" && typeof doc.name === "string") names.set(doc._id, doc.name);
  }
  return names;
}
