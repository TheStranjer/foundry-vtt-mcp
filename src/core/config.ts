import * as path from "path";

const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export function resolveConfigPath(
  env: NodeJS.ProcessEnv,
  cwd: string
): string {
  return env.FOUNDRY_CREDENTIALS || path.join(cwd, "config", "foundry_credentials.json");
}

export function resolveMaxUploadBytes(env: NodeJS.ProcessEnv): number {
  const value = env.FOUNDRY_MCP_MAX_UPLOAD_BYTES;
  if (value === undefined) return DEFAULT_MAX_UPLOAD_BYTES;
  if (!/^\d+$/.test(value)) {
    throw new Error("FOUNDRY_MCP_MAX_UPLOAD_BYTES must be an integer between 1 and 104857600");
  }

  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_UPLOAD_BYTES) {
    throw new Error("FOUNDRY_MCP_MAX_UPLOAD_BYTES must be an integer between 1 and 104857600");
  }
  return bytes;
}
