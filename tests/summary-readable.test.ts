import { EventEmitter } from "events";
import { FoundryClient } from "../src/foundry-client.js";
import { filterDocumentFields } from "../src/core/document-utils.js";

function createClient() {
  const deps = {
    logger: { error: jest.fn() },
    wsLogger: { logInbound: jest.fn(), logOutbound: jest.fn(), close: jest.fn() },
  };
  return new FoundryClient("/tmp/creds.json", deps as any);
}

const users = [
  { _id: "u1", name: "Lukas Wyss", role: 4 },
  { _id: "u2", name: "Mira", role: 1 },
];
const folders = [
  { _id: "f1", name: "Monsters", folder: null },
  { _id: "f2", name: "Bosses", folder: "f1" },
];
const messages = [
  { _id: "m1", timestamp: 1000, speaker: { alias: "A" }, author: "u1", content: "<p>First &amp; <b>best</b></p>" },
  { _id: "m2", timestamp: 2000, speaker: { alias: "B" }, author: "u2", content: "" },
  { _id: "m3", timestamp: 3000, speaker: { alias: "C" }, author: "u1", content: `<p>${"long ".repeat(60)}</p>` },
];
const actors = [
  { _id: "a1", name: "Goblin", type: "npc", folder: "f1" },
  { _id: "a2", name: "Ogre", type: "npc", folder: "f2" },
  { _id: "a3", name: "Loose", type: "npc", folder: null },
];

/** Answers modifyDocument "get" index reads from fixture data, by document class. */
function world(client: FoundryClient) {
  const data: Record<string, Record<string, unknown>[]> = {
    ChatMessage: messages,
    User: users,
    Folder: folders,
    Actor: actors,
  };
  return jest.spyOn(client as any, "sendGetRequest").mockImplementation(async (...args: unknown[]) => {
    const [documentName, operation] = args as [string, { query: Record<string, unknown>; index?: boolean; indexFields?: string[] }];
    const rows = (data[documentName] ?? []).filter((doc) =>
      Object.entries(operation.query).every(([key, value]) => doc[key] === value)
    );
    return { result: operation.index ? rows.map((row) => filterDocumentFields(row, operation.indexFields ?? null)) : rows };
  });
}

const typesOf = (send: jest.SpyInstance) => send.mock.calls.map((call) => call[0] as string);

describe("readable message summaries", () => {
  test("author name with author_id, ISO timestamp and a stripped, cut preview", async () => {
    const client = createClient();
    world(client);
    const page = await client.getDocuments("messages", { sort: "oldest" });

    expect(page.documents[0]).toEqual({
      _id: "m1",
      timestamp: "1970-01-01T00:00:01.000Z",
      speaker: { alias: "A" },
      author: "Lukas Wyss",
      author_id: "u1",
      preview: "First & best",
    });
    expect(page.documents[2].preview).toMatch(/^long long/);
    expect((page.documents[2].preview as string).endsWith("…")).toBe(true);
    expect((page.documents[2].preview as string).length).toBeLessThanOrEqual(121);
  });

  test("empty content leaves preview out, and content is never returned", async () => {
    const client = createClient();
    world(client);
    const page = await client.getDocuments("messages", { sort: "oldest" });
    expect(page.documents[1]).not.toHaveProperty("preview");
    for (const doc of page.documents) expect(doc).not.toHaveProperty("content");
  });

  test("where on the raw author id still works", async () => {
    const client = createClient();
    world(client);
    const page = await client.getDocuments("messages", { where: { author: "u2" } });
    expect(page.documents.map((doc) => doc._id)).toEqual(["m2"]);
    expect(page.documents[0]).toMatchObject({ author: "Mira", author_id: "u2" });
  });

  test("the page budget applies to the readable documents", async () => {
    const client = createClient();
    world(client);
    const one = Buffer.byteLength(JSON.stringify([{
      _id: "m1", timestamp: "1970-01-01T00:00:01.000Z", speaker: { alias: "A" }, author: "Lukas Wyss", author_id: "u1", preview: "First & best",
    }]));
    const page = await client.getDocuments("messages", { sort: "oldest", maxLength: one });
    expect(page).toMatchObject({ total: 3, returned: 1, next_offset: 1 });
  });
});

