import { pickDocument, shapeDocuments } from "../src/core/document-utils.js";
import { COLLECTION_DOCUMENT_NAMES, DOCUMENT_TYPES } from "../src/core/collections.js";

describe("shapeDocuments", () => {
  const docs = [
    { _id: "1", name: "A", type: "npc", extra: 1 },
    { _id: "2", name: "B", type: "pc", extra: 2 },
    { _id: "3", name: "C", type: "npc", extra: 3 },
  ];

  test("applies where, then field filter", () => {
    expect(shapeDocuments(docs, { where: { type: "npc" }, requestedFields: ["extra"] })).toEqual([
      { _id: "1", name: "A", extra: 1 },
      { _id: "3", name: "C", extra: 3 },
    ]);
  });

  test("returns everything with no shape", () => {
    expect(shapeDocuments(docs, {})).toEqual(docs);
  });

  test("truncates to maxLength", () => {
    const one = Buffer.byteLength(JSON.stringify([docs[0]]), "utf-8");
    expect(shapeDocuments(docs, { maxLength: one })).toEqual([docs[0]]);
  });
});

describe("pickDocument", () => {
  const docs = [
    { _id: "1", name: "A", extra: 1 },
    { _id: "2", name: "B", extra: 2 },
  ];

  test("finds by id, _id, or name", () => {
    expect(pickDocument(docs, { id: "2" }, null)).toBe(docs[1]);
    expect(pickDocument(docs, { _id: "1" }, null)).toBe(docs[0]);
    expect(pickDocument(docs, { name: "B" }, null)).toBe(docs[1]);
  });

  test("filters fields on the match", () => {
    expect(pickDocument(docs, { _id: "1" }, ["extra"])).toEqual({ _id: "1", name: "A", extra: 1 });
  });

  test("returns null with no match or no identifier", () => {
    expect(pickDocument(docs, { name: "Z" }, null)).toBeNull();
    expect(pickDocument(docs, {}, null)).toBeNull();
  });
});

describe("DOCUMENT_TYPES", () => {
  test("every type carries a documentName and an explicit packable flag", () => {
    for (const config of DOCUMENT_TYPES) {
      expect(config.documentName).toEqual(expect.any(String));
      expect(typeof config.packable).toBe("boolean");
    }
  });

  test("marks only non-compendium types as unpackable", () => {
    const unpackable = DOCUMENT_TYPES.filter((c) => !c.packable).map((c) => c.documentName);
    expect(unpackable).toEqual(["Folder", "User", "Combat", "ChatMessage", "Setting"]);
  });

  test("COLLECTION_DOCUMENT_NAMES is derived from DOCUMENT_TYPES", () => {
    expect(Object.keys(COLLECTION_DOCUMENT_NAMES)).toHaveLength(DOCUMENT_TYPES.length);
    for (const config of DOCUMENT_TYPES) {
      expect(COLLECTION_DOCUMENT_NAMES[config.collection]).toBe(config.documentName);
    }
  });
});
