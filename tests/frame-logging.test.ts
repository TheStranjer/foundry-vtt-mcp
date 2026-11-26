import { EventEmitter } from "events";
import { FoundryClient } from "../src/foundry-client.js";
import { summarizeFrame } from "../src/core/socket-protocol.js";

class TestWebSocket extends EventEmitter {
  static OPEN = 1;
  readyState = TestWebSocket.OPEN;
  send = jest.fn();
  close = jest.fn();
}

const SECRET = "SECRET-BODY-MARKER";

function connectedClient() {
  const logger = { error: jest.fn() };
  const wsLogger = { logInbound: jest.fn(), logOutbound: jest.fn(), close: jest.fn() } as any;
  const client = new FoundryClient("/tmp/creds.json", {
    logger,
    wsLogger,
    WebSocketCtor: TestWebSocket,
  } as any);
  const ws = new TestWebSocket();
  (client as any).connection = { ws, hostname: "h", sessionId: "s", credential: {}, generation: 14 };
  (client as any).setupWebSocketHandlers(ws);
  return { client, ws, logger, wsLogger };
}

function loggedLines(logger: { error: jest.Mock }): string[] {
  return logger.error.mock.calls.map((call) => String(call[0]));
}

describe("summarizeFrame", () => {
  test("inbound ack: id and byte length with thousands separators", () => {
    const frame = `4312[${"x".repeat(2000)}]`;
    expect(summarizeFrame("in", frame)).toBe(`<<< ack 12 (${(frame.length).toLocaleString("en-US")} bytes)`);
    expect(summarizeFrame("in", `4312["a"]`)).toBe("<<< ack 12 (9 bytes)");
  });

  test("outbound request: event name and ack id", () => {
    const frame = '4213["modifyDocument",{"type":"Actor"}]';
    expect(summarizeFrame("out", frame)).toBe(`>>> modifyDocument ack 13 (${frame.length} bytes)`);
  });

  test("event without an ack id", () => {
    expect(summarizeFrame("in", '42["userActivity","u1",{}]')).toBe("<<< userActivity (26 bytes)");
  });

  test("counts bytes, not characters", () => {
    expect(summarizeFrame("in", '42["é"]')).toBe("<<< é (8 bytes)");
  });

  test("accepts a Buffer", () => {
    expect(summarizeFrame("out", Buffer.from("3"))).toBe(">>> engine pong (1 bytes)");
  });

  test("Engine.IO and Socket.IO packet types", () => {
    expect(summarizeFrame("in", '0{"sid":"x"}')).toContain("<<< engine open");
    expect(summarizeFrame("in", "2")).toBe("<<< engine ping (1 bytes)");
    expect(summarizeFrame("out", "40")).toBe(">>> socket connect (2 bytes)");
    expect(summarizeFrame("in", '40{"sid":"y"}')).toContain("<<< socket connect");
    expect(summarizeFrame("in", "44{}")).toContain("<<< socket error");
    expect(summarizeFrame("in", "9")).toContain("<<< unknown packet");
    expect(summarizeFrame("in", "43x")).toContain("<<< ack ");
    expect(summarizeFrame("in", "4")).toContain("<<< socket packet");
  });

  test("never contains the body", () => {
    expect(summarizeFrame("in", `42["userActivity","${SECRET}"]`)).not.toContain(SECRET);
  });
});

describe("FoundryClient frame logging", () => {
  test("an inbound frame logs a summary, and the WebSocketLogger gets the full frame", () => {
    const { ws, logger, wsLogger } = connectedClient();
    const frame = `42["userActivity","u1",{"note":"${SECRET}"}]`;

    ws.emit("message", frame);

    expect(loggedLines(logger)).toContain(`[FoundryClient] ${summarizeFrame("in", frame)}`);
    expect(loggedLines(logger).join("\n")).not.toContain(SECRET);
    expect(wsLogger.logInbound).toHaveBeenCalledWith(frame);
  });

  test("an inbound ack frame logs ack id and size only", () => {
    const { ws, logger, wsLogger } = connectedClient();
    const frame = `4312[{"big":"${SECRET}"}]`;

    ws.emit("message", frame);

    expect(loggedLines(logger)).toContain(`[FoundryClient] <<< ack 12 (${frame.length} bytes)`);
    expect(loggedLines(logger).join("\n")).not.toContain(SECRET);
    expect(wsLogger.logInbound).toHaveBeenCalledWith(frame);
  });

  const requests: Array<[string, string, (client: any) => Promise<unknown>]> = [
    ["world", "world", (c) => c.requestWorldData()],
    [
      "modifyDocument",
      "modifyDocument",
      (c) =>
        c.sendModifyDocumentRequest("Actor", "update", { updates: [{ name: SECRET }] }, "t", () => true),
    ],
    ["browseFiles", "manageFiles", (c) => c.browseFiles({ target: SECRET })],
    ["createCompendium", "manageCompendium", (c) => c.createCompendium(SECRET, "Actor")],
    ["deleteCompendium", "manageCompendium", (c) => c.deleteCompendium(SECRET)],
  ];

  test.each(requests)(
    "%s logs a one-line summary and not the request body; WebSocketLogger gets the full frame",
    (_name, event, call) => {
      const { client, ws, logger, wsLogger } = connectedClient();
      (client as any).messageCounter = 13;

      void call(client).catch(() => undefined);

      const sent = ws.send.mock.calls[0][0] as string;
      expect(sent).toContain(event === "world" ? "world" : SECRET);
      expect(loggedLines(logger)).toContain(`[FoundryClient] >>> ${event} ack 13 (${sent.length} bytes)`);
      expect(loggedLines(logger).join("\n")).not.toContain(SECRET);
      expect(wsLogger.logOutbound).toHaveBeenCalledWith(sent);
    }
  );

  test("lifecycle lines are unchanged", () => {
    const { ws, logger } = connectedClient();
    ws.emit("close", 1006, Buffer.from("gone"));
    expect(loggedLines(logger)).toContain("[FoundryClient] WebSocket closed: 1006 - gone");
  });
});
