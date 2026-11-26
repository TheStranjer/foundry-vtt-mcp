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
  buildPage,
  filterDocumentFields,
  filterDocumentsByWhere,
  buildWhereHint,
  pageDocuments,
  pageFullDocuments,
  pickDocument,
  resolvePageParams,
  shapeDocuments,
  type DocumentPage,
  type PageParams,
} from "./core/document-utils.js";
import {
  type PackSummary,
  isUnknownPackError,
  packNotFoundMessage,
  summarizePacks,
  validatePackAccess,
} from "./core/compendium.js";
import {
  COLLECTION_DOCUMENT_NAMES,
  buildIdentifierQuery,
  buildIndexFields,
  resolveRequestedFields,
  sortFieldForCollection,
  summaryFieldsForCollection,
  summaryFieldsForDocumentName,
  whereToServerQuery,
} from "./core/collections.js";
import { buildDocumentOperation } from "./core/operations.js";
import {
  buildEmitMessage,
  engineReplyFor,
  isEngineHandshake,
  isManageCompendiumEvent,
  isSessionEvent,
  parseAckMessage,
  parseSessionPayload,
  SOCKET_CONNECT,
  summarizeFrame,
  type SessionPayload,
} from "./core/socket-protocol.js";
import { AckDispatcher } from "./core/ack-dispatcher.js";
import { selectSocketConnection } from "./core/socket-connection.js";
import { parseFoundryGeneration } from "./core/version.js";
import {
  buildJoinPayload,
  extractSessionIdFromCookies,
  parseJoinResponse,
} from "./core/session.js";
import { buildWorldSnapshot, filterWorldData, type WorldSnapshot } from "./core/world.js";
import {
  type JoinUser,
  hasCompleteUserIdentity,
  parseJoinDataUsers,
  resolveUserIdentity,
} from "./core/user-identity.js";

interface FoundryConnection {
  hostname: string;
  credential: FoundryCredential;
  sessionId: string;
  ws: WebSocket;
  /** Detected Foundry major generation (e.g. 13, 14), or null if unknown. */
  generation: number | null;
}

interface LoginResult {
  credential: FoundryCredential;
  sessionId: string;
  generation: number | null;
  ws: WebSocket;
}

/** An error Foundry returned in its response, as opposed to a timeout or a closed socket. */
class FoundryResponseError extends Error {}

/** Keys the world snapshot leaves out of `world`: document collections plus bulky system data. */
const WORLD_SNAPSHOT_DROPPED_KEYS = [
  ...Object.keys(COLLECTION_DOCUMENT_NAMES),
  "packs",
  "model",
  "template",
  "system",
];

/** Waits between reconnection attempts; the last one repeats until the client is back. */
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000, 60000];

/** Silence allowed on an HTTP request. A server can accept it and then never answer. */
const REQUEST_TIMEOUT_MS = 10000;

/** Time a socket request may wait for its ack. */
const ACK_TIMEOUT_MS = 30000;

/** Time to wait for the game session to bind, and for the join-data reply. */
const SOCKET_SETUP_TIMEOUT_MS = 10000;

/** Silence allowed on a file upload or download, which can pause longer than a small API call. */
const TRANSFER_TIMEOUT_MS = 60000;

/** Order documents by a (numeric) field, ties and missing values broken by _id so pages are stable. */
function sortDocuments(
  docs: Record<string, unknown>[],
  field: string,
  ascending: boolean
): Record<string, unknown>[] {
  const direction = ascending ? 1 : -1;
  const keyOf = (doc: Record<string, unknown>): number => (typeof doc[field] === "number" ? doc[field] : 0);
  return [...docs].sort((a, b) => {
    const diff = keyOf(a) - keyOf(b);
    if (diff !== 0) return diff * direction;
    return String(a._id).localeCompare(String(b._id)) * direction;
  });
}

