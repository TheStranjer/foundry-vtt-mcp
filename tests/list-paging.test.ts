import { FoundryClient } from "../src/foundry-client.js";
import {
  DEFAULT_MAX_LENGTH,
  MAX_LIMIT,
  buildPage,
  fitToBudget,
  pageDocuments,
  resolvePageParams,
} from "../src/core/document-utils.js";
import {
  DOCUMENT_TYPES,
  resolveRequestedFields,
  summaryFieldsForCollection,
  summaryFieldsForDocumentName,
} from "../src/core/collections.js";
import { getDocumentsTool } from "../src/server-tools.js";

function createClient() {
  const deps = {
    logger: { error: jest.fn() },
    wsLogger: { logInbound: jest.fn(), logOutbound: jest.fn(), close: jest.fn() },
  };
  return new FoundryClient("/tmp/creds.json", deps as any);
}

function docs(count: number, extra: (i: number) => Record<string, unknown> = () => ({})) {
  return Array.from({ length: count }, (_, i) => ({ _id: `id${i}`, name: `Doc ${i}`, ...extra(i) }));
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf-8");
}

describe("resolvePageParams", () => {
  test("applies defaults", () => {
    expect(resolvePageParams()).toEqual({ limit: 100, offset: 0, maxLength: DEFAULT_MAX_LENGTH });
    expect(resolvePageParams({ limit: null, offset: null, maxLength: null })).toEqual({
      limit: 100,
      offset: 0,
      maxLength: 200000,
    });
  });

  test("clamps limit to 1000 and at least 1", () => {
    expect(resolvePageParams({ limit: 5000 }).limit).toBe(MAX_LIMIT);
    expect(resolvePageParams({ limit: 0 }).limit).toBe(1);
    expect(resolvePageParams({ limit: -4 }).limit).toBe(1);
    expect(resolvePageParams({ limit: 7.9 }).limit).toBe(7);
  });

  test("offset is never negative", () => {
    expect(resolvePageParams({ offset: -3 }).offset).toBe(0);
    expect(resolvePageParams({ offset: 12 }).offset).toBe(12);
  });

  test("an explicit 0 max_length means no limit", () => {
    expect(resolvePageParams({ maxLength: 0 }).maxLength).toBe(0);
    expect(resolvePageParams({ maxLength: -1 }).maxLength).toBe(0);
    expect(resolvePageParams({ maxLength: 50 }).maxLength).toBe(50);
  });
});

describe("envelope arithmetic", () => {
  const all = docs(7);
  const params = { limit: 3, offset: 0, maxLength: 0 };

  test("walks all pages with next_offset", () => {
    const first = pageDocuments(all, params);
    expect(first).toMatchObject({ total: 7, offset: 0, returned: 3, next_offset: 3 });
    const second = pageDocuments(all, { ...params, offset: first.next_offset! });
    expect(second).toMatchObject({ total: 7, offset: 3, returned: 3, next_offset: 6 });
    const third = pageDocuments(all, { ...params, offset: second.next_offset! });
    expect(third).toMatchObject({ total: 7, offset: 6, returned: 1, next_offset: null });
    expect([...first.documents, ...second.documents, ...third.documents]).toEqual(all);
  });

  test("next_offset is null when the page ends exactly at the total", () => {
    expect(pageDocuments(all, { limit: 7, offset: 0, maxLength: 0 }).next_offset).toBeNull();
  });

  test("an offset past the end returns an empty page", () => {
    expect(pageDocuments(all, { limit: 3, offset: 20, maxLength: 0 })).toEqual({
      total: 7,
      offset: 20,
      returned: 0,
      next_offset: null,
      documents: [],
    });
  });

  test("the budget stops the page and next_offset points at the first document left out", () => {
    const two = bytes(all.slice(0, 2));
    const page = pageDocuments(all, { limit: 5, offset: 1, maxLength: two });
    expect(page).toMatchObject({ total: 7, offset: 1, returned: 2, next_offset: 3 });
    expect(page.documents).toEqual(all.slice(1, 3));
  });
});

