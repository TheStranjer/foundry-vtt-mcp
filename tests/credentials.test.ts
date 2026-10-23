import {
  getCredentialsInfo,
  parseCredentials,
  resolveCredentialIndex,
  type FoundryCredential,
} from "../src/core/credentials.js";

describe("credentials", () => {
  const creds: FoundryCredential[] = [
    { _id: "alpha", hostname: "a.example", password: "p1", userid: "u1" },
    { _id: "beta", hostname: "b.example", password: "p2", userid: "u2" },
  ];

  test("parseCredentials returns array", () => {
    const raw = JSON.stringify(creds);
    expect(parseCredentials(raw)).toEqual(creds);
  });

  test("parseCredentials rejects non-array", () => {
    expect(() => parseCredentials("{}"))
      .toThrow("Credentials JSON must be an array");
  });

  test("parseCredentials propagates JSON errors", () => {
    expect(() => parseCredentials("{bad"))
      .toThrow();
  });

  test("parseCredentials rejects a non-boolean insecure TLS option", () => {
    expect(() => parseCredentials(JSON.stringify([
      {
        _id: "alpha",
        hostname: "a.example",
        password: "p1",
        userid: "u1",
        allow_insecure_tls: "false",
      },
    ]))).toThrow("allow_insecure_tls must be a boolean");
  });

  test("parseCredentials accepts a username without a userid", () => {
    const raw = [{ _id: "a", hostname: "h", password: "p", username: "API" }];
    expect(parseCredentials(JSON.stringify(raw))).toEqual(raw);
  });

  test("parseCredentials rejects a credential with neither userid nor username", () => {
    expect(() => parseCredentials(JSON.stringify([{ _id: "a", hostname: "h", password: "p" }])))
      .toThrow("Each credential needs a userid or a username");
    expect(() => parseCredentials(JSON.stringify([{ _id: "a", hostname: "h", password: "p", userid: "" }])))
      .toThrow("Each credential needs a userid or a username");
  });

  test("parseCredentials rejects non-string userid or username", () => {
    expect(() => parseCredentials(JSON.stringify([{ _id: "a", hostname: "h", password: "p", userid: 5 }])))
      .toThrow("userid must be a string");
    expect(() => parseCredentials(JSON.stringify([
      { _id: "a", hostname: "h", password: "p", userid: "u", username: false },
    ]))).toThrow("username must be a string");
  });

  test("getCredentialsInfo includes username when known", () => {
    const info = getCredentialsInfo([{ ...creds[0], username: "API" }], 0);
    expect(info[0]).toMatchObject({ userid: "u1", username: "API" });
  });

  test("getCredentialsInfo maps active index", () => {
    const info = getCredentialsInfo(creds, 1);
    expect(info).toEqual([
      {
        _id: "alpha",
        hostname: "a.example",
        userid: "u1",
        item_order: 0,
        currently_active: false,
      },
      {
        _id: "beta",
        hostname: "b.example",
        userid: "u2",
        item_order: 1,
        currently_active: true,
      },
    ]);
  });

  test("resolveCredentialIndex selects by item_order", () => {
    expect(resolveCredentialIndex(creds, { item_order: 0 })).toBe(0);
  });

  test("resolveCredentialIndex rejects invalid item_order", () => {
    expect(() => resolveCredentialIndex(creds, { item_order: 3 }))
      .toThrow("Invalid item_order: 3. Valid range is 0-1");
  });

  test("resolveCredentialIndex selects by _id", () => {
    expect(resolveCredentialIndex(creds, { _id: "beta" })).toBe(1);
  });

  test("resolveCredentialIndex rejects unknown _id", () => {
    expect(() => resolveCredentialIndex(creds, { _id: "missing" }))
      .toThrow("No credential found with _id: \"missing\". Valid _ids are: alpha, beta");
  });

  test("resolveCredentialIndex requires identifier", () => {
    expect(() => resolveCredentialIndex(creds, {}))
      .toThrow("Must provide either item_order or _id");
  });
});