describe("folder_name", () => {
  test("is resolved next to folder, and folder keeps the id", async () => {
    const client = createClient();
    world(client);
    const page = await client.getDocuments("actors");
    expect(page.documents[0]).toEqual({ _id: "a1", name: "Goblin", type: "npc", folder: "f1", folder_name: "Monsters" });
    expect(page.documents[1]).toMatchObject({ folder: "f2", folder_name: "Bosses" });
  });

  test("is absent for a null folder", async () => {
    const client = createClient();
    world(client);
    const page = await client.getDocuments("actors");
    expect(page.documents[2]).toEqual({ _id: "a3", name: "Loose", type: "npc", folder: null });
  });

  test("where: { folder } keeps working on the id", async () => {
    const client = createClient();
    world(client);
    const page = await client.getDocuments("actors", { where: { folder: "f2" } });
    expect(page.documents.map((doc) => doc._id)).toEqual(["a2"]);
  });

  test("folders resolve their parent folder too", async () => {
    const client = createClient();
    world(client);
    const page = await client.getDocuments("folders");
    expect(page.documents[1]).toMatchObject({ _id: "f2", folder: "f1", folder_name: "Monsters" });
    expect(page.documents[0]).not.toHaveProperty("folder_name");
  });
});

describe("explicit requested_fields stay raw", () => {
  test("messages", async () => {
    const client = createClient();
    world(client);
    const page = await client.getDocuments("messages", { requestedFields: ["timestamp", "author", "content"], sort: "oldest", limit: 1 });
    expect(page.documents[0]).toEqual({ _id: "m1", timestamp: 1000, author: "u1", content: "<p>First &amp; <b>best</b></p>" });
  });

  test("folder has no folder_name, and no lookup request is made", async () => {
    const client = createClient();
    const send = world(client);
    const page = await client.getDocuments("actors", { requestedFields: ["folder"] });
    expect(page.documents[0]).toEqual({ _id: "a1", name: "Goblin", folder: "f1" });
    expect(typesOf(send)).toEqual(["Actor"]);
  });

  test('["*"] returns full documents untouched', async () => {
    const client = createClient();
    const send = world(client);
    const page = await client.getDocuments("actors", { requestedFields: ["*"] });
    expect(page.documents).toEqual(actors);
    expect(typesOf(send)).toEqual(["Actor"]);
  });
});

describe("request counts for a summary page", () => {
  test("messages: one index request plus one user lookup, whatever the limit", async () => {
    const client = createClient();
    const send = world(client);
    await client.getDocuments("messages", { limit: 1 });
    expect(typesOf(send).sort()).toEqual(["ChatMessage", "User"]);
    send.mockClear();
    await client.getDocuments("messages", { limit: 1000 });
    expect(typesOf(send)).toEqual(["ChatMessage"]); // users cached
  });

  test("the lookups are index reads of _id and name", async () => {
    const client = createClient();
    const send = world(client);
    await client.getDocuments("messages");
    await client.getDocuments("actors");
    const lookups = send.mock.calls.filter((call) => ["User", "Folder"].includes(call[0] as string));
    expect(lookups).toHaveLength(2);
    for (const call of lookups) {
      expect(call[1]).toMatchObject({ index: true, indexFields: ["_id", "name"], query: {} });
    }
  });

  test("a collection page costs one index request plus one folder lookup", async () => {
    const client = createClient();
    const send = world(client);
    await client.getDocuments("actors");
    expect(typesOf(send)).toEqual(["Actor", "Folder"]);
    await client.getDocuments("actors");
    expect(typesOf(send)).toEqual(["Actor", "Folder", "Actor"]);
  });

  test("no lookup when nothing on the page needs one", async () => {
    const client = createClient();
    const send = world(client);
    await client.getDocuments("actors", { where: { folder: null } });
    expect(typesOf(send)).toEqual(["Actor"]);
  });

  test("concurrent pages share one lookup", async () => {
    const client = createClient();
    const send = world(client);
    await Promise.all([client.getDocuments("actors"), client.getDocuments("actors")]);
    expect(typesOf(send).filter((type) => type === "Folder")).toHaveLength(1);
  });
});

