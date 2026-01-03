import {
  buildJoinPayload,
  extractSessionIdFromCookies,
  parseJoinResponse,
} from "../src/core/session.js";

describe("session", () => {
  test("extractSessionIdFromCookies returns null without cookies", () => {
    expect(extractSessionIdFromCookies(undefined)).toBeNull();
  });

  test("extractSessionIdFromCookies finds session", () => {
    const cookies = ["foo=bar", "session=abc123; Path=/; HttpOnly"];
    expect(extractSessionIdFromCookies(cookies)).toBe("abc123");
  });

  test("extractSessionIdFromCookies returns null when missing", () => {
    const cookies = ["foo=bar", "baz=qux"];
    expect(extractSessionIdFromCookies(cookies)).toBeNull();
  });

  test("buildJoinPayload creates join JSON", () => {
    const payload = buildJoinPayload({
      _id: "c1",
      hostname: "h",
      password: "pw",
      userid: "user",
    });
    expect(JSON.parse(payload)).toEqual({
      userid: "user",
      password: "pw",
      action: "join",
    });
  });

  test("parseJoinResponse succeeds on status success", () => {
    const result = parseJoinResponse(200, JSON.stringify({ status: "success", message: "ok" }));
    expect(result).toEqual({ success: true, message: "ok" });
  });

  test("parseJoinResponse fails on non-200", () => {
    expect(parseJoinResponse(403, "{}")).toEqual({ success: false });
  });

  test("parseJoinResponse fails on invalid JSON", () => {
    expect(parseJoinResponse(200, "not-json")).toEqual({ success: false });
  });

  test("parseJoinResponse fails on non-success status", () => {
    expect(parseJoinResponse(200, JSON.stringify({ status: "error" })))
      .toEqual({ success: false });
  });
});
