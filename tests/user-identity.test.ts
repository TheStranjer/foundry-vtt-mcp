import {
  buildJoinDataRequestMessage,
  hasCompleteUserIdentity,
  parseJoinDataUsers,
  resolveUserIdentity,
} from "../src/core/user-identity.js";
import type { FoundryCredential } from "../src/core/credentials.js";

describe("user-identity", () => {
  const base: FoundryCredential = { _id: "c", hostname: "h", password: "pw" };
  const users = [
    { id: "u1", name: "Gamemaster" },
    { id: "u2", name: "API" },
  ];

  test("hasCompleteUserIdentity requires both fields", () => {
    expect(hasCompleteUserIdentity({ ...base, userid: "u1", username: "Gamemaster" })).toBe(true);
    expect(hasCompleteUserIdentity({ ...base, userid: "u1" })).toBe(false);
    expect(hasCompleteUserIdentity({ ...base, username: "API" })).toBe(false);
  });

  test("buildJoinDataRequestMessage carries the ack id", () => {
    expect(buildJoinDataRequestMessage(7)).toBe('427["getJoinData"]');
  });

  test("parseJoinDataUsers reads _id or id and skips malformed entries", () => {
    expect(parseJoinDataUsers([{
      users: [
        { _id: "u1", name: "Gamemaster", role: 4 },
        { id: "u2", name: "API" },
        { _id: "u3" },
        null,
        "junk",
      ],
    }])).toEqual(users);
  });

  test("parseJoinDataUsers rejects a payload without users", () => {
    expect(() => parseJoinDataUsers([{}])).toThrow("missing users array");
    expect(() => parseJoinDataUsers([null])).toThrow("expected an object");
  });

  test("resolveUserIdentity leaves a complete credential untouched", () => {
    const credential = { ...base, userid: "wrong", username: "also-wrong" };
    expect(resolveUserIdentity(credential, users)).toBe(credential);
  });

  test("resolveUserIdentity infers username from userid", () => {
    expect(resolveUserIdentity({ ...base, userid: "u2" }, users))
      .toEqual({ ...base, userid: "u2", username: "API" });
  });

  test("resolveUserIdentity infers userid from username", () => {
    expect(resolveUserIdentity({ ...base, username: "Gamemaster" }, users))
      .toEqual({ ...base, userid: "u1", username: "Gamemaster" });
  });

  test("resolveUserIdentity falls back to a case-insensitive name match", () => {
    expect(resolveUserIdentity({ ...base, username: "api" }, users))
      .toEqual({ ...base, userid: "u2", username: "api" });
  });

  test("resolveUserIdentity prefers an exact name match over a case-insensitive one", () => {
    const mixed = [{ id: "a", name: "api" }, { id: "b", name: "API" }];
    expect(resolveUserIdentity({ ...base, username: "API" }, mixed).userid).toBe("b");
  });

  test("resolveUserIdentity rejects ambiguous names", () => {
    expect(() => resolveUserIdentity(
      { ...base, username: "API" },
      [{ id: "a", name: "API" }, { id: "b", name: "API" }]
    )).toThrow('Multiple Foundry users are named "API"');
    expect(() => resolveUserIdentity(
      { ...base, username: "Api" },
      [{ id: "a", name: "api" }, { id: "b", name: "API" }]
    )).toThrow('Multiple Foundry users match "Api" ignoring case');
  });

  test("resolveUserIdentity rejects unknown users", () => {
    expect(() => resolveUserIdentity({ ...base, userid: "nope" }, users))
      .toThrow('No Foundry user found with userid: "nope"');
    expect(() => resolveUserIdentity({ ...base, username: "Nobody" }, users))
      .toThrow('No Foundry user found with username: "Nobody"');
  });

  test("resolveUserIdentity rejects a credential with neither field", () => {
    expect(() => resolveUserIdentity(base, users))
      .toThrow("Credential must have a userid or a username");
  });
});