describe("cache clearing", () => {
  async function primed() {
    const client = createClient();
    const send = world(client);
    await client.getDocuments("actors");
    await client.getDocuments("messages");
    expect(typesOf(send).sort()).toEqual(["Actor", "ChatMessage", "Folder", "User"]);
    send.mockClear();
    await client.getDocuments("actors");
    await client.getDocuments("messages");
    expect(typesOf(send).sort()).toEqual(["Actor", "ChatMessage"]); // reused
    send.mockClear();
    return { client, send };
  }

  async function lookupsAfter(client: FoundryClient, send: jest.SpyInstance) {
    await client.getDocuments("actors");
    await client.getDocuments("messages");
    return typesOf(send).filter((type) => type === "Folder" || type === "User").sort();
  }

  test("reconnect clears both", async () => {
    const { client, send } = await primed();
    const connection = { ws: { close: jest.fn() } };
    (client as any).connection = connection;
    (client as any).adoptSocket(connection, new EventEmitter(), "sid", 13);
    expect(await lookupsAfter(client, send)).toEqual(["Folder", "User"]);
  });

  test("an instance switch clears both", async () => {
    const { client, send } = await primed();
    (client as any).credentials = [{ _id: "c", hostname: "host", password: "p", userid: "u" }];
    jest.spyOn(client as any, "login").mockResolvedValue({
      credential: (client as any).credentials[0],
      sessionId: "s2",
      generation: 13,
      ws: new EventEmitter(),
    });
    await client.chooseFoundryInstance({ item_order: 0 });
    expect(await lookupsAfter(client, send)).toEqual(["Folder", "User"]);
  });

  test("disconnect clears both", async () => {
    const { client, send } = await primed();
    client.disconnect();
    expect(await lookupsAfter(client, send)).toEqual(["Folder", "User"]);
  });

  test.each([
    ["modifyDocument", (client: FoundryClient) => client.modifyDocument("Folder", "f1", [{ name: "New" }])],
    ["createDocument", (client: FoundryClient) => client.createDocument("Folder", [{ name: "New", type: "Actor" }])],
    ["deleteDocument", (client: FoundryClient) => client.deleteDocument("Folder", ["f1"])],
  ])("our own %s of a Folder clears the folder lookup only", async (_name, write) => {
    const { client, send } = await primed();
    jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({ result: [] });
    await write(client).catch(() => undefined);
    expect(await lookupsAfter(client, send)).toEqual(["Folder"]);
  });

  test("a failed Folder write still clears the folder lookup", async () => {
    const { client, send } = await primed();
    jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({ error: { message: "denied" } });
    await expect(client.deleteDocument("Folder", ["f1"])).rejects.toThrow("denied");
    expect(await lookupsAfter(client, send)).toEqual(["Folder"]);
  });

  test("a write to another document type leaves both lookups alone", async () => {
    const { client, send } = await primed();
    jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({ result: [] });
    await client.deleteDocument("Actor", ["a1"]).catch(() => undefined);
    expect(await lookupsAfter(client, send)).toEqual([]);
  });

  test("our own User write clears the user lookup only", async () => {
    const { client, send } = await primed();
    jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({ result: [] });
    await client.deleteDocument("User", ["u1"]).catch(() => undefined);
    expect(await lookupsAfter(client, send)).toEqual(["User"]);
  });
});