describe("oversized first document", () => {
  const big = [
    { _id: "a", name: "Big", blob: "x".repeat(500) },
    { _id: "b", name: "Small" },
  ];

  test("returns no documents, the oversized document and a hint", () => {
    const page = pageDocuments(big, { limit: 10, offset: 0, maxLength: 100 });
    expect(page.documents).toEqual([]);
    expect(page.returned).toBe(0);
    expect(page.oversized).toEqual({ _id: "a", name: "Big", bytes: bytes(big[0]) });
    expect(page.next_offset).toBe(0);
    expect(page.hint).toContain("requested_fields");
    expect(page.hint).toContain("get_document");
  });

  test("next_offset is the oversized document's offset", () => {
    const page = pageDocuments([{ _id: "z", name: "Z" }, ...big], { limit: 10, offset: 1, maxLength: 100 });
    expect(page.oversized?._id).toBe("a");
    expect(page.next_offset).toBe(1);
  });

  test("a later oversized document just ends the page", () => {
    const page = pageDocuments([big[1], big[0]], { limit: 10, offset: 0, maxLength: 100 });
    expect(page.documents).toEqual([big[1]]);
    expect(page.oversized).toBeUndefined();
    expect(page.next_offset).toBe(1);
  });
});

describe("max_length budget", () => {
  test("0 means no limit", () => {
    const big = docs(3, () => ({ blob: "x".repeat(300000) }));
    expect(fitToBudget(big, 0).documents).toHaveLength(3);
  });

  test("the default budget applies when max_length is omitted", async () => {
    const client = createClient();
    const big = docs(3, () => ({ blob: "x".repeat(90000) }));
    jest.spyOn(client as any, "queryWorldDocuments").mockResolvedValue(big);

    const omitted = await client.getDocuments("actors", { requestedFields: ["*"] });
    expect(omitted.returned).toBe(2);
    expect(omitted.next_offset).toBe(2);

    const unlimited = await client.getDocuments("actors", { maxLength: 0, requestedFields: ["*"] });
    expect(unlimited.returned).toBe(3);
    expect(unlimited.next_offset).toBeNull();
  });

  test("each document is measured once", () => {
    const list = docs(50);
    const spy = jest.spyOn(JSON, "stringify");
    try {
      fitToBudget(list, 100000);
      expect(spy).toHaveBeenCalledTimes(list.length);
      spy.mockClear();
      fitToBudget(list, 300); // stops early; never re-serialises the prefix
      expect(spy.mock.calls.length).toBeLessThanOrEqual(list.length);
    } finally {
      spy.mockRestore();
    }
  });

  test("buildPage reports an oversized document with a null name when it has none", () => {
    const page = buildPage([{ _id: "m", blob: "x".repeat(100) }], 1, 0, 10);
    expect(page.oversized).toMatchObject({ _id: "m", name: null });
  });
});

