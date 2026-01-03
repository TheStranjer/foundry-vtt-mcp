// foundry-client.ts
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as crypto from "crypto";
import WebSocket from "ws";
import { WebSocketLogger } from "./websocket-logger.js";

interface FoundryCredential {
  _id: string;       // User-defined identifier for this credential entry
  hostname: string;
  password: string;
  userid: string;
}

export interface CredentialInfo {
  _id: string;
  hostname: string;
  userid: string;
  item_order: number;
  currently_active: boolean;
}

interface JoinResponse {
  request: string;
  status: string;
  message: string;
  redirect?: string;
}

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

  constructor(configPath?: string) {
    this.configPath =
      configPath ||
      process.env.FOUNDRY_CREDENTIALS ||
      path.join(process.cwd(), "config", "foundry_credentials.json");
    this.wsLogger = new WebSocketLogger();
  }

  /**
   * Load credentials from the config file
   */
  private loadCredentials(): FoundryCredential[] {
    try {
      const data = fs.readFileSync(this.configPath, "utf-8");
      return JSON.parse(data) as FoundryCredential[];
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
    return crypto.randomBytes(12).toString("hex");
  }

  /**
   * Perform GET /join to retrieve or generate a session cookie
   */
  private async getSession(hostname: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname,
          port: 443,
          path: "/join",
          method: "GET",
        },
        (res) => {
          // Look for session cookie in Set-Cookie header
          const cookies = res.headers["set-cookie"];
          if (cookies) {
            for (const cookie of cookies) {
              const match = cookie.match(/session=([^;]+)/);
              if (match) {
                resolve(match[1]);
                return;
              }
            }
          }
          // If no session cookie delivered, generate one
          resolve(this.generateSessionId());
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
      const payload = JSON.stringify({
        userid: credential.userid,
        password: credential.password,
        action: "join",
      });

      const req = https.request(
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
            if (res.statusCode === 200) {
              try {
                const response = JSON.parse(data) as JoinResponse;
                if (response.status === "success") {
                  console.error(
                    `[FoundryClient] Authentication successful: ${response.message}`
                  );
                  resolve(true);
                  return;
                }
              } catch {
                // Response wasn't JSON, treat as failure
              }
            }
            console.error(
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
      console.error(`[FoundryClient] Connecting to WebSocket: ${wsUrl}`);

      const ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        console.error("[FoundryClient] WebSocket connection established");
        resolve(ws);
      });

      ws.on("error", (error) => {
        reject(new Error(`WebSocket connection failed: ${error.message}`));
      });

      // Set a connection timeout
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket connection timeout"));
      }, 10000);

      ws.on("open", () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Set up WebSocket event handlers for reconnection
   */
  private setupWebSocketHandlers(ws: WebSocket): void {
    ws.on("close", (code, reason) => {
      console.error(
        `[FoundryClient] WebSocket closed: ${code} - ${reason.toString()}`
      );
      if (!this.reconnecting && this.connection) {
        this.reconnect();
      }
    });

    ws.on("error", (error) => {
      console.error(`[FoundryClient] WebSocket error: ${error.message}`);
    });

    ws.on("message", (data) => {
      const message = data.toString();
      this.wsLogger.logInbound(message);
      console.error(`[FoundryClient] WebSocket message: ${message}`);

      // Engine.IO handshake - reply with Socket.IO connect
      if (message.startsWith("0{")) {
        console.error("[FoundryClient] Received Engine.IO handshake, sending Socket.IO connect");
        this.sendWebSocketMessage(ws, "40");
        return;
      }

      // Socket.IO session event - connection is ready
      if (message.includes('["session",')) {
        console.error("[FoundryClient] Received session event, connection ready");
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

    console.error("[FoundryClient] Attempting to reconnect...");

    try {
      // Try to re-authenticate first
      const success = await this.authenticate(hostname, sessionId, credential);
      if (success) {
        const ws = await this.connectWebSocket(hostname, sessionId);
        this.setupWebSocketHandlers(ws);
        this.connection.ws = ws;
        console.error("[FoundryClient] Reconnection successful");
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
          console.error("[FoundryClient] Reconnection with new session successful");
        } else {
          console.error("[FoundryClient] Reconnection failed - authentication failed");
        }
      }
    } catch (error) {
      console.error(`[FoundryClient] Reconnection failed: ${error}`);
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
      console.error(`[FoundryClient] Trying to connect to ${hostname}...`);

      try {
        // Step 1: GET /join to get session cookie
        const sessionId = await this.getSession(hostname);
        console.error(`[FoundryClient] Got session ID: ${sessionId}`);

        // Step 2: POST /join to authenticate
        const success = await this.authenticate(hostname, sessionId, credential);
        if (!success) {
          console.error(
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

        console.error(
          `[FoundryClient] Successfully connected to ${hostname}`
        );
        return;
      } catch (error) {
        console.error(
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

    let targetIndex: number;

    if (identifier.item_order !== undefined) {
      if (identifier.item_order < 0 || identifier.item_order >= this.credentials.length) {
        throw new Error(`Invalid item_order: ${identifier.item_order}. Valid range is 0-${this.credentials.length - 1}`);
      }
      targetIndex = identifier.item_order;
    } else if (identifier._id !== undefined) {
      targetIndex = this.credentials.findIndex(c => c._id === identifier._id);
      if (targetIndex === -1) {
        const validIds = this.credentials.map(c => c._id).join(", ");
        throw new Error(`No credential found with _id: "${identifier._id}". Valid _ids are: ${validIds}`);
      }
    } else {
      throw new Error("Must provide either item_order or _id");
    }

    const credential = this.credentials[targetIndex];
    const hostname = credential.hostname;

    console.error(`[FoundryClient] Connecting to instance: ${credential._id} (${hostname})...`);

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

    console.error(`[FoundryClient] Successfully connected to ${credential._id} (${hostname})`);
  }

  /**
   * Get credential information without passwords
   */
  getCredentialsInfo(): CredentialInfo[] {
    if (this.credentials.length === 0) {
      this.credentials = this.loadCredentials();
    }

    return this.credentials.map((cred, index) => ({
      _id: cred._id,
      hostname: cred.hostname,
      userid: cred.userid,
      item_order: index,
      currently_active: index === this.activeCredentialIndex,
    }));
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return (
      this.connection !== null &&
      this.connection.ws.readyState === WebSocket.OPEN
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
    if (!this.connection || this.connection.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to Foundry server");
    }
    this.sendWebSocketMessage(this.connection.ws, data);
  }

  /**
   * Filter document object to only include requested fields (always includes _id and name)
   */
  private filterDocumentFields(doc: Record<string, unknown>, requestedFields: string[] | null): Record<string, unknown> {
    if (!requestedFields || requestedFields.length === 0) {
      return doc;
    }

    // Always include _id and name
    const fieldsToInclude = new Set(requestedFields);
    fieldsToInclude.add("_id");
    fieldsToInclude.add("name");

    const filtered: Record<string, unknown> = {};
    for (const field of fieldsToInclude) {
      if (field in doc) {
        filtered[field] = doc[field];
      }
    }
    return filtered;
  }

  /**
   * Truncate documents array until JSON is under maxLength bytes
   */
  private truncateDocuments(docs: Record<string, unknown>[], maxLength: number): Record<string, unknown>[] {
    if (!maxLength || maxLength <= 0) {
      return docs;
    }

    let result = [...docs];
    while (result.length > 0) {
      const json = JSON.stringify(result);
      if (Buffer.byteLength(json, "utf-8") <= maxLength) {
        return result;
      }
      result.pop();
    }
    return result;
  }

  /**
   * Request world data from Foundry
   * This is the generic method that handles the WebSocket communication pattern.
   * @returns The full world data response object
   */
  async requestWorldData(): Promise<Record<string, unknown>> {
    if (!this.connection || this.connection.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to Foundry server");
    }

    const ws = this.connection.ws;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.off("message", messageHandler);
        reject(new Error("Timeout waiting for world data (30s)"));
      }, 30000);

      const messageHandler = (data: WebSocket.Data) => {
        const message = data.toString();

        // Look for Socket.IO event response: 430[...]
        if (message.startsWith("430")) {
          clearTimeout(timeout);
          ws.off("message", messageHandler);

          try {
            // Parse the response - format is 430[{...}]
            const jsonPart = message.slice(3);
            const responseArray = JSON.parse(jsonPart) as unknown[];

            if (!Array.isArray(responseArray) || responseArray.length === 0) {
              reject(new Error("Invalid response format: expected array with data"));
              return;
            }

            const responseData = responseArray[0] as Record<string, unknown>;
            resolve(responseData);
          } catch (error) {
            reject(new Error(`Failed to parse world response: ${error}`));
          }
        }
      };

      ws.on("message", messageHandler);

      // Send the world request
      console.error("[FoundryClient] Requesting world data...");
      this.sendWebSocketMessage(ws, '420["world"]');
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
    if (!where || Object.keys(where).length === 0) {
      return docs;
    }

    return docs.filter((doc) => {
      for (const [key, value] of Object.entries(where)) {
        if (doc[key] !== value) {
          return false;
        }
      }
      return true;
    });
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
      this.filterDocumentFields(doc, requestedFields)
    );

    // Truncate if needed
    filteredDocs = this.truncateDocuments(filteredDocs, maxLength);

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
    return this.filterDocumentFields(doc, requestedFields);
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
    updates: Record<string, unknown>[]
  ): Promise<Record<string, unknown>> {
    if (!this.connection || this.connection.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to Foundry server");
    }

    const ws = this.connection.ws;
    const ackId = this.messageCounter++;

    // Ensure each update object has the _id
    const updatesWithId = updates.map((update) => ({
      ...update,
      _id,
    }));

    const payload = [
      "modifyDocument",
      {
        type,
        action: "update",
        operation: {
          parent: null,
          pack: null,
          updates: updatesWithId,
          action: "update",
          modifiedTime: Date.now(),
          diff: true,
          recursive: true,
          render: true,
        },
      },
    ];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.off("message", messageHandler);
        reject(new Error(`Timeout waiting for modifyDocument response (30s) for ${type} ${_id}`));
      }, 30000);

      const messageHandler = (data: WebSocket.Data) => {
        const message = data.toString();

        // Look for Socket.IO ack response: 43{id}[...]
        if (message.startsWith("43")) {
          try {
            // Find where the JSON array starts
            const jsonStart = message.indexOf("[");
            if (jsonStart === -1) return;

            const jsonPart = message.slice(jsonStart);
            const responseArray = JSON.parse(jsonPart) as unknown[];

            if (!Array.isArray(responseArray) || responseArray.length === 0) {
              return;
            }

            const responseData = responseArray[0] as Record<string, unknown>;

            // Check if this response matches our request by type
            if (responseData.type !== type) {
              return;
            }

            // Check if this is an error response - return it immediately
            if (responseData.error) {
              clearTimeout(timeout);
              ws.off("message", messageHandler);
              resolve(responseData);
              return;
            }

            // Check if the result contains our _id
            const result = responseData.result as Record<string, unknown>[] | undefined;
            if (!result || !Array.isArray(result)) {
              return;
            }

            const hasMatchingId = result.some((r) => r._id === _id);
            if (!hasMatchingId) {
              return;
            }

            // This is our response
            clearTimeout(timeout);
            ws.off("message", messageHandler);
            resolve(responseData);
          } catch (error) {
            // Parse error, not our message, continue waiting
          }
        }
      };

      ws.on("message", messageHandler);

      // Send the modifyDocument request
      const messageStr = `42${ackId}${JSON.stringify(payload)}`;
      console.error(`[FoundryClient] Sending modifyDocument: ${messageStr}`);
      this.sendWebSocketMessage(ws, messageStr);
    });
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
    data: Record<string, unknown>[]
  ): Promise<Record<string, unknown>> {
    if (!this.connection || this.connection.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to Foundry server");
    }

    const ws = this.connection.ws;
    const ackId = this.messageCounter++;

    const payload = [
      "modifyDocument",
      {
        type,
        action: "create",
        operation: {
          parent: null,
          pack: null,
          data,
          action: "create",
          modifiedTime: Date.now(),
          renderSheet: true,
          render: true,
        },
      },
    ];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.off("message", messageHandler);
        reject(new Error(`Timeout waiting for createDocument response (30s) for ${type}`));
      }, 30000);

      const messageHandler = (data: WebSocket.Data) => {
        const message = data.toString();

        // Look for Socket.IO ack response: 43{id}[...]
        if (message.startsWith("43")) {
          try {
            // Find where the JSON array starts
            const jsonStart = message.indexOf("[");
            if (jsonStart === -1) return;

            const jsonPart = message.slice(jsonStart);
            const responseArray = JSON.parse(jsonPart) as unknown[];

            if (!Array.isArray(responseArray) || responseArray.length === 0) {
              return;
            }

            const responseData = responseArray[0] as Record<string, unknown>;

            // Check if this response matches our request by type and action
            if (responseData.type !== type || responseData.action !== "create") {
              return;
            }

            // Check if this is an error response - return it immediately
            if (responseData.error) {
              clearTimeout(timeout);
              ws.off("message", messageHandler);
              resolve(responseData);
              return;
            }

            // This is our response
            clearTimeout(timeout);
            ws.off("message", messageHandler);
            resolve(responseData);
          } catch (error) {
            // Parse error, not our message, continue waiting
          }
        }
      };

      ws.on("message", messageHandler);

      // Send the createDocument request
      const messageStr = `42${ackId}${JSON.stringify(payload)}`;
      console.error(`[FoundryClient] Sending createDocument: ${messageStr}`);
      this.sendWebSocketMessage(ws, messageStr);
    });
  }

  /**
   * Delete a document in FoundryVTT
   * @param type - The document type (Actor, Item, Scene, JournalEntry, Folder, User, etc.)
   * @param ids - Array of document _ids to delete
   * @returns The result from Foundry containing the deleted document IDs
   */
  async deleteDocument(
    type: string,
    ids: string[]
  ): Promise<Record<string, unknown>> {
    if (!this.connection || this.connection.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to Foundry server");
    }

    const ws = this.connection.ws;
    const ackId = this.messageCounter++;

    const payload = [
      "modifyDocument",
      {
        type,
        action: "delete",
        operation: {
          parent: null,
          pack: null,
          ids,
          action: "delete",
          modifiedTime: Date.now(),
          deleteAll: false,
          render: true,
        },
      },
    ];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.off("message", messageHandler);
        reject(new Error(`Timeout waiting for deleteDocument response (30s) for ${type}`));
      }, 30000);

      const messageHandler = (data: WebSocket.Data) => {
        const message = data.toString();

        // Look for Socket.IO ack response: 43{id}[...]
        if (message.startsWith("43")) {
          try {
            // Find where the JSON array starts
            const jsonStart = message.indexOf("[");
            if (jsonStart === -1) return;

            const jsonPart = message.slice(jsonStart);
            const responseArray = JSON.parse(jsonPart) as unknown[];

            if (!Array.isArray(responseArray) || responseArray.length === 0) {
              return;
            }

            const responseData = responseArray[0] as Record<string, unknown>;

            // Check if this response matches our request by type and action
            if (responseData.type !== type || responseData.action !== "delete") {
              return;
            }

            // Check if this is an error response - return it immediately
            if (responseData.error) {
              clearTimeout(timeout);
              ws.off("message", messageHandler);
              resolve(responseData);
              return;
            }

            // Check if the result contains at least one of our requested IDs
            const result = responseData.result as string[] | undefined;
            if (!result || !Array.isArray(result)) {
              return;
            }

            const hasMatchingId = ids.some((id) => result.includes(id));
            if (!hasMatchingId) {
              return;
            }

            // This is our response
            clearTimeout(timeout);
            ws.off("message", messageHandler);
            resolve(responseData);
          } catch (error) {
            // Parse error, not our message, continue waiting
          }
        }
      };

      ws.on("message", messageHandler);

      // Send the deleteDocument request
      const messageStr = `42${ackId}${JSON.stringify(payload)}`;
      console.error(`[FoundryClient] Sending deleteDocument: ${messageStr}`);
      this.sendWebSocketMessage(ws, messageStr);
    });
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

    // Create a new object excluding the specified collections
    const filteredWorld: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(worldData)) {
      if (!excludeCollections.includes(key)) {
        filteredWorld[key] = value;
      }
    }

    return filteredWorld;
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
