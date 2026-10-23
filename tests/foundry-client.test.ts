import { EventEmitter } from "events";
import { FoundryClient } from "../src/foundry-client.js";
import type { FoundryCredential } from "../src/core/credentials.js";

class TestWebSocket extends EventEmitter {
  static OPEN = 1;
  url: string;
  readyState = TestWebSocket.OPEN;
  send = jest.fn();
  close = jest.fn(() => {
    this.readyState = 3;
  });

  constructor(url: string) {
    super();
    this.url = url;
  }
}

function createHttpsStub(responder: (req: EventEmitter, callback: (res: any) => void) => void) {
  return {
    request: jest.fn((options: any, callback: (res: any) => void) => {
      const req = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock };
      req.write = jest.fn();
      req.end = jest.fn(() => responder(req, callback));
      return req;
    }),
  };
}

function createClient(overrides: Record<string, unknown> = {}) {
  const logger = { error: jest.fn() };
  const wsLogger = { logInbound: jest.fn(), logOutbound: jest.fn(), close: jest.fn() } as any;
  const deps = {
    logger,
    wsLogger,
    ...overrides,
  };
  const client = new FoundryClient("/tmp/creds.json", deps as any);
  return { client, logger, wsLogger };
}

describe("FoundryClient", () => {
  test("loadCredentials parses config", () => {
    const creds = [
      { _id: "a", hostname: "h", password: "p", userid: "u" },
    ];
    const { client } = createClient({
      fs: { readFileSync: jest.fn(() => JSON.stringify(creds)) },
    });

    const loaded = (client as any).loadCredentials();
    expect(loaded).toEqual(creds);
  });

  test("loadCredentials wraps errors", () => {
    const { client } = createClient({
      fs: { readFileSync: jest.fn(() => { throw new Error("nope"); }) },
    });

    expect(() => (client as any).loadCredentials())
      .toThrow("Failed to load credentials");
  });

  test("getSession uses cookie when available", async () => {
    const https = createHttpsStub((_, callback) => {
      const res = new EventEmitter() as any;
      res.headers = { "set-cookie": ["session=abc123; Path=/"] };
      callback(res);
    });
    const { client } = createClient({ https });

    const sessionId = await (client as any).getSession("host");
    expect(sessionId).toBe("abc123");
  });

  test("getSession allows insecure TLS when requested", async () => {
    const https = createHttpsStub((_, callback) => {
      const res = new EventEmitter() as any;
      res.headers = { "set-cookie": ["session=abc123; Path=/"] };
      callback(res);
    });
    const { client } = createClient({ https });

    await (client as any).getSession("host", true);

    expect(https.request).toHaveBeenCalledWith(
      expect.objectContaining({ rejectUnauthorized: false }),
      expect.any(Function)
    );
  });

  test("getSession generates when no cookie", async () => {
    const https = createHttpsStub((_, callback) => {
      const res = new EventEmitter() as any;
      res.headers = {};
      callback(res);
    });
    const { client } = createClient({
      https,
      crypto: { randomBytes: jest.fn(() => Buffer.alloc(12, 1)) },
    });

    const sessionId = await (client as any).getSession("host");
    expect(sessionId).toBe(Buffer.alloc(12, 1).toString("hex"));
  });

  test("getSession rejects on request error", async () => {
    const https = {
      request: jest.fn((_options: any, _callback: any) => {
        const req = new EventEmitter() as EventEmitter & { end: jest.Mock };
        req.end = jest.fn(() => req.emit("error", new Error("fail")));
        return req;
      }),
    };
    const { client } = createClient({ https });

    await expect((client as any).getSession("host"))
      .rejects.toThrow("GET /join failed for host");
  });

  test("authenticate returns true on success", async () => {
    const https = createHttpsStub((req, callback) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      callback(res);
      res.emit("data", JSON.stringify({ status: "success", message: "ok" }));
      res.emit("end");
      expect((req as any).write).toHaveBeenCalled();
    });
    const { client } = createClient({ https });

    const success = await (client as any).authenticate("host", "sid", {
      _id: "x",
      hostname: "host",
      password: "pw",
      userid: "user",
    });
    expect(success).toBe(true);
  });

  test("authenticate allows insecure TLS from credentials", async () => {
    const https = createHttpsStub((_req, callback) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      callback(res);
      res.emit("data", JSON.stringify({ status: "success" }));
      res.emit("end");
    });
    const { client } = createClient({ https });

    await (client as any).authenticate("host", "sid", {
      _id: "x",
      hostname: "host",
      password: "pw",
      userid: "user",
      allow_insecure_tls: true,
    });

    expect(https.request).toHaveBeenCalledWith(
      expect.objectContaining({ rejectUnauthorized: false }),
      expect.any(Function)
    );
  });

  test("authenticate returns false on failure", async () => {
    const https = createHttpsStub((_req, callback) => {
      const res = new EventEmitter() as any;
      res.statusCode = 401;
      callback(res);
      res.emit("data", "nope");
      res.emit("end");
    });
    const { client } = createClient({ https });

    const success = await (client as any).authenticate("host", "sid", {
      _id: "x",
      hostname: "host",
      password: "pw",
      userid: "user",
    });
    expect(success).toBe(false);
  });

  test("authenticate rejects on request error", async () => {
    const https = {
      request: jest.fn((_options: any, _callback: any) => {
        const req = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock };
        req.write = jest.fn();
        req.end = jest.fn(() => req.emit("error", new Error("fail")));
        return req;
      }),
    };
    const { client } = createClient({ https });

    await expect((client as any).authenticate("host", "sid", {
      _id: "x",
      hostname: "host",
      password: "pw",
      userid: "user",
    })).rejects.toThrow("POST /join failed for host");
  });

  test("connectWebSocket resolves on open", async () => {
    jest.useFakeTimers();
    let created: TestWebSocket | null = null;
    class Ws extends TestWebSocket {
      constructor(url: string) {
        super(url);
        created = this;
      }
    }

    const { client } = createClient({ WebSocketCtor: Ws });
    const promise = (client as any).connectWebSocket("host", "sid");
    created?.emit("open");
    await expect(promise).resolves.toBe(created);
    jest.useRealTimers();
  });

  test("connectWebSocket rejects on error", async () => {
    jest.useFakeTimers();
    let created: TestWebSocket | null = null;
    class Ws extends TestWebSocket {
      constructor(url: string) {
        super(url);
        created = this;
      }
    }

    const { client } = createClient({ WebSocketCtor: Ws });
    const promise = (client as any).connectWebSocket("host", "sid");
    created?.emit("error", new Error("boom"));
    await expect(promise).rejects.toThrow("WebSocket connection failed");
    jest.useRealTimers();
  });

  test("connectWebSocket times out", async () => {
    jest.useFakeTimers();
    class Ws extends TestWebSocket {}
    const { client } = createClient({ WebSocketCtor: Ws });

    const promise = (client as any).connectWebSocket("host", "sid");
    jest.advanceTimersByTime(10000);

    await expect(promise).rejects.toThrow("WebSocket connection timeout");
    jest.useRealTimers();
  });

  test("connectWebSocket binds the session via cookie header for Foundry v14", async () => {
    jest.useFakeTimers();
    let created: TestWebSocket | null = null;
    let ctorUrl = "";
    let ctorOpts: unknown = "unset";
    class Ws extends TestWebSocket {
      constructor(url: string, opts?: unknown) {
        super(url);
        created = this;
        ctorUrl = url;
        ctorOpts = opts;
      }
    }

    const { client } = createClient({ WebSocketCtor: Ws as any });
    const promise = (client as any).connectWebSocket("host", "sid", 14);
    created?.emit("open");

    await expect(promise).resolves.toBe(created);
    expect(ctorUrl).toBe("wss://host/socket.io/?EIO=4&transport=websocket");
    expect(ctorUrl).not.toContain("session=sid");
    expect(ctorOpts).toEqual({ headers: { Cookie: "session=sid" } });
    jest.useRealTimers();
  });

  test("connectWebSocket allows insecure TLS when requested", async () => {
    jest.useFakeTimers();
    let created: TestWebSocket | null = null;
    let ctorOpts: any;
    class Ws extends TestWebSocket {
      constructor(url: string, opts?: unknown) {
        super(url);
        created = this;
        ctorOpts = opts;
      }
    }

    const { client } = createClient({ WebSocketCtor: Ws as any });
    const promise = (client as any).connectWebSocket("host", "sid", 14, true);
    created?.emit("open");

    await expect(promise).resolves.toBe(created);
    expect(ctorOpts).toEqual({
      headers: { Cookie: "session=sid" },
      rejectUnauthorized: false,
    });
    jest.useRealTimers();
  });

  test("connectWebSocket binds the session via query param for Foundry v13", async () => {
    jest.useFakeTimers();
    let created: TestWebSocket | null = null;
    let ctorUrl = "";
    let ctorOpts: unknown = "unset";
    class Ws extends TestWebSocket {
      constructor(url: string, opts?: unknown) {
        super(url);
        created = this;
        ctorUrl = url;
        ctorOpts = opts;
      }
    }

    const { client } = createClient({ WebSocketCtor: Ws as any });
    const promise = (client as any).connectWebSocket("host", "sid", 13);
    created?.emit("open");

    await expect(promise).resolves.toBe(created);
    expect(ctorUrl).toBe("wss://host/socket.io/?session=sid&EIO=4&transport=websocket");
    expect(ctorOpts).toBeUndefined();
    jest.useRealTimers();
  });

  test("detectGeneration parses the version from /api/status", async () => {
    const https = createHttpsStub((_req, callback) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      callback(res);
      res.emit("data", JSON.stringify({ active: true, version: "14.364" }));
      res.emit("end");
    });
    const { client } = createClient({ https });

    await expect((client as any).detectGeneration("host")).resolves.toBe(14);
    expect(https.request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "host", path: "/api/status", method: "GET" }),
      expect.any(Function)
    );
  });

  test("detectGeneration allows insecure TLS when requested", async () => {
    const https = createHttpsStub((_req, callback) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      callback(res);
      res.emit("data", JSON.stringify({ active: true, version: "14.364" }));
      res.emit("end");
    });
    const { client } = createClient({ https });

    await (client as any).detectGeneration("host", true);

    expect(https.request).toHaveBeenCalledWith(
      expect.objectContaining({ rejectUnauthorized: false }),
      expect.any(Function)
    );
  });

  test("detectGeneration returns null when the version cannot be determined", async () => {
    const https = createHttpsStub((_req, callback) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      callback(res);
      res.emit("data", "not json");
      res.emit("end");
    });
    const { client } = createClient({ https });

    await expect((client as any).detectGeneration("host")).resolves.toBeNull();
  });

  test("detectGeneration returns null on request error", async () => {
    const https = {
      request: jest.fn((_options: any, _callback: any) => {
        const req = new EventEmitter() as EventEmitter & { end: jest.Mock };
        req.end = jest.fn(() => req.emit("error", new Error("fail")));
        return req;
      }),
    };
    const { client } = createClient({ https });

    await expect((client as any).detectGeneration("host")).resolves.toBeNull();
  });

  test("waitForGameSession resolves when the session is bound", async () => {
    jest.useFakeTimers();
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");

    const promise = (client as any).waitForGameSession(ws);
    ws.emit("message", '42["session",{"sessionId":"abc","userId":"u1"}]');

    await expect(promise).resolves.toBeUndefined();
    jest.useRealTimers();
  });

  test("waitForGameSession rejects on a null session", async () => {
    jest.useFakeTimers();
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");

    const promise = (client as any).waitForGameSession(ws);
    ws.emit("message", '42["session",null]');

    await expect(promise).rejects.toThrow("null session");
    jest.useRealTimers();
  });

  test("waitForGameSession ignores unrelated messages then times out", async () => {
    jest.useFakeTimers();
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");

    const promise = (client as any).waitForGameSession(ws);
    ws.emit("message", '42["userActivity","u1",{}]');
    jest.advanceTimersByTime(10000);

    await expect(promise).rejects.toThrow("Timed out waiting for Foundry to bind the game session");
    jest.useRealTimers();
  });

  test("setupWebSocketHandlers responds to handshake", () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).setupWebSocketHandlers(ws);

    ws.emit("message", "0{\"sid\":\"x\"}");

    expect(ws.send).toHaveBeenCalledWith("40");
  });

  test("setupWebSocketHandlers ignores session event", () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).setupWebSocketHandlers(ws);

    ws.emit("message", "42[\"session\",{}]");

    expect(ws.send).not.toHaveBeenCalled();
  });

  test("setupWebSocketHandlers replies to Engine.IO ping with a pong", () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).setupWebSocketHandlers(ws);

    ws.emit("message", "2");

    expect(ws.send).toHaveBeenCalledWith("3");
  });

  test("setupWebSocketHandlers triggers reconnect on close", () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };

    const reconnect = jest.spyOn(client as any, "reconnect").mockResolvedValue(true);
    (client as any).setupWebSocketHandlers(ws);
    ws.readyState = 3; // a real socket is CLOSED when "close" fires
    ws.emit("close", 1000, Buffer.from("bye"));

    expect(reconnect).toHaveBeenCalled();
  });

  test("a closed socket that was already replaced does not trigger a reconnect", () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const oldWs = new TestWebSocket("ws://host");
    const currentWs = new TestWebSocket("ws://host");
    (client as any).connection = { hostname: "host", credential: {}, sessionId: "sid", ws: currentWs };
    const reconnect = jest.spyOn(client as any, "reconnect").mockResolvedValue(true);

    (client as any).setupWebSocketHandlers(oldWs);
    oldWs.emit("close", 1006, Buffer.from(""));
    expect(reconnect).not.toHaveBeenCalled();
  });

  test("reconnection keeps retrying with backoff until it succeeds", async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const { client } = createClient({
      WebSocketCtor: TestWebSocket,
      setTimeoutFn: ((fn: () => void, ms: number) => { timers.push({ fn, ms }); return 0; }) as any,
    });
    const ws = new TestWebSocket("ws://host");
    ws.readyState = 3;
    const connection = { hostname: "host", credential: {}, sessionId: "sid", ws };
    (client as any).connection = connection;
    const reconnect = jest.spyOn(client as any, "reconnect")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => { ws.readyState = TestWebSocket.OPEN; return true; });

    await (client as any).reconnectWithRetry(connection);
    expect(timers.map((t) => t.ms)).toEqual([1000]);
    timers.shift()!.fn(); await Promise.resolve(); await Promise.resolve();
    expect(timers.map((t) => t.ms)).toEqual([2000]);
    timers.shift()!.fn(); await Promise.resolve(); await Promise.resolve();
    expect(reconnect).toHaveBeenCalledTimes(3);
    expect(timers).toEqual([]);
  });

  test("reconnection stops retrying when the connection is replaced", async () => {
    const timers: Array<() => void> = [];
    const { client } = createClient({
      WebSocketCtor: TestWebSocket,
      setTimeoutFn: ((fn: () => void) => { timers.push(fn); return 0; }) as any,
    });
    const ws = new TestWebSocket("ws://host");
    ws.readyState = 3;
    const connection = { hostname: "host", credential: {}, sessionId: "sid", ws };
    (client as any).connection = connection;
    const reconnect = jest.spyOn(client as any, "reconnect").mockResolvedValue(false);

    await (client as any).reconnectWithRetry(connection);
    (client as any).connection = { ...connection, ws: new TestWebSocket("ws://other") };
    timers.shift()!();
    await Promise.resolve();
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  test("reconnect falls back to a fresh session when the old one gets a null game session", async () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = { hostname: "host", credential: {}, sessionId: "stale", ws };
    jest.spyOn(client as any, "authenticate").mockResolvedValue(true);
    const getSession = jest.spyOn(client as any, "getSession").mockResolvedValue("fresh");
    const connectWebSocket = jest.spyOn(client as any, "connectWebSocket").mockResolvedValue(new TestWebSocket("ws://host"));
    jest.spyOn(client as any, "waitForGameSession")
      .mockRejectedValueOnce(new Error("Foundry returned a null session"))
      .mockResolvedValueOnce(undefined);

    await expect((client as any).reconnect()).resolves.toBe(true);
    expect(getSession).toHaveBeenCalled();
    expect(connectWebSocket.mock.calls.map((c) => c[1])).toEqual(["stale", "fresh"]);
    expect((client as any).connection.sessionId).toBe("fresh");
  });

  test("ensureConnected tries one reconnection when disconnected", async () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    expect(await client.ensureConnected()).toBe(false);

    const ws = new TestWebSocket("ws://host");
    ws.readyState = 3;
    (client as any).connection = { hostname: "host", credential: {}, sessionId: "sid", ws };
    jest.spyOn(client as any, "reconnect").mockImplementation(async () => { ws.readyState = TestWebSocket.OPEN; return true; });
    expect(await client.ensureConnected()).toBe(true);
  });

  test("reconnect handles success and fallbacks", async () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" },
      sessionId: "sid",
      ws,
    };

    const authenticate = jest
      .spyOn(client as any, "authenticate")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const getSession = jest
      .spyOn(client as any, "getSession")
      .mockResolvedValue("newSid");
    const connectWebSocket = jest
      .spyOn(client as any, "connectWebSocket")
      .mockResolvedValue(new TestWebSocket("ws://host"));
    jest.spyOn(client as any, "waitForGameSession").mockResolvedValue(undefined);

    await (client as any).reconnect();

    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(getSession).toHaveBeenCalled();
    expect(connectWebSocket).toHaveBeenCalled();
  });

  test("fetchJoinUsers requests join data after the Socket.IO connect and closes the socket", async () => {
    const { client, wsLogger } = createClient();
    const ws = new TestWebSocket("ws://host");
    const connectWebSocket = jest.spyOn(client as any, "connectWebSocket").mockResolvedValue(ws);
    (client as any).messageCounter = 5;

    const promise = (client as any).fetchJoinUsers("host", "sid", 14, true);
    await Promise.resolve();
    await Promise.resolve();

    ws.emit("message", '0{"sid":"x"}');
    expect(ws.send).toHaveBeenLastCalledWith("40");
    ws.emit("message", "2");
    expect(ws.send).toHaveBeenLastCalledWith("3");
    ws.emit("message", '40{"sid":"y"}');
    expect(ws.send).toHaveBeenLastCalledWith('425["getJoinData"]');
    ws.emit("message", '42["session",null]');
    ws.emit("message", '434[{"users":[]}]');
    ws.emit("message", '435[{"users":[{"_id":"u1","name":"API"}]}]');

    await expect(promise).resolves.toEqual([{ id: "u1", name: "API" }]);
    expect(connectWebSocket).toHaveBeenCalledWith("host", "sid", 14, true);
    expect(ws.close).toHaveBeenCalled();
    expect(wsLogger.logOutbound).toHaveBeenCalledWith('425["getJoinData"]');
  });

  test("fetchJoinUsers rejects on malformed join data and closes the socket", async () => {
    const { client } = createClient();
    const ws = new TestWebSocket("ws://host");
    jest.spyOn(client as any, "connectWebSocket").mockResolvedValue(ws);
    (client as any).messageCounter = 1;

    const promise = (client as any).fetchJoinUsers("host", "sid", null);
    await Promise.resolve();
    await Promise.resolve();
    ws.emit("message", '431[{"world":{}}]');

    await expect(promise).rejects.toThrow("missing users array");
    expect(ws.close).toHaveBeenCalled();
  });

  test("fetchJoinUsers times out", async () => {
    jest.useFakeTimers();
    const { client } = createClient();
    const ws = new TestWebSocket("ws://host");
    jest.spyOn(client as any, "connectWebSocket").mockResolvedValue(ws);

    const promise = (client as any).fetchJoinUsers("host", "sid", null);
    const assertion = expect(promise).rejects.toThrow("Timed out waiting for Foundry join data");
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(10000);

    await assertion;
    expect(ws.close).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test("completeUserIdentity skips the lookup when both fields are set", async () => {
    const { client } = createClient();
    const fetchJoinUsers = jest.spyOn(client as any, "fetchJoinUsers");
    const credential = { _id: "c", hostname: "h", password: "p", userid: "u", username: "API" };

    await expect((client as any).completeUserIdentity("h", "sid", credential)).resolves.toBe(credential);
    expect(fetchJoinUsers).not.toHaveBeenCalled();
  });

  test("completeUserIdentity looks up the missing field", async () => {
    const { client } = createClient();
    jest.spyOn(client as any, "detectGeneration").mockResolvedValue(13);
    const fetchJoinUsers = jest
      .spyOn(client as any, "fetchJoinUsers")
      .mockResolvedValue([{ id: "u9", name: "API" }]);

    await expect((client as any).completeUserIdentity("h", "sid", {
      _id: "c", hostname: "h", password: "p", username: "API", allow_insecure_tls: true,
    })).resolves.toMatchObject({ userid: "u9", username: "API" });
    expect(fetchJoinUsers).toHaveBeenCalledWith("h", "sid", 13, true);
  });

  test("completeUserIdentity falls back to the given credential when the lookup fails", async () => {
    const { client, logger } = createClient();
    jest.spyOn(client as any, "detectGeneration").mockResolvedValue(13);
    jest.spyOn(client as any, "fetchJoinUsers").mockRejectedValue(new Error("no join data"));
    const credential = { _id: "c", hostname: "h", password: "p", userid: "u" };

    await expect((client as any).completeUserIdentity("h", "sid", credential)).resolves.toBe(credential);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("no join data"));
  });

  test("connect authenticates with the inferred identity and remembers it", async () => {
    const creds = [{ _id: "a", hostname: "a", password: "p", userid: "u1" }];
    const { client } = createClient({ fs: { readFileSync: jest.fn(() => JSON.stringify(creds)) } });

    jest.spyOn(client as any, "getSession").mockResolvedValue("sid");
    jest.spyOn(client as any, "fetchJoinUsers").mockResolvedValue([{ id: "u1", name: "API" }]);
    const authenticate = jest.spyOn(client as any, "authenticate").mockResolvedValue(true);
    jest.spyOn(client as any, "detectGeneration").mockResolvedValue(14);
    jest.spyOn(client as any, "connectWebSocket").mockResolvedValue(new TestWebSocket("ws://a"));
    jest.spyOn(client as any, "setupWebSocketHandlers").mockImplementation(() => undefined);
    jest.spyOn(client as any, "waitForGameSession").mockResolvedValue(undefined);

    await client.connect();

    expect(authenticate).toHaveBeenCalledWith(
      "a",
      "sid",
      expect.objectContaining({ userid: "u1", username: "API" })
    );
    expect(client.getCredentialsInfo()[0]).toMatchObject({ userid: "u1", username: "API" });
  });

  test("chooseFoundryInstance authenticates with the inferred identity", async () => {
    const creds = [{ _id: "a", hostname: "a", password: "p", username: "API" }];
    const { client } = createClient({ fs: { readFileSync: jest.fn(() => JSON.stringify(creds)) } });

    jest.spyOn(client as any, "getSession").mockResolvedValue("sid");
    jest.spyOn(client as any, "fetchJoinUsers").mockResolvedValue([{ id: "u7", name: "API" }]);
    const authenticate = jest.spyOn(client as any, "authenticate").mockResolvedValue(true);
    jest.spyOn(client as any, "detectGeneration").mockResolvedValue(14);
    jest.spyOn(client as any, "connectWebSocket").mockResolvedValue(new TestWebSocket("ws://a"));
    jest.spyOn(client as any, "setupWebSocketHandlers").mockImplementation(() => undefined);
    jest.spyOn(client as any, "waitForGameSession").mockResolvedValue(undefined);

    await client.chooseFoundryInstance({ item_order: 0 });

    expect(authenticate).toHaveBeenCalledWith(
      "a",
      "sid",
      expect.objectContaining({ userid: "u7", username: "API" })
    );
  });

  test("connect throws when no credentials", async () => {
    const { client } = createClient({ fs: { readFileSync: jest.fn(() => "[]") } });
    await expect(client.connect()).rejects.toThrow("No credentials found in config file");
  });

  test("connect tries credentials until success", async () => {
    const creds = [
      { _id: "a", hostname: "a", password: "p", userid: "u", username: "n" },
      { _id: "b", hostname: "b", password: "p", userid: "u", username: "n" },
    ];
    const { client } = createClient({ fs: { readFileSync: jest.fn(() => JSON.stringify(creds)) } });

    jest.spyOn(client as any, "getSession").mockResolvedValue("sid");
    jest.spyOn(client as any, "authenticate")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    jest.spyOn(client as any, "detectGeneration").mockResolvedValue(14);
    jest.spyOn(client as any, "connectWebSocket")
      .mockResolvedValue(new TestWebSocket("ws://b"));
    jest.spyOn(client as any, "setupWebSocketHandlers").mockImplementation(() => undefined);
    jest.spyOn(client as any, "waitForGameSession").mockResolvedValue(undefined);

    await client.connect();
    expect(client.getHostname()).toBe("b");
  });

  test("connect fails when all credentials fail", async () => {
    const creds = [{ _id: "a", hostname: "a", password: "p", userid: "u" }];
    const { client } = createClient({ fs: { readFileSync: jest.fn(() => JSON.stringify(creds)) } });

    jest.spyOn(client as any, "getSession").mockResolvedValue("sid");
    jest.spyOn(client as any, "authenticate").mockResolvedValue(false);

    await expect(client.connect()).rejects.toThrow("Failed to connect to any Foundry server");
  });

  test("chooseFoundryInstance switches connection", async () => {
    const creds = [
      { _id: "a", hostname: "a", password: "p", userid: "u", username: "n" },
      { _id: "b", hostname: "b", password: "p", userid: "u", username: "n" },
    ];
    const { client } = createClient({ fs: { readFileSync: jest.fn(() => JSON.stringify(creds)) } });

    const oldWs = new TestWebSocket("ws://a");
    (client as any).connection = {
      hostname: "a",
      credential: creds[0],
      sessionId: "sid",
      ws: oldWs,
    };

    jest.spyOn(client as any, "getSession").mockResolvedValue("sid");
    jest.spyOn(client as any, "authenticate").mockResolvedValue(true);
    jest.spyOn(client as any, "detectGeneration").mockResolvedValue(13);
    jest.spyOn(client as any, "connectWebSocket").mockResolvedValue(new TestWebSocket("ws://b"));
    jest.spyOn(client as any, "setupWebSocketHandlers").mockImplementation(() => undefined);
    jest.spyOn(client as any, "waitForGameSession").mockResolvedValue(undefined);

    await client.chooseFoundryInstance({ item_order: 1 });

    expect(oldWs.close).toHaveBeenCalled();
    expect(client.getHostname()).toBe("b");
  });

  test("getDocuments validates collection", async () => {
    const { client } = createClient();
    jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({});

    await expect(client.getDocuments("actors"))
      .rejects.toThrow("Response does not contain actors array");
  });

  test("getDocuments filters and truncates", async () => {
    const { client } = createClient();
    jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({
      result: [
        { _id: "1", name: "A", type: "npc" },
        { _id: "2", name: "B", type: "pc" },
      ],
    });

    const docs = await client.getDocuments("actors", {
      requestedFields: ["type"],
      where: { type: "npc" },
      maxLength: 1000,
    });

    expect(docs).toEqual([{ _id: "1", name: "A", type: "npc" }]);
  });

  test("getDocument resolves dot-notation fields end to end", async () => {
    const { client } = createClient();
    jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({
      result: [
        {
          _id: "jJ10LA0URnIaLu7g",
          name: "Bezaliel",
          system: {
            age: 52,
            aspirations: "Uncover the Mysteries.",
            attributes_physical: { strength: { value: 1 }, stamina: { value: 2 } },
            touchstones_vampire: { "1": "", "2": "" },
            secret: "omitted",
          },
        },
      ],
    });

    await expect(
      client.getDocument(
        "actors",
        { name: "Bezaliel" },
        {
          requestedFields: [
            "system.age",
            "system.aspirations",
            "system.attributes_physical.strength",
            "system.touchstones_vampire.1",
            "system.nonexistent.path",
          ],
        }
      )
    ).resolves.toEqual({
      _id: "jJ10LA0URnIaLu7g",
      name: "Bezaliel",
      system: {
        age: 52,
        aspirations: "Uncover the Mysteries.",
        attributes_physical: { strength: { value: 1 } },
        touchstones_vampire: { "1": "" },
      },
    });
  });

  test("getDocument resolves by id and name", async () => {
    const { client } = createClient();
    jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({
      result: [
        { _id: "1", id: "1", name: "A" },
        { _id: "2", id: "2", name: "B" },
      ],
    });

    await expect(client.getDocument("items", { id: "1" }))
      .resolves.toEqual({ _id: "1", id: "1", name: "A" });
    await expect(client.getDocument("items", { _id: "2" }))
      .resolves.toEqual({ _id: "2", id: "2", name: "B" });
    await expect(client.getDocument("items", { name: "B" }))
      .resolves.toEqual({ _id: "2", id: "2", name: "B" });
  });

  test("getDocument returns null when missing", async () => {
    const { client } = createClient();
    jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({ result: [] });

    await expect(client.getDocument("items", { name: "Missing" }))
      .resolves.toBeNull();
  });

  describe("compendium reads", () => {
    const worldPacks = [
      { id: "world.my-items", label: "My Items", type: "Item", packageType: "world", packageName: "w", index: [] },
      { id: "my-module.actors", label: "Actors", type: "Actor", packageType: "module", packageName: "my-module" },
    ];

    test("getCompendiums lists packs and filters by type", async () => {
      const { client } = createClient();
      jest.spyOn(client, "requestWorldData").mockResolvedValue({ packs: worldPacks });

      await expect(client.getCompendiums()).resolves.toEqual([
        { id: "world.my-items", label: "My Items", type: "Item", packageType: "world", packageName: "w" },
        { id: "my-module.actors", label: "Actors", type: "Actor", packageType: "module", packageName: "my-module" },
      ]);
      await expect(client.getCompendiums({ type: "actor" }))
        .resolves.toEqual([
          { id: "my-module.actors", label: "Actors", type: "Actor", packageType: "module", packageName: "my-module" },
        ]);
    });

    test("getPackDocuments sends a get operation with the pack and an empty query", async () => {
      const { client } = createClient();
      jest.spyOn(client, "requestWorldData").mockResolvedValue({ packs: worldPacks });
      jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({
        result: [
          { _id: "1", name: "Sword", type: "weapon" },
          { _id: "2", name: "Potion", type: "consumable" },
        ],
      });

      const docs = await client.getPackDocuments("Item", "world.my-items", {
        where: { type: "weapon" },
        requestedFields: ["type"],
      });

      expect(docs).toEqual([{ _id: "1", name: "Sword", type: "weapon" }]);
      expect((client as any).sendModifyDocumentRequest).toHaveBeenCalledWith(
        "Item",
        "get",
        { action: "get", pack: "world.my-items", query: {}, index: false, broadcast: false },
        expect.any(String),
        expect.any(Function),
        "getPackDocuments"
      );
    });

    test("getPackDocuments only matches responses that carry a result array", async () => {
      const { client } = createClient();
      jest.spyOn(client, "requestWorldData").mockResolvedValue({ packs: worldPacks });
      jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({ result: [] });

      await client.getPackDocuments("Item", "world.my-items");

      const isMatch = (client as any).sendModifyDocumentRequest.mock.calls[0][4] as (r: any) => boolean;
      expect(isMatch({ result: [] })).toBe(true);
      expect(isMatch({ result: undefined })).toBe(false);
      expect(isMatch({})).toBe(false);
    });

    test("getPackDocuments truncates to maxLength", async () => {
      const { client } = createClient();
      jest.spyOn(client, "requestWorldData").mockResolvedValue({ packs: worldPacks });
      jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({
        result: [
          { _id: "1", name: "A".repeat(200) },
          { _id: "2", name: "B".repeat(200) },
        ],
      });

      const docs = await client.getPackDocuments("Item", "world.my-items", { maxLength: 260 });

      expect(docs).toHaveLength(1);
    });

    test("getPackDocuments rejects an unknown pack without sending a request", async () => {
      const { client } = createClient();
      jest.spyOn(client, "requestWorldData").mockResolvedValue({ packs: worldPacks });
      const send = jest.spyOn(client as any, "sendModifyDocumentRequest");

      await expect(client.getPackDocuments("Item", "world.nope"))
        .rejects.toThrow('Compendium pack "world.nope" not found');
      expect(send).not.toHaveBeenCalled();
    });

    test("getPackDocuments rejects a pack that holds another document type", async () => {
      const { client } = createClient();
      jest.spyOn(client, "requestWorldData").mockResolvedValue({ packs: worldPacks });
      const send = jest.spyOn(client as any, "sendModifyDocumentRequest");

      await expect(client.getPackDocuments("Actor", "world.my-items"))
        .rejects.toThrow("holds Item documents, not Actor");
      expect(send).not.toHaveBeenCalled();
    });

    test("getPackDocuments surfaces a server error message", async () => {
      const { client } = createClient();
      jest.spyOn(client, "requestWorldData").mockResolvedValue({ packs: worldPacks });
      jest.spyOn(client as any, "sendModifyDocumentRequest")
        .mockResolvedValue({ error: { class: "ServerError", message: "boom" } });

      await expect(client.getPackDocuments("Item", "world.my-items")).rejects.toThrow("boom");
    });

    test("getPackDocument queries by _id, id, or name and returns the first match", async () => {
      const { client } = createClient();
      jest.spyOn(client, "requestWorldData").mockResolvedValue({ packs: worldPacks });
      const send = jest.spyOn(client as any, "sendModifyDocumentRequest")
        .mockResolvedValue({ result: [{ _id: "1", name: "Sword" }] });

      await expect(client.getPackDocument("Item", "world.my-items", { _id: "1" }))
        .resolves.toEqual({ _id: "1", name: "Sword" });
      await expect(client.getPackDocument("Item", "world.my-items", { id: "1" }))
        .resolves.toEqual({ _id: "1", name: "Sword" });
      await expect(client.getPackDocument("Item", "world.my-items", { name: "Sword" }))
        .resolves.toEqual({ _id: "1", name: "Sword" });

      expect(send.mock.calls.map((call) => (call[2] as any).query)).toEqual([
        { _id: "1" },
        { _id: "1" },
        { name: "Sword" },
      ]);
    });

    test("getPackDocument returns null when nothing matches or no identifier is given", async () => {
      const { client } = createClient();
      jest.spyOn(client, "requestWorldData").mockResolvedValue({ packs: worldPacks });
      const send = jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({ result: [] });

      await expect(client.getPackDocument("Item", "world.my-items", { name: "Missing" }))
        .resolves.toBeNull();
      send.mockClear();
      await expect(client.getPackDocument("Item", "world.my-items", {})).resolves.toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    test("getPackDocument filters fields with dot notation", async () => {
      const { client } = createClient();
      jest.spyOn(client, "requestWorldData").mockResolvedValue({ packs: worldPacks });
      jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({
        result: [{ _id: "1", name: "Rune", system: { price: { value: 10000, denomination: "gp" }, weight: 1 } }],
      });

      await expect(
        client.getPackDocument("Item", "world.my-items", { _id: "1" }, { requestedFields: ["system.price"] })
      ).resolves.toEqual({
        _id: "1",
        name: "Rune",
        system: { price: { value: 10000, denomination: "gp" } },
      });
    });
  });

  test("getDocuments asks the server for one document type, not the whole world", async () => {
    const { client } = createClient();
    const world = jest.spyOn(client, "requestWorldData");
    const get = jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({ result: [] });

    await client.getDocuments("journal");

    expect(world).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith(
      "JournalEntry",
      "get",
      { action: "get", query: {}, index: false, broadcast: false },
      expect.any(String),
      expect.any(Function),
      "getWorldDocuments"
    );
  });

  test("getDocument filters by _id or name on the server", async () => {
    const { client } = createClient();
    const get = jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({ result: [] });

    await client.getDocument("actors", { id: "abc" });
    await client.getDocument("actors", { _id: "def" });
    await client.getDocument("messages", { name: "Hello" });

    expect(get.mock.calls.map((c) => [c[0], (c[2] as any).query])).toEqual([
      ["Actor", { _id: "abc" }],
      ["Actor", { _id: "def" }],
      ["ChatMessage", { name: "Hello" }],
    ]);
  });

  test("scalar top-level where keys are sent as the server query", async () => {
    const { client } = createClient();
    const get = jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({
      result: [{ _id: "1", name: "A", type: "npc", folder: null }],
    });

    const docs = await client.getDocuments("actors", {
      where: { type: "npc", folder: null, "system.level": 3, flags: { x: 1 } },
    });

    expect((get.mock.calls[0][2] as any).query).toEqual({ type: "npc" });
    // The local filter still runs on what the server returns.
    expect(docs).toEqual([]);
  });

  test("getDocument without an identifier sends nothing", async () => {
    const { client } = createClient();
    const get = jest.spyOn(client as any, "sendModifyDocumentRequest");

    await expect(client.getDocument("actors", {})).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  test("getDocuments surfaces a server error message", async () => {
    const { client } = createClient();
    jest.spyOn(client as any, "sendModifyDocumentRequest").mockResolvedValue({ error: { message: "nope" } });

    await expect(client.getDocuments("items")).rejects.toThrow("nope");
  });

  test("getDocuments falls back to the world payload for an unmapped collection", async () => {
    const { client } = createClient();
    jest.spyOn(client, "requestWorldData").mockResolvedValue({ widgets: [{ _id: "1", name: "W" }] });
    const get = jest.spyOn(client as any, "sendModifyDocumentRequest");

    await expect(client.getDocuments("widgets")).resolves.toEqual([{ _id: "1", name: "W" }]);
    expect(get).not.toHaveBeenCalled();
  });

  test("modifyDocument builds operation", async () => {
    const { client } = createClient({ now: () => 123, WebSocketCtor: TestWebSocket });
    jest.spyOn(client as any, "sendModifyDocumentRequest")
      .mockResolvedValue({ ok: true });

    const result = await client.modifyDocument("Actor", "1", [{ name: "x" }], { parentUuid: "Scene.1" });

    expect(result).toEqual({ ok: true });
    expect((client as any).sendModifyDocumentRequest).toHaveBeenCalledWith(
      "Actor",
      "update",
      expect.objectContaining({ parentUuid: "Scene.1", modifiedTime: 123, pack: null }),
      expect.any(String),
      expect.any(Function),
      "modifyDocument"
    );
  });

  test("modifyDocument builds operation with pack", async () => {
    const { client } = createClient({ now: () => 123, WebSocketCtor: TestWebSocket });
    jest.spyOn(client as any, "sendModifyDocumentRequest")
      .mockResolvedValue({ ok: true });

    const result = await client.modifyDocument("Actor", "1", [{ name: "x" }], { pack: "world.my-compendium" });

    expect(result).toEqual({ ok: true });
    expect((client as any).sendModifyDocumentRequest).toHaveBeenCalledWith(
      "Actor",
      "update",
      expect.objectContaining({ modifiedTime: 123, pack: "world.my-compendium" }),
      expect.any(String),
      expect.any(Function),
      "modifyDocument"
    );
  });

  test("createDocument builds operation", async () => {
    const { client } = createClient({ now: () => 456, WebSocketCtor: TestWebSocket });
    jest.spyOn(client as any, "sendModifyDocumentRequest")
      .mockResolvedValue({ ok: true });

    await client.createDocument("Actor", [{ name: "x" }]);

    expect((client as any).sendModifyDocumentRequest).toHaveBeenCalledWith(
      "Actor",
      "create",
      expect.objectContaining({ modifiedTime: 456, pack: null }),
      expect.any(String),
      expect.any(Function),
      "createDocument"
    );
  });

  test("createDocument builds operation with pack", async () => {
    const { client } = createClient({ now: () => 456, WebSocketCtor: TestWebSocket });
    jest.spyOn(client as any, "sendModifyDocumentRequest")
      .mockResolvedValue({ ok: true });

    await client.createDocument("Actor", [{ name: "Goblin" }], { pack: "world.monsters" });

    expect((client as any).sendModifyDocumentRequest).toHaveBeenCalledWith(
      "Actor",
      "create",
      expect.objectContaining({ modifiedTime: 456, pack: "world.monsters" }),
      expect.any(String),
      expect.any(Function),
      "createDocument"
    );
  });

  test("deleteDocument builds operation", async () => {
    const { client } = createClient({ now: () => 789, WebSocketCtor: TestWebSocket });
    jest.spyOn(client as any, "sendModifyDocumentRequest")
      .mockResolvedValue({ ok: true });

    await client.deleteDocument("Actor", ["1"]);

    expect((client as any).sendModifyDocumentRequest).toHaveBeenCalledWith(
      "Actor",
      "delete",
      expect.objectContaining({ modifiedTime: 789, pack: null }),
      expect.any(String),
      expect.any(Function),
      "deleteDocument"
    );
  });

  test("deleteDocument builds operation with pack", async () => {
    const { client } = createClient({ now: () => 789, WebSocketCtor: TestWebSocket });
    jest.spyOn(client as any, "sendModifyDocumentRequest")
      .mockResolvedValue({ ok: true });

    await client.deleteDocument("Actor", ["abc123"], { pack: "world.monsters" });

    expect((client as any).sendModifyDocumentRequest).toHaveBeenCalledWith(
      "Actor",
      "delete",
      expect.objectContaining({ modifiedTime: 789, pack: "world.monsters" }),
      expect.any(String),
      expect.any(Function),
      "deleteDocument"
    );
  });

  test("requestWorldData resolves on world message", async () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };

    const promise = client.requestWorldData();
    ws.emit("message", "430" + JSON.stringify([{ ok: true }]));

    await expect(promise).resolves.toEqual({ ok: true });
    expect(ws.send).toHaveBeenCalledWith('420["world"]');
  });

  test("requestWorldData rejects when not connected", async () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    await expect(client.requestWorldData())
      .rejects.toThrow("Not connected to Foundry server");
  });

  test("requestWorldData rejects on parse error", async () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };

    const promise = client.requestWorldData();
    ws.emit("message", "430not-json");

    await expect(promise).rejects.toThrow("Failed to parse world response");
  });

  test("sendModifyDocumentRequest resolves on match", async () => {
    jest.useFakeTimers();
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };

    const promise = (client as any).sendModifyDocumentRequest(
      "Actor",
      "update",
      { updates: [] },
      "timeout",
      (data: Record<string, unknown>) => data.action === "update",
      "modifyDocument"
    );

    ws.emit("message", "43" + JSON.stringify([{ type: "Actor", action: "update", result: [] }]));

    await expect(promise).resolves.toEqual({ type: "Actor", action: "update", result: [] });
    jest.useRealTimers();
  });

  test("concurrent requests of the same type each get their own response by ack id", async () => {
    jest.useFakeTimers();
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };
    (client as any).messageCounter = 7;
    const isGet = (data: Record<string, unknown>) => Array.isArray(data.result);

    const first = (client as any).sendModifyDocumentRequest("Item", "get", { query: { name: "A" } }, "t", isGet, "a");
    const second = (client as any).sendModifyDocumentRequest("Item", "get", { query: { name: "B" } }, "t", isGet, "b");

    // Foundry answers the second request first.
    ws.emit("message", "438" + JSON.stringify([{ type: "Item", result: [{ name: "B" }] }]));
    ws.emit("message", "437" + JSON.stringify([{ type: "Item", result: [{ name: "A" }] }]));

    await expect(first).resolves.toEqual({ type: "Item", result: [{ name: "A" }] });
    await expect(second).resolves.toEqual({ type: "Item", result: [{ name: "B" }] });
    jest.useRealTimers();
  });

  test("sendModifyDocumentRequest ignores mismatched type and handles error payload", async () => {
    jest.useFakeTimers();
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };

    const promise = (client as any).sendModifyDocumentRequest(
      "Actor",
      "update",
      { updates: [] },
      "timeout",
      () => false,
      "modifyDocument"
    );

    ws.emit("message", "43" + JSON.stringify([{ type: "Other", action: "update", result: [] }]));
    ws.emit("message", "43" + JSON.stringify([{ type: "Actor", error: "bad" }]));

    await expect(promise).resolves.toEqual({ type: "Actor", error: "bad" });
    jest.useRealTimers();
  });

  test("sendModifyDocumentRequest times out", async () => {
    jest.useFakeTimers();
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };

    const promise = (client as any).sendModifyDocumentRequest(
      "Actor",
      "update",
      { updates: [] },
      "timeout",
      () => true,
      "modifyDocument"
    );

    jest.advanceTimersByTime(30000);
    await expect(promise).rejects.toThrow("timeout");
    jest.useRealTimers();
  });

  test("getWorld filters collections", async () => {
    const { client } = createClient();
    jest.spyOn(client, "requestWorldData").mockResolvedValue({ actors: [], meta: { title: "x" } });

    await expect(client.getWorld(["actors"]))
      .resolves.toEqual({ meta: { title: "x" } });
  });

  test("send throws when not connected", () => {
    const { client } = createClient({ WebSocketCtor: TestWebSocket });
    expect(() => client.send("hi")).toThrow("Not connected to Foundry server");
  });

  test("disconnect closes ws and logger", () => {
    const { client, wsLogger } = createClient({ WebSocketCtor: TestWebSocket });
    const ws = new TestWebSocket("ws://host");
    (client as any).connection = {
      hostname: "host",
      credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
      sessionId: "sid",
      ws,
    };

    client.disconnect();

    expect(ws.close).toHaveBeenCalled();
    expect(wsLogger.close).toHaveBeenCalled();
  });

  describe("uploadFile", () => {
    test("throws when both url and image_data provided", async () => {
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      await expect(client.uploadFile({
        target: "worlds/test/assets",
        filename: "test.png",
        url: "http://example.com/image.png",
        image_data: "base64data",
      })).rejects.toThrow("Cannot provide both 'url' and 'image_data'");
    });

    test("throws when neither url nor image_data provided", async () => {
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      await expect(client.uploadFile({
        target: "worlds/test/assets",
        filename: "test.png",
      })).rejects.toThrow("Must provide either 'url' or 'image_data'");
    });

    test("throws when not connected", async () => {
      const { client } = createClient({ WebSocketCtor: TestWebSocket });

      await expect(client.uploadFile({
        target: "worlds/test/assets",
        filename: "test.png",
        image_data: "aGVsbG8=",
      })).rejects.toThrow("Not connected to Foundry server");
    });

    test("uploads base64 image data with configured TLS option", async () => {
      const https = createHttpsStub((_req, callback) => {
        const res = new EventEmitter() as any;
        res.statusCode = 200;
        callback(res);
        res.emit("data", JSON.stringify({ path: "worlds/test/assets/test.png" }));
        res.emit("end");
      });

      const { client } = createClient({
        WebSocketCtor: TestWebSocket,
        https,
        crypto: { randomBytes: jest.fn(() => Buffer.alloc(8, 1)) },
      });

      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: {
          _id: "c",
          hostname: "host",
          password: "p",
          userid: "u",
          allow_insecure_tls: true,
        } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const result = await client.uploadFile({
        target: "worlds/test/assets",
        filename: "test.png",
        image_data: "aGVsbG8=", // "hello" in base64
      });

      expect(result.path).toBe("worlds/test/assets/test.png");
      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: "host",
          path: "/upload",
          method: "POST",
          rejectUnauthorized: false,
        }),
        expect.any(Function)
      );
    });

    test("handles upload error response", async () => {
      const https = createHttpsStub((_req, callback) => {
        const res = new EventEmitter() as any;
        res.statusCode = 200;
        callback(res);
        res.emit("data", JSON.stringify({ error: "Permission denied" }));
        res.emit("end");
      });

      const { client } = createClient({
        WebSocketCtor: TestWebSocket,
        https,
        crypto: { randomBytes: jest.fn(() => Buffer.alloc(8, 1)) },
      });

      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      await expect(client.uploadFile({
        target: "worlds/test/assets",
        filename: "test.png",
        image_data: "aGVsbG8=",
      })).rejects.toThrow("Upload failed: Permission denied");
    });

    test("handles non-JSON success response", async () => {
      const https = createHttpsStub((_req, callback) => {
        const res = new EventEmitter() as any;
        res.statusCode = 200;
        callback(res);
        res.emit("data", "OK");
        res.emit("end");
      });

      const { client } = createClient({
        WebSocketCtor: TestWebSocket,
        https,
        crypto: { randomBytes: jest.fn(() => Buffer.alloc(8, 1)) },
      });

      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const result = await client.uploadFile({
        target: "worlds/test/assets",
        filename: "test.png",
        image_data: "aGVsbG8=",
      });

      expect(result.path).toBe("worlds/test/assets/test.png");
      expect(result.message).toBe("Upload completed");
    });

    test("rejects on request error", async () => {
      const https = {
        request: jest.fn((_options: any, _callback: any) => {
          const req = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock };
          req.write = jest.fn();
          req.end = jest.fn(() => req.emit("error", new Error("Network error")));
          return req;
        }),
      };

      const { client } = createClient({
        WebSocketCtor: TestWebSocket,
        https,
        crypto: { randomBytes: jest.fn(() => Buffer.alloc(8, 1)) },
      });

      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      await expect(client.uploadFile({
        target: "worlds/test/assets",
        filename: "test.png",
        image_data: "aGVsbG8=",
      })).rejects.toThrow("Upload request failed: Network error");
    });
  });

  describe("browseFiles", () => {
    test("throws when not connected", async () => {
      const { client } = createClient({ WebSocketCtor: TestWebSocket });

      await expect(client.browseFiles({
        target: "worlds/test/assets",
      })).rejects.toThrow("Not connected to Foundry server");
    });

    test("resolves on browse response", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.browseFiles({ target: "worlds/test/assets" });

      const response = {
        target: "worlds/test/assets",
        private: false,
        gridSize: null,
        dirs: ["worlds/test/assets/avatars"],
        privateDirs: [],
        files: ["worlds/test/assets/image.png"],
        extensions: [".png", ".jpg"],
      };

      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).resolves.toEqual(response);
      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('["manageFiles"'));
      jest.useRealTimers();
    });

    test("uses default extensions for images", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      client.browseFiles({ target: "worlds/test/assets" });

      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('".apng"')
      );
      jest.useRealTimers();
    });

    test("uses custom type and extensions", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      client.browseFiles({
        target: "worlds/test/assets",
        type: "audio",
        extensions: [".mp3", ".wav"],
      });

      const sentMessage = ws.send.mock.calls[0][0];
      expect(sentMessage).toContain('"type":"audio"');
      expect(sentMessage).toContain('".mp3"');
      expect(sentMessage).toContain('".wav"');
      jest.useRealTimers();
    });

    test("rejects on error response with dirs", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.browseFiles({ target: "worlds/test/assets" });

      ws.emit("message", "43" + JSON.stringify([{
        dirs: [],
        error: "Directory not found",
      }]));

      await expect(promise).rejects.toThrow("Browse files failed: Directory not found");
      jest.useRealTimers();
    });

    test("rejects on error response without dirs (non-existent directory)", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.browseFiles({ target: "worlds/werewolf-the-forsaken" });

      // Foundry returns error-only response when directory doesn't exist
      ws.emit("message", "431" + JSON.stringify([{
        error: "Directory worlds/werewolf-the-forsaken does not exist or is not accessible in this storage location",
      }]));

      await expect(promise).rejects.toThrow("Browse files failed: Directory worlds/werewolf-the-forsaken does not exist");
      jest.useRealTimers();
    });

    test("times out after 30 seconds", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.browseFiles({ target: "worlds/test/assets" });

      jest.advanceTimersByTime(30000);

      await expect(promise).rejects.toThrow("Timeout waiting for browseFiles response");
      jest.useRealTimers();
    });

    test("ignores unrelated messages", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.browseFiles({ target: "worlds/test/assets" });

      // Send unrelated message (no dirs)
      ws.emit("message", "43" + JSON.stringify([{ type: "Actor", result: [] }]));

      // Then send the actual response
      const response = {
        target: "worlds/test/assets",
        private: false,
        gridSize: null,
        dirs: [],
        privateDirs: [],
        files: [],
        extensions: [],
      };
      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).resolves.toEqual(response);
      jest.useRealTimers();
    });
  });

  describe("createCompendium", () => {
    test("throws when not connected", async () => {
      const { client } = createClient({ WebSocketCtor: TestWebSocket });

      await expect(client.createCompendium("My NPCs", "Actor"))
        .rejects.toThrow("Not connected to Foundry server");
    });

    test("sends correct payload", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      client.createCompendium("My NPCs", "Actor");

      const sentMessage = ws.send.mock.calls[0][0];
      expect(sentMessage).toContain('"manageCompendium"');
      expect(sentMessage).toContain('"action":"create"');
      expect(sentMessage).toContain('"label":"My NPCs"');
      expect(sentMessage).toContain('"type":"Actor"');
      jest.useRealTimers();
    });

    test("resolves on success response", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.createCompendium("My NPCs", "Actor");

      const response = {
        request: {
          action: "create",
          data: {
            label: "My NPCs",
            type: "Actor",
            name: "my-npcs",
            id: "world.my-npcs",
          },
        },
        result: {
          label: "My NPCs",
          type: "Actor",
          name: "my-npcs",
          id: "world.my-npcs",
        },
      };

      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).resolves.toEqual(response);
      jest.useRealTimers();
    });

    test("rejects on error response", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.createCompendium("My NPCs", "Actor");

      const response = {
        request: { action: "create" },
        error: "Permission denied",
      };

      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).rejects.toThrow("Create compendium failed: Permission denied");
      jest.useRealTimers();
    });

    test("times out after 30 seconds", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.createCompendium("My NPCs", "Actor");

      jest.advanceTimersByTime(30000);

      await expect(promise).rejects.toThrow("Timeout waiting for createCompendium response");
      jest.useRealTimers();
    });

    test("ignores unrelated messages", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.createCompendium("My NPCs", "Actor");

      // Send unrelated message (wrong action)
      ws.emit("message", "43" + JSON.stringify([{ request: { action: "delete" }, result: "ok" }]));

      // Send correct response
      const response = {
        request: { action: "create" },
        result: { label: "My NPCs", name: "my-npcs" },
      };
      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).resolves.toEqual(response);
      jest.useRealTimers();
    });
  });

  describe("deleteCompendium", () => {
    test("throws when not connected", async () => {
      const { client } = createClient({ WebSocketCtor: TestWebSocket });

      await expect(client.deleteCompendium("my-npcs"))
        .rejects.toThrow("Not connected to Foundry server");
    });

    test("sends correct payload", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      client.deleteCompendium("my-npcs");

      const sentMessage = ws.send.mock.calls[0][0];
      expect(sentMessage).toContain('"manageCompendium"');
      expect(sentMessage).toContain('"action":"delete"');
      expect(sentMessage).toContain('"data":"my-npcs"');
      jest.useRealTimers();
    });

    test("resolves on success response", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.deleteCompendium("my-npcs");

      const response = {
        request: { action: "delete", data: "my-npcs" },
        result: "world.my-npcs",
      };

      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).resolves.toEqual(response);
      jest.useRealTimers();
    });

    test("rejects on error response", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.deleteCompendium("nonexistent");

      const response = {
        request: { action: "delete" },
        error: "Compendium not found",
      };

      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).rejects.toThrow("Delete compendium failed: Compendium not found");
      jest.useRealTimers();
    });

    test("times out after 30 seconds", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.deleteCompendium("my-npcs");

      jest.advanceTimersByTime(30000);

      await expect(promise).rejects.toThrow("Timeout waiting for deleteCompendium response");
      jest.useRealTimers();
    });

    test("ignores unrelated messages", async () => {
      jest.useFakeTimers();
      const { client } = createClient({ WebSocketCtor: TestWebSocket });
      const ws = new TestWebSocket("ws://host");
      (client as any).connection = {
        hostname: "host",
        credential: { _id: "c", hostname: "host", password: "p", userid: "u" } as FoundryCredential,
        sessionId: "sid",
        ws,
      };

      const promise = client.deleteCompendium("my-npcs");

      // Send unrelated message (wrong action)
      ws.emit("message", "43" + JSON.stringify([{ request: { action: "create" }, result: {} }]));

      // Send correct response
      const response = {
        request: { action: "delete" },
        result: "world.my-npcs",
      };
      ws.emit("message", "43" + JSON.stringify([response]));

      await expect(promise).resolves.toEqual(response);
      jest.useRealTimers();
    });
  });

  describe("getContentTypeFromFilename", () => {
    test("returns correct mime types", () => {
      const { client } = createClient();
      const getContentType = (client as any).getContentTypeFromFilename.bind(client);

      expect(getContentType("image.png")).toBe("image/png");
      expect(getContentType("photo.jpg")).toBe("image/jpeg");
      expect(getContentType("photo.jpeg")).toBe("image/jpeg");
      expect(getContentType("animation.gif")).toBe("image/gif");
      expect(getContentType("icon.svg")).toBe("image/svg+xml");
      expect(getContentType("doc.pdf")).toBe("application/pdf");
      expect(getContentType("song.mp3")).toBe("audio/mpeg");
      expect(getContentType("unknown.xyz")).toBe("application/octet-stream");
    });
  });

  describe("buildMultipartFormData", () => {
    test("builds correct multipart structure", () => {
      const { client } = createClient();
      const buildFormData = (client as any).buildMultipartFormData.bind(client);

      const result = buildFormData("----TestBoundary", {
        source: "data",
        target: "worlds/test",
        filename: "test.png",
        fileBuffer: Buffer.from("test"),
        contentType: "image/png",
      });

      const str = result.toString();
      expect(str).toContain("------TestBoundary");
      expect(str).toContain('name="source"');
      expect(str).toContain("data");
      expect(str).toContain('name="target"');
      expect(str).toContain("worlds/test");
      expect(str).toContain('name="upload"');
      expect(str).toContain('filename="test.png"');
      expect(str).toContain("Content-Type: image/png");
      expect(str).toContain('name="bucket"');
      expect(str).toContain("null");
      expect(str).toContain("------TestBoundary--");
    });
  });
});
