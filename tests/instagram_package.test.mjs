import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildInstagramPost,
  instagramImageFilename,
  pngDimensions,
  writeInstagramPackage,
} from "../src/lib/instagram_package.mjs";
import { generationSlug, resolveOutputPath } from "../src/lib/runtime.mjs";

const carousel = {
  topic: "테스트 주제",
  caption: "첫 문단입니다.\n\n두 번째 문단입니다.",
  hashtags: ["#인사이트", "인사이트", " 저장 콘텐츠 ", "AI"],
  cards: [
    {
      n: 1,
      headline: "첫 카드",
      body: "첫 카드의 충분히 구체적인 본문입니다.",
      sources: ["https://example.com/a"],
    },
    {
      n: 2,
      headline: "둘째 카드",
      body: "둘째 카드의 충분히 구체적인 본문입니다.",
      sources: ["javascript:alert(1)", "https://example.com/a"],
    },
  ],
};

test("buildInstagramPost creates a deterministic 4:5 publish contract", () => {
  const post = buildInstagramPost(carousel, {
    createdAt: "2026-08-13T00:00:00.000Z",
  });
  assert.equal(post.platform, "instagram");
  assert.deepEqual(post.image, {
    width: 1080,
    height: 1350,
    aspectRatio: "4:5",
  });
  assert.deepEqual(post.hashtags, ["인사이트", "저장콘텐츠", "AI"]);
  assert.equal(post.images[0].filename, "instagram-01.png");
  assert.match(post.publishText, /#인사이트 #저장콘텐츠 #AI/);
  assert.deepEqual(post.sources, ["https://example.com/a"]);
  assert.equal(post.createdAt, "2026-08-13T00:00:00.000Z");
});

test("instagramImageFilename pads card numbers", () => {
  assert.equal(instagramImageFilename(8), "instagram-08.png");
});

test("pngDimensions reads the PNG header and rejects non-PNG input", () => {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 4, "ascii");
    data.copy(out, 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1080, 0);
  ihdr.writeUInt32BE(1350, 4);
  const png = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", Buffer.from([0])),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  assert.deepEqual(pngDimensions(png), { width: 1080, height: 1350 });
  assert.equal(
    pngDimensions(png.subarray(0, 24)),
    null,
    "truncated PNG container is rejected",
  );
  assert.equal(pngDimensions(Buffer.from("not a png")), null);
});

test("generationSlug keeps repeated topics in separate timestamped directories", () => {
  assert.equal(
    generationSlug(
      "같은 주제",
      new Date("2026-08-13T12:34:56.789Z"),
      "abc12345",
    ),
    "같은-주제-20260813T123456789Z-abc12345",
  );
  assert.notEqual(generationSlug("같은 주제"), generationSlug("같은 주제"));
});

test("writeInstagramPackage writes the complete post-copy sidecar set", async () => {
  const directory = await mkdtemp(join(tmpdir(), "instagram-package-test-"));
  try {
    await writeInstagramPackage({ carousel, passed: true }, directory, {
      createdAt: "2026-08-13T00:00:00.000Z",
    });
    const [savedCarousel, savedPost, caption, sources] = await Promise.all([
      readFile(join(directory, "carousel.json"), "utf8"),
      readFile(join(directory, "instagram-post.json"), "utf8"),
      readFile(join(directory, "caption.txt"), "utf8"),
      readFile(join(directory, "sources.txt"), "utf8"),
    ]);
    assert.equal(JSON.parse(savedCarousel).passed, true);
    assert.equal(JSON.parse(savedPost).image.aspectRatio, "4:5");
    assert.match(caption, /#인사이트/);
    assert.equal(sources.trim(), "https://example.com/a");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resolveOutputPath blocks traversal and sibling-prefix escapes", () => {
  const root = "/tmp/instagram-carousel";
  assert.equal(
    resolveOutputPath(root, "output/topic/card-1.png"),
    "/tmp/instagram-carousel/output/topic/card-1.png",
  );
  assert.throws(() => resolveOutputPath(root, "../secret"));
  assert.throws(() => resolveOutputPath(root, "output/../../secret"));
  assert.throws(() => resolveOutputPath(root, "output-other/topic"));
});
