#!/usr/bin/env node
// Content brain for Instagram carousels.
//
// Pipeline: topic -> GENERATE (quality-bar system prompt) -> VERIFY (adversarial
// novelty + fact judge) -> REVISE if needed -> validated carousel JSON.
//
// The whole quality standard ("no obvious content, only genuinely useful/novel,
// judged for truth") lives in the SYSTEM PROMPTS under prompts/, not in code.
//
// Provider: the standard OpenAI API. Tests inject deterministic providers.
//
// Usage:
//   node src/generate-carousel.mjs --topic "도파민 중독의 진짜 메커니즘"
//   node src/generate-carousel.mjs --topic "..." --tone polite
//   node src/generate-carousel.mjs --niche brain-psychology
//   node src/generate-carousel.mjs --topic "..." --out out.json
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";
import { extractJson } from "./lib/json.mjs";
import {
  CAROUSEL_LIMITS,
  validateCard,
  validateCarousel,
} from "./lib/carousel_contract.mjs";
import { parseArgs, retry } from "./lib/runtime.mjs";
import { openaiComplete, openaiGrounded } from "./lib/openai.mjs";
import { DEFAULT_TONE, getTone, withToneInstruction } from "./lib/tone.mjs";

loadEnv();

const PROVIDERS = { openai: openaiComplete };

const promptPath = (name) =>
  fileURLToPath(new URL(`./prompts/${name}`, import.meta.url));

async function pickTopic(args) {
  if (args.topic && typeof args.topic === "string") return args.topic;
  const nichesRaw = await readFile(
    fileURLToPath(new URL("./config/niches.json", import.meta.url)),
    "utf8",
  );
  const niches = JSON.parse(nichesRaw).niches;
  const nicheKey =
    typeof args.niche === "string" ? args.niche : Object.keys(niches)[0];
  const niche = niches[nicheKey];
  if (!niche)
    throw new Error(
      `unknown niche '${nicheKey}'. available: ${Object.keys(niches).join(", ")}`,
    );
  // Deterministic-ish pick unless --pick <index>; default first keyword.
  const idx = Number.isFinite(Number(args.pick)) ? Number(args.pick) : 0;
  const kw = niche.keywords[idx % niche.keywords.length];
  return kw;
}

// Web-grounded fact-check via ChatGPT OAuth web_search. Returns per-card
// { supported, confidence, sources[], issue } judged against real search hits.
async function factCheckStage(carousel, factcheckSystem) {
  const grounded = await openaiGrounded(
    factcheckSystem,
    `팩트체크할 캐러셀 JSON:\n${JSON.stringify(carousel)}`,
    {
      effort: "medium",
    },
  );
  let fv;
  try {
    fv = extractJson(grounded.text);
  } catch {
    fv = { cards: [], overall: "" };
  }
  fv._citations = grounded.sources || [];
  return fv;
}

// Attach real source URLs to each card for the Instagram review package and
// flag whether the card's facts were web-supported.
function attachSources(carousel, factVerdict) {
  const byN = {};
  (factVerdict.cards || []).forEach((c) => (byN[c.n] = c));
  (carousel.cards || []).forEach((card) => {
    const f = byN[card.n];
    if (!f) return;
    card.sources =
      Array.isArray(f.sources) && f.sources.length
        ? f.sources
        : factVerdict._citations || [];
    card.factSupported = f.supported !== false;
  });
}

function summarizeVerdict(v, expectedCardCount) {
  const cards = Array.isArray(v?.cards) ? v.cards : [];
  const weak = cards.filter(
    (c) => Number(c.novelty) < 3 || Number(c.truth) < 4 || Number(c.human) < 3,
  );
  const complete = cards.length === expectedCardCount;
  return {
    verdict: v?.verdict,
    passed: v?.verdict === "pass" && complete && weak.length === 0,
    complete,
    weakCount: weak.length,
    weak,
    overall: v?.overall,
    reviseInstructions: v?.reviseInstructions,
  };
}

function needsSocialCopyRevision(summary) {
  return /caption|캡션|hashtag|해시태그/i.test(
    [summary.overall, summary.reviseInstructions].filter(Boolean).join(" "),
  );
}

