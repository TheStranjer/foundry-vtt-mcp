// foundry-client.ts
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as crypto from "crypto";
import WebSocket from "ws";
import { WebSocketLogger } from "./websocket-logger.js";
import { resolveConfigPath } from "./core/config.js";
import {
  type CredentialInfo,
  type FoundryCredential,
  getCredentialsInfo,
  parseCredentials,
  resolveCredentialIndex,
} from "./core/credentials.js";
import {
  filterDocumentFields,
  filterDocumentsByWhere,
  truncateDocuments,
} from "./core/document-utils.js";
import { buildDocumentOperation } from "./core/operations.js";
import {
  buildModifyDocumentMessage,
  isEngineHandshake,
  isSessionEvent,
  parseAckMessage,
  parseWorldResponseMessage,
  WORLD_REQUEST_MESSAGE,
} from "./core/socket-protocol.js";
import {
  buildJoinPayload,
  extractSessionIdFromCookies,
  parseJoinResponse,
} from "./core/session.js";
import { filterWorldData } from "./core/world.js";

interface FoundryConnection {
  hostname: string;
  credential: FoundryCredential;
  sessionId: string;
  ws: WebSocket;
}

export class FoundryClient {
  private connection: FoundryConnection | null = null;
  private reconnecting = false;
  private configPath: string;
  private messageCounter = 1;
  private credentials: FoundryCredential[] = [];
  private activeCredentialIndex: number = -1;
  private wsLogger: WebSocketLogger;
  private fs: Pick<typeof fs, "readFileSync">;
  private https: Pick<typeof https, "request">;
  private crypto: Pick<typeof crypto, "randomBytes">;
  private WebSocketCtor: typeof WebSocket;
  private now: () => number;
  private setTimeoutFn: typeof setTimeout;
  private clearTimeoutFn: typeof clearTimeout;
  private logger: { error: (...args: unknown[]) => void };

  constructor(
    configPath?: string,
    deps: {
      fs?: Pick<typeof fs, "readFileSync">;
      https?: Pick<typeof https, "request">;
      crypto?: Pick<typeof crypto, "randomBytes">;
      WebSocketCtor?: typeof WebSocket;
      wsLogger?: WebSocketLogger;
      now?: () => number;
      setTimeoutFn?: typeof setTimeout;
      clearTimeoutFn?: typeof clearTimeout;
      logger?: { error: (...args: unknown[]) => void };
    } = {}
  ) {
    this.configPath = configPath || resolveConfigPath(process.env, process.cwd());
    this.wsLogger = deps.wsLogger || new WebSocketLogger();
    this.fs = deps.fs || fs;
    this.https = deps.https || https;
    this.crypto = deps.crypto || crypto;
    this.WebSocketCtor = deps.WebSocketCtor || WebSocket;
    this.now = deps.now || (() => Date.now());
    this.setTimeoutFn = deps.setTimeoutFn || setTimeout;
    this.clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;
    this.logger = deps.logger || console;
  }

  /**
   * Load credentials from the config file
   */
  private loadCredentials(): FoundryCredential[] {
    try {
      const data = this.fs.readFileSync(this.configPath, "utf-8");
      return parseCredentials(data);
    } catch (error) {
      throw new Error(
        `Failed to load credentials from ${this.configPath}: ${error}`
      );
    }
  }

  /**
   * Generate a random session ID (24-char alphanumeric)
   */
  private generateSessionId(): string {
    return this.crypto.randomBytes(12).toString("hex");
  }

