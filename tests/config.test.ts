import { resolveConfigPath, resolveMaxUploadBytes } from "../src/core/config.js";
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

describe("resolveMaxUploadBytes", () => {
  test("defaults to 25 MiB", () => {
    expect(resolveMaxUploadBytes({})).toBe(25 * 1024 * 1024);
  });

  test.each(["0", "104857601", "1.5", "nope"])("rejects invalid value %s", (value) => {
    expect(() => resolveMaxUploadBytes({ FOUNDRY_MCP_MAX_UPLOAD_BYTES: value }))
      .toThrow("FOUNDRY_MCP_MAX_UPLOAD_BYTES must be an integer between 1 and 104857600");
  });

  test("accepts the configured byte limit", () => {
    expect(resolveMaxUploadBytes({ FOUNDRY_MCP_MAX_UPLOAD_BYTES: "42" })).toBe(42);
  });
});