// Build per-card critique for the cards we will rewrite.
function buildCritiques(targetNs, summary, unsupported) {
  const vByN = new Map((summary.weak || []).map((c) => [c.n, c]));
  const fByN = new Map((unsupported || []).map((c) => [c.n, c]));
  return targetNs.map((n) => {
    const parts = [];
    const v = vByN.get(n);
    if (v)
      parts.push(
        `품질: novelty ${v.novelty}/truth ${v.truth}/human ${v.human ?? "-"} — ${v.issues || ""} → ${v.fix || ""}`,
      );
    const f = fByN.get(n);
    if (f)
      parts.push(
        `사실 미확인/반박: ${f.issue || "웹에서 근거 못 찾음"} → 검색으로 확인되는 사실로 바꾸거나 빼라.`,
      );
    return {
      n,
      critique:
        parts.join("\n") ||
        "더 새롭고, 사실에 근거하고, 사람 말투로 다시 써라.",
    };
  });
}

// Targeted card-level revision: rewrite ONLY the weak cards, keeping the rest
// untouched so passing content is never disturbed.
async function reviseCards(carousel, weak, callLLM, contentSystem, log) {
  for (const w of weak) {
    const idx = (carousel.cards || []).findIndex((c) => c.n === w.n);
    if (idx === -1) continue;
    const prompt = [
      `아래는 캐러셀 전체다(맥락용). 이 중 ${w.n}번 카드 하나만 다시 써라. 나머지 카드는 절대 바꾸지 마라(장수도 그대로).`,
      `전체 캐러셀:\n${JSON.stringify(carousel)}`,
      `${w.n}번 카드의 문제(반드시 고쳐라):\n${w.critique}`,
      `요구: 전체 흐름·톤과 자연스럽게 이어지게 이 카드만 교체. 시스템 지침(사람 말투·새로움·사실성) 전부 준수.`,
      `출력: 그 카드 하나의 JSON 객체만. {"n":${w.n},"kicker":"...","headline":"...","body":"...","imagePrompt":"...","audit":{"novelty":"...","factBasis":"...","confidence":"high|med|low"}}`,
    ].join("\n\n");
    try {
      const card = extractJson(await callLLM(contentSystem, prompt));
      card.n = w.n;
      const errors = validateCard(card, w.n);
      if (errors.length) {
        log(
          `[revise] card ${w.n} rejected (${errors.join("; ")}); keeping previous`,
        );
        continue;
      }
      carousel.cards[idx] = card;
      log(`[revise] card ${w.n} rewritten`);
    } catch (e) {
      log(`[revise] card ${w.n} failed (soft): ${e.message}`);
    }
  }
}

async function reviseSocialCopy(
  carousel,
  summary,
  callLLM,
  contentSystem,
  log,
) {
  const prompt = [
    "카드 내용과 장수는 절대 바꾸지 말고 Instagram caption과 hashtags만 다시 써라.",
    `전체 캐러셀:\n${JSON.stringify(carousel)}`,
    `편집장 지적:\n${summary.overall || summary.reviseInstructions || "게시글 문구를 더 정확하고 자연스럽게 고쳐라."}`,
    "caption은 카드에 없는 새 사실을 추가하지 않는 3~6개 짧은 문단. hashtags는 # 없이 주제에 직접 관련된 3~12개.",
    '출력: {"caption":"...","hashtags":["...","..."]} JSON 객체 하나만.',
  ].join("\n\n");
  try {
    const copy = extractJson(await callLLM(contentSystem, prompt));
    const candidate = {
      ...carousel,
      caption: copy.caption,
      hashtags: copy.hashtags,
    };
    const copyErrors = validateCarousel(candidate).filter((error) =>
      /caption|hashtag/.test(error),
    );
    if (copyErrors.length) {
      log(`[revise] Instagram copy rejected (${copyErrors.join("; ")})`);
      return false;
    }
    carousel.caption = copy.caption;
    carousel.hashtags = copy.hashtags;
    log("[revise] Instagram caption and hashtags rewritten");
    return true;
  } catch (error) {
    log(`[revise] Instagram copy failed (soft): ${error.message}`);
    return false;
  }
}

