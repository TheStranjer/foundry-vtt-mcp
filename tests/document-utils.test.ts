import {
  filterDocumentFields,
  filterDocumentsByWhere,
  truncateDocuments,
} from "../src/core/document-utils.js";

describe("document utils", () => {
  test("filterDocumentFields returns original when requestedFields empty", () => {
    const doc = { _id: "1", name: "A", extra: 1 };
    expect(filterDocumentFields(doc, null)).toBe(doc);
    expect(filterDocumentFields(doc, [])).toBe(doc);
  });

  test("filterDocumentFields includes requested and required fields", () => {
    const doc = { _id: "1", name: "A", extra: 1, skip: true };
    expect(filterDocumentFields(doc, ["extra"]))
      .toEqual({ _id: "1", name: "A", extra: 1 });
  });

  test("filterDocumentFields ignores missing fields", () => {
    const doc = { _id: "1", name: "A" };
    expect(filterDocumentFields(doc, ["missing"]))
      .toEqual({ _id: "1", name: "A" });
  });

  test("truncateDocuments keeps docs under limit", () => {
    const docs = [{ a: 1 }, { b: 2 }];
    const maxLength = Buffer.byteLength(JSON.stringify(docs), "utf-8");
    expect(truncateDocuments(docs, maxLength)).toEqual(docs);
  });

  test("truncateDocuments removes until under limit", () => {
    const docs = [{ a: "a".repeat(50) }, { b: "b".repeat(50) }];
    const maxLength = Buffer.byteLength(JSON.stringify([docs[0]]), "utf-8");
    expect(truncateDocuments(docs, maxLength)).toEqual([docs[0]]);
  });

  test("truncateDocuments returns empty when too small", () => {
    const docs = [{ a: "a" }];
    expect(truncateDocuments(docs, 1)).toEqual([]);
  });

  test("filterDocumentsByWhere returns original when no filter", () => {
    const docs = [{ a: 1 }];
    expect(filterDocumentsByWhere(docs, null)).toBe(docs);
    expect(filterDocumentsByWhere(docs, {})).toBe(docs);
  });

  test("filterDocumentsByWhere filters by all keys", () => {
    const docs = [
      { type: "npc", folder: "f1" },
      { type: "npc", folder: "f2" },
      { type: "pc", folder: "f1" },
    ];
    expect(filterDocumentsByWhere(docs, { type: "npc", folder: "f1" }))
      .toEqual([{ type: "npc", folder: "f1" }]);
  });
});