/** Operation fields for a get: Foundry's index returns only `indexFields` when set. */
function indexOperation(indexFields: string[] | null): Record<string, unknown> {
  return indexFields ? { index: true, indexFields } : { index: false };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** How a socket request is timed and named in logs and timeout errors. */
interface AckOptions {
  timeoutMs: number;
  /** Names the request in logs and in the default timeout message. */
  label: string;
  /** Overrides the default `Timeout waiting for <label> response (<n>s)`. */
  timeoutMessage?: string;
}

/** A request whose id is allocated and whose ack is awaited, but which has not been sent yet. */
interface PendingAckCall {
  id: number;
  /** The parsed ack payload (`[...]`). Rejects on timeout or a malformed ack. */
  result: Promise<unknown[]>;
  send: (event: string, args?: unknown[]) => void;
}

/** A request made through {@link FoundryClient.httpsRequest}. */
export interface HttpsRequestOptions {
  hostname: string;
  path: string;
  method: string;
  headers?: Record<string, string | number>;
  body?: string | Buffer;
  allowInsecureTls?: boolean;
  /** Silence allowed before the request is destroyed. Defaults to REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Defaults to 443, or 80 for the "http" protocol. */
  port?: number | string;
  /** Defaults to "https". "http" goes through the injected http module. */
  protocol?: "https" | "http";
}

/** A fully read HTTP response. */
export interface HttpsResponse {
  statusCode: number | undefined;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export class FoundryClient {
  private connection: FoundryConnection | null = null;
  /** The attempt in progress; everyone who needs a reconnection waits on the same one. */
  private reconnectAttempt: Promise<boolean> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private configPath: string;
  private messageCounter = 1;
  /** One dispatcher per socket; a replaced socket's pending requests go with it. */
  private ackDispatchers = new WeakMap<WebSocket, AckDispatcher>();
  private credentials: FoundryCredential[] = [];
  private activeCredentialIndex: number = -1;
  /** The slimmed world for the current connection, or null until fetched / after invalidation. */
  private worldSnapshot: WorldSnapshot | null = null;
  /** The world fetch in flight; concurrent callers share it. */
  private worldSnapshotFetch: Promise<WorldSnapshot> | null = null;
  /** Bumped on every invalidation so a fetch that began earlier cannot store stale data. */
  private worldSnapshotEpoch = 0;
  private wsLogger: WebSocketLogger;
  private fs: Pick<typeof fs, "readFileSync">;
  private https: Pick<typeof https, "request">;
  private http: Pick<typeof http, "request">;
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
      http?: Pick<typeof http, "request">;
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
    this.http = deps.http || http;
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
        `Failed to load credentials from ${this.configPath}: ${error}`,
        { cause: error }
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
   * Make one HTTP(S) request and read the whole response. Rejects on a request
   * or response error, and on silence longer than `timeoutMs`, which destroys
   * the request with a "no response for Ns" error. Any status code resolves.
   */
  private httpsRequest(options: HttpsRequestOptions): Promise<HttpsResponse> {
    const {
      hostname,
      path,
      method,
      headers,
      body,
      allowInsecureTls = false,
      timeoutMs = REQUEST_TIMEOUT_MS,
      protocol = "https",
    } = options;
    const isHttps = protocol === "https";
    const port = options.port ?? (isHttps ? 443 : 80);

    return new Promise((resolve, reject) => {
      const requestOptions: http.RequestOptions = {
        hostname,
        port,
        path,
        method,
        timeout: timeoutMs,
        ...(isHttps && allowInsecureTls && { rejectUnauthorized: false }),
        ...((headers || body !== undefined) && {
          headers: {
            ...headers,
            ...(body !== undefined && { "Content-Length": Buffer.byteLength(body) }),
          },
        }),
      };

      const onResponse = (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers ?? {},
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", reject);
      };

      const req = isHttps
        ? this.https.request(requestOptions, onResponse)
        : this.http.request(requestOptions, onResponse);

      req.on("timeout", () => {
        req.destroy(new Error(`no response for ${timeoutMs / 1000}s`));
      });
      req.on("error", reject);

      if (body !== undefined) {
        req.write(body);
      }
      req.end();
    });
  }

  /** The Cookie and Origin headers Foundry expects on a POST (v14 rejects one without its own Origin). */
  private sessionHeaders(hostname: string, sessionId: string): Record<string, string> {
    return {
      Cookie: `session=${sessionId}`,
      Origin: `https://${hostname}`,
    };
  }

  /**
   * Detect the Foundry major generation via the public `GET /api/status`
   * endpoint. This tells us how to bind the socket session on the WebSocket
   * upgrade (query parameter for v13, cookie for v14). Returns null when the
   * version cannot be determined, in which case a compatibility strategy that
   * satisfies both mechanisms is used.
   */
  private async detectGeneration(
    hostname: string,
    allowInsecureTls = false
  ): Promise<number | null> {
    try {
      const res = await this.httpsRequest({
        hostname,
        path: "/api/status",
        method: "GET",
        allowInsecureTls,
      });
      const generation = parseFoundryGeneration(res.body.toString("utf-8"));
      this.logger.error(
        `[FoundryClient] Detected Foundry generation for ${hostname}: ${generation ?? "unknown"}`
      );
      return generation;
    } catch (error) {
      this.logger.error(
        `[FoundryClient] Could not detect Foundry version for ${hostname}: ${errorMessage(error)}`
      );
      return null;
    }
  }

  /**
   * Perform GET /join to retrieve or generate a session cookie
   */
  private async getSession(
    hostname: string,
    allowInsecureTls = false
  ): Promise<string> {
    try {
      const res = await this.httpsRequest({
        hostname,
        path: "/join",
        method: "GET",
        allowInsecureTls,
      });
      const sessionId = extractSessionIdFromCookies(res.headers["set-cookie"]);
      return sessionId || this.generateSessionId();
    } catch (error) {
      throw new Error(`GET /join failed for ${hostname}: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  }

  /**
   * Perform POST /join to authenticate
   */
  private async authenticate(
    hostname: string,
    sessionId: string,
    credential: FoundryCredential
  ): Promise<boolean> {
    let res: HttpsResponse;
    try {
      res = await this.httpsRequest({
        hostname,
        path: "/join",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.sessionHeaders(hostname, sessionId),
        },
        body: buildJoinPayload(credential),
        allowInsecureTls: credential.allow_insecure_tls,
      });
    } catch (error) {
      throw new Error(`POST /join failed for ${hostname}: ${errorMessage(error)}`, {
        cause: error,
      });
    }

    const data = res.body.toString("utf-8");
    const parsed = parseJoinResponse(res.statusCode, data);
    if (parsed.success) {
      this.logger.error(
        `[FoundryClient] Authentication successful: ${parsed.message || ""}`.trim()
      );
      return true;
    }

    this.logger.error(
      `[FoundryClient] Authentication failed for ${hostname}: ${res.statusCode} - ${data}`
    );
    return false;
  }

  /**
   * Establish WebSocket connection.
   *
   * The connection parameters depend on the Foundry generation: v13 binds the
   * session via the `?session=` query parameter while v14 binds it via the
   * `session` cookie on the upgrade request (see socket-connection.ts). This
   * resolves once the transport is open; callers should then wait for the game
   * session to bind via waitForGameSession().
   */
  private connectWebSocket(
    hostname: string,
    sessionId: string,
    generation: number | null = null,
    allowInsecureTls = false
  ): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const { url, headers } = selectSocketConnection(generation, hostname, sessionId);
      this.logger.error(
        `[FoundryClient] Connecting to WebSocket (Foundry gen ${generation ?? "unknown"}): ${url}`
      );

      const options = {
        ...(headers && { headers }),
        ...(allowInsecureTls && { rejectUnauthorized: false }),
      };
      const ws = Object.keys(options).length
        ? new this.WebSocketCtor(url, options)
        : new this.WebSocketCtor(url);

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
      // Only the current socket matters: an old one replaced by a reconnect may close later.
      if (this.connection && this.connection.ws === ws) {
        void this.reconnectWithRetry(this.connection);
      }
    });

    ws.on("error", (error) => {
      this.logger.error(`[FoundryClient] WebSocket error: ${error.message}`);
    });

    const acks = this.ackDispatcher(ws, true);
    ws.on("message", (data) => {
      const message = data.toString();
      this.wsLogger.logInbound(message);
      this.logger.error(`[FoundryClient] ${summarizeFrame("in", message)}`);

      if (this.answerEngineFrame(ws, message)) return;

      if (acks.dispatch(message)) return;

      if (isManageCompendiumEvent(message)) {
        // Another client created or deleted a compendium: the cached pack list is stale.
        this.invalidateWorldSnapshot();
        return;
      }

      if (isSessionEvent(message)) {
        this.logger.error("[FoundryClient] Received session event, connection ready");
        return;
      }
    });
  }

  /**
   * Answer the transport-level frames every socket must answer: the Engine.IO handshake
   * (with the Socket.IO connect) and the server's pings (with a pong, or the server drops the
   * connection after pingTimeout, ~10 min of silence for Foundry). True if the frame was one.
   */
  private answerEngineFrame(ws: WebSocket, message: string): boolean {
    const reply = engineReplyFor(message);
    if (reply === null) return false;

    if (isEngineHandshake(message)) {
      this.logger.error("[FoundryClient] Received Engine.IO handshake, sending Socket.IO connect");
    }
    this.sendWebSocketMessage(ws, reply);
    return true;
  }

  /**
   * The socket's one ack dispatcher. A socket that routes its own frames passes `ownFrames`
   * and calls `dispatch` from its message handler; any other socket gets a listener that does
   * nothing else, installed the first time a request is made on it.
   */
  private ackDispatcher(ws: WebSocket, ownFrames = false): AckDispatcher {
    let dispatcher = this.ackDispatchers.get(ws);
    if (!dispatcher) {
      const created = new AckDispatcher();
      dispatcher = created;
      this.ackDispatchers.set(ws, created);
      if (!ownFrames) {
        ws.on("message", (data: WebSocket.Data) => {
          created.dispatch(data.toString());
        });
      }
    }
    return dispatcher;
  }

  /**
   * Allocate an ack id and start waiting for its reply, without sending anything yet.
   * The reply is routed here by id only; it is parsed once, by this request.
   */
  private openAck(ws: WebSocket, options: AckOptions): PendingAckCall {
    const dispatcher = this.ackDispatcher(ws);
    const id = this.messageCounter++;
    const { timeoutMs, label } = options;
    const timeoutMessage =
      options.timeoutMessage ?? `Timeout waiting for ${label} response (${timeoutMs / 1000}s)`;

    const result = new Promise<unknown[]>((resolve, reject) => {
      const timeout = this.setTimeoutFn(() => {
        dispatcher.remove(id);
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      dispatcher.add(id, (frame) => {
        this.clearTimeoutFn(timeout);
        const ack = parseAckMessage(frame);
        if (ack.error || !ack.payload) {
          reject(ack.error ?? new Error("Invalid ack format: empty payload"));
          return;
        }
        resolve(ack.payload);
      });
    });

    const send = (event: string, args: unknown[] = []) => {
      const message = buildEmitMessage(id, event, args);
      this.logger.error(`[FoundryClient] ${summarizeFrame("out", message)}`);
      this.sendWebSocketMessage(ws, message);
    };

    return { id, result, send };
  }

  /**
   * Emit `event` on the connected socket and resolve with the parsed ack payload. Rejects when
   * not connected, on timeout, or on a malformed ack. The caller checks the payload itself.
   */
  private emitWithAck(event: string, args: unknown[], options: AckOptions): Promise<unknown[]> {
    const ws = this.requireSocket();
    const call = this.openAck(ws, options);
    call.send(event, args);
    return call.result;
  }

  private requireSocket(): WebSocket {
    if (!this.connection || this.connection.ws.readyState !== this.WebSocketCtor.OPEN) {
      throw new Error("Not connected to Foundry server");
    }
    return this.connection.ws;
  }

  /**
   * Wait for a Socket.IO event (not an ack). `match` returns a value for the frame that is
   * awaited and undefined for any other; the first value resolves the wait.
   */
  private waitForEvent<T>(
    ws: WebSocket,
    match: (message: string) => T | undefined,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = this.setTimeoutFn(() => {
        ws.off("message", messageHandler);
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      const messageHandler = (data: WebSocket.Data) => {
        const matched = match(data.toString());
        if (matched === undefined) {
          return;
        }

        this.clearTimeoutFn(timeout);
        ws.off("message", messageHandler);
        resolve(matched);
      };

      ws.on("message", messageHandler);
    });
  }

  /**
   * Wait for Foundry to bind the game session to this socket.
   *
   * Foundry emits `42["session", { sessionId, userId }]` once the socket is
   * bound to the authenticated user, or `42["session", null]` if it is not.
   * Data requests (world, modifyDocument, ...) only succeed after a non-null
   * session, so we block until it arrives. A null session means binding failed
   * (e.g. the session was not carried on the upgrade for this Foundry version);
   * surfacing it here turns a silent 30s data timeout into an immediate, clear
   * error.
   */
  private async waitForGameSession(ws: WebSocket): Promise<void> {
    const session = await this.waitForEvent<SessionPayload>(
      ws,
      (message) => {
        if (!isSessionEvent(message)) return undefined;
        const parsed = parseSessionPayload(message);
        return parsed.matched ? parsed : undefined;
      },
      SOCKET_SETUP_TIMEOUT_MS,
      "Timed out waiting for Foundry to bind the game session (10s)"
    );

    if (!session.sessionId) {
      throw new Error(
        "Foundry returned a null session; the socket was not bound to a user. " +
          "Check credentials and that the session was carried on the WebSocket upgrade."
      );
    }

    this.logger.error(
      `[FoundryClient] Game session bound (sessionId=${session.sessionId}, userId=${session.userId ?? "unknown"})`
    );
  }

  /**
   * Fetch the world's users over an unauthenticated socket via `getJoinData`,
   * the request Foundry's own join screen makes to populate its user picker.
   */
  private async fetchJoinUsers(
    hostname: string,
    sessionId: string,
    generation: number | null,
    allowInsecureTls = false
  ): Promise<JoinUser[]> {
    const ws = await this.connectWebSocket(hostname, sessionId, generation, allowInsecureTls);
    const acks = this.ackDispatcher(ws, true);
    const call = this.openAck(ws, {
      timeoutMs: SOCKET_SETUP_TIMEOUT_MS,
      label: "getJoinData",
      timeoutMessage: "Timed out waiting for Foundry join data (10s)",
    });

    ws.on("message", (data) => {
      const message = data.toString();
      this.wsLogger.logInbound(message);

      if (this.answerEngineFrame(ws, message)) return;
      // The Socket.IO connect is acknowledged: only now may the request go out.
      if (message.startsWith(SOCKET_CONNECT)) {
        call.send("getJoinData");
        return;
      }
      acks.dispatch(message);
    });

    try {
      const payload = await call.result;
      return parseJoinDataUsers(payload);
    } finally {
      ws.close();
    }
  }

  /**
   * Fill in a credential's missing userid or username from the world's user
   * list. Credentials that already carry both are returned without a lookup.
   * A failed lookup is logged and the credential is returned as given, so
   * /join still gets a chance with whatever it carries. A generation the caller already
   * detected is used as given; only when it is omitted does the lookup detect one itself.
   */
  private async completeUserIdentity(
    hostname: string,
    sessionId: string,
    credential: FoundryCredential,
    knownGeneration?: number | null
  ): Promise<FoundryCredential> {
    if (hasCompleteUserIdentity(credential)) {
      return credential;
    }

    try {
      const generation =
        knownGeneration !== undefined
          ? knownGeneration
          : await this.detectGeneration(hostname, credential.allow_insecure_tls);
      const users = await this.fetchJoinUsers(
        hostname,
        sessionId,
        generation,
        credential.allow_insecure_tls
      );
      const resolved = resolveUserIdentity(credential, users);
      this.logger.error(
        `[FoundryClient] Resolved Foundry user for ${hostname}: ${resolved.username} (${resolved.userid})`
      );
      return resolved;
    } catch (error) {
      this.logger.error(
        `[FoundryClient] Could not resolve Foundry user for ${hostname}: ${error}`
      );
      return credential;
    }
  }

  /**
   * Keep trying to reconnect after the socket closes. A single immediate attempt fails when
   * Foundry itself is restarting (it is still down a few ms after the close), and the client
   * then stayed disconnected for good. Retries back off to once a minute and stop once
   * connected, or when the connection is replaced (choose_foundry_instance).
   */
  private async reconnectWithRetry(connection: FoundryConnection, attempt = 0): Promise<void> {
    if (this.connection !== connection || this.isConnected()) return;
    if (await this.reconnect()) return;
    if (this.connection !== connection || this.isConnected()) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.logger.error(`[FoundryClient] Retrying reconnection in ${delay / 1000}s`);
    // The connection object outlives its sockets, so a retry from before a brief recovery can
    // still be pending when this one starts. Only one may stay scheduled.
    this.cancelRetry();
    this.retryTimer = this.setTimeoutFn(() => {
      this.retryTimer = null;
      void this.reconnectWithRetry(connection, attempt + 1);
    }, delay);
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) {
      this.clearTimeoutFn(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * True if connected, after one reconnection attempt if needed. Lets a tool call that arrives
   * while disconnected (e.g. right after Foundry came back) reconnect instead of failing.
   */
  async ensureConnected(): Promise<boolean> {
    if (this.isConnected()) return true;
    if (!this.connection) return false;
    await this.reconnect();
    return this.isConnected();
  }

  /** One reconnection attempt, shared by all callers. True when the client is connected again. */
  private reconnect(): Promise<boolean> {
    if (!this.connection) return Promise.resolve(false);

    this.reconnectAttempt ??= this.attemptReconnect(this.connection).finally(() => {
      this.reconnectAttempt = null;
    });
    return this.reconnectAttempt;
  }

  /**
   * The one login sequence: GET /join for a session (unless one is given), fill in a missing
   * user identity, POST /join, then open a socket bound to the game session. The generation is
   * detected at most once (unless given) and shared by the identity lookup and the socket.
   * Returns null when /join rejects the credential; throws on request or binding failures.
   */
  private async login(
    credential: FoundryCredential,
    options: {
      sessionId?: string;
      generation?: number | null;
      /** Reuse the credential as given instead of looking up a missing userid or username. */
      skipIdentityLookup?: boolean;
      /** Called with the credential once its user identity is resolved, even if login then fails. */
      onCredentialResolved?: (credential: FoundryCredential) => void;
    } = {}
  ): Promise<LoginResult | null> {
    const { hostname } = credential;
    const allowInsecureTls = credential.allow_insecure_tls;

    const sessionId = options.sessionId ?? (await this.getSession(hostname, allowInsecureTls));
    if (options.sessionId === undefined) {
      this.logger.error(`[FoundryClient] Got session ID: ${sessionId}`);
    }

    let generation = options.generation;
    const resolveGeneration = async (): Promise<number | null> => {
      generation ??= await this.detectGeneration(hostname, allowInsecureTls);
      return generation;
    };

    let resolved = credential;
    if (!options.skipIdentityLookup && !hasCompleteUserIdentity(credential)) {
      resolved = await this.completeUserIdentity(
        hostname,
        sessionId,
        credential,
        await resolveGeneration()
      );
    }

    options.onCredentialResolved?.(resolved);

    if (!(await this.authenticate(hostname, sessionId, resolved))) {
      return null;
    }

    const boundGeneration = await resolveGeneration();
    const ws = await this.openBoundSocket(hostname, sessionId, boundGeneration, allowInsecureTls);
    return { credential: resolved, sessionId, generation: boundGeneration, ws };
  }

  private async attemptReconnect(connection: FoundryConnection): Promise<boolean> {
    const { hostname, credential, sessionId, generation } = connection;
    const allowInsecureTls = credential.allow_insecure_tls;

    this.logger.error("[FoundryClient] Attempting to reconnect...");

    try {
      // Try the current session first. After Foundry restarts it no longer knows that session:
      // /join still "succeeds" (Foundry starts another session, under a cookie this client never
      // reads), but the socket opened with the old cookie gets a null session. So if this path
      // does not end with a bound socket, fall through to a fresh session.
      try {
        const login = await this.login(credential, {
          sessionId,
          generation,
          skipIdentityLookup: true,
        });
        if (login) {
          return this.adoptSocket(connection, login.ws, login.sessionId, login.generation);
        }
      } catch (error) {
        this.logger.error(`[FoundryClient] Reconnection with the current session failed: ${error}`);
      }

      if (this.connection !== connection) return false;

      // Session may have expired, try full reconnect with new session. A restart may also have
      // been an upgrade, which changes how the socket binds its session.
      const newGeneration = (await this.detectGeneration(hostname, allowInsecureTls)) ?? generation;
      const newSessionId = await this.getSession(hostname, allowInsecureTls);
      const login = await this.login(credential, {
        sessionId: newSessionId,
        generation: newGeneration,
        skipIdentityLookup: true,
      });
      if (login) {
        return this.adoptSocket(connection, login.ws, login.sessionId, login.generation);
      }
      this.logger.error("[FoundryClient] Reconnection failed - authentication failed");
    } catch (error) {
      this.logger.error(`[FoundryClient] Reconnection failed: ${error}`);
    }
    return false;
  }

  /** A socket bound to the game session. One that fails to bind is closed, not left open. */
  private async openBoundSocket(
    hostname: string,
    sessionId: string,
    generation: number | null,
    allowInsecureTls = false
  ): Promise<WebSocket> {
    const ws = await this.connectWebSocket(hostname, sessionId, generation, allowInsecureTls);
    this.setupWebSocketHandlers(ws);
    try {
      await this.waitForGameSession(ws);
    } catch (error) {
      ws.close();
      throw error;
    }
    return ws;
  }

  /**
   * Install a reconnected socket, unless its connection was replaced during the attempt: writing
   * to the current connection then would point another instance at this server's world.
   */
  private adoptSocket(
    connection: FoundryConnection,
    ws: WebSocket,
    sessionId: string,
    generation: number | null
  ): boolean {
    if (this.connection !== connection) {
      ws.close();
      return false;
    }

    connection.ws = ws;
    this.invalidateWorldSnapshot();
    connection.sessionId = sessionId;
    connection.generation = generation;
    this.logger.error("[FoundryClient] Reconnection successful");
    return true;
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
        const login = await this.login(credential, {
          onCredentialResolved: (resolved) => {
            this.credentials[i] = resolved;
          },
        });
        if (!login) {
          this.logger.error(
            `[FoundryClient] Authentication failed for ${hostname}, trying next...`
          );
          continue;
        }

        // Store the successful connection
        this.invalidateWorldSnapshot();
        this.connection = {
          hostname,
          credential: login.credential,
          sessionId: login.sessionId,
          ws: login.ws,
          generation: login.generation,
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

    this.invalidateWorldSnapshot();

    // Disconnect existing connection if any
    if (this.connection) {
      this.connection.ws.close();
      this.connection = null;
      this.activeCredentialIndex = -1;
    }

    // Connect to the chosen instance
    const login = await this.login(credential, {
      onCredentialResolved: (resolved) => {
        this.credentials[targetIndex] = resolved;
      },
    });
    if (!login) {
      throw new Error(`Authentication failed for ${hostname}`);
    }

    this.invalidateWorldSnapshot();
    this.connection = {
      hostname,
      credential: login.credential,
      sessionId: login.sessionId,
      ws: login.ws,
      generation: login.generation,
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
   * Request world data from Foundry
   * This is the generic method that handles the WebSocket communication pattern.
   * @returns The full world data response object
   */
  async requestWorldData(): Promise<Record<string, unknown>> {
    this.requireSocket();
    this.logger.error("[FoundryClient] Requesting world data...");
    const payload = await this.emitWithAck("world", [], {
      timeoutMs: ACK_TIMEOUT_MS,
      label: "world",
      timeoutMessage: "Timeout waiting for world data (30s)",
    });
    return payload[0] as Record<string, unknown>;
  }

  /** Drop the cached world, and make any fetch already in flight discard its result. */
  private invalidateWorldSnapshot(): void {
    this.worldSnapshotEpoch++;
    this.worldSnapshot = null;
    this.worldSnapshotFetch = null;
  }

  /**
   * The slimmed world for this connection. The first call fetches the world and keeps only the
   * metadata and pack list; later calls are served from that, and concurrent first calls share
   * one request. A failed fetch is not cached.
   */
  private loadWorldSnapshot(): Promise<WorldSnapshot> {
    if (this.worldSnapshot) return Promise.resolve(this.worldSnapshot);
    if (this.worldSnapshotFetch) return this.worldSnapshotFetch;

    const epoch = this.worldSnapshotEpoch;
    const fetch: Promise<WorldSnapshot> = this.requestWorldData()
      .then((worldData) => {
        const snapshot = buildWorldSnapshot(worldData, WORLD_SNAPSHOT_DROPPED_KEYS);
        if (epoch === this.worldSnapshotEpoch) {
          this.worldSnapshot = snapshot;
        }
        return snapshot;
      })
      .finally(() => {
        if (this.worldSnapshotFetch === fetch) {
          this.worldSnapshotFetch = null;
        }
      });
    this.worldSnapshotFetch = fetch;
    return fetch;
  }

  private async sendModifyDocumentRequest(
    type: string,
    action: "get" | "update" | "create" | "delete",
    operation: Record<string, unknown>,
    timeoutMessage: string,
    isMatch: (responseData: Record<string, unknown>) => boolean,
    logLabel = "modifyDocument"
  ): Promise<Record<string, unknown>> {
    const payload = await this.emitWithAck(
      "modifyDocument",
      [{ type, action, operation }],
      { timeoutMs: ACK_TIMEOUT_MS, label: logLabel, timeoutMessage }
    );
    const responseData = payload[0] as Record<string, unknown>;

    // A Foundry error is the answer to this request; the caller throws it.
    if (responseData.error) {
      return responseData;
    }

    if (responseData.type !== type || !isMatch(responseData)) {
      throw new Error(`Unexpected ${logLabel} response for ${type}`);
    }

    return responseData;
  }

  /**
   * Send a modifyDocument "get" and return the response, throwing on a server error.
   * Shared by world-collection reads (queryWorldDocuments) and compendium reads
   * (getPackDocuments); each caller interprets the result array as it needs to.
   */
  private async sendGetRequest(
    documentName: string,
    operation: Record<string, unknown>,
    timeoutMessage: string,
    logLabel: string
  ): Promise<Record<string, unknown>> {
    const response = await this.sendModifyDocumentRequest(
      documentName,
      "get",
      operation,
      timeoutMessage,
      (responseData) => Array.isArray(responseData.result),
      logLabel
    );

    return this.throwOnFoundryError(response);
  }

  /**
   * Send a modifyDocument write (update/create/delete) and throw on a Foundry-side error,
   * so permission/validation failures surface as tool errors rather than successes.
   */
  private async sendWriteRequest(
    ...args: Parameters<FoundryClient["sendModifyDocumentRequest"]>
  ): Promise<Record<string, unknown>> {
    return this.throwOnFoundryError(await this.sendModifyDocumentRequest(...args));
  }

  private throwOnFoundryError(response: Record<string, unknown>): Record<string, unknown> {
    if (response.error) {
      const error = response.error as { message?: unknown };
      throw new FoundryResponseError(typeof error.message === "string" ? error.message : String(response.error));
    }

    return response;
  }

  /**
   * Request one page of documents from a specific collection in the world
   * @param collection - The collection name (actors, items, folders, users, scenes, journal)
   * @param options.limit - Page size (default 100, at most 1000)
   * @param options.offset - Position of the first document of the page (default 0)
   * @param options.maxLength - Byte budget for the page's documents (default 200000; 0 means no limit)
   * @param options.requestedFields - Fields to include (always includes _id and name). Absent or empty
   *   returns the collection's summary fields; ["*"] returns full documents.
   * @param options.where - Filter documents by field values (AND logic for all conditions)
   * @param options.sort - "newest" (default) or "oldest"; only for collections with a sort field (messages)
   * @returns The page envelope: total, offset, returned, next_offset, documents
   */
  async getDocuments(
    collection: string,
    options?: {
      limit?: number | null;
      offset?: number | null;
      maxLength?: number | null;
      requestedFields?: string[] | null;
      where?: Record<string, unknown> | null;
      sort?: "newest" | "oldest" | null;
    }
  ): Promise<DocumentPage> {
    const params = resolvePageParams(options);
    const fields = resolveRequestedFields(options?.requestedFields, summaryFieldsForCollection(collection));
    const where = options?.where ?? null;
    const sortField = sortFieldForCollection(collection);

    let page: DocumentPage;
    if (sortField) {
      page = await this.getSortedPage(collection, sortField, options?.sort ?? "newest", fields, where, params);
    } else {
      const serverQuery = whereToServerQuery(where);
      if (fields) {
        const docs = await this.queryWorldDocuments(collection, serverQuery, buildIndexFields(fields, where));
        page = pageDocuments(shapeDocuments(docs, { where, requestedFields: fields }), params);
      } else {
        // Full documents: index the collection, then fetch only the page's documents.
        const index = await this.queryWorldDocuments(collection, serverQuery, buildIndexFields(["_id"], where));
        page = await pageFullDocuments(filterDocumentsByWhere(index, where), params, (id) =>
          this.fetchWorldDocument(collection, id)
        );
      }
    }

    return this.withWhereHint(page, where, (indexFields) => this.queryWorldDocuments(collection, {}, indexFields));
  }

  /**
   * Add `where_hint` to an empty page that had a where filter: one index request for
   * `_id` plus the where keys, over the whole collection. Non-empty pages are returned as is.
   */
  private async withWhereHint(
    page: DocumentPage,
    where: Record<string, unknown> | null,
    fetchIndex: (indexFields: string[]) => Promise<Record<string, unknown>[]>
  ): Promise<DocumentPage> {
    if (page.total !== 0 || !where || Object.keys(where).length === 0) {
      return page;
    }
    const docs = await fetchIndex(["_id", ...Object.keys(where)]);
    return { ...page, where_hint: buildWhereHint(docs, where) };
  }

  /**
   * One page of a collection ordered by `sortField` (Foundry returns documents in _id order).
   *
   * With a field list (summary fields or explicit `requested_fields`), one indexed request
   * returns the sort field plus the page fields for the whole collection; the page is sorted,
   * cut and budgeted locally.
   *
   * With full documents (`["*"]`) an indexed request returns only _id and the sort field, and
   * the page's documents are then read one at a time, stopping once the byte budget is full
   * (see pageFullDocuments). Foundry's query matches fields exactly and the code has no evidence
   * of an `$in`-style operator, so several ids cannot be fetched in one request.
   */
  private async getSortedPage(
    collection: string,
    sortField: string,
    sort: "newest" | "oldest",
    fields: string[] | null,
    where: Record<string, unknown> | null,
    params: PageParams
  ): Promise<DocumentPage> {
    const ascending = sort === "oldest";
    const serverQuery = whereToServerQuery(where);

    if (fields) {
      const rows = await this.queryWorldDocuments(
        collection,
        serverQuery,
        buildIndexFields([sortField, ...fields], where)
      );
      const sorted = sortDocuments(filterDocumentsByWhere(rows, where), sortField, ascending);
      const documents = sorted
        .slice(params.offset, params.offset + params.limit)
        .map((doc) => filterDocumentFields(doc, fields));
      return buildPage(documents, sorted.length, params.offset, params.maxLength);
    }

    const order = await this.queryWorldDocuments(collection, serverQuery, buildIndexFields([sortField], where));
    const sorted = sortDocuments(filterDocumentsByWhere(order, where), sortField, ascending);
    return pageFullDocuments(sorted, params, (id) => this.fetchWorldDocument(collection, id));
  }

  /** One full world document by id, or undefined when it no longer exists. */
  private async fetchWorldDocument(collection: string, id: string): Promise<Record<string, unknown> | undefined> {
    const docs = await this.queryWorldDocuments(collection, { _id: id }, null);
    return docs.find((candidate) => candidate._id === id);
  }

  /** One full compendium document by id, or undefined when it no longer exists. */
  private async fetchPackDocumentById(
    documentName: string,
    pack: string,
    id: string
  ): Promise<Record<string, unknown> | undefined> {
    const docs = await this.fetchPackDocuments(documentName, pack, { _id: id }, null);
    return docs.find((candidate) => candidate._id === id);
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
    const query = buildIdentifierQuery(identifier);
    if (!query) {
      return null;
    }

    const requestedFields = resolveRequestedFields(options?.requestedFields);
    const docs = await this.queryWorldDocuments(collection, query, buildIndexFields(requestedFields));
    return pickDocument(docs, identifier, requestedFields);
  }

  /**
   * List the compendium packs known to the world.
   * @param options.type - Optional document type to filter by (e.g. "Item", "Actor")
   * @returns Pack summaries (id, label, type, package)
   */
  async getCompendiums(options?: { type?: string | null }): Promise<PackSummary[]> {
    const snapshot = await this.loadWorldSnapshot();
    return summarizePacks(snapshot.packs, options?.type ?? null);
  }

  /**
   * Read one page of documents out of a compendium pack. Uses the same modifyDocument socket
   * message as create/modify/delete, with action "get" and the pack in the operation.
   * @param documentName - The document type the pack holds (Actor, Item, JournalEntry, ...)
   * @param pack - The compendium pack ID (e.g. "world.my-items", "my-module.items")
   * @param options.query - Foundry query object; an empty query returns the whole pack
   * @param options.limit - Page size (default 100, at most 1000)
   * @param options.offset - Position of the first document of the page (default 0)
   * @param options.maxLength - Byte budget for the page's documents (default 200000; 0 means no limit)
   * @param options.requestedFields - Fields to include (always includes _id and name). Absent or empty
   *   returns the document type's summary fields; ["*"] returns full documents.
   * @param options.where - Filter documents by field values (AND logic for all conditions)
   * @returns The page envelope: total, offset, returned, next_offset, documents
   */
  async getPackDocuments(
    documentName: string,
    pack: string,
    options?: {
      query?: Record<string, unknown>;
      limit?: number | null;
      offset?: number | null;
      maxLength?: number | null;
      requestedFields?: string[] | null;
      where?: Record<string, unknown> | null;
    }
  ): Promise<DocumentPage> {
    const params = resolvePageParams(options);
    const requestedFields = resolveRequestedFields(options?.requestedFields, summaryFieldsForDocumentName(documentName));
    const where = options?.where ?? null;
    const query = options?.query ?? {};
    let page: DocumentPage;
    if (requestedFields) {
      const docs = await this.fetchPackDocuments(
        documentName,
        pack,
        query,
        buildIndexFields(requestedFields, where)
      );
      page = pageDocuments(shapeDocuments(docs, { where, requestedFields }), params);
    } else {
      // Full documents: index the pack, then fetch only the page's documents.
      const index = await this.fetchPackDocuments(documentName, pack, query, buildIndexFields(["_id"], where));
      page = await pageFullDocuments(filterDocumentsByWhere(index, where), params, (id) =>
        this.fetchPackDocumentById(documentName, pack, id)
      );
    }
    return this.withWhereHint(page, where, (indexFields) =>
      this.fetchPackDocuments(documentName, pack, {}, indexFields)
    );
  }

  /** Raw compendium read; sends an index request when `indexFields` is given. */
  private async fetchPackDocuments(
    documentName: string,
    pack: string,
    query: Record<string, unknown>,
    indexFields: string[] | null
  ): Promise<Record<string, unknown>[]> {
    const request = () =>
      this.sendGetRequest(
        documentName,
        {
          action: "get",
          pack,
          query,
          ...indexOperation(indexFields),
          broadcast: false,
        },
        `Timeout waiting for compendium read response (30s) for ${pack}`,
        "getPackDocuments"
      );

    let response: Record<string, unknown>;
    if (this.worldSnapshot) {
      // Warm cache: validate locally, as before.
      const packError = validatePackAccess(this.worldSnapshot.packs, pack, documentName);
      if (packError) {
        throw new Error(packError);
      }
      response = await request();
    } else {
      // Cold cache: skip the world fetch and let Foundry answer.
      try {
        response = await request();
      } catch (error) {
        throw await this.explainPackReadError(error, documentName, pack);
      }
    }

    return (response.result as Record<string, unknown>[] | undefined) ?? [];
  }

  /**
   * Turn a failed cold-cache pack read into a friendly error. Foundry's unknown-pack crash
   * ("reading 'packData'") becomes the "not found" message. Any other error Foundry itself
   * returned (e.g. a document type mismatch) falls back to fetching the world, and only on
   * this error path, to name the pack's real type. A successful read that returns documents
   * of the wrong type can't be told apart without the world, so it is returned as Foundry
   * answered it. Transport errors (timeouts, closed socket) are passed through untouched.
   */
  private async explainPackReadError(error: unknown, documentName: string, pack: string): Promise<unknown> {
    if (!(error instanceof FoundryResponseError)) return error;

    if (isUnknownPackError(error.message)) {
      return new Error(packNotFoundMessage(pack));
    }

    try {
      const snapshot = await this.loadWorldSnapshot();
      const packError = validatePackAccess(snapshot.packs, pack, documentName);
      return packError ? new Error(packError) : error;
    } catch {
      return error;
    }
  }

  /**
   * Read the documents of one world collection with a modifyDocument "get", so the server
   * sends only that document type (filtered by `query`) instead of the whole world payload.
   * Collections without a known document class fall back to the world payload.
   */
  private async queryWorldDocuments(
    collection: string,
    query: Record<string, unknown>,
    indexFields: string[] | null = null
  ): Promise<Record<string, unknown>[]> {
    const documentName = COLLECTION_DOCUMENT_NAMES[collection];
    if (!documentName) {
      const worldData = await this.requestWorldData();
      const docs = worldData[collection] as Record<string, unknown>[] | undefined;
      if (!docs || !Array.isArray(docs)) {
        throw new Error(`Response does not contain ${collection} array`);
      }
      return docs;
    }

    const response = await this.sendGetRequest(
      documentName,
      { action: "get", query, ...indexOperation(indexFields), broadcast: false },
      `Timeout waiting for ${collection} read response (30s)`,
      "getWorldDocuments"
    );

    if (!Array.isArray(response.result)) {
      throw new Error(`Response does not contain ${collection} array`);
    }

    return response.result as Record<string, unknown>[];
  }

  /**
   * Read one document out of a compendium pack by id, _id, or name
   * @returns The document object or null if not found
   */
  async getPackDocument(
    documentName: string,
    pack: string,
    identifier: { id?: string; _id?: string; name?: string },
    options?: { requestedFields?: string[] | null }
  ): Promise<Record<string, unknown> | null> {
    const query = buildIdentifierQuery(identifier);
    if (!query) {
      return null;
    }

    const requestedFields = resolveRequestedFields(options?.requestedFields);
    const docs = await this.fetchPackDocuments(documentName, pack, query, buildIndexFields(requestedFields));
    return pickDocument(docs, identifier, requestedFields);
  }

  /**
   * Modify a document in FoundryVTT
   * @param type - The document type (Actor, Item, Scene, JournalEntry, Folder, User, etc.)
   * @param _id - The _id of the document to modify
   * @param updates - Array of update objects. Each object should contain the _id and the fields to update.
   *                  Updates use dot-notation paths merged into the document, e.g.:
   *                  { "_id": "abc123", "system": { "attributes": { "hp": { "value": 10 } } } }
   * @param options.parentUuid - Optional UUID of the parent document for embedded documents
   * @param options.pack - Optional compendium pack ID to modify documents within a compendium
   * @returns The result from Foundry containing the updated document data
   */
  async modifyDocument(
    type: string,
    _id: string,
    updates: Record<string, unknown>[],
    options?: { parentUuid?: string; pack?: string }
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
        pack: options?.pack || null,
        updates: updatesWithId,
        action: "update",
        modifiedTime: this.now(),
        recursive: true,
        render: true,
      },
      options
    );

    return this.sendWriteRequest(
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
   *               The exact field structure depends on the game system - consider using get_document
   *               first to retrieve an existing document of the same type to understand the schema.
   * @param options.parentUuid - Optional UUID of the parent document for embedded documents
   * @param options.pack - Optional compendium pack ID to create documents within a compendium
   * @returns The result from Foundry containing the created document data
   */
  async createDocument(
    type: string,
    data: Record<string, unknown>[],
    options?: { parentUuid?: string; pack?: string }
  ): Promise<Record<string, unknown>> {
    // Build operation object with optional parentUuid
    const operation = buildDocumentOperation(
      {
        pack: options?.pack || null,
        data,
        action: "create",
        modifiedTime: this.now(),
        renderSheet: true,
        render: true,
      },
      options
    );

    return this.sendWriteRequest(
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
   * @param options.parentUuid - Optional UUID of the parent document for embedded documents
   * @param options.pack - Optional compendium pack ID to delete documents from a compendium
   * @returns The result from Foundry containing the deleted document IDs
   */
  async deleteDocument(
    type: string,
    ids: string[],
    options?: { parentUuid?: string; pack?: string }
  ): Promise<Record<string, unknown>> {
    // Build operation object with optional parentUuid
    const operation = buildDocumentOperation(
      {
        pack: options?.pack || null,
        ids,
        action: "delete",
        modifiedTime: this.now(),
        deleteAll: false,
        render: true,
      },
      options
    );

    return this.sendWriteRequest(
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

  /**
   * Get world data excluding document collection keys
   * @param excludeCollections - Array of collection keys to exclude from the world data
   * @returns The world data with the specified collections removed
   */
  async getWorld(excludeCollections: string[]): Promise<Record<string, unknown>> {
    const snapshot = await this.loadWorldSnapshot();
    return filterWorldData(snapshot.world, excludeCollections);
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

    const { hostname, sessionId, credential } = this.connection;
    let res: HttpsResponse;
    try {
      res = await this.httpsRequest({
        hostname,
        path: "/upload",
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          ...this.sessionHeaders(hostname, sessionId),
        },
        body: formData,
        allowInsecureTls: credential.allow_insecure_tls,
        timeoutMs: TRANSFER_TIMEOUT_MS,
      });
    } catch (error) {
      throw new Error(`Upload request failed: ${errorMessage(error)}`, { cause: error });
    }

    const data = res.body.toString("utf-8");
    let parsed: { path?: string; message?: string; error?: string } | undefined;
    try {
      parsed = JSON.parse(data);
    } catch {
      parsed = undefined;
    }

    if (parsed) {
      if (parsed.error) {
        throw new Error(`Upload failed: ${parsed.error}`);
      }
      return {
        path: parsed.path || `${target}/${filename}`,
        message: parsed.message,
      };
    }
    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
      return {
        path: `${target}/${filename}`,
        message: "Upload completed",
      };
    }
    throw new Error(`Upload failed with status ${res.statusCode}: ${data}`);
  }

  /**
   * Download a file from a URL
   */
  private async downloadFile(url: string): Promise<{ buffer: Buffer; contentType: string }> {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";

    let res: HttpsResponse;
    try {
      res = await this.httpsRequest({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || undefined,
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        protocol: isHttps ? "https" : "http",
        timeoutMs: TRANSFER_TIMEOUT_MS,
      });
    } catch (error) {
      throw new Error(`Failed to download file: ${errorMessage(error)}`, { cause: error });
    }

    // Handle redirects
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      return this.downloadFile(new URL(res.headers.location, url).href);
    }

    if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Failed to download file: HTTP ${res.statusCode}`);
    }

    const contentType = (res.headers["content-type"] as string) || "application/octet-stream";
    return { buffer: res.body, contentType };
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

    this.requireSocket();

    const payload = await this.emitWithAck(
      "manageFiles",
      [
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
      ],
      { timeoutMs: ACK_TIMEOUT_MS, label: "browseFiles" }
    );
    const responseData = payload[0] as Record<string, unknown>;

    if (responseData.error) {
      throw new Error(`Browse files failed: ${responseData.error}`);
    }

    // A directory listing always carries dirs.
    if (!("dirs" in responseData)) {
      throw new Error("Unexpected browseFiles response");
    }

    return responseData as {
      target: string;
      private: boolean;
      gridSize: number | null;
      dirs: string[];
      privateDirs: string[];
      files: string[];
      extensions: string[];
    };
  }

  /**
   * Create a new Compendium pack in FoundryVTT
   * @param label - The display label for the compendium
   * @param type - The document type this compendium will contain (e.g., "Actor", "Item", "Scene")
   * @returns The result from Foundry containing the created compendium data
   */
  async createCompendium(
    label: string,
    type: string
  ): Promise<Record<string, unknown>> {
    return this.manageCompendium(
      "create",
      { action: "create", data: { label, type }, options: {} },
      "Create compendium failed"
    );
  }

  /**
   * Delete a Compendium pack from FoundryVTT
   * @param name - The name (not label) of the compendium to delete (e.g., "my-npcs")
   * @returns The result from Foundry containing the deleted compendium ID
   */
  async deleteCompendium(name: string): Promise<Record<string, unknown>> {
    return this.manageCompendium(
      "delete",
      { action: "delete", data: name },
      "Delete compendium failed"
    );
  }

  /** Send a manageCompendium request and check that the reply answers the same action. */
  private async manageCompendium(
    action: "create" | "delete",
    request: Record<string, unknown>,
    failure: string
  ): Promise<Record<string, unknown>> {
    const payload = await this.emitWithAck("manageCompendium", [request], {
      timeoutMs: ACK_TIMEOUT_MS,
      label: `${action}Compendium`,
    });
    const responseData = payload[0] as Record<string, unknown>;

    if ((responseData.request as Record<string, unknown> | undefined)?.action !== action) {
      throw new Error(`Unexpected ${action}Compendium response`);
    }

    if (responseData.error) {
      throw new Error(`${failure}: ${responseData.error}`);
    }

    // The pack list changed; the next read fetches it again.
    this.invalidateWorldSnapshot();
    return responseData;
  }

  /**
   * Close the connection
   */
  disconnect(): void {
    this.cancelRetry();
    this.invalidateWorldSnapshot();
    if (this.connection) {
      this.connection.ws.close();
      this.connection = null;
    }
    this.wsLogger.close();
  }
}
