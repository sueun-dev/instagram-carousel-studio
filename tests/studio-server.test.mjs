import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createStudioServer } from "../src/studio-server.mjs";

function carouselResult(topic = "통합 테스트") {
  return {
    topic,
    provider: "fake",
    passed: true,
    attempts: 1,
    verdict: {
      verdict: "pass",
      overall: "fixture passed",
      cards: Array.from({ length: 5 }, (_, index) => ({
        n: index + 1,
        novelty: 4,
        truth: 5,
        human: 4,
      })),
    },
    carousel: {
      topic,
      hook: "통합 테스트 훅",
      cards: Array.from({ length: 5 }, (_, index) => ({
        n: index + 1,
        kicker: `단계 ${index + 1}`,
        headline: `통합 카드 ${index + 1}`,
        body: `통합 서버와 파일 저장 경로를 확인하기 위한 충분히 구체적인 테스트 본문 ${index + 1}입니다.`,
        imagePrompt: `editorial test subject ${index + 1}, 4:5, no text`,
        audit: {
          novelty: "integration",
          factBasis: "fixture",
          confidence: "high",
        },
        factSupported: true,
        sources: [`https://example.org/card-${index + 1}`],
      })),
      cta: "통합 결과를 확인하세요.",
      styleSpec: "editorial 4:5 test style",
      caption:
        "서버부터 게시 패키지까지 하나의 흐름으로 연결되는지 확인합니다.\n\n테스트 결과를 다시 확인할 수 있게 저장합니다.",
      hashtags: ["통합테스트", "인스타그램", "캐러셀"],
    },
  };
}

function pngHeader(width = 1080, height = 1350) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 4, "ascii");
    data.copy(out, 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", Buffer.from([0])),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function isScript(args, name) {
  return basename(args[0]) === name;
}

async function fakeSuccessRunner(args) {
  if (isScript(args, "generate-carousel.mjs")) {
    const topic = args[args.indexOf("--topic") + 1];
    return {
      stdout: JSON.stringify(carouselResult(topic)),
      stderr: "",
      code: 0,
    };
  }
  if (isScript(args, "generate-images.mjs")) {
    const outDir = args[args.indexOf("--out") + 1];
    await mkdir(outDir, { recursive: true });
    const files = await Promise.all(
      Array.from({ length: 5 }, async (_, index) => {
        const file = join(outDir, `card-${index + 1}.png`);
        await writeFile(file, pngHeader(1024, 1536));
        return file;
      }),
    );
    return { stdout: JSON.stringify({ outDir, files }), stderr: "", code: 0 };
  }
  throw new Error(`unexpected script: ${args[0]}`);
}

