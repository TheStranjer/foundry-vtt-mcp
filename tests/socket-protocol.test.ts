import {
  buildModifyDocumentMessage,
  isEngineHandshake,
  isSessionEvent,
  parseAckMessage,
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
