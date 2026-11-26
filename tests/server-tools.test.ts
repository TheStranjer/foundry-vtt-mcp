import {
  createToolDefinitions,
  createToolHandler,
  DOCUMENT_TYPES,
} from "../src/server-tools.js";

describe("server tools", () => {
  test("createToolDefinitions includes document tools", () => {
    const tools = createToolDefinitions();
    expect(tools.find((tool) => tool.name === "get_documents")).toBeTruthy();
    expect(tools.find((tool) => tool.name === "get_document")).toBeTruthy();
  });

  test("the 26 per-collection getters are gone, with no aliases", () => {
    const names = createToolDefinitions().map((tool) => tool.name);
    for (const config of DOCUMENT_TYPES) {
      expect(names).not.toContain(`get_${config.plural}`);
      expect(names).not.toContain(`get_${config.singular}`);
    }
  });

  test("no description mentions get_* or an old per-collection tool", () => {
    const text = JSON.stringify(createToolDefinitions());
    expect(text).not.toContain("get_*");
    for (const config of DOCUMENT_TYPES) {
      for (const name of [`get_${config.plural}`, `get_${config.singular}`]) {
        expect(text).not.toMatch(new RegExp(`${name}\\b`));
      }
    }
  });

  test("the tool list stays under its byte budget", () => {
    expect(JSON.stringify(createToolDefinitions()).length).toBeLessThan(12000);
  });

  test("collection is an enum of the 13 collections on both read tools", () => {
    const expected = [
      "actors", "items", "folders", "users", "scenes", "journal", "macros",
      "cards", "playlists", "tables", "combats", "messages", "settings",
    ];
    for (const name of ["get_documents", "get_document"]) {
      const tool = createToolDefinitions().find((t) => t.name === name) as any;
      expect([...tool.inputSchema.properties.collection.enum].sort()).toEqual([...expected].sort());
      expect(tool.inputSchema.required).toEqual(["collection"]);
    }
  });

  test("get_documents documents the sort and pack restrictions", () => {
    const tool = createToolDefinitions().find((t) => t.name === "get_documents") as any;
    expect(tool.inputSchema.properties.sort.description).toContain("messages only");
    for (const collection of DOCUMENT_TYPES.filter((c) => c.packable).map((c) => c.collection)) {
      expect(tool.inputSchema.properties.pack.description).toContain(collection);
    }
    for (const collection of DOCUMENT_TYPES.filter((c) => !c.packable).map((c) => c.collection)) {
      expect(tool.inputSchema.properties.pack.description).not.toContain(collection);
    }
  });

  test("modify, create and delete share one short document type line", () => {
    for (const name of ["modify_document", "create_document", "delete_document"]) {
      const tool = createToolDefinitions().find((t) => t.name === name) as any;
      const description = tool.inputSchema.properties.type.description as string;
      expect(description).not.toContain("Valid types include");
      expect(description.length).toBeLessThan(200);
    }
  });

  test("createToolDefinitions includes compendium tools", () => {
    const tools = createToolDefinitions();
    const createCompendium = tools.find((tool) => tool.name === "create_compendium");
    const deleteCompendium = tools.find((tool) => tool.name === "delete_compendium");
    expect(createCompendium).toBeTruthy();
    expect(deleteCompendium).toBeTruthy();
    expect(createCompendium?.inputSchema.required).toContain("label");
    expect(createCompendium?.inputSchema.required).toContain("type");
    expect(deleteCompendium?.inputSchema.required).toContain("name");
  });

  test("document tools include pack parameter", () => {
    const tools = createToolDefinitions();
    const modifyDocument = tools.find((tool) => tool.name === "modify_document");
    const createDocument = tools.find((tool) => tool.name === "create_document");
    const deleteDocument = tools.find((tool) => tool.name === "delete_document");

    expect(modifyDocument?.inputSchema.properties).toHaveProperty("pack");
    expect(createDocument?.inputSchema.properties).toHaveProperty("pack");
    expect(deleteDocument?.inputSchema.properties).toHaveProperty("pack");
  });

  test("handler blocks when not connected and reconnecting fails", async () => {
    const client = {
      isConnected: () => false,
      ensureConnected: jest.fn(async () => false),
    } as any;
    const handler = createToolHandler(client);

    const response = await handler({ params: { name: "get_documents", arguments: { collection: "actors" } } });
    expect((response as any).isError).toBe(true);
    expect(client.ensureConnected).toHaveBeenCalled();
  });

  test("handler reconnects on demand before running a tool", async () => {
    const client = {
      isConnected: () => false,
      ensureConnected: jest.fn(async () => true),
      getDocuments: jest.fn(async () => [{ _id: "1", name: "A" }]),
    } as any;
    const handler = createToolHandler(client);

    const response = await handler({ params: { name: "get_documents", arguments: { collection: "actors" } } });
    expect((response as any).isError).toBeUndefined();
    expect(client.getDocuments).toHaveBeenCalled();
  });

  test("get_[plural] returns documents", async () => {
    const client = {
      isConnected: () => true,
      getDocuments: jest.fn().mockResolvedValue([{ _id: "1" }]),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "get_documents",
        arguments: { collection: "actors", max_length: 5, requested_fields: ["name"], where: { type: "npc" } },
      },
    });

    expect(client.getDocuments).toHaveBeenCalled();
    expect((response as any).isError).toBeUndefined();
  });

  test("get_actor resolves dot-notation through the real client and filter", async () => {
    const { FoundryClient } = await import("../src/foundry-client.js");
    const client = new FoundryClient("/tmp/creds.json", {
      logger: { error: jest.fn() },
      wsLogger: { logInbound: jest.fn(), logOutbound: jest.fn(), close: jest.fn() },
    } as any);

    jest.spyOn(client, "isConnected").mockReturnValue(true);
    jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({
      result: [
        {
          _id: "jJ10LA0URnIaLu7g",
          name: "Bezaliel",
          system: { age: 52, aspirations: "Uncover the Mysteries.", secret: "omitted" },
        },
      ],
    });

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "get_document",
        arguments: { collection: "actors",
          name: "Bezaliel",
          requested_fields: ["system.age", "system.aspirations"],
        },
      },
    });

    expect(JSON.parse((response as any).content[0].text)).toEqual({
      _id: "jJ10LA0URnIaLu7g",
      name: "Bezaliel",
      system: { age: 52, aspirations: "Uncover the Mysteries." },
    });
  });

  test("get_[plural] returns error on failure", async () => {
    const client = {
      isConnected: () => true,
      getDocuments: jest.fn().mockRejectedValue(new Error("boom")),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_documents", arguments: { collection: "actors" } } });

    expect((response as any).isError).toBe(true);
    expect(response.content[0].text).toContain("boom");
  });

  test("get_[singular] requires identifier", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_document", arguments: { collection: "actors" } } });

    expect((response as any).isError).toBe(true);
  });

  test("get_[singular] returns not found", async () => {
    const client = {
      isConnected: () => true,
      getDocument: jest.fn().mockResolvedValue(null),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_document", arguments: { collection: "actors", name: "Missing" } } });

    expect((response as any).isError).toBeUndefined();
    expect(response.content[0].text).toContain("not found");
  });

  test("get_[singular] returns error on failure", async () => {
    const client = {
      isConnected: () => true,
      getDocument: jest.fn().mockRejectedValue(new Error("nope")),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_document", arguments: { collection: "actors", name: "x" } } });

    expect((response as any).isError).toBe(true);
  });

  describe("compendium reads", () => {
    test("each collection routes to the right world read, and rejects pack unless packable", async () => {
      for (const config of DOCUMENT_TYPES) {
        const client = {
          isConnected: () => true,
          getDocuments: jest.fn().mockResolvedValue({ documents: [] }),
          getDocument: jest.fn().mockResolvedValue({ _id: "1" }),
          getPackDocuments: jest.fn().mockResolvedValue({ documents: [] }),
          getPackDocument: jest.fn().mockResolvedValue({ _id: "1" }),
        } as any;
        const handler = createToolHandler(client);

        await handler({ params: { name: "get_documents", arguments: { collection: config.collection } } });
        expect(client.getDocuments).toHaveBeenCalledWith(config.collection, expect.any(Object));
        await handler({ params: { name: "get_document", arguments: { collection: config.collection, name: "x" } } });
        expect(client.getDocument).toHaveBeenCalledWith(config.collection, { id: undefined, _id: undefined, name: "x" }, expect.any(Object));
        expect(client.getPackDocuments).not.toHaveBeenCalled();
        expect(client.getPackDocument).not.toHaveBeenCalled();

        const list = await handler({ params: { name: "get_documents", arguments: { collection: config.collection, pack: "w.p" } } });
        const one = await handler({ params: { name: "get_document", arguments: { collection: config.collection, pack: "w.p", _id: "1" } } });
        if (config.packable) {
          expect(client.getPackDocuments).toHaveBeenCalledWith(config.documentName, "w.p", expect.any(Object));
          expect(client.getPackDocument).toHaveBeenCalledWith(config.documentName, "w.p", expect.any(Object), expect.any(Object));
          expect((list as any).isError).toBeUndefined();
          expect((one as any).isError).toBeUndefined();
        } else {
          expect((list as any).isError).toBe(true);
          expect(list.content[0].text).toBe(`Error: ${config.plural} cannot be stored in a compendium`);
          expect((one as any).isError).toBe(true);
          expect(client.getPackDocuments).not.toHaveBeenCalled();
          expect(client.getPackDocument).not.toHaveBeenCalled();
        }
      }
    });

    test("an unknown or missing collection is rejected", async () => {
      const client = { isConnected: () => true, getDocuments: jest.fn(), getDocument: jest.fn() } as any;
      const handler = createToolHandler(client);

      for (const name of ["get_documents", "get_document"]) {
        for (const args of [{}, { collection: "dragons", name: "x" }]) {
          const response = await handler({ params: { name, arguments: args } });
          expect((response as any).isError).toBe(true);
          expect(response.content[0].text).toContain("'collection' must be one of");
        }
      }
      expect(client.getDocuments).not.toHaveBeenCalled();
      expect(client.getDocument).not.toHaveBeenCalled();
    });

    test("a missing identifier is rejected for every collection", async () => {
      const client = { isConnected: () => true, getDocument: jest.fn(), getPackDocument: jest.fn() } as any;
      const handler = createToolHandler(client);

      for (const config of DOCUMENT_TYPES) {
        const response = await handler({ params: { name: "get_document", arguments: { collection: config.collection } } });
        expect((response as any).isError).toBe(true);
        expect(response.content[0].text).toContain("Must provide at least one of: id, _id, or name");
      }
      expect(client.getDocument).not.toHaveBeenCalled();
    });

    test("get_documents passes paging and sort options to the world read", async () => {
      const client = { isConnected: () => true, getDocuments: jest.fn().mockResolvedValue({}) } as any;
      await createToolHandler(client)({
        params: {
          name: "get_documents",
          arguments: { collection: "messages", limit: 5, offset: 10, sort: "oldest", max_length: 0, where: { type: 1 } },
        },
      });
      expect(client.getDocuments).toHaveBeenCalledWith("messages", {
        limit: 5,
        offset: 10,
        maxLength: 0,
        sort: "oldest",
        requestedFields: null,
        where: { type: 1 },
      });
    });

    test("createToolDefinitions includes get_compendiums", () => {
      const tool = createToolDefinitions().find((t) => t.name === "get_compendiums");
      expect(tool).toBeTruthy();
      expect(tool?.inputSchema.properties).toHaveProperty("type");
      expect(tool?.inputSchema.required).toEqual([]);
    });

    test("get_[plural] with pack reads from the compendium", async () => {
      const client = {
        isConnected: () => true,
        getDocuments: jest.fn(),
        getPackDocuments: jest.fn().mockResolvedValue([{ _id: "1" }]),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "get_documents",
          arguments: { collection: "items",
            pack: "my-module.items",
            max_length: 5,
            requested_fields: ["name"],
            where: { type: "consumable" },
          },
        },
      });

      expect(client.getDocuments).not.toHaveBeenCalled();
      expect(client.getPackDocuments).toHaveBeenCalledWith("Item", "my-module.items", {
        maxLength: 5,
        requestedFields: ["name"],
        where: { type: "consumable" },
      });
      expect((response as any).isError).toBeUndefined();
      expect(JSON.parse(response.content[0].text)).toEqual([{ _id: "1" }]);
    });

    test("get_[plural] without pack still reads the world", async () => {
      const client = {
        isConnected: () => true,
        getDocuments: jest.fn().mockResolvedValue([]),
        getPackDocuments: jest.fn(),
      } as any;

      const handler = createToolHandler(client);
      await handler({ params: { name: "get_documents", arguments: { collection: "items" } } });

      expect(client.getDocuments).toHaveBeenCalled();
      expect(client.getPackDocuments).not.toHaveBeenCalled();
    });

    test("get_[plural] with pack maps journals to JournalEntry", async () => {
      const client = {
        isConnected: () => true,
        getPackDocuments: jest.fn().mockResolvedValue([]),
      } as any;

      const handler = createToolHandler(client);
      await handler({ params: { name: "get_documents", arguments: { collection: "journal", pack: "w.notes" } } });

      expect(client.getPackDocuments).toHaveBeenCalledWith("JournalEntry", "w.notes", expect.any(Object));
    });

    test("get_[plural] with pack rejects types that cannot be in a compendium", async () => {
      const client = { isConnected: () => true, getPackDocuments: jest.fn() } as any;

      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "get_documents", arguments: { collection: "folders", pack: "w.x" } } });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("cannot be stored in a compendium");
      expect(client.getPackDocuments).not.toHaveBeenCalled();
    });

    test("get_[plural] with pack returns error on failure", async () => {
      const client = {
        isConnected: () => true,
        getPackDocuments: jest.fn().mockRejectedValue(new Error('Compendium pack "w.x" not found')),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "get_documents", arguments: { collection: "items", pack: "w.x" } } });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("not found");
    });

    test("get_[singular] with pack reads one document from the compendium", async () => {
      const client = {
        isConnected: () => true,
        getDocument: jest.fn(),
        getPackDocument: jest.fn().mockResolvedValue({ _id: "1", name: "Rune" }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "get_document",
          arguments: { collection: "items", pack: "my-module.items", _id: "1", requested_fields: ["system.price"] },
        },
      });

      expect(client.getDocument).not.toHaveBeenCalled();
      expect(client.getPackDocument).toHaveBeenCalledWith(
        "Item",
        "my-module.items",
        { id: undefined, _id: "1", name: undefined },
        { requestedFields: ["system.price"] }
      );
      expect(JSON.parse(response.content[0].text)).toEqual({ _id: "1", name: "Rune" });
    });

    test("get_[singular] with pack returns not found", async () => {
      const client = {
        isConnected: () => true,
        getPackDocument: jest.fn().mockResolvedValue(null),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "get_document", arguments: { collection: "items", pack: "w.items", name: "Missing" } },
      });

      expect((response as any).isError).toBeUndefined();
      expect(response.content[0].text).toContain("not found");
    });

    test("get_[singular] with pack still requires an identifier", async () => {
      const client = { isConnected: () => true, getPackDocument: jest.fn() } as any;

      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "get_document", arguments: { collection: "items", pack: "w.items" } } });

      expect((response as any).isError).toBe(true);
      expect(client.getPackDocument).not.toHaveBeenCalled();
    });

    test("get_[singular] with pack rejects types that cannot be in a compendium", async () => {
      const client = { isConnected: () => true, getPackDocument: jest.fn() } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: { name: "get_document", arguments: { collection: "users", pack: "w.x", name: "Gamemaster" } },
      });

      expect((response as any).isError).toBe(true);
      expect(client.getPackDocument).not.toHaveBeenCalled();
    });

    test("get_compendiums lists packs", async () => {
      const client = {
        isConnected: () => true,
        getCompendiums: jest.fn().mockResolvedValue([{ id: "w.items", label: "Items", type: "Item" }]),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "get_compendiums", arguments: { type: "Item" } } });

      expect(client.getCompendiums).toHaveBeenCalledWith({ type: "Item" });
      expect(JSON.parse(response.content[0].text)).toEqual([{ id: "w.items", label: "Items", type: "Item" }]);
    });

    test("get_compendiums without a type lists everything", async () => {
      const client = { isConnected: () => true, getCompendiums: jest.fn().mockResolvedValue([]) } as any;

      const handler = createToolHandler(client);
      await handler({ params: { name: "get_compendiums" } });

      expect(client.getCompendiums).toHaveBeenCalledWith({ type: null });
    });

    test("get_compendiums returns error on failure", async () => {
      const client = {
        isConnected: () => true,
        getCompendiums: jest.fn().mockRejectedValue(new Error("nope")),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({ params: { name: "get_compendiums" } });

      expect((response as any).isError).toBe(true);
    });
  });

  test("get_world returns world", async () => {
    const client = {
      isConnected: () => true,
      getWorld: jest.fn().mockResolvedValue({ title: "World" }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_world" } });

    expect(client.getWorld).toHaveBeenCalledWith(
      [...DOCUMENT_TYPES.map((config) => config.collection), ...[ 'packs', 'model', 'template', 'system' ]]
    );
    expect((response as any).isError).toBeUndefined();
  });

  test("modify_document validates inputs", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "modify_document", arguments: { _id: "1" } } });

    expect((response as any).isError).toBe(true);
  });

  test("modify_document executes", async () => {
    const client = {
      isConnected: () => true,
      modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "modify_document",
        arguments: { type: "Actor", _id: "1", updates: [{ name: "x" }], parent_uuid: "Scene.1" },
      },
    });

    expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "1", [{ name: "x" }], { parentUuid: "Scene.1", pack: undefined });
    expect((response as any).isError).toBeUndefined();
  });

  test("modify_document executes with pack", async () => {
    const client = {
      isConnected: () => true,
      modifyDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "modify_document",
        arguments: {
          type: "Actor",
          _id: "1",
          updates: [{ name: "x" }],
          pack: "world.my-compendium",
        },
      },
    });

    expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "1", [{ name: "x" }], {
      parentUuid: undefined,
      pack: "world.my-compendium",
    });
    expect((response as any).isError).toBeUndefined();
  });

  test("modify_document returns error on failure", async () => {
    const client = {
      isConnected: () => true,
      modifyDocument: jest.fn().mockRejectedValue(new Error("Modify failed")),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "modify_document",
        arguments: { type: "Actor", _id: "1", updates: [{ name: "x" }] },
      },
    });

    expect((response as any).isError).toBe(true);
    expect(response.content[0].text).toContain("Modify failed");
  });

  test("create_document validates inputs", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "create_document", arguments: { type: "Actor" } } });

    expect((response as any).isError).toBe(true);
  });

  test("create_document executes", async () => {
    const client = {
      isConnected: () => true,
      createDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "create_document",
        arguments: { type: "Actor", data: [{ name: "x" }], parent_uuid: "Scene.1" },
      },
    });

    expect(client.createDocument).toHaveBeenCalledWith("Actor", [{ name: "x" }], {
      parentUuid: "Scene.1",
      pack: undefined,
    });
    expect((response as any).isError).toBeUndefined();
  });

  test("create_document executes with pack", async () => {
    const client = {
      isConnected: () => true,
      createDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "create_document",
        arguments: {
          type: "Actor",
          data: [{ name: "Goblin" }],
          pack: "world.monsters",
        },
      },
    });

    expect(client.createDocument).toHaveBeenCalledWith("Actor", [{ name: "Goblin" }], {
      parentUuid: undefined,
      pack: "world.monsters",
    });
    expect((response as any).isError).toBeUndefined();
  });

  test("create_document returns error on failure", async () => {
    const client = {
      isConnected: () => true,
      createDocument: jest.fn().mockRejectedValue(new Error("Create failed")),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "create_document",
        arguments: { type: "Actor", data: [{ name: "x" }] },
      },
    });

    expect((response as any).isError).toBe(true);
    expect(response.content[0].text).toContain("Create failed");
  });

  test("delete_document validates inputs", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "delete_document", arguments: { type: "Actor", ids: [] } } });

    expect((response as any).isError).toBe(true);
  });

  test("delete_document executes", async () => {
    const client = {
      isConnected: () => true,
      deleteDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "delete_document",
        arguments: { type: "Actor", ids: ["1", "2"], parent_uuid: "Scene.1" },
      },
    });

    expect(client.deleteDocument).toHaveBeenCalledWith("Actor", ["1", "2"], {
      parentUuid: "Scene.1",
      pack: undefined,
    });
    expect((response as any).isError).toBeUndefined();
  });

  test("delete_document executes with pack", async () => {
    const client = {
      isConnected: () => true,
      deleteDocument: jest.fn().mockResolvedValue({ ok: true }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "delete_document",
        arguments: {
          type: "Actor",
          ids: ["abc123"],
          pack: "world.monsters",
        },
      },
    });

    expect(client.deleteDocument).toHaveBeenCalledWith("Actor", ["abc123"], {
      parentUuid: undefined,
      pack: "world.monsters",
    });
    expect((response as any).isError).toBeUndefined();
  });

  test("delete_document returns error on failure", async () => {
    const client = {
      isConnected: () => true,
      deleteDocument: jest.fn().mockRejectedValue(new Error("Delete failed")),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "delete_document",
        arguments: { type: "Actor", ids: ["1"] },
      },
    });

    expect((response as any).isError).toBe(true);
    expect(response.content[0].text).toContain("Delete failed");
  });

  test("show_credentials returns data", async () => {
    const client = {
      isConnected: () => true,
      getCredentialsInfo: jest.fn().mockReturnValue([{ _id: "x" }]),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "show_credentials" } });

    expect((response as any).isError).toBeUndefined();
  });

  test("choose_foundry_instance validates inputs", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "choose_foundry_instance", arguments: {} } });

    expect((response as any).isError).toBe(true);
  });

  test("choose_foundry_instance returns success", async () => {
    const client = {
      isConnected: () => true,
      chooseFoundryInstance: jest.fn().mockResolvedValue(undefined),
      getHostname: jest.fn().mockReturnValue("host"),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "choose_foundry_instance", arguments: { item_order: 0 } } });

    expect((response as any).isError).toBeUndefined();
  });

  test("unknown tool throws", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    await expect(handler({ params: { name: "missing_tool" } }))
      .rejects.toThrow("Unknown tool");
  });

  describe("upload_file", () => {
    test("requires target", async () => {
      const client = {
        isConnected: () => true,
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "upload_file",
          arguments: { filename: "test.png", image_data: "abc" },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("'target' is required");
    });

    test("requires filename", async () => {
      const client = {
        isConnected: () => true,
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "upload_file",
          arguments: { target: "worlds/test", image_data: "abc" },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("'filename' is required");
    });

    test("executes successfully with image_data", async () => {
      const client = {
        isConnected: () => true,
        uploadFile: jest.fn().mockResolvedValue({ path: "worlds/test/image.png" }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "upload_file",
          arguments: {
            target: "worlds/test",
            filename: "image.png",
            image_data: "aGVsbG8=",
          },
        },
      });

      expect(client.uploadFile).toHaveBeenCalledWith({
        target: "worlds/test",
        filename: "image.png",
        url: undefined,
        image_data: "aGVsbG8=",
      });
      expect((response as any).isError).toBeUndefined();
    });

    test("executes successfully with url", async () => {
      const client = {
        isConnected: () => true,
        uploadFile: jest.fn().mockResolvedValue({ path: "worlds/test/image.png" }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "upload_file",
          arguments: {
            target: "worlds/test",
            filename: "image.png",
            url: "https://example.com/image.png",
          },
        },
      });

      expect(client.uploadFile).toHaveBeenCalledWith({
        target: "worlds/test",
        filename: "image.png",
        url: "https://example.com/image.png",
        image_data: undefined,
      });
      expect((response as any).isError).toBeUndefined();
    });

    test("returns error on failure", async () => {
      const client = {
        isConnected: () => true,
        uploadFile: jest.fn().mockRejectedValue(new Error("Upload failed")),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "upload_file",
          arguments: {
            target: "worlds/test",
            filename: "image.png",
            image_data: "abc",
          },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("Upload failed");
    });
  });

  describe("browse_files", () => {
    test("requires target", async () => {
      const client = {
        isConnected: () => true,
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "browse_files",
          arguments: {},
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("'target' is required");
    });

    test("executes successfully with default options", async () => {
      const client = {
        isConnected: () => true,
        browseFiles: jest.fn().mockResolvedValue({
          target: "worlds/test",
          dirs: ["worlds/test/avatars"],
          files: [],
        }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "browse_files",
          arguments: { target: "worlds/test" },
        },
      });

      expect(client.browseFiles).toHaveBeenCalledWith({
        target: "worlds/test",
        type: undefined,
        extensions: undefined,
      });
      expect((response as any).isError).toBeUndefined();
    });

    test("executes successfully with custom options", async () => {
      const client = {
        isConnected: () => true,
        browseFiles: jest.fn().mockResolvedValue({
          target: "worlds/test",
          dirs: [],
          files: ["worlds/test/song.mp3"],
        }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "browse_files",
          arguments: {
            target: "worlds/test",
            type: "audio",
            extensions: [".mp3", ".wav"],
          },
        },
      });

      expect(client.browseFiles).toHaveBeenCalledWith({
        target: "worlds/test",
        type: "audio",
        extensions: [".mp3", ".wav"],
      });
      expect((response as any).isError).toBeUndefined();
    });

    test("returns error on failure", async () => {
      const client = {
        isConnected: () => true,
        browseFiles: jest.fn().mockRejectedValue(new Error("Directory not found")),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "browse_files",
          arguments: { target: "worlds/test" },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("Directory not found");
    });
  });

  describe("create_compendium", () => {
    test("requires label", async () => {
      const client = {
        isConnected: () => true,
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "create_compendium",
          arguments: { type: "Actor" },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("'label' is required");
    });

    test("requires type", async () => {
      const client = {
        isConnected: () => true,
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "create_compendium",
          arguments: { label: "My Compendium" },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("'type' is required");
    });

    test("executes successfully", async () => {
      const client = {
        isConnected: () => true,
        createCompendium: jest.fn().mockResolvedValue({
          request: { action: "create" },
          result: {
            label: "My NPCs",
            type: "Actor",
            name: "my-npcs",
            id: "world.my-npcs",
          },
        }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "create_compendium",
          arguments: { label: "My NPCs", type: "Actor" },
        },
      });

      expect(client.createCompendium).toHaveBeenCalledWith("My NPCs", "Actor");
      expect((response as any).isError).toBeUndefined();
      const result = JSON.parse(response.content[0].text);
      expect(result.result.name).toBe("my-npcs");
    });

    test("returns error on failure", async () => {
      const client = {
        isConnected: () => true,
        createCompendium: jest.fn().mockRejectedValue(new Error("Permission denied")),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "create_compendium",
          arguments: { label: "My NPCs", type: "Actor" },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("Permission denied");
    });
  });

  describe("delete_compendium", () => {
    test("requires name", async () => {
      const client = {
        isConnected: () => true,
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "delete_compendium",
          arguments: {},
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("'name' is required");
    });

    test("executes successfully", async () => {
      const client = {
        isConnected: () => true,
        deleteCompendium: jest.fn().mockResolvedValue({
          request: { action: "delete", data: "my-npcs" },
          result: "world.my-npcs",
        }),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "delete_compendium",
          arguments: { name: "my-npcs" },
        },
      });

      expect(client.deleteCompendium).toHaveBeenCalledWith("my-npcs");
      expect((response as any).isError).toBeUndefined();
      const result = JSON.parse(response.content[0].text);
      expect(result.result).toBe("world.my-npcs");
    });

    test("returns error on failure", async () => {
      const client = {
        isConnected: () => true,
        deleteCompendium: jest.fn().mockRejectedValue(new Error("Compendium not found")),
      } as any;

      const handler = createToolHandler(client);
      const response = await handler({
        params: {
          name: "delete_compendium",
          arguments: { name: "nonexistent" },
        },
      });

      expect((response as any).isError).toBe(true);
      expect(response.content[0].text).toContain("Compendium not found");
    });
  });
});