export async function generateCarousel({
  topic,
  initialCarousel,
  provider = "openai",
  tone = DEFAULT_TONE,
  maxRevisions = 2,
  verify = true,
  factCheck = true,
  callLLM: callLLMOverride,
  factChecker,
  log = () => {},
}) {
  // callLLM/factChecker are injectable for deterministic tests; production uses
  // the ChatGPT OAuth providers.
  const callLLM = callLLMOverride || PROVIDERS[provider];
  if (!callLLM)
    throw new Error(
      `unknown provider '${provider}'. use: ${Object.keys(PROVIDERS).join(", ")}`,
    );

  const selectedTone = getTone(tone);

  const contentSystem = withToneInstruction(
    await readFile(promptPath("content-system.md"), "utf8"),
    selectedTone.id,
  );
  const verifySystem = withToneInstruction(
    await readFile(promptPath("verify-system.md"), "utf8"),
    selectedTone.id,
  );
  const factcheckSystem = await readFile(
    promptPath("factcheck-system.md"),
    "utf8",
  );
  const runFactCheck =
    factChecker || ((c) => factCheckStage(c, factcheckSystem));

  let carousel = initialCarousel ? structuredClone(initialCarousel) : null;
  let lastVerdict = null;
  let lastFact = null;

  // 1) Initial full generation (once). One structural-repair retry.
  const initialUser = `주제: ${topic}\n\n위 시스템 지침을 100% 지켜서 Instagram 캐러셀 JSON을 출력하라. 장수는 주제에 맞게 정하되(${CAROUSEL_LIMITS.min}~${CAROUSEL_LIMITS.max}장 범위) 억지로 늘리거나 줄이지 마라.`;
  if (carousel) {
    const resumeErrors = validateCarousel(carousel);
    if (resumeErrors.length)
      throw new Error(
        `cannot resume invalid carousel: ${resumeErrors.join("; ")}`,
      );
    log(`[resume] existing ${carousel.cards.length}-card carousel`);
  } else {
    log(`[generate] (provider=${provider})`);
    carousel = extractJson(await callLLM(contentSystem, initialUser));
    const struct0 = validateCarousel(carousel);
    if (struct0.length) {
      log(`[generate] structural issues: ${struct0.join("; ")} — repairing`);
      carousel = extractJson(
        await callLLM(
          contentSystem,
          `${initialUser}\n\n구조 위반 수정: ${struct0.join("; ")}. 모든 카드를 빠짐없이 채워라.`,
        ),
      );
    }
  }

  // Fast path: skip the verify/fact-check loop (quick UI previews).
  if (!verify) {
    return {
      topic,
      provider,
      tone: selectedTone.id,
      attempts: 1,
      carousel,
      verdict: null,
      passed: validateCarousel(carousel).length === 0,
    };
  }

  // 2) Verify + fact-check + TARGETED card-level revision until converged.
  // Only weak cards are rewritten; cards that pass get locked and are never
  // disturbed again, so the loop makes monotonic progress instead of whack-a-mole
  // whole-carousel regeneration (which never converged before).
  const locked = new Set();
  let round = 0;
  for (; round <= maxRevisions; round += 1) {
    const verifyText = await callLLM(
      verifySystem,
      `심사할 캐러셀 JSON:\n${JSON.stringify(carousel)}`,
    );
    lastVerdict = extractJson(verifyText);
    const summary = summarizeVerdict(lastVerdict, carousel.cards?.length || 0);

    let unsupported = [];
    let factCheckFailed = false;
    if (factCheck) {
      try {
        lastFact = await retry(() => runFactCheck(carousel), {
          attempts: 2,
          onError: (error, attempt) =>
            log(`[factcheck] attempt ${attempt} failed: ${error.message}`),
        });
        const factCards = Array.isArray(lastFact?.cards) ? lastFact.cards : [];
        const expectedNs = (carousel.cards || []).map((card) => Number(card.n));
        const returnedNs = new Set(factCards.map((card) => Number(card.n)));
        if (
          factCards.length !== expectedNs.length ||
          expectedNs.some((n) => !returnedNs.has(n))
        ) {
          factCheckFailed = true;
          log(
            `[factcheck] incomplete verdict (${factCards.length}/${expectedNs.length} cards)`,
          );
        } else {
          attachSources(carousel, lastFact);
          unsupported = factCards.filter((card) => card.supported !== true);
          const missingSources = (carousel.cards || []).filter(
            (card) =>
              card.factSupported &&
              (!Array.isArray(card.sources) || card.sources.length === 0),
          );
          if (missingSources.length) {
            factCheckFailed = true;
            log(
              `[factcheck] supported cards missing sources: ${missingSources.map((card) => card.n).join(",")}`,
            );
          }
        }
      } catch (e) {
        factCheckFailed = true;
        log(`[factcheck] failed (soft): ${e.message}`);
      }
    }

    const unsupportedNs = new Set(unsupported.map((c) => c.n));
    const weakSetNow = new Set([
      ...(summary.weak || []).map((c) => c.n),
      ...unsupportedNs,
    ]);
    // A later evidence or editorial verdict can invalidate an earlier lock.
    // Unlock every currently weak card so the loop cannot deadlock with
    // verdict=revise while targetNs is empty.
    for (const n of weakSetNow) locked.delete(n);
    for (const card of carousel.cards || [])
      if (!weakSetNow.has(card.n)) locked.add(card.n);
    const targetNs = [...weakSetNow].filter((n) => !locked.has(n));
    const structural = validateCarousel(carousel);
    log(
      `[round ${round + 1}] verify=${summary.verdict} weak=${summary.weakCount} unsupported=${unsupported.length} → revise ${targetNs.join(",") || "none"}`,
    );

    if (
      summary.passed &&
      targetNs.length === 0 &&
      !structural.length &&
      !factCheckFailed
    ) {
      return {
        topic,
        provider,
        tone: selectedTone.id,
        attempts: round + 1,
        carousel,
        verdict: lastVerdict,
        factVerdict: lastFact,
        passed: true,
        locked: [...locked],
      };
    }
    if (round === maxRevisions) break;

    if (targetNs.length > 0) {
      await reviseCards(
        carousel,
        buildCritiques(targetNs, summary, unsupported),
        callLLM,
        contentSystem,
        log,
      );
    }
    if (!factCheckFailed && needsSocialCopyRevision(summary)) {
      await reviseSocialCopy(carousel, summary, callLLM, contentSystem, log);
    }
  }

  return {
    topic,
    provider,
    tone: selectedTone.id,
    attempts: round + 1,
    carousel,
    verdict: lastVerdict,
    factVerdict: lastFact,
    passed: false,
    locked: [...locked],
  };
}

