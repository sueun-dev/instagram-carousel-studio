import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateImages } from "../src/generate-images.mjs";

const cards = Array.from({ length: 5 }, (_, index) => ({
  n: index + 1,
  headline: `카드 ${index + 1}`,
  imagePrompt: `editorial subject ${index + 1}`,
}));

test("generateImages preserves order, bounds concurrency, and retries only failures", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "instagram-images-test-"));
  let active = 0;
  let peak = 0;
  const attempts = new Map();
  const provider = async (_prompt, file) => {
    active += 1;
    peak = Math.max(peak, active);
    const count = (attempts.get(file) || 0) + 1;
    attempts.set(file, count);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    if (file.endsWith("card-3.png") && count === 1)
      throw new Error("transient");
    return file;
  };

  try {
    const files = await generateImages({
      carousel: { cards, styleSpec: "shared" },
      outDir,
      imageProvider: "fake",
      providers: { fake: provider },
      concurrency: 2,
      maxAttempts: 2,
    });
    assert.equal(peak, 2);
    assert.deepEqual(
      files.map((file) => file.split("/").pop()),
      ["card-1.png", "card-2.png", "card-3.png", "card-4.png", "card-5.png"],
    );
    assert.equal(attempts.get(join(outDir, "card-3.png")), 2);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("generateImages rejects card counts outside the Instagram contract", async () => {
  await assert.rejects(
    generateImages({
      carousel: { cards: cards.slice(0, 4) },
      outDir: "/tmp/unused",
      imageProvider: "fake",
      providers: { fake: async () => {} },
    }),
    /requires 5-8 cards/,
  );
});
