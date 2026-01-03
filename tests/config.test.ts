import { resolveConfigPath } from "../src/core/config.js";
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
