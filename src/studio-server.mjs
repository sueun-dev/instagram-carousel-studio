#!/usr/bin/env node
// 넘김 (Neomgim) — a local control panel to tune the whole content system:
// edit the system prompts (content + verify), niches, and model/effort settings,
// then generate an Instagram carousel package (content, images, and post copy).
//
// Run: node src/studio-server.mjs
import { createServer } from "node:http";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { basename, join, extname, relative, sep } from "node:path";
import { loadEnv } from "./lib/env.mjs";
import { CAROUSEL_LIMITS, INSTAGRAM_IMAGE } from "./lib/carousel_contract.mjs";
import { codexAuthStatus } from "./lib/codex.mjs";
import {
  instagramImageFilename,
  pngDimensions,
  writeInstagramPackage,
} from "./lib/instagram_package.mjs";
import {
  generationSlug,
  resolveInside,
  resolveOutputDirectoryPath,
} from "./lib/runtime.mjs";
import { DEFAULT_TONE, normalizeTone, TONES } from "./lib/tone.mjs";

loadEnv();

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.INSTAGRAM_STUDIO_PORT || 5273);
const host = "127.0.0.1";

const FILES = {
  content: join(root, "prompts/content-system.md"),
  verify: join(root, "prompts/verify-system.md"),
  niches: join(root, "config/niches.json"),
  settings: join(root, "config/settings.json"),
};

const TEXT_PROVIDERS = [
  {
    id: "codex",
    label: "ChatGPT 로그인 (OAuth)",
    description: "Codex 로그인 세션으로 글 작성과 팩트체크",
  },
  {
    id: "openai",
    label: "OpenAI API 키",
    description: "OPENAI_API_KEY로 Responses API 직접 호출",
  },
];
const TEXT_MODELS = {
  codex: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"],
  openai: ["gpt-5.6", "gpt-5.5", "gpt-5.4"],
};
// Supported reasoning tiers for the configured text providers.
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh"];
const MOODS = ["dark", "light"];

function publicOutputPath(outputRoot, file) {
  const safeFile = resolveInside(outputRoot, file);
  return `output/${relative(outputRoot, safeFile).split(sep).join("/")}`;
}

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type });
  res.end(
    typeof body === "string" || Buffer.isBuffer(body)
      ? body
      : JSON.stringify(body),
  );
}

