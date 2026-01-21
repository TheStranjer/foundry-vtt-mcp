import {
  createToolDefinitions,
  createToolHandler,
  DOCUMENT_TYPES,
} from "../src/server-tools.js";

describe("server tools", () => {
  test("createToolDefinitions includes document tools", () => {
    const tools = createToolDefinitions();
    const actorList = tools.find((tool) => tool.name === "get_actors");
    const actorGet = tools.find((tool) => tool.name === "get_actor");
    expect(actorList).toBeTruthy();
    expect(actorGet).toBeTruthy();
  });

  test("handler blocks when not connected", async () => {
    const client = {
      isConnected: () => false,
    } as any;
    const handler = createToolHandler(client);

    const response = await handler({ params: { name: "get_actors" } });
    expect((response as any).isError).toBe(true);
  });

  test("get_[plural] returns documents", async () => {
    const client = {
      isConnected: () => true,
      getDocuments: jest.fn().mockResolvedValue([{ _id: "1" }]),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({
      params: {
        name: "get_actors",
        arguments: { max_length: 5, requested_fields: ["name"], where: { type: "npc" } },
      },
    });

    expect(client.getDocuments).toHaveBeenCalled();
    expect((response as any).isError).toBeUndefined();
  });

  test("get_[plural] returns error on failure", async () => {
    const client = {
      isConnected: () => true,
      getDocuments: jest.fn().mockRejectedValue(new Error("boom")),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_actors" } });

    expect((response as any).isError).toBe(true);
    expect(response.content[0].text).toContain("boom");
  });

  test("get_[singular] requires identifier", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_actor", arguments: {} } });

    expect((response as any).isError).toBe(true);
  });

  test("get_[singular] returns not found", async () => {
    const client = {
      isConnected: () => true,
      getDocument: jest.fn().mockResolvedValue(null),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_actor", arguments: { name: "Missing" } } });

    expect((response as any).isError).toBeUndefined();
    expect(response.content[0].text).toContain("not found");
  });

  test("get_[singular] returns error on failure", async () => {
    const client = {
      isConnected: () => true,
      getDocument: jest.fn().mockRejectedValue(new Error("nope")),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_actor", arguments: { name: "x" } } });

    expect((response as any).isError).toBe(true);
  });

  test("get_world returns world", async () => {
    const client = {
      isConnected: () => true,
      getWorld: jest.fn().mockResolvedValue({ title: "World" }),
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "get_world" } });

    expect(client.getWorld).toHaveBeenCalledWith(
      DOCUMENT_TYPES.map((config) => config.collection)
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

    expect(client.modifyDocument).toHaveBeenCalledWith("Actor", "1", [{ name: "x" }], { parentUuid: "Scene.1" });
    expect((response as any).isError).toBeUndefined();
  });

  test("create_document validates inputs", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "create_document", arguments: { type: "Actor" } } });

    expect((response as any).isError).toBe(true);
  });

  test("delete_document validates inputs", async () => {
    const client = {
      isConnected: () => true,
    } as any;

    const handler = createToolHandler(client);
    const response = await handler({ params: { name: "delete_document", arguments: { type: "Actor", ids: [] } } });

    expect((response as any).isError).toBe(true);
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
});
