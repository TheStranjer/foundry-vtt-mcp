import { summarizePacks, validatePackAccess } from "../src/core/compendium.js";

const packs = [
  {
    id: "world.my-items",
    label: "My Items",
    type: "Item",
    packageType: "world",
    packageName: "myworld",
    system: "dnd5e",
    index: [{ _id: "1", name: "Sword" }],
    folders: [{ _id: "f1" }],
  },
  { id: "my-module.actors", label: "Module Actors", type: "Actor", packageType: "module", packageName: "my-module" },
];

describe("compendium helpers", () => {
  test("summarizePacks lists packs without the bulky index and folders", () => {
    expect(summarizePacks(packs)).toEqual([
      {
        id: "world.my-items",
        label: "My Items",
        type: "Item",
        packageType: "world",
        packageName: "myworld",
        system: "dnd5e",
      },
      {
        id: "my-module.actors",
        label: "Module Actors",
        type: "Actor",
        packageType: "module",
        packageName: "my-module",
      },
    ]);
  });

  test("summarizePacks filters by document type case-insensitively", () => {
    expect(summarizePacks(packs, "actor").map((pack) => pack.id)).toEqual(["my-module.actors"]);
    expect(summarizePacks(packs, "Item").map((pack) => pack.id)).toEqual(["world.my-items"]);
    expect(summarizePacks(packs, "Scene")).toEqual([]);
  });

  test("summarizePacks returns an empty list when packs is not an array", () => {
    expect(summarizePacks(undefined)).toEqual([]);
    expect(summarizePacks({})).toEqual([]);
  });

  test("validatePackAccess accepts a matching pack", () => {
    expect(validatePackAccess(packs, "world.my-items", "Item")).toBeNull();
  });

  test("validatePackAccess reports an unknown pack and points at get_compendiums", () => {
    const message = validatePackAccess(packs, "world.nope", "Item");
    expect(message).toContain('"world.nope" not found');
    expect(message).toContain("get_compendiums");
  });

  test("validatePackAccess reports a document type mismatch", () => {
    expect(validatePackAccess(packs, "world.my-items", "Actor"))
      .toBe('Compendium pack "world.my-items" holds Item documents, not Actor.');
  });

  test("validatePackAccess treats a missing pack list as not found", () => {
    expect(validatePackAccess(undefined, "world.my-items", "Item")).toContain("not found");
  });
});
