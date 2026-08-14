import { randomUUID } from "node:crypto";
import { resolve, sep } from "node:path";

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

export function slugify(value, fallback = "carousel") {
  return (
    String(value || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || fallback
  );
}

export function generationSlug(
  value,
  createdAt = new Date(),
  uniqueId = randomUUID().slice(0, 8),
) {
  const timestamp = createdAt.toISOString().replace(/[-:.]/g, "");
  return `${slugify(value)}-${timestamp}-${uniqueId}`;
}

export async function mapLimit(items, limit, worker) {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("concurrency limit must be a positive integer");
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, runWorker),
  );
  return results;
}

export async function retry(
  operation,
  { attempts = 3, onError = () => {} } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      await onError(error, attempt);
    }
  }
  throw lastError || new Error("operation failed");
}

export function resolveInside(baseDirectory, relativePath) {
  const base = resolve(baseDirectory);
  const candidate = resolve(base, String(relativePath || ""));
  if (candidate === base || candidate.startsWith(`${base}${sep}`))
    return candidate;
  throw new Error("path escapes the allowed directory");
}

export function resolveOutputPath(projectRoot, requestedPath) {
  return resolveOutputDirectoryPath(
    resolve(projectRoot, "output"),
    requestedPath,
  );
}

export function resolveOutputDirectoryPath(outputDirectory, requestedPath) {
  const normalized = String(requestedPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!normalized.startsWith("output/"))
    throw new Error("path must be inside output/");
  return resolveInside(outputDirectory, normalized.slice("output/".length));
}
