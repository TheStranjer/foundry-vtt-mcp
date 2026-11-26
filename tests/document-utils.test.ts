import {
  filterDocumentFields,
  filterDocumentsByWhere,
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

  test("filterDocumentFields supports dot-notation nested paths", () => {
    const doc = {
      _id: "1",
      name: "A",
      img: "avatar.jpg",
      system: {
        aspirations: ["a", "b"],
        obsessions: "focus",
        path: "obrimos",
        secret: "hidden",
      },
    };
    expect(
      filterDocumentFields(doc, ["system.aspirations", "system.path", "img"])
    ).toEqual({
      _id: "1",
      name: "A",
      img: "avatar.jpg",
      system: {
        aspirations: ["a", "b"],
        path: "obrimos",
      },
    });
  });

  test("filterDocumentFields prefers a literal dotted key over path traversal", () => {
    const doc = {
      _id: "1",
      name: "A",
      "system.aspirations": "literal",
      system: { aspirations: "nested" },
    };
    expect(filterDocumentFields(doc, ["system.aspirations"])).toEqual({
      _id: "1",
      name: "A",
      "system.aspirations": "literal",
    });
  });

  test("filterDocumentFields falls back to path traversal when literal key absent", () => {
    const doc = { _id: "1", name: "A", system: { aspirations: "nested" } };
    expect(filterDocumentFields(doc, ["system.aspirations"])).toEqual({
      _id: "1",
      name: "A",
      system: { aspirations: "nested" },
    });
  });

  test("filterDocumentFields ignores missing nested paths", () => {
    const doc = { _id: "1", name: "A", system: { path: "x" } };
    expect(filterDocumentFields(doc, ["system.missing", "system.path"]))
      .toEqual({ _id: "1", name: "A", system: { path: "x" } });
  });

  test("filterDocumentFields ignores nested paths on non-object fields", () => {
    const doc = { _id: "1", name: "A", img: "avatar.jpg" };
    expect(filterDocumentFields(doc, ["img.nope"]))
      .toEqual({ _id: "1", name: "A" });
  });

  test("filterDocumentFields ignores nested paths through null and arrays", () => {
    const doc = {
      _id: "1",
      name: "A",
      geist: null,
      progress: [{ name: "Starting XP", beats: 75 }],
    };
    expect(filterDocumentFields(doc, ["geist.name", "progress.0.name"]))
      .toEqual({ _id: "1", name: "A" });
  });

  test("filterDocumentFields treats arrays as opaque leaf values", () => {
    const doc = { _id: "1", name: "A", progress: [{ beats: 75 }] };
    expect(filterDocumentFields(doc, ["progress"]))
      .toEqual({ _id: "1", name: "A", progress: [{ beats: 75 }] });
  });

  test("filterDocumentFields resolves numeric-like keys", () => {
    const doc = {
      _id: "1",
      name: "A",
      system: { touchstones_vampire: { "1": "first", "2": "second" } },
    };
    expect(filterDocumentFields(doc, ["system.touchstones_vampire.1"]))
      .toEqual({
        _id: "1",
        name: "A",
        system: { touchstones_vampire: { "1": "first" } },
      });
  });

  test("filterDocumentFields merges sibling paths sharing a parent", () => {
    const doc = {
      _id: "1",
      name: "A",
      system: {
        attributes_physical: {
          strength: { value: 1 },
          dexterity: { value: 3 },
          stamina: { value: 2 },
        },
      },
    };
    expect(
      filterDocumentFields(doc, [
        "system.attributes_physical.strength",
        "system.attributes_physical.dexterity",
      ])
    ).toEqual({
      _id: "1",
      name: "A",
      system: {
        attributes_physical: { strength: { value: 1 }, dexterity: { value: 3 } },
      },
    });
  });

  test("filterDocumentFields lets a broader path win over a narrower sibling", () => {
    const doc = {
      _id: "1",
      name: "A",
      system: {
        attributes_physical: { strength: { value: 1 }, dexterity: { value: 3 } },
      },
    };
    expect(
      filterDocumentFields(doc, [
        "system.attributes_physical.strength",
        "system.attributes_physical",
      ])
    ).toEqual({
      _id: "1",
      name: "A",
      system: {
        attributes_physical: { strength: { value: 1 }, dexterity: { value: 3 } },
      },
    });
  });

  test("filterDocumentFields resolves a realistic mixed request", () => {
    const doc = {
      _id: "jJ10LA0URnIaLu7g",
      name: "Bezaliel",
      system: {
        age: 52,
        health: { max: 5, value: 5 },
        attributes_physical: { strength: { value: 1 }, stamina: { value: 2 } },
        touchstones_vampire: { "1": "", "2": "" },
        secret: "omitted",
      },
    };
    expect(
      filterDocumentFields(doc, [
        "system.age",
        "system.health",
        "system.attributes_physical.strength",
        "system.touchstones_vampire.1",
        "system.nonexistent.path",
      ])
    ).toEqual({
      _id: "jJ10LA0URnIaLu7g",
      name: "Bezaliel",
      system: {
        age: 52,
        health: { max: 5, value: 5 },
        attributes_physical: { strength: { value: 1 } },
        touchstones_vampire: { "1": "" },
      },
    });
  });

  test("filterDocumentFields does not mutate the source when mixing parent and child paths", () => {
    const doc = {
      _id: "1",
      name: "A",
      system: { a: 1, b: 2 },
    };
    const result = filterDocumentFields(doc, ["system", "system.a"]);
    result.system = { ...(result.system as object), injected: true };
    expect(doc.system).toEqual({ a: 1, b: 2 });
    expect(result).toEqual({
      _id: "1",
      name: "A",
      system: { a: 1, b: 2, injected: true },
    });
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

import { buildIndexFields } from "../src/core/collections.js";

describe("buildIndexFields", () => {
  test("returns null without requested fields", () => {
    expect(buildIndexFields(null)).toBeNull();
    expect(buildIndexFields(undefined, { type: "npc" })).toBeNull();
    expect(buildIndexFields([], { type: "npc" })).toBeNull();
  });

  test("adds _id, name and where keys without duplicates", () => {
    expect(buildIndexFields(["name", "system.hp"], { type: "npc", "system.hp": 1 })).toEqual([
      "_id",
      "name",
      "system.hp",
      "type",
    ]);
  });
});
