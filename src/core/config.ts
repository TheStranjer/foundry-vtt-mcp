import * as path from "path";

export function resolveConfigPath(
  env: NodeJS.ProcessEnv,
  cwd: string
): string {
  return env.FOUNDRY_CREDENTIALS || path.join(cwd, "config", "foundry_credentials.json");
}