async function withStudio(runNodeProcess, operation, options = {}) {
  const outputRoot = await mkdtemp(join(tmpdir(), "instagram-studio-test-"));
  const server = createStudioServer({
    outputRoot,
    runNodeProcess,
    getCodexStatus:
      options.getCodexStatus ||
      (async () => ({
        available: true,
        signedIn: true,
        method: "chatgpt",
      })),
    hasOpenAiApiKey: options.hasOpenAiApiKey || (() => true),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  try {
    await operation({ baseUrl: `http://127.0.0.1:${port}`, outputRoot });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await rm(outputRoot, { recursive: true, force: true });
  }
}

async function postJson(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Studio API integrates generation, image files, publish PNGs, listing, and downloads", async () => {
  await withStudio(fakeSuccessRunner, async ({ baseUrl, outputRoot }) => {
    const [page, styles, app] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/styles.css`),
      fetch(`${baseUrl}/app.js`),
    ]);
    assert.equal(page.status, 200);
    const pageText = await page.text();
    assert.match(pageText, />글 만들기</);
    assert.match(pageText, /id="prodFinishBtn"/);
    assert.match(pageText, />분야 \(선택\)</);
    assert.doesNotMatch(pageText, />니치/);
    assert.match(pageText, /id="textAuthLabel"/);
    assert.equal(styles.headers.get("content-type"), "text/css; charset=utf-8");
    assert.equal(
      app.headers.get("content-type"),
      "text/javascript; charset=utf-8",
    );
    const appText = await app.text();
    assert.ok(
      appText.indexOf("<span>제목</span>") <
        appText.indexOf("<span>소제목</span>"),
      "card editor should show title before kicker",
    );

    const generatedResponse = await postJson(baseUrl, "/api/generate", {
      topic: "서버 통합",
      verify: true,
    });
    assert.equal(generatedResponse.status, 200);
    const generated = await generatedResponse.json();
    assert.match(generated.dir, /^output\/서버-통합-/);

    const directory = join(outputRoot, generated.dir.slice("output/".length));
    for (const name of [
      "carousel.json",
      "instagram-post.json",
      "caption.txt",
      "sources.txt",
      "generation.log",
    ]) {
      assert.equal(
        existsSync(join(directory, name)),
        true,
        `${name} should be saved`,
      );
    }

    const imagesResponse = await postJson(baseUrl, "/api/images", {
      dir: generated.dir,
    });
    assert.equal(imagesResponse.status, 200);
    const images = await imagesResponse.json();
    assert.equal(images.files.length, 5);
    assert.ok(images.files.every((file) => file.startsWith("/file?path=")));

    await Promise.all(
      Array.from({ length: 5 }, async (_, index) => {
        const response = await fetch(
          `${baseUrl}/api/publish-image?dir=${encodeURIComponent(generated.dir)}&card=${index + 1}`,
          {
            method: "POST",
            headers: { "content-type": "image/png" },
            body: pngHeader(),
          },
        );
        assert.equal(response.status, 200);
      }),
    );

    const outputs = await (await fetch(`${baseUrl}/api/outputs`)).json();
    assert.equal(outputs.items.length, 1);
    assert.equal(outputs.items[0].backgroundImageCount, 5);
    assert.equal(outputs.items[0].hasImages, true);
    assert.equal(outputs.items[0].hasPublishImages, true);
    assert.equal(outputs.items[0].hasPostPackage, true);

    const captionResponse = await fetch(
      `${baseUrl}/file?path=${encodeURIComponent(`${generated.dir}/caption.txt`)}`,
    );
    assert.equal(captionResponse.status, 200);
    assert.match(await captionResponse.text(), /#통합테스트/);
    assert.equal(
      (await fetch(`${baseUrl}/file?path=output%2F..%2Fsecret`)).status,
      404,
    );

    const saved = JSON.parse(
      await readFile(join(directory, "carousel.json"), "utf8"),
    );
    assert.equal(saved.passed, true);
  });
});

test("Studio saves manual card and social copy edits before image production", async () => {
  await withStudio(fakeSuccessRunner, async ({ baseUrl, outputRoot }) => {
    const generatedResponse = await postJson(baseUrl, "/api/generate", {
      topic: "수정 저장",
      verify: true,
    });
    const generated = await generatedResponse.json();
    const directory = join(outputRoot, generated.dir.slice("output/".length));

    assert.equal(
      (await postJson(baseUrl, "/api/images", { dir: generated.dir })).status,
      200,
    );
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        fetch(
          `${baseUrl}/api/publish-image?dir=${encodeURIComponent(generated.dir)}&card=${index + 1}`,
          {
            method: "POST",
            headers: { "content-type": "image/png" },
            body: pngHeader(),
          },
        ),
      ),
    );

    const edited = JSON.parse(JSON.stringify(generated.result.carousel));
    edited.cards[1].headline = "직접 고친 두 번째 카드 제목";
    edited.cards[1].body =
      "사용자가 직접 다듬은 문장이 저장되고 다음 카드 이미지에도 그대로 반영되는지 확인합니다.";
    edited.caption =
      "직접 다듬은 Instagram 캡션입니다. 저장된 문구가 게시용 텍스트 파일에도 정확히 반영됩니다.";
    edited.hashtags = "#직접수정 #콘텐츠편집 #인스타그램";

    const savedResponse = await postJson(baseUrl, "/api/carousel", {
      dir: generated.dir,
      carousel: edited,
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.deepEqual(saved.invalidatedImages, [2]);
    assert.equal(saved.result.passed, false);
    assert.equal(saved.result.editState.manuallyEdited, true);
    assert.equal(saved.result.editState.verifiedBeforeManualEdit, true);
    assert.deepEqual(saved.result.editState.editedCards, [2]);
    assert.equal(saved.result.editState.socialCopyEdited, true);
    assert.equal(saved.result.carousel.cards[1].manualEdited, true);
    assert.equal(saved.result.carousel.cards[0].manualEdited, false);

    assert.equal(existsSync(join(directory, "instagram-01.png")), true);
    assert.equal(existsSync(join(directory, "instagram-02.png")), false);
    assert.equal(
      existsSync(join(directory, "card-2.png")),
      true,
      "the reusable background should remain",
    );
    assert.match(
      await readFile(join(directory, "caption.txt"), "utf8"),
      /#직접수정 #콘텐츠편집 #인스타그램/,
    );
    const persisted = JSON.parse(
      await readFile(join(directory, "carousel.json"), "utf8"),
    );
    assert.equal(
      persisted.carousel.cards[1].headline,
      edited.cards[1].headline,
    );

    edited.cards[1].body = "너무 짧음";
    const invalid = await postJson(baseUrl, "/api/carousel", {
      dir: generated.dir,
      carousel: edited,
    });
    assert.equal(invalid.status, 400);
    assert.ok(
      (await invalid.json()).details.some((detail) =>
        detail.includes("body too thin"),
      ),
    );
  });
});

test("Studio exposes writing tones and forwards the saved tone to generation", async () => {
  let generationArgs;
  const runner = async (args) => {
    if (isScript(args, "generate-carousel.mjs")) generationArgs = args;
    return fakeSuccessRunner(args);
  };

  await withStudio(runner, async ({ baseUrl }) => {
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.deepEqual(
      state.textProviders.map((provider) => provider.id),
      ["codex", "openai"],
    );
    assert.deepEqual(state.textModels.codex, [
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "gpt-5.6-luna",
    ]);
    assert.equal(state.settings.textProvider, "codex");
    assert.equal(state.auth.codex.method, "chatgpt");
    assert.deepEqual(
      state.tones.map((tone) => tone.id),
      [
        "casual",
        "polite",
        "expert",
        "punchy",
        "storyteller",
        "witty",
        "teacher",
        "analytical",
      ],
    );
    assert.equal(state.settings.tone, "casual");

    const response = await postJson(baseUrl, "/api/generate", {
      topic: "말투 전달",
      verify: false,
    });
    assert.equal(response.status, 200);
    assert.equal(
      generationArgs[generationArgs.indexOf("--tone") + 1],
      state.settings.tone,
    );
    assert.equal(
      generationArgs[generationArgs.indexOf("--provider") + 1],
      "codex",
    );
    assert.ok(generationArgs.includes("--generate-only"));

    const override = await postJson(baseUrl, "/api/generate", {
      topic: "메인 화면 말투 선택",
      tone: "expert",
      verify: false,
    });
    assert.equal(override.status, 200);
    assert.equal(
      generationArgs[generationArgs.indexOf("--tone") + 1],
      "expert",
    );

    const page = await (await fetch(`${baseUrl}/`)).text();
    assert.match(page, /id="p-tone"/);
    assert.match(page, /id="s-tone"/);
    assert.match(page, /id="s-textProvider"/);
  });
});

test("Studio blocks image generation with a clear key boundary", async () => {
  await withStudio(
    fakeSuccessRunner,
    async ({ baseUrl }) => {
      const generated = await postJson(baseUrl, "/api/generate", {
        topic: "키 경계",
        verify: true,
      });
      assert.equal(generated.status, 200);
      const { dir } = await generated.json();
      const response = await postJson(baseUrl, "/api/images", { dir });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /OPENAI_API_KEY/);
    },
    { hasOpenAiApiKey: () => false },
  );
});

test("Studio remains usable after provider errors, malformed output, and image failure", async () => {
  let generationCalls = 0;
  let imageCalls = 0;
  const runner = async (args) => {
    if (isScript(args, "generate-carousel.mjs")) {
      generationCalls += 1;
      if (generationCalls === 1) throw new Error("provider timeout");
      if (generationCalls === 2)
        return { stdout: "not-json", stderr: "", code: 0 };
      return fakeSuccessRunner(args);
    }
    imageCalls += 1;
    if (imageCalls === 1) throw new Error("image provider unavailable");
    return fakeSuccessRunner(args);
  };

  await withStudio(runner, async ({ baseUrl }) => {
    assert.equal(
      (
        await postJson(baseUrl, "/api/generate", {
          topic: "복구",
          verify: true,
        })
      ).status,
      500,
    );
    assert.equal(
      (
        await postJson(baseUrl, "/api/generate", {
          topic: "복구",
          verify: true,
        })
      ).status,
      500,
    );
    const recovered = await postJson(baseUrl, "/api/generate", {
      topic: "복구",
      verify: true,
    });
    assert.equal(recovered.status, 200);
    const { dir } = await recovered.json();

    assert.equal((await postJson(baseUrl, "/api/images", { dir })).status, 500);
    assert.equal((await postJson(baseUrl, "/api/images", { dir })).status, 200);
    const wrongSize = await fetch(
      `${baseUrl}/api/publish-image?dir=${encodeURIComponent(dir)}&card=1`,
      {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: pngHeader(100, 100),
      },
    );
    assert.equal(wrongSize.status, 400);
    assert.match((await wrongSize.json()).error, /1080x1350/);
    assert.equal(
      (await fetch(`${baseUrl}/api/state`)).status,
      200,
      "server should stay healthy after failures",
    );
  });
});

test("parallel generations of the same topic never overwrite each other", async () => {
  const runner = async (args) => {
    if (isScript(args, "generate-carousel.mjs"))
      await new Promise((resolve) => setTimeout(resolve, 5));
    return fakeSuccessRunner(args);
  };
  await withStudio(runner, async ({ baseUrl, outputRoot }) => {
    const responses = await Promise.all([
      postJson(baseUrl, "/api/generate", { topic: "동일 주제", verify: true }),
      postJson(baseUrl, "/api/generate", { topic: "동일 주제", verify: true }),
    ]);
    assert.ok(responses.every((response) => response.status === 200));
    const [first, second] = await Promise.all(
      responses.map((response) => response.json()),
    );
    assert.notEqual(first.dir, second.dir);
    assert.equal(
      existsSync(
        join(outputRoot, first.dir.slice("output/".length), "carousel.json"),
      ),
      true,
    );
    assert.equal(
      existsSync(
        join(outputRoot, second.dir.slice("output/".length), "carousel.json"),
      ),
      true,
    );
    const outputs = await (await fetch(`${baseUrl}/api/outputs`)).json();
    assert.equal(outputs.items.length, 2);
  });
});