  /**
   * Perform GET /join to retrieve or generate a session cookie
   */
  private async getSession(hostname: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = this.https.request(
        {
          hostname,
          port: 443,
          path: "/join",
          method: "GET",
        },
        (res) => {
          const sessionId = extractSessionIdFromCookies(res.headers["set-cookie"]);
          resolve(sessionId || this.generateSessionId());
        }
      );

      req.on("error", (error) => {
        reject(new Error(`GET /join failed for ${hostname}: ${error.message}`));
      });

      req.end();
    });
  }

  /**
   * Perform POST /join to authenticate
   */
  private async authenticate(
    hostname: string,
    sessionId: string,
    credential: FoundryCredential
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const payload = buildJoinPayload(credential);

      const req = this.https.request(
        {
          hostname,
          port: 443,
          path: "/join",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            Cookie: `session=${sessionId}`,
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            const parsed = parseJoinResponse(res.statusCode, data);
            if (parsed.success) {
              this.logger.error(
                `[FoundryClient] Authentication successful: ${parsed.message || ""}`.trim()
              );
              resolve(true);
              return;
            }

            this.logger.error(
              `[FoundryClient] Authentication failed for ${hostname}: ${res.statusCode} - ${data}`
            );
            resolve(false);
          });
        }
      );

      req.on("error", (error) => {
        reject(
          new Error(`POST /join failed for ${hostname}: ${error.message}`)
        );
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Establish WebSocket connection
   */
  private connectWebSocket(hostname: string, sessionId: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const wsUrl = `wss://${hostname}/socket.io/?session=${sessionId}&EIO=4&transport=websocket`;
      this.logger.error(`[FoundryClient] Connecting to WebSocket: ${wsUrl}`);

      const ws = new this.WebSocketCtor(wsUrl);

      ws.on("open", () => {
      this.logger.error("[FoundryClient] WebSocket connection established");
        resolve(ws);
      });

      ws.on("error", (error) => {
        reject(new Error(`WebSocket connection failed: ${error.message}`));
      });

      // Set a connection timeout
      const timeout = this.setTimeoutFn(() => {
        ws.close();
        reject(new Error("WebSocket connection timeout"));
      }, 10000);

      ws.on("open", () => {
        this.clearTimeoutFn(timeout);
      });
    });
  }

  /**
   * Set up WebSocket event handlers for reconnection
   */
  private setupWebSocketHandlers(ws: WebSocket): void {
    ws.on("close", (code, reason) => {
      this.logger.error(
        `[FoundryClient] WebSocket closed: ${code} - ${reason.toString()}`
      );
      if (!this.reconnecting && this.connection) {
        this.reconnect();
      }
    });

    ws.on("error", (error) => {
      this.logger.error(`[FoundryClient] WebSocket error: ${error.message}`);
    });

    ws.on("message", (data) => {
      const message = data.toString();
      this.wsLogger.logInbound(message);
      this.logger.error(`[FoundryClient] WebSocket message: ${message}`);

      if (isEngineHandshake(message)) {
        this.logger.error("[FoundryClient] Received Engine.IO handshake, sending Socket.IO connect");
        this.sendWebSocketMessage(ws, "40");
        return;
      }

      if (isSessionEvent(message)) {
        this.logger.error("[FoundryClient] Received session event, connection ready");
        return;
      }
    });
  }

  /**
   * Attempt to reconnect using cached credentials
   */
  private async reconnect(): Promise<void> {
    if (!this.connection || this.reconnecting) return;

    this.reconnecting = true;
    const { hostname, credential, sessionId } = this.connection;

    this.logger.error("[FoundryClient] Attempting to reconnect...");

    try {
      // Try to re-authenticate first
      const success = await this.authenticate(hostname, sessionId, credential);
      if (success) {
        const ws = await this.connectWebSocket(hostname, sessionId);
        this.setupWebSocketHandlers(ws);
        this.connection.ws = ws;
        this.logger.error("[FoundryClient] Reconnection successful");
      } else {
        // Session may have expired, try full reconnect with new session
        const newSessionId = await this.getSession(hostname);
        const newSuccess = await this.authenticate(
          hostname,
          newSessionId,
          credential
        );
        if (newSuccess) {
          const ws = await this.connectWebSocket(hostname, newSessionId);
          this.setupWebSocketHandlers(ws);
          this.connection.sessionId = newSessionId;
          this.connection.ws = ws;
          this.logger.error("[FoundryClient] Reconnection with new session successful");
        } else {
          this.logger.error("[FoundryClient] Reconnection failed - authentication failed");
        }
      }
    } catch (error) {
      this.logger.error(`[FoundryClient] Reconnection failed: ${error}`);
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * Connect to FoundryVTT, trying each credential until one works
   */
  async connect(): Promise<void> {
    this.credentials = this.loadCredentials();

    if (this.credentials.length === 0) {
      throw new Error("No credentials found in config file");
    }

    for (let i = 0; i < this.credentials.length; i++) {
      const credential = this.credentials[i];
      const hostname = credential.hostname;
      this.logger.error(`[FoundryClient] Trying to connect to ${hostname}...`);

      try {
        // Step 1: GET /join to get session cookie
        const sessionId = await this.getSession(hostname);
        this.logger.error(`[FoundryClient] Got session ID: ${sessionId}`);

        // Step 2: POST /join to authenticate
        const success = await this.authenticate(hostname, sessionId, credential);
        if (!success) {
          this.logger.error(
            `[FoundryClient] Authentication failed for ${hostname}, trying next...`
          );
          continue;
        }

        // Step 3: Establish WebSocket connection
        const ws = await this.connectWebSocket(hostname, sessionId);
        this.setupWebSocketHandlers(ws);

        // Store the successful connection
        this.connection = {
          hostname,
          credential,
          sessionId,
          ws,
        };
        this.activeCredentialIndex = i;

        this.logger.error(`[FoundryClient] Successfully connected to ${hostname}`);
        return;
      } catch (error) {
        this.logger.error(
          `[FoundryClient] Failed to connect to ${hostname}: ${error}`
        );
        continue;
      }
    }

    throw new Error("Failed to connect to any Foundry server");
  }

  /**
   * Connect to a specific Foundry instance by item_order (index) or _id
   * @param identifier - Either { item_order: number } or { _id: string }
   */
  async chooseFoundryInstance(identifier: { item_order?: number; _id?: string }): Promise<void> {
    if (this.credentials.length === 0) {
      this.credentials = this.loadCredentials();
    }

    if (this.credentials.length === 0) {
      throw new Error("No credentials found in config file");
    }

    const targetIndex = resolveCredentialIndex(this.credentials, identifier);

    const credential = this.credentials[targetIndex];
    const hostname = credential.hostname;

    this.logger.error(`[FoundryClient] Connecting to instance: ${credential._id} (${hostname})...`);

    // Disconnect existing connection if any
    if (this.connection) {
      this.connection.ws.close();
      this.connection = null;
      this.activeCredentialIndex = -1;
    }

    // Connect to the chosen instance
    const sessionId = await this.getSession(hostname);
    const success = await this.authenticate(hostname, sessionId, credential);

    if (!success) {
      throw new Error(`Authentication failed for ${hostname}`);
    }

    const ws = await this.connectWebSocket(hostname, sessionId);
    this.setupWebSocketHandlers(ws);

    this.connection = {
      hostname,
      credential,
      sessionId,
      ws,
    };
    this.activeCredentialIndex = targetIndex;

    this.logger.error(`[FoundryClient] Successfully connected to ${credential._id} (${hostname})`);
  }

  /**
   * Get credential information without passwords
   */
  getCredentialsInfo(): CredentialInfo[] {
    if (this.credentials.length === 0) {
      this.credentials = this.loadCredentials();
    }

    return getCredentialsInfo(this.credentials, this.activeCredentialIndex);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return (
      this.connection !== null &&
      this.connection.ws.readyState === this.WebSocketCtor.OPEN
    );
  }

  /**
   * Get the WebSocket instance
   */
  getWebSocket(): WebSocket | null {
    return this.connection?.ws || null;
  }

  /**
   * Get the connected hostname
   */
  getHostname(): string | null {
    return this.connection?.hostname || null;
  }

  /**
   * Internal method to send WebSocket messages with logging
   */
  private sendWebSocketMessage(ws: WebSocket, data: string | Buffer): void {
    this.wsLogger.logOutbound(data);
    ws.send(data);
  }

  /**
   * Send a message through the WebSocket
   */
  send(data: string | Buffer): void {
    if (!this.connection || this.connection.ws.readyState !== this.WebSocketCtor.OPEN) {
      throw new Error("Not connected to Foundry server");
    }
    this.sendWebSocketMessage(this.connection.ws, data);
  }

  /**
   * Filter document object to only include requested fields (always includes _id and name)
   */
  /**
   * Request world data from Foundry
   * This is the generic method that handles the WebSocket communication pattern.
   * @returns The full world data response object
   */
  async requestWorldData(): Promise<Record<string, unknown>> {
    if (!this.connection || this.connection.ws.readyState !== this.WebSocketCtor.OPEN) {
      throw new Error("Not connected to Foundry server");
    }

    const ws = this.connection.ws;

    return new Promise((resolve, reject) => {
      const timeout = this.setTimeoutFn(() => {
        ws.off("message", messageHandler);
        reject(new Error("Timeout waiting for world data (30s)"));
      }, 30000);

      const messageHandler = (data: WebSocket.Data) => {
        const message = data.toString();
        const parsed = parseWorldResponseMessage(message);
        if (!parsed.matched) {
          return;
        }

        this.clearTimeoutFn(timeout);
        ws.off("message", messageHandler);

        if (parsed.error) {
          reject(parsed.error);
          return;
        }

        resolve(parsed.data as Record<string, unknown>);
      };

      ws.on("message", messageHandler);

      // Send the world request
      this.logger.error("[FoundryClient] Requesting world data...");
      this.sendWebSocketMessage(ws, WORLD_REQUEST_MESSAGE);
    });
  }

  private async sendModifyDocumentRequest(
    type: string,
    action: "update" | "create" | "delete",
    operation: Record<string, unknown>,
    timeoutMessage: string,
    isMatch: (responseData: Record<string, unknown>) => boolean,
    logLabel = "modifyDocument"
  ): Promise<Record<string, unknown>> {
    if (!this.connection || this.connection.ws.readyState !== this.WebSocketCtor.OPEN) {
      throw new Error("Not connected to Foundry server");
    }

    const ws = this.connection.ws;
    const ackId = this.messageCounter++;
    const payload = [
      "modifyDocument",
      {
        type,
        action,
        operation,
      },
    ];

    return new Promise((resolve, reject) => {
      const finishResolve = (responseData: Record<string, unknown>) => {
        this.clearTimeoutFn(timeout);
        ws.off("message", messageHandler);
        resolve(responseData);
      };

      const timeout = this.setTimeoutFn(() => {
        ws.off("message", messageHandler);
        reject(new Error(timeoutMessage));
      }, 30000);

      const messageHandler = (data: WebSocket.Data) => {
        const message = data.toString();

        const parsed = parseAckMessage(message);
        if (!parsed.matched) {
          return;
        }

        if (parsed.error || !parsed.payload) {
          return;
        }

        const responseData = parsed.payload[0] as Record<string, unknown>;

        if (responseData.type !== type) {
          return;
        }

        if (responseData.error) {
          finishResolve(responseData);
          return;
        }

        if (!isMatch(responseData)) {
          return;
        }

        finishResolve(responseData);
      };

      ws.on("message", messageHandler);

      // Send the modifyDocument request
      const messageStr = buildModifyDocumentMessage(ackId, payload);
      this.logger.error(`[FoundryClient] Sending ${logLabel}: ${messageStr}`);
      this.sendWebSocketMessage(ws, messageStr);
    });
  }

  /** Valid document collection names in FoundryVTT */
  static readonly DOCUMENT_COLLECTIONS = ["actors", "items", "folders", "users", "scenes", "journal"] as const;

  /**
   * Filter documents by a where clause (AND logic for all key-value pairs)
   */
  private filterDocumentsByWhere(
    docs: Record<string, unknown>[],
    where: Record<string, unknown> | null
  ): Record<string, unknown>[] {
    return filterDocumentsByWhere(docs, where);
  }

  /**
   * Request documents from a specific collection in the world
   * @param collection - The collection name (actors, items, folders, users, scenes, journal)
   * @param options.maxLength - Maximum bytes for the JSON response; documents removed until under limit
   * @param options.requestedFields - Array of field names to include (always includes _id and name)
   * @param options.where - Filter documents by field values (AND logic for all conditions)
   * @returns Array of document objects
   */
  async getDocuments(
    collection: string,
    options?: {
      maxLength?: number | null;
      requestedFields?: string[] | null;
      where?: Record<string, unknown> | null;
    }
  ): Promise<Record<string, unknown>[]> {
    const maxLength = options?.maxLength ?? 0;
    const requestedFields = options?.requestedFields ?? null;
    const where = options?.where ?? null;

    const worldData = await this.requestWorldData();
    const docs = worldData[collection] as Record<string, unknown>[] | undefined;

    if (!docs || !Array.isArray(docs)) {
      throw new Error(`Response does not contain ${collection} array`);
    }

    // Apply where filter first
    let filteredDocs = this.filterDocumentsByWhere(docs, where);

    // Filter fields for each document
    filteredDocs = filteredDocs.map((doc) =>
      filterDocumentFields(doc, requestedFields)
    );

    // Truncate if needed
    filteredDocs = truncateDocuments(filteredDocs, maxLength);

    return filteredDocs;
  }

  /**
   * Request a specific document by id, _id, or name from a collection
   * @param collection - The collection name (actors, items, folders, users, scenes, journal)
   * @param identifier - The id, _id, or name of the document to find
   * @param options.requestedFields - Array of field names to include (always includes _id and name)
   * @returns The document object or null if not found
   */
  async getDocument(
    collection: string,
    identifier: { id?: string; _id?: string; name?: string },
    options?: {
      requestedFields?: string[] | null;
    }
  ): Promise<Record<string, unknown> | null> {
    const requestedFields = options?.requestedFields ?? null;

    const worldData = await this.requestWorldData();
    const docs = worldData[collection] as Record<string, unknown>[] | undefined;

    if (!docs || !Array.isArray(docs)) {
      throw new Error(`Response does not contain ${collection} array`);
    }

    // Find the document by id, _id, or name
    let doc: Record<string, unknown> | undefined;

    if (identifier.id) {
      doc = docs.find((d) => d.id === identifier.id || d._id === identifier.id);
    } else if (identifier._id) {
      doc = docs.find((d) => d._id === identifier._id || d.id === identifier._id);
    } else if (identifier.name) {
      doc = docs.find((d) => d.name === identifier.name);
    }

    if (!doc) {
      return null;
    }

    // Filter fields
    return filterDocumentFields(doc, requestedFields);
  }

  /**
   * Modify a document in FoundryVTT
   * @param type - The document type (Actor, Item, Scene, JournalEntry, Folder, User, etc.)
   * @param _id - The _id of the document to modify
   * @param updates - Array of update objects. Each object should contain the _id and the fields to update.
   *                  Updates use dot-notation paths merged into the document, e.g.:
   *                  { "_id": "abc123", "system": { "attributes": { "hp": { "value": 10 } } } }
   * @returns The result from Foundry containing the updated document data
   */
  async modifyDocument(
    type: string,
    _id: string,
    updates: Record<string, unknown>[],
    options?: { parentUuid?: string }
  ): Promise<Record<string, unknown>> {
    // Ensure each update object has the _id
    const updatesWithId = updates.map((update) => ({
      ...update,
      _id,
    }));

    // Build operation object with optional parentUuid
    const operation = buildDocumentOperation(
      {
        diff: false,
        pack: null,
        updates: updatesWithId,
        action: "update",
        modifiedTime: this.now(),
        recursive: true,
        render: true,
      },
      options
    );

    return this.sendModifyDocumentRequest(
      type,
      "update",
      operation,
      `Timeout waiting for modifyDocument response (30s) for ${type} ${_id}`,
      (responseData) => {
        const result = responseData.result as Record<string, unknown>[] | undefined;
        if (!result || !Array.isArray(result)) {
          return false;
        }

        return result.some((r) => r._id === _id);
      },
      "modifyDocument"
    );
  }

  /**
   * Create a new document in FoundryVTT
   * @param type - The document type (Actor, Item, Scene, JournalEntry, Folder, User, etc.)
   * @param data - Array of data objects defining the new documents to create.
   *               Each object should contain the fields for the new document.
   *               The exact field structure depends on the game system - consider using get_* tools
   *               first to retrieve an existing document of the same type to understand the schema.
   * @returns The result from Foundry containing the created document data
   */
  async createDocument(
    type: string,
    data: Record<string, unknown>[],
    options?: { parentUuid?: string }
  ): Promise<Record<string, unknown>> {
    // Build operation object with optional parentUuid
    const operation = buildDocumentOperation(
      {
        pack: null,
        data,
        action: "create",
        modifiedTime: this.now(),
        renderSheet: true,
        render: true,
      },
      options
    );

    return this.sendModifyDocumentRequest(
      type,
      "create",
      operation,
      `Timeout waiting for createDocument response (30s) for ${type}`,
      (responseData) => responseData.action === "create",
      "createDocument"
    );
  }

  /**
   * Delete a document in FoundryVTT
   * @param type - The document type (Actor, Item, Scene, JournalEntry, Folder, User, etc.)
   * @param ids - Array of document _ids to delete
   * @returns The result from Foundry containing the deleted document IDs
   */
  async deleteDocument(
    type: string,
    ids: string[],
    options?: { parentUuid?: string }
  ): Promise<Record<string, unknown>> {
    // Build operation object with optional parentUuid
    const operation = buildDocumentOperation(
      {
        pack: null,
        ids,
        action: "delete",
        modifiedTime: this.now(),
        deleteAll: false,
        render: true,
      },
      options
    );

    return this.sendModifyDocumentRequest(
      type,
      "delete",
      operation,
      `Timeout waiting for deleteDocument response (30s) for ${type}`,
      (responseData) => {
        if (responseData.action !== "delete") {
          return false;
        }

        const result = responseData.result as string[] | undefined;
        if (!result || !Array.isArray(result)) {
          return false;
        }

        return ids.some((id) => result.includes(id));
      },
      "deleteDocument"
    );
  }

  // Convenience methods for specific document types
  async getActors(options?: { maxLength?: number | null; requestedFields?: string[] | null }) {
    return this.getDocuments("actors", options);
  }

  async getActor(identifier: { id?: string; _id?: string; name?: string }, options?: { requestedFields?: string[] | null }) {
    return this.getDocument("actors", identifier, options);
  }

  async getItems(options?: { maxLength?: number | null; requestedFields?: string[] | null }) {
    return this.getDocuments("items", options);
  }

  async getItem(identifier: { id?: string; _id?: string; name?: string }, options?: { requestedFields?: string[] | null }) {
    return this.getDocument("items", identifier, options);
  }

  async getFolders(options?: { maxLength?: number | null; requestedFields?: string[] | null }) {
    return this.getDocuments("folders", options);
  }

  async getFolder(identifier: { id?: string; _id?: string; name?: string }, options?: { requestedFields?: string[] | null }) {
    return this.getDocument("folders", identifier, options);
  }

  async getUsers(options?: { maxLength?: number | null; requestedFields?: string[] | null }) {
    return this.getDocuments("users", options);
  }

  async getUser(identifier: { id?: string; _id?: string; name?: string }, options?: { requestedFields?: string[] | null }) {
    return this.getDocument("users", identifier, options);
  }

  async getScenes(options?: { maxLength?: number | null; requestedFields?: string[] | null }) {
    return this.getDocuments("scenes", options);
  }

  async getScene(identifier: { id?: string; _id?: string; name?: string }, options?: { requestedFields?: string[] | null }) {
    return this.getDocument("scenes", identifier, options);
  }

  async getJournals(options?: { maxLength?: number | null; requestedFields?: string[] | null }) {
    return this.getDocuments("journal", options);
  }

  async getJournal(identifier: { id?: string; _id?: string; name?: string }, options?: { requestedFields?: string[] | null }) {
    return this.getDocument("journal", identifier, options);
  }

  /**
   * Get world data excluding document collection keys
   * @param excludeCollections - Array of collection keys to exclude from the world data
   * @returns The world data with the specified collections removed
   */
  async getWorld(excludeCollections: string[]): Promise<Record<string, unknown>> {
    const worldData = await this.requestWorldData();
    return filterWorldData(worldData, excludeCollections);
  }

  /**
   * Upload a file to FoundryVTT
   * @param options.target - The target directory path (e.g., "worlds/myworld/assets/avatars")
   * @param options.filename - The filename to use for the uploaded file
   * @param options.url - URL to download the file from (XOR with image_data)
   * @param options.image_data - Base64-encoded image data (XOR with url)
   * @returns The result from Foundry containing the uploaded file path
   */
  async uploadFile(options: {
    target: string;
    filename: string;
    url?: string;
    image_data?: string;
  }): Promise<{ path: string; message?: string }> {
    const { target, filename, url, image_data } = options;

    // XOR validation: exactly one of url or image_data must be provided
    const hasUrl = url !== undefined && url !== null && url !== "";
    const hasImageData = image_data !== undefined && image_data !== null && image_data !== "";

    if (hasUrl && hasImageData) {
      throw new Error("Cannot provide both 'url' and 'image_data'. Please provide exactly one.");
    }
    if (!hasUrl && !hasImageData) {
      throw new Error("Must provide either 'url' or 'image_data'. Please provide exactly one.");
    }

    if (!this.connection) {
      throw new Error("Not connected to Foundry server");
    }

    // Get the file data
    let fileBuffer: Buffer;
    let contentType: string;

    if (hasUrl) {
      // Download the file from URL
      const downloaded = await this.downloadFile(url!);
      fileBuffer = downloaded.buffer;
      contentType = downloaded.contentType;
    } else {
      // Decode base64 image data
      fileBuffer = Buffer.from(image_data!, "base64");
      // Detect content type from filename extension
      contentType = this.getContentTypeFromFilename(filename);
    }

    // Create multipart form data
    const boundary = `----FoundryMCPBoundary${this.crypto.randomBytes(8).toString("hex")}`;
    const formData = this.buildMultipartFormData(boundary, {
      source: "data",
      target,
      filename,
      fileBuffer,
      contentType,
    });

    return new Promise((resolve, reject) => {
      const req = this.https.request(
        {
          hostname: this.connection!.hostname,
          port: 443,
          path: "/upload",
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": Buffer.byteLength(formData),
            Cookie: `session=${this.connection!.sessionId}`,
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                reject(new Error(`Upload failed: ${parsed.error}`));
                return;
              }
              resolve({
                path: parsed.path || `${target}/${filename}`,
                message: parsed.message,
              });
            } catch {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve({
                  path: `${target}/${filename}`,
                  message: "Upload completed",
                });
              } else {
                reject(new Error(`Upload failed with status ${res.statusCode}: ${data}`));
              }
            }
          });
        }
      );

      req.on("error", (error) => {
        reject(new Error(`Upload request failed: ${error.message}`));
      });

      req.write(formData);
      req.end();
    });
  }

  /**
   * Download a file from a URL
   */
  private downloadFile(url: string): Promise<{ buffer: Buffer; contentType: string }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === "https:";

      const requestOptions: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
      };

      const handleResponse = (res: http.IncomingMessage) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.downloadFile(res.headers.location).then(resolve).catch(reject);
          return;
        }

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Failed to download file: HTTP ${res.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const contentType = (res.headers["content-type"] as string) || "application/octet-stream";
          resolve({ buffer, contentType });
        });
      };

      const req = isHttps
        ? this.https.request(requestOptions, handleResponse)
        : http.request(requestOptions, handleResponse);

      req.on("error", (error: Error) => {
        reject(new Error(`Failed to download file: ${error.message}`));
      });

      req.end();
    });
  }

  /**
   * Get content type from filename extension
   */
  private getContentTypeFromFilename(filename: string): string {
    const ext = filename.toLowerCase().split(".").pop();
    const mimeTypes: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      bmp: "image/bmp",
      tiff: "image/tiff",
      apng: "image/apng",
      avif: "image/avif",
      pdf: "application/pdf",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      mp4: "video/mp4",
      webm: "video/webm",
    };
    return mimeTypes[ext || ""] || "application/octet-stream";
  }

  /**
   * Build multipart form data for file upload
   */
  private buildMultipartFormData(
    boundary: string,
    data: {
      source: string;
      target: string;
      filename: string;
      fileBuffer: Buffer;
      contentType: string;
    }
  ): Buffer {
    const { source, target, filename, fileBuffer, contentType } = data;

    const parts: Buffer[] = [];
    const CRLF = "\r\n";

    // source field
    parts.push(Buffer.from(`--${boundary}${CRLF}`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="source"${CRLF}${CRLF}`));
    parts.push(Buffer.from(`${source}${CRLF}`));

    // target field
    parts.push(Buffer.from(`--${boundary}${CRLF}`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="target"${CRLF}${CRLF}`));
    parts.push(Buffer.from(`${target}${CRLF}`));

    // upload field (the file)
    parts.push(Buffer.from(`--${boundary}${CRLF}`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="upload"; filename="${filename}"${CRLF}`));
    parts.push(Buffer.from(`Content-Type: ${contentType}${CRLF}${CRLF}`));
    parts.push(fileBuffer);
    parts.push(Buffer.from(CRLF));

    // bucket field
    parts.push(Buffer.from(`--${boundary}${CRLF}`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="bucket"${CRLF}${CRLF}`));
    parts.push(Buffer.from(`null${CRLF}`));

    // End boundary
    parts.push(Buffer.from(`--${boundary}--${CRLF}`));

    return Buffer.concat(parts);
  }

  /**
   * Browse files in FoundryVTT's file system
   * @param options.target - The target directory path to browse (e.g., "worlds/myworld/assets")
   * @param options.type - The file type filter (defaults to "image")
   * @param options.extensions - Array of file extensions to filter (defaults to common image extensions)
   * @returns The directory listing including dirs, files, and metadata
   */
  async browseFiles(options: {
    target: string;
    type?: string;
    extensions?: string[];
  }): Promise<{
    target: string;
    private: boolean;
    gridSize: number | null;
    dirs: string[];
    privateDirs: string[];
    files: string[];
    extensions: string[];
  }> {
    const {
      target,
      type = "image",
      extensions = [".apng", ".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".tiff", ".webp"],
    } = options;

    if (!this.connection || this.connection.ws.readyState !== this.WebSocketCtor.OPEN) {
      throw new Error("Not connected to Foundry server");
    }

    const ws = this.connection.ws;
    const ackId = this.messageCounter++;

    const payload = [
      "manageFiles",
      {
        action: "browseFiles",
        storage: "data",
        target,
      },
      {
        type,
        extensions,
        wildcard: false,
        render: true,
      },
    ];

    return new Promise((resolve, reject) => {
      const timeout = this.setTimeoutFn(() => {
        ws.off("message", messageHandler);
        reject(new Error("Timeout waiting for browseFiles response (30s)"));
      }, 30000);

      const messageHandler = (data: WebSocket.Data) => {
        const message = data.toString();

        // Parse ack message format: 43[payload]
        const parsed = parseAckMessage(message);
        if (!parsed.matched) {
          return;
        }

        if (parsed.error || !parsed.payload) {
          return;
        }

        const responseData = parsed.payload[0] as Record<string, unknown>;

        // Check for error response first (may not have dirs property)
        if (responseData.error && !("dirs" in responseData)) {
          this.clearTimeoutFn(timeout);
          ws.off("message", messageHandler);
          reject(new Error(`Browse files failed: ${responseData.error}`));
          return;
        }

        // Check if this is a file browser response (has dirs array)
        if (!("dirs" in responseData)) {
          return;
        }

        this.clearTimeoutFn(timeout);
        ws.off("message", messageHandler);

        if (responseData.error) {
          reject(new Error(`Browse files failed: ${responseData.error}`));
          return;
        }

        resolve(responseData as {
          target: string;
          private: boolean;
          gridSize: number | null;
          dirs: string[];
          privateDirs: string[];
          files: string[];
          extensions: string[];
        });
      };

      ws.on("message", messageHandler);

      // Send the manageFiles request
      const messageStr = `42${ackId}${JSON.stringify(payload)}`;
      this.logger.error(`[FoundryClient] Sending browseFiles: ${messageStr}`);
      this.sendWebSocketMessage(ws, messageStr);
    });
  }

  /**
   * Get the session ID for the current connection
   */
  getSessionId(): string | null {
    return this.connection?.sessionId || null;
  }

  /**
   * Close the connection
   */
  disconnect(): void {
    if (this.connection) {
      this.connection.ws.close();
      this.connection = null;
    }
    this.wsLogger.close();
  }
}
