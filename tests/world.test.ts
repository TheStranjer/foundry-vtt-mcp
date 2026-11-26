import { buildWorldSnapshot, filterWorldData } from "../src/core/world.js";

describe("filterWorldData", () => {
  test("excludes collections", () => {
    const world = { actors: [], items: [], meta: { title: "World" } };
    expect(filterWorldData(world, ["actors", "items"]))
      .toEqual({ meta: { title: "World" } });
  });

  test("keeps all when exclude empty", () => {
    const world = { actors: [], meta: { title: "World" } };
    expect(filterWorldData(world, []))
      .toEqual(world);
  });
});

describe("buildWorldSnapshot", () => {
  const dropped = ["actors", "packs", "system"];

  test("drops the listed keys and keeps the metadata", () => {
    const snapshot = buildWorldSnapshot(
      { title: "W", actors: [{ _id: "a" }], packs: [], system: { big: 1 } },
      dropped
    );
    expect(snapshot.world).toEqual({ title: "W" });
  });

  test("slims modules", () => {
    const snapshot = buildWorldSnapshot(
      { modules: [{ id: "m", title: "M", version: "1", esmodules: ["x.js"], flags: {} }] },
      dropped
    );
    expect(snapshot.world.modules).toEqual([
      { id: "m", title: "M", version: "1", description: undefined, authors: undefined, url: undefined },
    ]);
  });

  test("keeps packs without index and folders", () => {
    const snapshot = buildWorldSnapshot(
      { packs: [{ id: "world.a", type: "Item", index: [{ _id: "1" }], folders: [{}] }] },
      dropped
    );
    expect(snapshot.packs).toEqual([{ id: "world.a", type: "Item" }]);
  });

  test("has no packs when the payload has none", () => {
    expect(buildWorldSnapshot({}, dropped).packs).toEqual([]);
  });

  test("does not mutate the payload", () => {
    const payload = { packs: [{ id: "p", index: [1] }], modules: [{ id: "m", extra: 1 }] };
    buildWorldSnapshot(payload, dropped);
    expect(payload).toEqual({ packs: [{ id: "p", index: [1] }], modules: [{ id: "m", extra: 1 }] });
  });
});