describe("summary fields", () => {
  test("each collection has the configured summary set", () => {
    expect(summaryFieldsForCollection("actors")).toEqual(["_id", "name", "type", "folder"]);
    expect(summaryFieldsForCollection("messages")).toEqual(["_id", "timestamp", "speaker.alias", "author"]);
    expect(summaryFieldsForCollection("settings")).toEqual(["_id", "key"]);
    expect(summaryFieldsForCollection("users")).toEqual(["_id", "name", "role"]);
    expect(summaryFieldsForDocumentName("ChatMessage")).toEqual(summaryFieldsForCollection("messages"));
    for (const config of DOCUMENT_TYPES) {
      expect(config.summaryFields).toContain("_id");
    }
  });

  test("resolveRequestedFields", () => {
    const defaults = ["_id", "name"];
    expect(resolveRequestedFields(undefined, defaults)).toBe(defaults);
    expect(resolveRequestedFields([], defaults)).toBe(defaults);
    expect(resolveRequestedFields(["*"], defaults)).toBeNull();
    expect(resolveRequestedFields(["a", "*"], defaults)).toBeNull();
    expect(resolveRequestedFields(["a"], defaults)).toEqual(["a"]);
    expect(resolveRequestedFields(undefined)).toBeNull();
  });

  test.each([
    ["actors", ["_id", "name", "type", "folder"]],
    ["settings", ["_id", "name", "key"]],
    ["users", ["_id", "name", "role"]],
  ])("a world list read of %s asks the index for its summary fields", async (collection, indexFields) => {
    const client = createClient();
    const query = jest.spyOn(client as any, "queryWorldDocuments").mockResolvedValue([]);

    await client.getDocuments(collection);

    expect(query.mock.calls[0][2]).toEqual(indexFields);
  });

  test("a pack list read uses the summary fields of its document type", async () => {
    const client = createClient();
    jest.spyOn(client as any, "loadWorldSnapshot").mockResolvedValue({ packs: [{ id: "w.p", type: "Item" }] });
    const fetch = jest.spyOn(client as any, "sendGetRequest").mockResolvedValue({ result: [] });

    await client.getPackDocuments("Item", "w.p");

    expect(fetch.mock.calls[0][1]).toMatchObject({ index: true, indexFields: ["_id", "name", "type", "folder"] });
  });

  test('["*"] returns full documents with no index', async () => {
    const client = createClient();
    const full = [{ _id: "1", name: "A", type: "npc", system: { hp: 1 } }];
    const query = jest.spyOn(client as any, "queryWorldDocuments").mockResolvedValue(full);

    const page = await client.getDocuments("actors", { requestedFields: ["*"] });

    expect(query.mock.calls[0][2]).toBeNull();
    expect(page.documents).toEqual(full);
  });

  test("singular reads stay full unless fields are requested", async () => {
    const client = createClient();
    const full = [{ _id: "1", name: "A", system: { hp: 1 } }];
    const query = jest.spyOn(client as any, "queryWorldDocuments").mockResolvedValue(full);

    await expect(client.getDocument("actors", { _id: "1" })).resolves.toEqual(full[0]);
    expect(query.mock.calls[0][2]).toBeNull();
    await expect(client.getDocument("actors", { _id: "1" }, { requestedFields: ["*"] })).resolves.toEqual(full[0]);
    expect(query.mock.calls[1][2]).toBeNull();
  });
});

describe("limit", () => {
  test("is clamped to 1000", async () => {
    const client = createClient();
    jest.spyOn(client as any, "queryWorldDocuments").mockResolvedValue(docs(1500));

    const page = await client.getDocuments("actors", { limit: 5000, maxLength: 0 });

    expect(page.returned).toBe(1000);
    expect(page.total).toBe(1500);
    expect(page.next_offset).toBe(1000);
  });

  test("defaults to 100", async () => {
    const client = createClient();
    jest.spyOn(client as any, "queryWorldDocuments").mockResolvedValue(docs(150));

    const page = await client.getDocuments("actors");

    expect(page.returned).toBe(100);
    expect(page.next_offset).toBe(100);
  });
});

