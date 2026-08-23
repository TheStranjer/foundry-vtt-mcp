import { resolveAllowDeletes, resolveConfigPath } from "../src/core/config.js";
import * as path from "path";

describe("resolveConfigPath", () => {
  test("uses env when provided", () => {
    const env = { FOUNDRY_CREDENTIALS: "/tmp/creds.json" } as NodeJS.ProcessEnv;
    expect(resolveConfigPath(env, "/cwd")).toBe("/tmp/creds.json");
  });

  test("falls back to cwd config", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(resolveConfigPath(env, "/cwd"))
      .toBe(path.join("/cwd", "config", "foundry_credentials.json"));
  });
});

describe("resolveAllowDeletes", () => {
  test("enables deletion only for the exact value true", () => {
    expect(resolveAllowDeletes({ FOUNDRY_MCP_ALLOW_DELETES: "true" })).toBe(true);
    expect(resolveAllowDeletes({ FOUNDRY_MCP_ALLOW_DELETES: "TRUE" })).toBe(false);
    expect(resolveAllowDeletes({ FOUNDRY_MCP_ALLOW_DELETES: "1" })).toBe(false);
    expect(resolveAllowDeletes({})).toBe(false);
  });
});
