import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const nichesFile = fileURLToPath(
  new URL("../src/config/niches.json", import.meta.url),
);

test("topic examples cover many niches without empty or duplicate keywords", async () => {
  const config = JSON.parse(await readFile(nichesFile, "utf8"));
  const entries = Object.entries(config.niches || {});
  assert.equal(entries.length, 16);

  const allKeywords = [];
  for (const [id, niche] of entries) {
    assert.match(id, /^[a-z0-9-]+$/);
    assert.ok(niche.label?.trim(), `${id} must have a label`);
    assert.equal(niche.keywords?.length, 8, `${id} must have 8 examples`);
    assert.ok(
      niche.keywords.every((keyword) => keyword.trim().length >= 10),
      `${id} examples must be useful topic phrases`,
    );
    allKeywords.push(...niche.keywords);
  }

  assert.equal(allKeywords.length, 128);
  assert.equal(new Set(allKeywords).size, allKeywords.length);
});
