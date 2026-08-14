#!/usr/bin/env node
// Stage 2: Instagram carousel JSON -> one AI background per card.
//
// Reads a carousel result (from generate-carousel.mjs) and generates one image
// per card from its imagePrompt, sharing the carousel's styleSpec so the set is
// visually consistent. Writes source backgrounds to output/<slug>/card-N.png;
// the Studio composites those into publish-ready 1080x1350 images.
//
// Usage:
//   node src/generate-images.mjs --in examples/sample-carousel.json
//   node src/generate-images.mjs --in <file> --out output/topic
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadEnv } from "./lib/env.mjs";
import { openaiImageToFile } from "./lib/openai.mjs";
import { cardImagePrompt } from "./lib/image_prompt.mjs";
import { CAROUSEL_LIMITS } from "./lib/carousel_contract.mjs";
import { mapLimit, parseArgs, retry, slugify } from "./lib/runtime.mjs";

loadEnv();

const IMAGE_PROVIDERS = {
  openai: (prompt, file) => openaiImageToFile(prompt, file),
};

export async function generateImages({
  carousel,
  outDir,
  imageProvider = "openai",
  imageMood,
  providers = IMAGE_PROVIDERS,
  concurrency,
  maxAttempts = 3,
  log = () => {},
}) {
  const provider = providers[imageProvider];
  if (!provider)
    throw new Error(
      `unknown image provider '${imageProvider}'. use: ${Object.keys(providers).join(", ")}`,
    );
  const mood = imageMood || process.env.INSTAGRAM_IMAGE_MOOD || "dark";
  const cards = carousel.cards || [];
  if (
    cards.length < CAROUSEL_LIMITS.min ||
    cards.length > CAROUSEL_LIMITS.max
  ) {
    throw new Error(
      `Instagram carousel requires ${CAROUSEL_LIMITS.min}-${CAROUSEL_LIMITS.max} cards; received ${cards.length}`,
    );
  }
  const styleSpec = carousel.styleSpec;
  await mkdir(outDir, { recursive: true });
  // gpt-image-2 (openai OAuth) is heavier per call; keep concurrency modest.
  const workerCount = concurrency || (imageProvider === "openai" ? 2 : 3);
  const files = await mapLimit(cards, workerCount, async (card, i) => {
    const prompt = cardImagePrompt(card, styleSpec, mood);
    const file = join(outDir, `card-${card.n ?? i + 1}.png`);
    log(`[image] card ${card.n ?? i + 1} generating (${imageProvider})...`);
    try {
      return await retry(
        async () => {
          await provider(prompt, file);
          log(`[image] card ${card.n ?? i + 1} ok`);
          return file;
        },
        {
          attempts: maxAttempts,
          onError: (error, attempt) =>
            log(
              `[image] card ${card.n ?? i + 1} attempt ${attempt} failed: ${error.message}`,
            ),
        },
      );
    } catch (error) {
      throw new Error(
        `card ${card.n ?? i + 1} image failed after retries: ${error.message}`,
      );
    }
  });
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.in || typeof args.in !== "string") {
    process.stderr.write(
      "usage: generate-images.mjs --in <carousel.json> [--out <dir>]\n",
    );
    process.exit(2);
  }
  const result = JSON.parse(await readFile(args.in, "utf8"));
  const carousel = result.carousel || result;
  const outDir =
    typeof args.out === "string"
      ? args.out
      : fileURLToPath(
          new URL(`../output/${slugify(carousel.topic)}`, import.meta.url),
        );
  const imageProvider =
    typeof args["image-provider"] === "string"
      ? args["image-provider"]
      : process.env.INSTAGRAM_IMAGE_PROVIDER || "openai";
  const files = await generateImages({
    carousel,
    outDir,
    imageProvider,
    log: (m) => process.stderr.write(m + "\n"),
  });
  process.stdout.write(JSON.stringify({ outDir, files }, null, 2) + "\n");
}
