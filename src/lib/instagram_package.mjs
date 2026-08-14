import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { INSTAGRAM_IMAGE, normalizeHashtags } from "./carousel_contract.mjs";

function uniqueHttpSources(cards) {
  const urls = new Set();
  for (const card of cards) {
    for (const value of card.sources || []) {
      try {
        const url = new URL(String(value));
        if (url.protocol === "http:" || url.protocol === "https:")
          urls.add(url.href);
      } catch {
        // Ignore malformed model output instead of writing unsafe links.
      }
    }
  }
  return [...urls];
}

export function instagramImageFilename(cardNumber) {
  return `instagram-${String(cardNumber).padStart(2, "0")}.png`;
}

export function pngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 45) return null;
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  let offset = 8;
  let dimensions = null;
  let hasImageData = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) return null;
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) return null;
      dimensions = {
        width: buffer.readUInt32BE(offset + 8),
        height: buffer.readUInt32BE(offset + 12),
      };
    }
    if (type === "IDAT") hasImageData = true;
    if (type === "IEND")
      return length === 0 && chunkEnd === buffer.length && hasImageData
        ? dimensions
        : null;
    offset = chunkEnd;
  }
  return null;
}

export function buildInstagramPost(
  carousel,
  { createdAt = new Date().toISOString() } = {},
) {
  const cards = Array.isArray(carousel?.cards) ? carousel.cards : [];
  const hashtags = normalizeHashtags(carousel?.hashtags);
  const caption = String(carousel?.caption || "").trim();
  const publishText = [caption, hashtags.map((tag) => `#${tag}`).join(" ")]
    .filter(Boolean)
    .join("\n\n");
  return {
    schemaVersion: 1,
    platform: "instagram",
    format: "carousel",
    createdAt,
    topic: String(carousel?.topic || "").trim(),
    cardCount: cards.length,
    image: INSTAGRAM_IMAGE,
    images: cards.map((card, index) => ({
      card: Number(card.n) || index + 1,
      filename: instagramImageFilename(Number(card.n) || index + 1),
      altText: [card.headline, card.body].filter(Boolean).join(". "),
    })),
    caption,
    hashtags,
    publishText,
    sources: uniqueHttpSources(cards),
  };
}

export async function writeInstagramPackage(result, outDir, options = {}) {
  const carousel = result?.carousel || result;
  const post = buildInstagramPost(carousel, options);
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(
      join(outDir, "carousel.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    ),
    writeFile(
      join(outDir, "instagram-post.json"),
      `${JSON.stringify(post, null, 2)}\n`,
    ),
    writeFile(join(outDir, "caption.txt"), `${post.publishText}\n`),
    writeFile(join(outDir, "sources.txt"), `${post.sources.join("\n")}\n`),
  ]);
  return post;
}