describe("message order", () => {
  const messages = [
    { _id: "m1", timestamp: 300, speaker: { alias: "C" } },
    { _id: "m2", timestamp: 100, speaker: { alias: "A" } },
    { _id: "m3", timestamp: 200, speaker: { alias: "B" } },
    { _id: "m4", timestamp: 400, speaker: { alias: "D" } },
  ];

  function messageClient() {
    const client = createClient();
    const send = jest.spyOn(client as any, "sendGetRequest").mockImplementation(async (...args: unknown[]) => {
      const operation = args[1] as { query: { _id?: string } };
      const result = operation.query._id
        ? messages.filter((m) => m._id === operation.query._id)
        : messages.map(({ _id, timestamp }) => ({ _id, timestamp }));
      return { result };
    });
    return { client, send };
  }

  test("newest first by default", async () => {
    const { client } = messageClient();
    const page = await client.getDocuments("messages", { limit: 2 });
    expect(page.documents.map((m) => m._id)).toEqual(["m4", "m1"]);
    expect(page).toMatchObject({ total: 4, returned: 2, next_offset: 2 });
    const next = await client.getDocuments("messages", { limit: 2, offset: 2 });
    expect(next.documents.map((m) => m._id)).toEqual(["m3", "m2"]);
    expect(next.next_offset).toBeNull();
  });

  test("oldest first", async () => {
    const { client } = messageClient();
    const page = await client.getDocuments("messages", { limit: 3, sort: "oldest" });
    expect(page.documents.map((m) => m._id)).toEqual(["m2", "m3", "m1"]);
    expect(page.next_offset).toBe(3);
  });

  test("fetches _id and timestamp for all, then only the page's fields one by one", async () => {
    const { client, send } = messageClient();
    const page = await client.getDocuments("messages", { limit: 2 });

    const operations = send.mock.calls.map((call) => call[1] as any);
    expect(operations[0]).toMatchObject({ index: true, indexFields: ["_id", "name", "timestamp"], query: {} });
    expect(operations.slice(1).map((op) => op.query)).toEqual([{ _id: "m4" }, { _id: "m1" }]);
    expect(operations[1].indexFields).toEqual(["_id", "name", "timestamp", "speaker.alias", "author"]);
    expect(page.documents[0]).toEqual({ _id: "m4", timestamp: 400, speaker: { alias: "D" } });
  });

  test('["*"] fetches the page documents in full', async () => {
    const { client, send } = messageClient();
    await client.getDocuments("messages", { limit: 1, requestedFields: ["*"] });
    expect((send.mock.calls[1][1] as any).index).toBe(false);
  });

  test("where filters before sorting and paging", async () => {
    const client = createClient();
    const rows = [
      { _id: "a", timestamp: 1, type: 1 },
      { _id: "b", timestamp: 2, type: 0 },
      { _id: "c", timestamp: 3, type: 1 },
    ];
    jest.spyOn(client as any, "sendGetRequest").mockImplementation(async (...args: unknown[]) => {
      const query = (args[1] as any).query;
      return { result: query._id ? rows.filter((r) => r._id === query._id) : rows };
    });
    const page = await client.getDocuments("messages", { where: { type: 1 } });
    expect(page.total).toBe(2);
    expect(page.documents.map((m) => m._id)).toEqual(["c", "a"]);
  });

  test("the page still obeys the byte budget", async () => {
    const client = createClient();
    const big = [
      { _id: "a", timestamp: 1, text: "x".repeat(500) },
      { _id: "b", timestamp: 2, text: "y".repeat(500) },
    ];
    jest.spyOn(client as any, "sendGetRequest").mockImplementation(async (...args: unknown[]) => {
      const query = (args[1] as any).query;
      return { result: query._id ? big.filter((r) => r._id === query._id) : big };
    });
    const page = await client.getDocuments("messages", { requestedFields: ["*"], maxLength: 100 });
    expect(page.documents).toEqual([]);
    expect(page.oversized).toMatchObject({ _id: "b" });
    expect(page.next_offset).toBe(0);
  });
});

describe("list tool definition", () => {
  test("documents limit, offset, budget and summary fields", () => {
    const def = getDocumentsTool;
    expect(Object.keys(def.inputSchema.properties)).toEqual(
      expect.arrayContaining(["collection", "limit", "offset", "max_length", "requested_fields", "where", "sort", "pack"])
    );
    expect(def.description).toContain("next_offset");
    expect(def.inputSchema.properties.requested_fields.description).toContain("_id, name, type, folder");
  });

  test("sort is for messages only", () => {
    const sort = getDocumentsTool.inputSchema.properties.sort;
    expect(sort.enum).toEqual(["newest", "oldest"]);
    expect(sort.description).toContain("messages only");
  });
});

describe("list tool handler", () => {
  const page = { total: 0, offset: 0, returned: 0, next_offset: null, documents: [] };

  test("passes paging arguments through and leaves an omitted max_length unset", async () => {
    const { createToolHandler } = await import("../src/server-tools.js");
    const client = { isConnected: () => true, getDocuments: jest.fn().mockResolvedValue(page) } as any;
    const handler = createToolHandler(client);

    await handler({ params: { name: "get_documents", arguments: { collection: "messages", limit: 5, offset: 10, sort: "oldest" } } });
    await handler({ params: { name: "get_documents", arguments: { collection: "messages", max_length: 0 } } });

    expect(client.getDocuments.mock.calls[0][1]).toMatchObject({ limit: 5, offset: 10, sort: "oldest", maxLength: undefined });
    expect(client.getDocuments.mock.calls[1][1]).toMatchObject({ maxLength: 0 });
  });

  test("rejects an unknown sort", async () => {
    const { createToolHandler } = await import("../src/server-tools.js");
    const client = { isConnected: () => true, getDocuments: jest.fn() } as any;
    const response = await createToolHandler(client)({ params: { name: "get_documents", arguments: { collection: "messages", sort: "sideways" } } });
    expect((response as any).isError).toBe(true);
    expect(client.getDocuments).not.toHaveBeenCalled();
  });
});
