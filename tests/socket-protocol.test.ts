import {
  buildModifyDocumentMessage,
  ENGINE_PING,
  ENGINE_PONG,
  isEngineHandshake,
  isEnginePing,
  isSessionEvent,
  ackIdOf,
  parseAckMessage,
  parseSessionPayload,
  parseWorldResponseMessage,
  WORLD_REQUEST_MESSAGE,
} from "../src/core/socket-protocol.js";

describe("socket protocol", () => {
  test("WORLD_REQUEST_MESSAGE is correct", () => {
    expect(WORLD_REQUEST_MESSAGE).toBe('420["world"]');
  });

  test("isEngineHandshake detects handshake", () => {
    expect(isEngineHandshake("0{\"sid\":\"x\"}"))
      .toBe(true);
    expect(isEngineHandshake("40"))
      .toBe(false);
  });

  test("isSessionEvent detects session", () => {
    expect(isSessionEvent('42["session",{}]'))
      .toBe(true);
    expect(isSessionEvent("42[\"other\"]"))
      .toBe(false);
  });

  test("Engine.IO ping/pong constants and detection", () => {
    expect(ENGINE_PING).toBe("2");
    expect(ENGINE_PONG).toBe("3");
    expect(isEnginePing("2")).toBe(true);
    expect(isEnginePing("3")).toBe(false);
    expect(isEnginePing("42[\"session\",null]")).toBe(false);
    expect(isEnginePing("0{}")).toBe(false);
  });

  describe("parseSessionPayload", () => {
    test("parses a bound session with sessionId and userId", () => {
      const parsed = parseSessionPayload('42["session",{"sessionId":"abc","userId":"u1"}]');
      expect(parsed).toEqual({ matched: true, sessionId: "abc", userId: "u1" });
    });

    test("matches a null session but reports no sessionId", () => {
      const parsed = parseSessionPayload('42["session",null]');
      expect(parsed).toEqual({ matched: true, sessionId: null, userId: null });
    });

    test("handles a numeric-prefixed session event", () => {
      const parsed = parseSessionPayload('420["session",{"sessionId":"z"}]');
      expect(parsed.matched).toBe(true);
      expect(parsed.sessionId).toBe("z");
      expect(parsed.userId).toBeNull();
    });

    test("does not match other events", () => {
      expect(parseSessionPayload('42["userActivity","u1",{}]').matched).toBe(false);
      expect(parseSessionPayload("40").matched).toBe(false);
      expect(parseSessionPayload("2").matched).toBe(false);
    });

    test("does not match malformed json", () => {
      expect(parseSessionPayload('42["session",not-json').matched).toBe(false);
    });
  });

  test("parseWorldResponseMessage ignores non-world", () => {
    expect(parseWorldResponseMessage("40")).toEqual({ matched: false });
  });

  test("parseWorldResponseMessage parses world payload", () => {
    const msg = "430" + JSON.stringify([{ ok: true }]);
    const parsed = parseWorldResponseMessage(msg);
    expect(parsed.matched).toBe(true);
    expect(parsed.data).toEqual({ ok: true });
  });

  test("parseWorldResponseMessage reports invalid array", () => {
    const msg = "430" + JSON.stringify([]);
    const parsed = parseWorldResponseMessage(msg);
    expect(parsed.matched).toBe(true);
    expect(parsed.error?.message).toContain("Invalid response format");
  });

  test("parseWorldResponseMessage reports parse errors", () => {
    const parsed = parseWorldResponseMessage("430not-json");
    expect(parsed.matched).toBe(true);
    expect(parsed.error?.message).toContain("Failed to parse world response");
  });

  test("ackIdOf reads the ack id, or null without one", () => {
    expect(ackIdOf("4312[{}]")).toBe(12);
    expect(ackIdOf("43[{}]")).toBeNull();
    expect(ackIdOf("4212[{}]")).toBeNull();
    expect(ackIdOf("43")).toBeNull();
  });

  test("parseAckMessage ignores non-ack", () => {
    expect(parseAckMessage("40")).toEqual({ matched: false });
  });

  test("parseAckMessage requires JSON array", () => {
    const parsed = parseAckMessage("43123");
    expect(parsed.matched).toBe(true);
    expect(parsed.error?.message).toContain("missing JSON array");
  });

  test("parseAckMessage rejects empty payload", () => {
    const parsed = parseAckMessage("43[]");
    expect(parsed.matched).toBe(true);
    expect(parsed.error?.message).toContain("empty payload");
  });

  test("parseAckMessage parses payload", () => {
    const parsed = parseAckMessage("43" + JSON.stringify([{ ok: true }]));
    expect(parsed.matched).toBe(true);
    expect(parsed.payload).toEqual([{ ok: true }]);
  });

  test("parseAckMessage reports parse errors", () => {
    const parsed = parseAckMessage("43not-json");
    expect(parsed.matched).toBe(true);
    expect(parsed.error?.message).toContain("Invalid ack format: missing JSON array");
  });

  test("buildModifyDocumentMessage formats payload", () => {
    expect(buildModifyDocumentMessage(7, ["x"]))
      .toBe("427[\"x\"]");
  });
});
