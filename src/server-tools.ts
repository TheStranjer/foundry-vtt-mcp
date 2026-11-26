import type { FoundryClient } from "./foundry-client.js";
import { DOCUMENT_TYPES, type DocumentTypeConfig } from "./core/collections.js";
import { DEFAULT_LIMIT, DEFAULT_MAX_LENGTH, MAX_LIMIT } from "./core/document-utils.js";

export { DOCUMENT_TYPES, type DocumentTypeConfig };

const COLLECTIONS = DOCUMENT_TYPES.map((config) => config.collection);
const PACKABLE_COLLECTIONS = DOCUMENT_TYPES.filter((config) => config.packable).map((config) => config.collection);

const collectionProperty = {
  type: "string",
  enum: COLLECTIONS,
  description: "The collection to read.",
};

const requestedFieldsProperty = (empty: string) => ({
  type: "array",
  items: { type: "string" },
  description: `Fields to include; dot-notation allowed (e.g. "system.age"). Always includes _id and name. ${empty}`,
});

const packProperty = (restriction: string) => ({
  type: "string",
  description: `Optional compendium pack ID (see get_compendiums); reads from it instead of the world. ${restriction}`,
});

export const getDocumentsTool = {
  name: "get_documents",
  description: `List documents of a collection, one page at a time. Responds { total, offset, returned, next_offset, documents }: total counts after where (when it is 0, where_hint lists the values that exist per where key), next_offset is the next page's offset (null when done). Documents hold summary fields unless requested_fields is given (["*"] = full). If the page's first document exceeds max_length, documents is empty and oversized gives its _id, name and bytes; fetch it with get_document.`,
  inputSchema: {
    type: "object",
    properties: {
      collection: collectionProperty,
      requested_fields: requestedFieldsProperty(
        `If empty, only summary fields come back (usually _id, name, type, folder; messages: _id, timestamp, speaker.alias, author; settings: _id, key; users: _id, name, role). ["*"] returns full documents.`
      ),
      where: {
        type: "object",
        additionalProperties: true,
        description: `Match field values (AND), e.g. {"folder":"abc","type":"npc"}.`,
      },
      limit: { type: "integer", description: `Page size. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.` },
      offset: { type: "integer", description: "Documents to skip. Default 0; use next_offset to page." },
      sort: {
        type: "string",
        enum: ["newest", "oldest"],
        description: `messages only: order by timestamp. Default "newest".`,
      },
      max_length: {
        type: "integer",
        description: `Byte budget for the page's documents. Default ${DEFAULT_MAX_LENGTH}; 0 = no limit. The page stops at the first document that does not fit.`,
      },
      pack: packProperty(`Only for: ${PACKABLE_COLLECTIONS.join(", ")}.`),
    },
    required: ["collection"],
  },
};

export const getDocumentTool = {
  name: "get_document",
  description: `Get one document of a collection by id, _id or name. Returns the full document unless requested_fields is given.`,
  inputSchema: {
    type: "object",
    properties: {
      collection: collectionProperty,
      id: { type: "string", description: "Document id." },
      _id: { type: "string", description: "Document _id." },
      name: { type: "string", description: "Document name." },
      requested_fields: requestedFieldsProperty("Empty or [\"*\"] returns all fields."),
      pack: packProperty("Same collections as in get_documents."),
    },
    required: ["collection"],
  },
};

export const getCompendiumsTool = {
  name: "get_compendiums",
  description: `List the compendium packs in FoundryVTT (id, label, document type, owning package). Use a pack's id as the "pack" parameter of get_documents or get_document.`,
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: `Optional. Only list packs that hold this document type (e.g., "Item", "Actor", "JournalEntry"). Case-insensitive.`,
      },
    },
    required: [],
  },
};

