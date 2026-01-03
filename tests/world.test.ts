import { filterWorldData } from "../src/core/world.js";

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