function readJsonBody(req, maxBytes = 4_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function readBufferBody(req, maxBytes = 15_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Spawn `node <script> ...args`, capturing stdout (result JSON) and stderr (logs).
function runNode(args, { env, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env,
    });
    let stdout = "";
    let stderr = "";
    let timer = null;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        const forceKill = setTimeout(() => child.kill("SIGKILL"), 5000);
        forceKill.unref?.();
        finish(reject, new Error(`generation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      finish(reject, err);
    });
    child.on("close", (code) => {
      if (code === 0 || code === 2) finish(resolve, { stdout, stderr, code });
      else {
        const messages = [...stderr.matchAll(/Error:\s*([^\n]+)/g)];
        const detail = messages.at(-1)?.[1]?.trim();
        finish(
          reject,
          new Error(detail || `${basename(args[0])} 실행 실패 (exit ${code})`),
        );
      }
    });
  });
}

function childEnv(settings) {
  return {
    ...process.env,
    INSTAGRAM_CODEX_MODEL:
      settings.textProvider === "codex"
        ? settings.textModel || "gpt-5.6-terra"
        : process.env.INSTAGRAM_CODEX_MODEL || "gpt-5.6-terra",
    INSTAGRAM_CODEX_EFFORT: settings.effort || "medium",
    INSTAGRAM_OPENAI_MODEL:
      settings.textProvider === "openai"
        ? settings.textModel || "gpt-5.6"
        : process.env.INSTAGRAM_OPENAI_MODEL || "gpt-5.6",
    INSTAGRAM_OPENAI_EFFORT: settings.effort || "medium",
    INSTAGRAM_IMAGE_PROVIDER: settings.imageProvider || "openai",
    INSTAGRAM_IMAGE_SIZE: settings.imageSize || "1024x1536",
    INSTAGRAM_IMAGE_MOOD: settings.imageMood || "dark",
  };
}

async function readSettings() {
  try {
    const settings = JSON.parse(await readFile(FILES.settings, "utf8"));
    return { ...settings, tone: normalizeTone(settings.tone) };
  } catch {
    return {
      textProvider: "codex",
      textModel: "gpt-5.6-terra",
      effort: "medium",
      tone: DEFAULT_TONE,
      imageProvider: "openai",
      maxRevisions: 2,
    };
  }
}

export function createStudioServer({
  outputRoot = join(root, "../output"),
  runNodeProcess = runNode,
  getCodexStatus = codexAuthStatus,
  hasOpenAiApiKey = () => Boolean(process.env.OPENAI_API_KEY?.trim()),
} = {}) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;

      if (req.method === "GET" && (path === "/" || path === "/index.html")) {
        const html = await readFile(join(root, "studio/index.html"), "utf8");
        return send(res, 200, html, "text/html; charset=utf-8");
      }

      if (
        req.method === "GET" &&
        (path === "/styles.css" || path === "/app.js")
      ) {
        const filename = path === "/styles.css" ? "styles.css" : "app.js";
        const type =
          path === "/styles.css"
            ? "text/css; charset=utf-8"
            : "text/javascript; charset=utf-8";
        return send(
          res,
          200,
          await readFile(join(root, "studio", filename)),
          type,
        );
      }

      if (req.method === "GET" && path === "/api/state") {
        const [content, verify, niches, settings, codexAuth] =
          await Promise.all([
            readFile(FILES.content, "utf8"),
            readFile(FILES.verify, "utf8"),
            readFile(FILES.niches, "utf8"),
            readSettings(),
            getCodexStatus(),
          ]);
        return send(res, 200, {
          content,
          verify,
          niches,
          settings,
          textProviders: TEXT_PROVIDERS,
          textModels: TEXT_MODELS,
          efforts: EFFORTS,
          tones: TONES,
          moods: MOODS,
          carouselLimits: CAROUSEL_LIMITS,
          publishImage: INSTAGRAM_IMAGE,
          auth: {
            codex: codexAuth,
            openaiApiKeyConfigured: hasOpenAiApiKey(),
          },
        });
      }

      if (req.method === "POST" && path === "/api/save") {
        const body = await readJsonBody(req);
        const target = String(body.target || "");
        if (!FILES[target]) return send(res, 400, { error: "unknown target" });
        let content = String(body.content ?? "");
        if (target === "niches" || target === "settings") {
          try {
            content = JSON.stringify(JSON.parse(content), null, 2) + "\n";
          } catch {
            return send(res, 400, { error: "invalid JSON" });
          }
        }
        await writeFile(FILES[target], content);
        return send(res, 200, { ok: true });
      }

      if (req.method === "POST" && path === "/api/generate") {
        const body = await readJsonBody(req);
        const topic = String(body.topic || "").trim();
        if (!topic) return send(res, 400, { error: "topic required" });
        const settings = await readSettings();
        const textProvider = settings.textProvider || "codex";
        if (textProvider === "codex") {
          const auth = await getCodexStatus();
          if (!auth.available) {
            return send(res, 400, {
              error:
                "Codex CLI를 찾을 수 없습니다. Codex를 설치하고 `codex login`으로 ChatGPT 로그인을 완료하세요.",
            });
          }
          if (!auth.signedIn || auth.method !== "chatgpt") {
            return send(res, 400, {
              error:
                "ChatGPT OAuth 로그인이 필요합니다. 터미널에서 `codex login`을 실행한 뒤 다시 시도하세요.",
            });
          }
        }
        if (textProvider === "openai" && !hasOpenAiApiKey()) {
          return send(res, 400, {
            error:
              "OpenAI API 키 방식이 선택됐지만 OPENAI_API_KEY가 없습니다. ChatGPT 로그인(OAuth)을 선택하거나 .env에 키를 넣으세요.",
          });
        }
        const args = [
          join(root, "generate-carousel.mjs"),
          "--topic",
          topic,
          "--provider",
          textProvider,
          "--tone",
          settings.tone || DEFAULT_TONE,
          "--max-revisions",
          String(settings.maxRevisions ?? 2),
        ];
        if (!body.verify) args.push("--generate-only");
        const { stdout, stderr = "" } = await runNodeProcess(args, {
          env: childEnv(settings),
        });
        let result;
        try {
          result = JSON.parse(stdout);
        } catch {
          return send(res, 500, {
            error: "generation returned non-JSON",
            raw: stdout.slice(0, 500),
          });
        }
        const dir = join(
          outputRoot,
          generationSlug(result.carousel?.topic || topic),
        );
        const post = await writeInstagramPackage(result, dir);
        await writeFile(join(dir, "generation.log"), stderr);
        return send(res, 200, {
          result,
          post,
          dir: publicOutputPath(outputRoot, dir),
        });
      }

      if (req.method === "POST" && path === "/api/images") {
        const body = await readJsonBody(req);
        let dir;
        try {
          dir = resolveOutputDirectoryPath(outputRoot, body.dir);
        } catch {
          return send(res, 400, { error: "bad dir" });
        }
        const carouselFile = join(dir, "carousel.json");
        if (!existsSync(carouselFile))
          return send(res, 400, { error: "bad dir" });
        const settings = await readSettings();
        if (
          (settings.imageProvider || "openai") === "openai" &&
          !hasOpenAiApiKey()
        ) {
          return send(res, 400, {
            error:
              "이미지 생성에는 OPENAI_API_KEY가 필요합니다. ChatGPT OAuth는 글 작성·검증에 사용되며 Images API 키를 대신하지 않습니다.",
          });
        }
        const args = [
          join(root, "generate-images.mjs"),
          "--in",
          carouselFile,
          "--out",
          dir,
          "--image-provider",
          settings.imageProvider || "openai",
        ];
        const { stdout } = await runNodeProcess(args, {
          env: childEnv(settings),
        });
        let out;
        try {
          out = JSON.parse(stdout);
        } catch {
          return send(res, 500, {
            error: "image gen returned non-JSON",
            raw: stdout.slice(0, 500),
          });
        }
        const files = (out.files || []).map(
          (file) =>
            "/file?path=" +
            encodeURIComponent(publicOutputPath(outputRoot, file)),
        );
        return send(res, 200, { files });
      }

      if (req.method === "POST" && path === "/api/publish-image") {
        let dir;
        try {
          dir = resolveOutputDirectoryPath(
            outputRoot,
            url.searchParams.get("dir"),
          );
        } catch {
          return send(res, 400, { error: "bad dir" });
        }
        const cardNumber = Number(url.searchParams.get("card"));
        if (
          !Number.isInteger(cardNumber) ||
          cardNumber < 1 ||
          cardNumber > CAROUSEL_LIMITS.max
        ) {
          return send(res, 400, { error: "bad card number" });
        }
        if (
          !String(req.headers["content-type"] || "").startsWith("image/png")
        ) {
          return send(res, 415, { error: "image/png required" });
        }
        const carouselFile = join(dir, "carousel.json");
        if (!existsSync(carouselFile))
          return send(res, 400, { error: "bad dir" });
        const result = JSON.parse(await readFile(carouselFile, "utf8"));
        const cards = result.carousel?.cards || [];
        if (!cards.some((card) => Number(card.n) === cardNumber))
          return send(res, 400, { error: "card not in carousel" });
        const png = await readBufferBody(req);
        const dimensions = pngDimensions(png);
        if (!dimensions) {
          return send(res, 400, { error: "invalid PNG" });
        }
        if (
          dimensions.width !== INSTAGRAM_IMAGE.width ||
          dimensions.height !== INSTAGRAM_IMAGE.height
        ) {
          return send(res, 400, {
            error: `PNG must be ${INSTAGRAM_IMAGE.width}x${INSTAGRAM_IMAGE.height}`,
          });
        }
        const filename = instagramImageFilename(cardNumber);
        await writeFile(join(dir, filename), png);
        return send(res, 200, { ok: true, filename, bytes: png.length });
      }

      if (req.method === "GET" && path === "/api/outputs") {
        const outRoot = outputRoot;
        const items = [];
        if (existsSync(outRoot)) {
          for (const name of await readdir(outRoot)) {
            const cfile = join(outRoot, name, "carousel.json");
            if (!existsSync(cfile)) continue;
            let topic = name;
            let cards = 0;
            try {
              const j = JSON.parse(await readFile(cfile, "utf8"));
              topic = j.carousel?.topic || name;
              cards = j.carousel?.cards?.length || 0;
            } catch {
              // keep defaults
            }
            const st = await stat(cfile);
            const publishImages = Array.from({ length: cards }, (_, index) =>
              existsSync(
                join(outRoot, name, instagramImageFilename(index + 1)),
              ),
            );
            const backgroundImages = Array.from({ length: cards }, (_, index) =>
              existsSync(join(outRoot, name, `card-${index + 1}.png`)),
            );
            items.push({
              dir: "output/" + name,
              topic,
              cards,
              backgroundImageCount: backgroundImages.filter(Boolean).length,
              hasImages: cards > 0 && backgroundImages.every(Boolean),
              hasPublishImages: cards > 0 && publishImages.every(Boolean),
              hasPostPackage: existsSync(
                join(outRoot, name, "instagram-post.json"),
              ),
              mtime: st.mtimeMs,
            });
          }
        }
        items.sort((a, b) => b.mtime - a.mtime);
        return send(res, 200, { items });
      }

      if (req.method === "GET" && path === "/file") {
        let file;
        try {
          file = resolveOutputDirectoryPath(
            outputRoot,
            url.searchParams.get("path"),
          );
        } catch {
          return send(res, 404, "not found", "text/plain");
        }
        if (!existsSync(file)) return send(res, 404, "not found", "text/plain");
        const types = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".json": "application/json",
          ".txt": "text/plain; charset=utf-8",
        };
        res.writeHead(200, {
          "content-type": types[extname(file)] || "application/octet-stream",
          "cache-control": "no-store",
        });
        return createReadStream(file).pipe(res);
      }

      send(res, 404, { error: "not found" });
    } catch (err) {
      if (!res.headersSent)
        send(res, 500, { error: String(err.message || err) });
    }
  });

  server.requestTimeout = 0; // generation is long-lived
  server.headersTimeout = 120000;
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createStudioServer();
  server.listen(port, host, () => {
    process.stdout.write(`넘김 (Neomgim) on http://${host}:${port}/\n`);
  });
}