export const modifyDocumentTool = {
  name: "modify_document",
  description: `Modify a document in FoundryVTT. Retrieve it with get_document first: schemas vary by game system, so check the current field paths.`,
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: `The document type to modify. Foundry document class name, case-sensitive (e.g. "Actor", "JournalEntry", "Token").`,
      },
      _id: {
        type: "string",
        description: `The _id of the document to modify. This is the unique identifier for the document in FoundryVTT.`,
      },
      updates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
        description: `Update objects; the _id is added automatically. Field structure depends on the game system, so inspect the document first. Example: [{ "system": { "attributes_physical": { "strength": { "value": 5 } } } }]`,
      },
      parent_uuid: {
        type: "string",
        description: `Optional. UUID of the parent document, required for embedded documents (Drawing, Token, Tile, Wall, ...). Format "{ParentType}.{parentId}", e.g. "Scene.vrKkbtn8u66mv1Y9".`,
      },
      pack: {
        type: "string",
        description: `Optional. The compendium pack ID containing the document to modify (e.g., "world.my-compendium"). If not provided, modifies a world document. Use this to update documents within a compendium.`,
      },
    },
    required: ["type", "_id", "updates"],
  },
};

export const createDocumentTool = {
  name: "create_document",
  description: `Create a new document in FoundryVTT. Retrieve an existing document of the same type with get_document first: schemas vary by game system.`,
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: `The document type to create. Foundry document class name, case-sensitive (e.g. "Actor", "JournalEntry", "Token").`,
      },
      data: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
        description: `Data objects for the new documents; most need at least a "name". Field structure depends on the game system, so inspect an existing document first. Example: [{ "name": "Goblin", "type": "npc", "system": { "attributes": { "hp": { "value": 10, "max": 10 } } } }]`,
      },
      parent_uuid: {
        type: "string",
        description: `Optional. UUID of the parent document, required for embedded documents (Drawing, Token, Tile, Wall, ...). Format "{ParentType}.{parentId}", e.g. "Scene.vrKkbtn8u66mv1Y9".`,
      },
      pack: {
        type: "string",
        description: `Optional. The compendium pack ID to create the document in (e.g., "world.my-compendium"). If not provided, the document is created in the world. Use this to add documents directly to a compendium.`,
      },
    },
    required: ["type", "data"],
  },
};

export const getWorldTool = {
  name: "get_world",
  description: `Get world metadata from FoundryVTT. Returns information about the world such as title, system, version, and other metadata. This excludes document collections (actors, items, scenes, etc.) - use get_documents for those.`,
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const deleteDocumentTool = {
  name: "delete_document",
  description: `Delete one or more documents in FoundryVTT. This action is permanent and cannot be undone. Use with caution.`,
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: `The document type to delete. Foundry document class name, case-sensitive (e.g. "Actor", "JournalEntry", "Token").`,
      },
      ids: {
        type: "array",
        items: {
          type: "string",
        },
        description: `The _ids of the documents to delete, e.g. ["vlcf6AI5FaE9qjgJ", "abc123def456"].`,
      },
      parent_uuid: {
        type: "string",
        description: `Optional. UUID of the parent document, required for embedded documents (Drawing, Token, Tile, Wall, ...). Format "{ParentType}.{parentId}", e.g. "Scene.vrKkbtn8u66mv1Y9".`,
      },
      pack: {
        type: "string",
        description: `Optional. The compendium pack ID containing the documents to delete (e.g., "world.my-compendium"). If not provided, deletes world documents. Use this to remove documents from a compendium.`,
      },
    },
    required: ["type", "ids"],
  },
};

