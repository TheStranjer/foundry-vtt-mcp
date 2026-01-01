// foundry-client.ts
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as crypto from "crypto";
import WebSocket from "ws";

interface FoundryCredential {
  hostname: string;
  password: string;
  userid: string;
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

  constructor(configPath?: string) {
    this.configPath =
      configPath ||
      path.join(process.cwd(), "config", "foundry_credentials.json");
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
      console.error(`[FoundryClient] WebSocket message: ${message}`);

      // Engine.IO handshake - reply with Socket.IO connect
      if (message.startsWith("0{")) {
        console.error("[FoundryClient] Received Engine.IO handshake, sending Socket.IO connect");
        ws.send("40");
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
    const credentials = this.loadCredentials();

    if (credentials.length === 0) {
      throw new Error("No credentials found in config file");
    }

    for (const credential of credentials) {
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
   * Send a message through the WebSocket
   */
  send(data: string | Buffer): void {
    if (!this.connection || this.connection.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to Foundry server");
    }
    this.connection.ws.send(data);
  }

  /**
   * Filter actor object to only include requested fields (always includes _id and name)
   */
  private filterActorFields(actor: Record<string, unknown>, requestedFields: string[] | null): Record<string, unknown> {
    if (!requestedFields || requestedFields.length === 0) {
      return actor;
    }

    // Always include _id and name
    const fieldsToInclude = new Set(requestedFields);
    fieldsToInclude.add("_id");
    fieldsToInclude.add("name");

    const filtered: Record<string, unknown> = {};
    for (const field of fieldsToInclude) {
      if (field in actor) {
        filtered[field] = actor[field];
      }
    }
    return filtered;
  }

  /**
   * Truncate actors array until JSON is under maxLength bytes
   */
  private truncateActors(actors: Record<string, unknown>[], maxLength: number): Record<string, unknown>[] {
    if (!maxLength || maxLength <= 0) {
      return actors;
    }

    let result = [...actors];
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
      ws.send('420["world"]');
    });
  }

  /**
   * Request actors from the world
   * @param options.maxLength - Maximum bytes for the JSON response; actors removed until under limit
   * @param options.requestedFields - Array of field names to include (always includes _id and name)
   * @returns Array of actor objects
   */
  async getActors(options?: {
    maxLength?: number | null;
    requestedFields?: string[] | null;
  }): Promise<Record<string, unknown>[]> {
    const maxLength = options?.maxLength ?? 0;
    const requestedFields = options?.requestedFields ?? null;

    const worldData = await this.requestWorldData();
    const actors = worldData.actors as Record<string, unknown>[] | undefined;

    if (!actors || !Array.isArray(actors)) {
      throw new Error("Response does not contain actors array");
    }

    // Filter fields for each actor
    let filteredActors = actors.map((actor) =>
      this.filterActorFields(actor, requestedFields)
    );

    // Truncate if needed
    filteredActors = this.truncateActors(filteredActors, maxLength);

    return filteredActors;
  }

  /**
   * Request a specific actor by id, _id, or name
   * @param identifier - The id, _id, or name of the actor to find
   * @param options.requestedFields - Array of field names to include (always includes _id and name)
   * @returns The actor object or null if not found
   */
  async getActor(
    identifier: { id?: string; _id?: string; name?: string },
    options?: {
      requestedFields?: string[] | null;
    }
  ): Promise<Record<string, unknown> | null> {
    const requestedFields = options?.requestedFields ?? null;

    const worldData = await this.requestWorldData();
    const actors = worldData.actors as Record<string, unknown>[] | undefined;

    if (!actors || !Array.isArray(actors)) {
      throw new Error("Response does not contain actors array");
    }

    // Find the actor by id, _id, or name
    let actor: Record<string, unknown> | undefined;

    if (identifier.id) {
      actor = actors.find((a) => a.id === identifier.id || a._id === identifier.id);
    } else if (identifier._id) {
      actor = actors.find((a) => a._id === identifier._id || a.id === identifier._id);
    } else if (identifier.name) {
      actor = actors.find((a) => a.name === identifier.name);
    }

    if (!actor) {
      return null;
    }

    // Filter fields
    return this.filterActorFields(actor, requestedFields);
  }

  /**
   * Close the connection
   */
  disconnect(): void {
    if (this.connection) {
      this.connection.ws.close();
      this.connection = null;
    }
  }
}
