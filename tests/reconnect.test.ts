import { EventEmitter } from "events";
import { FoundryClient } from "../src/foundry-client.js";

class TestWebSocket extends EventEmitter {
  static OPEN = 1;
  readyState = TestWebSocket.OPEN;
  send = jest.fn();
  close = jest.fn(() => {
    this.readyState = 3;
  });
}

function closedSocket(): TestWebSocket {
  const ws = new TestWebSocket();
  ws.readyState = 3;
  return ws;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createClient(overrides: Record<string, unknown> = {}) {
  const deps = {
    logger: { error: jest.fn() },
    wsLogger: { logInbound: jest.fn(), logOutbound: jest.fn(), close: jest.fn() },
    WebSocketCtor: TestWebSocket,
    ...overrides,
  };
  return new FoundryClient("/tmp/creds.json", deps as any) as any;
}

function connectionOn(client: any, overrides: Record<string, unknown> = {}) {
  const connection = {
    hostname: "host",
    credential: { _id: "c", hostname: "host", password: "p", userid: "u" },
    sessionId: "stale",
    generation: 14,
    ws: closedSocket(),
    ...overrides,
  };
  client.connection = connection;
  return connection;
}

/** A client whose network steps are mocked; connectWebSocket hands out `sockets` in order. */
function mockNetwork(client: any, sockets: TestWebSocket[]) {
  return {
    authenticate: jest.spyOn(client, "authenticate").mockResolvedValue(true),
    detectGeneration: jest.spyOn(client, "detectGeneration").mockResolvedValue(14),
    getSession: jest.spyOn(client, "getSession").mockResolvedValue("fresh"),
    connectWebSocket: sockets.reduce(
      (spy: jest.SpyInstance, ws) => spy.mockResolvedValueOnce(ws),
      jest.spyOn(client, "connectWebSocket")
    ),
    waitForGameSession: jest.spyOn(client, "waitForGameSession").mockResolvedValue(undefined),
  };
}

function httpsStub(respond: (req: any, callback: (res: any) => void) => void) {
  return {
    request: jest.fn((_options: unknown, callback: (res: any) => void) => {
      const req = new EventEmitter() as any;
      req.write = jest.fn();
      req.destroy = jest.fn((error: Error) => req.emit("error", error));
      req.end = jest.fn(() => respond(req, callback));
      return req;
    }),
  };
}

const NULL_SESSION = new Error("Foundry returned a null session");

describe("sockets that fail to bind", () => {
  test("the current-session socket is closed when falling back to a fresh session", async () => {
    const client = createClient();
    const connection = connectionOn(client);
    const [stale, fresh] = [new TestWebSocket(), new TestWebSocket()];
    mockNetwork(client, [stale, fresh]).waitForGameSession.mockRejectedValueOnce(NULL_SESSION);

    await expect(client.reconnect()).resolves.toBe(true);

    expect(stale.close).toHaveBeenCalled();
    expect(fresh.close).not.toHaveBeenCalled();
    expect(connection.ws).toBe(fresh);
  });

  test("no socket stays open when both sessions fail to bind", async () => {
    const client = createClient();
    connectionOn(client);
    const sockets = [new TestWebSocket(), new TestWebSocket()];
    mockNetwork(client, sockets).waitForGameSession.mockRejectedValue(NULL_SESSION);

    await expect(client.reconnect()).resolves.toBe(false);

    expect(sockets.map((ws) => ws.readyState)).toEqual([3, 3]);
  });
});

describe("a connection replaced during a reconnection attempt", () => {
  test("is not given the old server's socket by the current-session path", async () => {
    const client = createClient();
    const old = connectionOn(client);
    const candidate = new TestWebSocket();
    const auth = deferred<boolean>();
    mockNetwork(client, [candidate]).authenticate.mockReturnValueOnce(auth.promise);

    const attempt = client.reconnect();
    const replacement = connectionOn(client, { hostname: "other", sessionId: "other", ws: new TestWebSocket() });
    const replacementWs = replacement.ws;
    auth.resolve(true);

    await expect(attempt).resolves.toBe(false);
    expect(replacement.ws).toBe(replacementWs);
    expect(replacement.sessionId).toBe("other");
    expect(candidate.close).toHaveBeenCalled();
    expect(old.ws).not.toBe(candidate);
  });

  test("is not given the old server's socket by the fresh-session path", async () => {
    const client = createClient();
    connectionOn(client);
    const candidate = new TestWebSocket();
    const auth = deferred<boolean>();
    const network = mockNetwork(client, [candidate]);
    network.authenticate.mockResolvedValueOnce(false).mockReturnValueOnce(auth.promise);

    const attempt = client.reconnect();
    await new Promise((resolve) => setImmediate(resolve));
    const replacement = connectionOn(client, { hostname: "other", sessionId: "other", ws: new TestWebSocket() });
    const replacementWs = replacement.ws;
    auth.resolve(true);

    await expect(attempt).resolves.toBe(false);
    expect(replacement.ws).toBe(replacementWs);
    expect(replacement.sessionId).toBe("other");
    expect(candidate.close).toHaveBeenCalled();
  });

  test("stops the attempt instead of starting a fresh session for the old server", async () => {
    const client = createClient();
    connectionOn(client);
    const auth = deferred<boolean>();
    const network = mockNetwork(client, []);
    network.authenticate.mockReturnValueOnce(auth.promise);

    const attempt = client.reconnect();
    connectionOn(client, { hostname: "other", ws: new TestWebSocket() });
    auth.resolve(false);

    await expect(attempt).resolves.toBe(false);
    expect(network.getSession).not.toHaveBeenCalled();
  });
});

describe("a Foundry upgraded across the restart", () => {
  test("the fresh session binds the way the running generation expects", async () => {
    const client = createClient();
    const connection = connectionOn(client, { generation: 13 });
    const network = mockNetwork(client, [new TestWebSocket(), new TestWebSocket()]);
    network.waitForGameSession.mockRejectedValueOnce(NULL_SESSION);

    await expect(client.reconnect()).resolves.toBe(true);

    expect(network.connectWebSocket.mock.calls.map((call) => call[2])).toEqual([13, 14]);
    expect(connection.generation).toBe(14);
  });

  test("the known generation is kept when detection fails", async () => {
    const client = createClient();
    const connection = connectionOn(client, { generation: 13 });
    const network = mockNetwork(client, [new TestWebSocket()]);
    network.authenticate.mockResolvedValueOnce(false);
    network.detectGeneration.mockResolvedValue(null);

    await expect(client.reconnect()).resolves.toBe(true);

    expect(network.connectWebSocket.mock.calls[0][2]).toBe(13);
    expect(connection.generation).toBe(13);
  });
});

describe("concurrent reconnection", () => {
  test("parallel tool calls all wait on the same attempt", async () => {
    const client = createClient();
    const connection = connectionOn(client);
    const attempt = deferred<boolean>();
    const attemptReconnect = jest.spyOn(client, "attemptReconnect").mockReturnValue(attempt.promise);

    const calls = [client.ensureConnected(), client.ensureConnected(), client.ensureConnected()];
    connection.ws = new TestWebSocket();
    attempt.resolve(true);

    await expect(Promise.all(calls)).resolves.toEqual([true, true, true]);
    expect(attemptReconnect).toHaveBeenCalledTimes(1);
  });

  test("a new attempt can start once the last one is over", async () => {
    const client = createClient();
    connectionOn(client);
    const attemptReconnect = jest.spyOn(client, "attemptReconnect").mockResolvedValue(false);

    await client.reconnect();
    await client.reconnect();

    expect(attemptReconnect).toHaveBeenCalledTimes(2);
  });

  test("reconnect does nothing without a connection", async () => {
    const client = createClient();
    const attemptReconnect = jest.spyOn(client, "attemptReconnect");

    await expect(client.reconnect()).resolves.toBe(false);
    expect(attemptReconnect).not.toHaveBeenCalled();
  });

  test("a close during an on-demand attempt still starts the retries", async () => {
    const timers: number[] = [];
    const client = createClient({
      setTimeoutFn: (_fn: () => void, ms: number) => {
        timers.push(ms);
        return 1;
      },
      clearTimeoutFn: jest.fn(),
    });
    const ws = new TestWebSocket();
    ws.readyState = 2; // CLOSING: isConnected() is already false but "close" has not fired
    connectionOn(client, { ws });
    client.setupWebSocketHandlers(ws);
    const attempt = deferred<boolean>();
    jest.spyOn(client, "attemptReconnect").mockReturnValue(attempt.promise);

    const toolCall = client.ensureConnected();
    ws.readyState = 3;
    ws.emit("close", 1006, Buffer.from(""));
    attempt.resolve(false);

    await expect(toolCall).resolves.toBe(false);
    await new Promise((resolve) => setImmediate(resolve));
    expect(timers).toEqual([1000]);
  });

  test("only one retry stays scheduled when the socket drops again", async () => {
    const pending = new Set<number>();
    let nextId = 1;
    const client = createClient({
      setTimeoutFn: () => {
        pending.add(nextId);
        return nextId++;
      },
      clearTimeoutFn: (id: number) => pending.delete(id),
    });
    const connection = connectionOn(client);
    jest.spyOn(client, "reconnect").mockResolvedValue(false);

    await client.reconnectWithRetry(connection);
    await client.reconnectWithRetry(connection);

    expect(pending.size).toBe(1);
  });

  test("disconnect cancels the pending retry", async () => {
    const clearTimeoutFn = jest.fn();
    const client = createClient({ setTimeoutFn: () => 7, clearTimeoutFn });
    const connection = connectionOn(client);
    jest.spyOn(client, "reconnect").mockResolvedValue(false);

    await client.reconnectWithRetry(connection);
    client.disconnect();

    expect(clearTimeoutFn).toHaveBeenCalledWith(7);
  });
});

describe("a server that accepts a request and goes silent", () => {
  const silent = () => httpsStub((req) => req.emit("timeout"));

  test("getSession fails", async () => {
    const client = createClient({ https: silent() });
    await expect(client.getSession("host")).rejects.toThrow("no response for 10s");
  });

  test("authenticate fails", async () => {
    const client = createClient({ https: silent() });
    await expect(client.authenticate("host", "sid", { password: "p", userid: "u" }))
      .rejects.toThrow("no response for 10s");
  });

  test("detectGeneration gives up", async () => {
    const client = createClient({ https: silent() });
    await expect(client.detectGeneration("host")).resolves.toBeNull();
  });

  test("every request carries the timeout", async () => {
    const https = silent();
    const client = createClient({ https });

    await client.getSession("host").catch(() => undefined);
    await client.authenticate("host", "sid", { password: "p", userid: "u" }).catch(() => undefined);
    await client.detectGeneration("host");

    expect(https.request.mock.calls.map(([options]) => (options as any).timeout))
      .toEqual([10000, 10000, 10000]);
  });

  test("a response that dies midway fails authenticate", async () => {
    const https = httpsStub((_req, callback) => {
      const res = new EventEmitter();
      callback(res);
      res.emit("error", new Error("aborted"));
    });
    const client = createClient({ https });

    await expect(client.authenticate("host", "sid", { password: "p", userid: "u" }))
      .rejects.toThrow("POST /join failed for host: aborted");
  });

  test("a response that dies midway gives up on detectGeneration", async () => {
    const https = httpsStub((_req, callback) => {
      const res = new EventEmitter();
      callback(res);
      res.emit("error", new Error("aborted"));
    });
    const client = createClient({ https });

    await expect(client.detectGeneration("host")).resolves.toBeNull();
  });

  test("a stalled attempt ends, so the next one can start", async () => {
    const client = createClient({ https: silent() });
    connectionOn(client);

    await expect(client.reconnect()).resolves.toBe(false);
    expect(client.reconnectAttempt).toBeNull();
  });
});