export const showCredentialsTool = {
  name: "show_credentials",
  description: `Show all configured Foundry credentials without revealing passwords. Returns the _id, hostname, userid, item_order (zero-based index), and currently_active status for each credential entry. Use this to see which Foundry instances are available and which one is currently connected.`,
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const chooseFoundryInstanceTool = {
  name: "choose_foundry_instance",
  description: `Switch to a different Foundry instance. Disconnects from the current instance (if any) and connects to the specified one. You can identify the instance either by item_order (zero-based index) or by _id (the name of the credential entry). Use show_credentials first to see available instances.`,
  inputSchema: {
    type: "object",
    properties: {
      item_order: {
        type: "integer",
        description: `The zero-based index of the credential in the foundry_credentials.json array. Use show_credentials to see the item_order for each instance.`,
      },
      _id: {
        type: "string",
        description: `The _id (name) of the credential entry. This is the user-defined identifier in the foundry_credentials.json file.`,
      },
    },
    required: [],
  },
};

export const uploadFileTool = {
  name: "upload_file",
  description: `Upload a file to FoundryVTT. You must provide EXACTLY ONE of 'url' or 'image_data' (XOR logic). If you provide both or neither, the request will fail.

- Use 'url' to download and upload a file from a remote URL (e.g., an image URL from the web)
- Use 'image_data' to upload base64-encoded file content directly

The file will be uploaded to the specified target directory in FoundryVTT's data storage.`,
  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: `The target directory path in FoundryVTT where the file should be uploaded. Example: "worlds/myworld/assets/avatars" or "worlds/myworld/assets/scenes"`,
      },
      filename: {
        type: "string",
        description: `The filename to use for the uploaded file (including extension). Example: "goblin-avatar.png"`,
      },
      url: {
        type: "string",
        description: `URL to download the file from. The file will be downloaded and then uploaded to FoundryVTT. Cannot be used together with 'image_data'.`,
      },
      image_data: {
        type: "string",
        description: `Base64-encoded file content to upload. Cannot be used together with 'url'.`,
      },
    },
    required: ["target", "filename"],
  },
};

export const browseFilesTool = {
  name: "browse_files",
  description: `Browse files and directories in FoundryVTT's file system. Returns a listing of directories and files at the specified target path, filtered by file type.`,
  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: `The target directory path to browse. Example: "worlds/myworld/assets" or "worlds/myworld/assets/avatars"`,
      },
      type: {
        type: "string",
        description: `The file type filter. Defaults to "image". Common values: "image", "audio", "video", "text"`,
      },
      extensions: {
        type: "array",
        items: { type: "string" },
        description: `Array of file extensions to filter (with leading dot). Defaults to common image extensions: [".apng", ".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".tiff", ".webp"]`,
      },
    },
    required: ["target"],
  },
};

export const createCompendiumTool = {
  name: "create_compendium",
  description: `Create a new Compendium pack in FoundryVTT. Compendia are collections of documents (Actors, Items, Scenes, etc.) that can be used for organizing and sharing content. The compendium will be created in the current world.`,
  inputSchema: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: `The display label for the compendium (e.g., "My NPCs", "Custom Items"). This is what users see in the UI.`,
      },
      type: {
        type: "string",
        description: `The document type this compendium will contain. Valid types: "Actor", "Item", "Scene", "JournalEntry", "Macro", "Playlist", "RollTable", "Cards", "Adventure". All documents in a compendium must be of the same type.`,
      },
    },
    required: ["label", "type"],
  },
};

export const deleteCompendiumTool = {
  name: "delete_compendium",
  description: `Delete a Compendium pack from FoundryVTT. This permanently removes the compendium and all documents it contains. Use with caution.`,
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: `The name (not label) of the compendium to delete. This is the lowercase, slugified version of the label (e.g., "my-npcs" for a compendium labeled "My NPCs"). You can find this in the compendium's "id" field (e.g., "world.my-npcs" has name "my-npcs").`,
      },
    },
    required: ["name"],
  },
};

export function createToolDefinitions() {
  return [
    getDocumentsTool,
    getDocumentTool,
    getWorldTool,
    getCompendiumsTool,
    modifyDocumentTool,
    createDocumentTool,
    deleteDocumentTool,
    showCredentialsTool,
    chooseFoundryInstanceTool,
    uploadFileTool,
    browseFilesTool,
    createCompendiumTool,
    deleteCompendiumTool,
  ];
}

