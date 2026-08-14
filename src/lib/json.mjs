// Robust JSON extraction from LLM text output. Models sometimes wrap JSON in
// markdown fences, add stray prose, or emit trailing content after the object,
// so we strip fences, then scan for the first complete brace-balanced object
// (respecting strings and escapes) before parsing.
export function extractJson(text) {
  const raw = String(text ?? "").trim();
  if (!raw) throw new Error("empty LLM output");

  const unfenced = raw
    .replace(/^﻿/, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    // fall through to balanced-object scan
  }

  const span = firstBalancedObject(unfenced);
  if (!span)
    throw new Error(
      `no JSON object found in LLM output: ${unfenced.slice(0, 160)}`,
    );
  return JSON.parse(span);
}

// Returns the substring of the first complete {...} object, tracking brace depth
// while ignoring braces inside string literals (and their escapes).
function firstBalancedObject(s) {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
