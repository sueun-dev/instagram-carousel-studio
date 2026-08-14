// Minimal .env loader (no dependency). Loads KEY=VALUE lines from the repo
// root .env into process.env without overwriting already-set variables.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function loadEnv() {
  const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
