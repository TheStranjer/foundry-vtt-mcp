import { CachedLookup } from "../src/core/lookup-cache.js";
import {
  PREVIEW_MAX_LENGTH,
  buildNameMap,
  htmlToText,
  makePreview,
  summarizeMessage,
  toIsoTimestamp,
  withFolderName,
} from "../src/core/summary-fields.js";

describe("htmlToText", () => {
  test("removes tags, decodes entities and collapses whitespace", () => {
    expect(htmlToText("<p>Hello&nbsp;<b>brave</b>\n\n  world &amp; &lt;co&gt; &#33;&#x21;</p>")).toBe("Hello brave world & <co> !!");
  });

  test("block tags separate words, inline tags do not", () => {
    expect(htmlToText("<div>one</div><div>two</div>a<i>b</i>c<br>d")).toBe("one two abc d");
  });

  test("drops comments and keeps a bare < that is not a tag", () => {
    expect(htmlToText("<!-- note -->1 < 2")).toBe("1 < 2");
  });

  test("leaves unknown entities as they are", () => {
    expect(htmlToText("&bogus; &#99999999;")).toBe("&bogus; &#99999999;");
  });

  test("entities are decoded after tags are removed, so encoded markup stays text", () => {
    expect(htmlToText("&lt;b&gt;x&lt;/b&gt;")).toBe("<b>x</b>");
  });
});

describe("makePreview", () => {
  test("short content is returned whole", () => {
    expect(makePreview("<p>Hi</p>")).toBe("Hi");
  });

  test("long content is cut with an ellipsis", () => {
    const preview = makePreview(`<p>${"word ".repeat(100)}</p>`);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(PREVIEW_MAX_LENGTH + 1);
    expect(preview.startsWith("word word")).toBe(true);
  });

  test("content of exactly the limit is not cut", () => {
    expect(makePreview("a".repeat(PREVIEW_MAX_LENGTH))).toBe("a".repeat(PREVIEW_MAX_LENGTH));
  });

  test("a cut never splits a surrogate pair", () => {
    const preview = makePreview("a".repeat(PREVIEW_MAX_LENGTH - 1) + "😀😀");
    expect(preview).toBe("a".repeat(PREVIEW_MAX_LENGTH - 1) + "…");
  });

  test("empty, tag-only and missing content give an empty preview", () => {
    expect(makePreview("")).toBe("");
    expect(makePreview("<p> </p><br>")).toBe("");
    expect(makePreview(undefined)).toBe("");
    expect(makePreview(5)).toBe("");
  });
});

describe("toIsoTimestamp", () => {
  test("epoch milliseconds become ISO 8601 UTC", () => {
    expect(toIsoTimestamp(1795404997568)).toBe("2026-11-23T03:36:37.568Z");
  });

  test("anything else is untouched", () => {
    expect(toIsoTimestamp("x")).toBe("x");
    expect(toIsoTimestamp(undefined)).toBeUndefined();
    expect(toIsoTimestamp(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("summarizeMessage", () => {
  const users = new Map([["u1", "Lukas Wyss"]]);

  test("builds the readable message summary", () => {
    const summary = summarizeMessage(
      { _id: "m1", timestamp: 1000, speaker: { alias: "Lukas" }, author: "u1", content: "<p>Roll &amp; go</p>" },
      users
    );
    expect(summary).toEqual({
      _id: "m1",
      timestamp: "1970-01-01T00:00:01.000Z",
      speaker: { alias: "Lukas" },
      author: "Lukas Wyss",
      author_id: "u1",
      preview: "Roll & go",
    });
    expect(Object.keys(summary)).toEqual(["_id", "timestamp", "speaker", "author", "author_id", "preview"]);
  });

  test("no preview for empty content, and content is never returned", () => {
    const summary = summarizeMessage({ _id: "m1", author: "u1", content: "" }, users);
    expect(summary).not.toHaveProperty("preview");
    expect(summary).not.toHaveProperty("content");
  });

  test("an unknown author keeps the id as author", () => {
    expect(summarizeMessage({ _id: "m1", author: "gone" }, users)).toMatchObject({ author: "gone", author_id: "gone" });
  });

  test("a message without an author gets neither author field", () => {
    const summary = summarizeMessage({ _id: "m1" }, users);
    expect(summary).not.toHaveProperty("author");
    expect(summary).not.toHaveProperty("author_id");
  });
});

describe("withFolderName", () => {
  const folders = new Map([["f1", "Monsters"]]);

  test("adds folder_name right after folder and keeps folder", () => {
    const doc = withFolderName({ _id: "a", name: "A", type: "npc", folder: "f1" }, folders);
    expect(doc).toEqual({ _id: "a", name: "A", type: "npc", folder: "f1", folder_name: "Monsters" });
    expect(Object.keys(doc)).toEqual(["_id", "name", "type", "folder", "folder_name"]);
  });

  test("null, missing and unknown folders get no folder_name", () => {
    for (const doc of [{ _id: "a", folder: null }, { _id: "a" }, { _id: "a", folder: "zzz" }]) {
      expect(withFolderName(doc, folders)).toBe(doc);
    }
  });
});

describe("buildNameMap", () => {
  test("maps ids to names and skips incomplete rows", () => {
    expect([...buildNameMap([{ _id: "a", name: "A" }, { _id: "b" }, { name: "c" }])]).toEqual([["a", "A"]]);
  });
});

describe("CachedLookup", () => {
  test("loads once and reuses the value", async () => {
    const lookup = new CachedLookup<number>();
    const load = jest.fn().mockResolvedValue(7);
    expect(await lookup.get(load)).toBe(7);
    expect(await lookup.get(load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("concurrent callers share one load", async () => {
    const lookup = new CachedLookup<number>();
    const load = jest.fn().mockResolvedValue(1);
    await Promise.all([lookup.get(load), lookup.get(load)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("clear forces a reload", async () => {
    const lookup = new CachedLookup<number>();
    const load = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await lookup.get(load);
    lookup.clear();
    expect(await lookup.get(load)).toBe(2);
  });

  test("a failed load is not cached", async () => {
    const lookup = new CachedLookup<number>();
    const load = jest.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(3);
    await expect(lookup.get(load)).rejects.toThrow("boom");
    expect(await lookup.get(load)).toBe(3);
  });

  test("a load in flight during clear does not repopulate the cache", async () => {
    const lookup = new CachedLookup<number>();
    let resolve!: (value: number) => void;
    const slow = lookup.get(() => new Promise<number>((r) => (resolve = r)));
    lookup.clear();
    resolve(1);
    await slow;
    const load = jest.fn().mockResolvedValue(2);
    expect(await lookup.get(load)).toBe(2);
  });
});