export function errorResponse(message: string) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export function successResponse(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

type ToolArgs = Record<string, unknown> | undefined;
type ToolResult = ReturnType<typeof successResponse> | ReturnType<typeof errorResponse>;

interface ToolHandlerEntry {
  /** Completes "Error <verb>: <message>" when the handler throws. */
  verb: string;
  run: (client: FoundryClient, args: ToolArgs) => Promise<ToolResult> | ToolResult;
}

function resolveConfig(args: ToolArgs): DocumentTypeConfig | ToolResult {
  const collection = args?.collection;
  const config = DOCUMENT_TYPES.find((c) => c.collection === collection);
  return config ?? errorResponse(`Error: 'collection' must be one of: ${COLLECTIONS.join(", ")}`);
}

function isToolResult(value: DocumentTypeConfig | ToolResult): value is ToolResult {
  return "content" in value;
}

const listHandler: ToolHandlerEntry = {
  verb: "fetching documents",
  run: async (client, args) => {
    const config = resolveConfig(args);
    if (isToolResult(config)) {
      return config;
    }

    const limit = args?.limit as number | undefined;
    const offset = args?.offset as number | undefined;
    const maxLength = args?.max_length as number | undefined;
    const sort = args?.sort as string | undefined;
    const requestedFields = args?.requested_fields as string[] | undefined;
    const where = args?.where as Record<string, unknown> | undefined;
    const pack = args?.pack as string | undefined;

    if (pack && !config.packable) {
      return errorResponse(`Error: ${config.plural} cannot be stored in a compendium`);
    }

    if (sort !== undefined && sort !== "newest" && sort !== "oldest") {
      return errorResponse('Error: sort must be "newest" or "oldest"');
    }

    // max_length is passed through as given: omitted means the default budget, 0 means no limit.
    const options = {
      limit,
      offset,
      maxLength,
      requestedFields: requestedFields || null,
      where: where || null,
    };

    return successResponse(
      pack
        ? await client.getPackDocuments(config.documentName, pack, options)
        : await client.getDocuments(config.collection, { ...options, sort })
    );
  },
};

const getOneHandler: ToolHandlerEntry = {
  verb: "fetching document",
  run: async (client, args) => {
    const config = resolveConfig(args);
    if (isToolResult(config)) {
      return config;
    }

    const id = args?.id as string | undefined;
    const _id = args?._id as string | undefined;
    const docName = args?.name as string | undefined;
    const requestedFields = args?.requested_fields as string[] | undefined;
    const pack = args?.pack as string | undefined;

    if (!id && !_id && !docName) {
      return errorResponse("Error: Must provide at least one of: id, _id, or name");
    }

    if (pack && !config.packable) {
      return errorResponse(`Error: ${config.plural} cannot be stored in a compendium`);
    }

    const identifier = { id, _id, name: docName };
    const options = { requestedFields: requestedFields || null };
    const doc = pack
      ? await client.getPackDocument(config.documentName, pack, identifier, options)
      : await client.getDocument(config.collection, identifier, options);

    if (!doc) {
      return {
        content: [
          {
            type: "text",
            text: `${config.description.charAt(0).toUpperCase() + config.description.slice(1)} not found`,
          },
        ],
      };
    }

    return successResponse(doc);
  },
};

const TOOL_HANDLERS: Readonly<Record<string, ToolHandlerEntry>> = {
  get_documents: listHandler,
  get_document: getOneHandler,

  get_compendiums: {
    verb: "fetching compendiums",
    run: async (client, args) => {
      const type = args?.type as string | undefined;
      return successResponse(await client.getCompendiums({ type: type || null }));
    },
  },

  get_world: {
    verb: "fetching world",
    run: async (client) => {
      const excludeCollections = [...DOCUMENT_TYPES.map((config) => config.collection), ...[ 'packs', 'model', 'template', 'system' ]];
      return successResponse(await client.getWorld(excludeCollections));
    },
  },

  modify_document: {
    verb: "modifying document",
    run: async (client, args) => {
      const type = args?.type as string | undefined;
      const _id = args?._id as string | undefined;
      const updates = args?.updates as Record<string, unknown>[] | undefined;
      const parentUuid = args?.parent_uuid as string | undefined;
      const pack = args?.pack as string | undefined;

      if (!type) {
        return errorResponse("Error: 'type' is required");
      }
      if (!_id) {
        return errorResponse("Error: '_id' is required");
      }
      if (!updates || !Array.isArray(updates)) {
        return errorResponse("Error: 'updates' must be an array of objects");
      }

      return successResponse(await client.modifyDocument(type, _id, updates, { parentUuid, pack }));
    },
  },

  create_document: {
    verb: "creating document",
    run: async (client, args) => {
      const type = args?.type as string | undefined;
      const data = args?.data as Record<string, unknown>[] | undefined;
      const parentUuid = args?.parent_uuid as string | undefined;
      const pack = args?.pack as string | undefined;

      if (!type) {
        return errorResponse("Error: 'type' is required");
      }
      if (!data || !Array.isArray(data)) {
        return errorResponse("Error: 'data' must be an array of objects");
      }

      return successResponse(await client.createDocument(type, data, { parentUuid, pack }));
    },
  },

  delete_document: {
    verb: "deleting document",
    run: async (client, args) => {
      const type = args?.type as string | undefined;
      const ids = args?.ids as string[] | undefined;
      const parentUuid = args?.parent_uuid as string | undefined;
      const pack = args?.pack as string | undefined;

      if (!type) {
        return errorResponse("Error: 'type' is required");
      }
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return errorResponse("Error: 'ids' must be a non-empty array of strings");
      }

      return successResponse(await client.deleteDocument(type, ids, { parentUuid, pack }));
    },
  },

  show_credentials: {
    verb: "fetching credentials",
    run: (client) => successResponse(client.getCredentialsInfo()),
  },

  choose_foundry_instance: {
    verb: "switching Foundry instance",
    run: async (client, args) => {
      const itemOrder = args?.item_order as number | undefined;
      const _id = args?._id as string | undefined;

      if (itemOrder === undefined && _id === undefined) {
        return errorResponse("Error: Must provide either item_order or _id");
      }

      await client.chooseFoundryInstance({ item_order: itemOrder, _id });

      const hostname = client.getHostname();
      return successResponse({
        success: true,
        message: `Successfully connected to ${hostname}`,
        hostname,
      });
    },
  },

  upload_file: {
    verb: "uploading file",
    run: async (client, args) => {
      const target = args?.target as string | undefined;
      const filename = args?.filename as string | undefined;
      const url = args?.url as string | undefined;
      const imageData = args?.image_data as string | undefined;

      if (!target) {
        return errorResponse("Error: 'target' is required");
      }
      if (!filename) {
        return errorResponse("Error: 'filename' is required");
      }

      return successResponse(
        await client.uploadFile({ target, filename, url, image_data: imageData })
      );
    },
  },

  browse_files: {
    verb: "browsing files",
    run: async (client, args) => {
      const target = args?.target as string | undefined;
      const type = args?.type as string | undefined;
      const extensions = args?.extensions as string[] | undefined;

      if (!target) {
        return errorResponse("Error: 'target' is required");
      }

      return successResponse(await client.browseFiles({ target, type, extensions }));
    },
  },

  create_compendium: {
    verb: "creating compendium",
    run: async (client, args) => {
      const label = args?.label as string | undefined;
      const type = args?.type as string | undefined;

      if (!label) {
        return errorResponse("Error: 'label' is required");
      }
      if (!type) {
        return errorResponse("Error: 'type' is required");
      }

      return successResponse(await client.createCompendium(label, type));
    },
  },

  delete_compendium: {
    verb: "deleting compendium",
    run: async (client, args) => {
      const name = args?.name as string | undefined;

      if (!name) {
        return errorResponse("Error: 'name' is required");
      }

      return successResponse(await client.deleteCompendium(name));
    },
  },
};

const CONNECTIONLESS_TOOLS = ["show_credentials", "choose_foundry_instance"];

export function createToolHandler(foundryClient: FoundryClient) {
  return async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
    const { name, arguments: args } = request.params;

    if (
      !CONNECTIONLESS_TOOLS.includes(name) &&
      !foundryClient.isConnected() &&
      !(await foundryClient.ensureConnected())
    ) {
      return errorResponse("Error: Not connected to FoundryVTT server");
    }

    const entry = Object.hasOwn(TOOL_HANDLERS, name) ? TOOL_HANDLERS[name] : undefined;
    if (!entry) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      return await entry.run(foundryClient, args);
    } catch (error) {
      return errorResponse(
        `Error ${entry.verb}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