export { validateCarousel } from "./lib/carousel_contract.mjs";

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const provider =
    typeof args.provider === "string"
      ? args.provider
      : process.env.INSTAGRAM_TEXT_PROVIDER || "openai";
  const tone =
    typeof args.tone === "string"
      ? args.tone
      : process.env.INSTAGRAM_TONE || DEFAULT_TONE;
  const maxRevisions = Number.isFinite(Number(args["max-revisions"]))
    ? Number(args["max-revisions"])
    : 2;
  const verify = !args["generate-only"];
  const factCheck = !args["no-factcheck"];
  let initialCarousel;
  if (typeof args.in === "string") {
    const saved = JSON.parse(await readFile(args.in, "utf8"));
    initialCarousel = saved.carousel || saved;
  }
  const topic =
    (typeof args.topic === "string" && args.topic) ||
    initialCarousel?.topic ||
    initialCarousel?.hook ||
    (await pickTopic(args));
  const result = await generateCarousel({
    topic,
    initialCarousel,
    provider,
    tone,
    maxRevisions,
    verify,
    factCheck,
    log: (m) => process.stderr.write(m + "\n"),
  });
  const out = JSON.stringify(result, null, 2);
  if (typeof args.out === "string") {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(args.out, out);
    process.stderr.write(`\nwrote ${args.out} (passed=${result.passed})\n`);
  } else {
    process.stdout.write(out + "\n");
  }
  process.exit(result.passed ? 0 : 2);
}
