// Deterministic tests for the carousel orchestration (no network). A scripted
// fake LLM + fake fact-checker are injected so the generate → verify →
// targeted-revise → lock convergence logic is exercised in milliseconds.
import test from "node:test";
import assert from "node:assert/strict";
import {
  generateCarousel,
  validateCarousel,
} from "../src/generate-carousel.mjs";
import { extractJson } from "../src/lib/json.mjs";

const CARD = (n, headline) => ({
  n,
  kicker: `k${n}`,
  headline: headline || `Head${n}`,
  body: `본문 ${n} 이것은 충분히 긴 본문 문장이다 정말로 그렇다`,
  imagePrompt: `prompt ${n} cinematic amber near-black`,
  audit: { novelty: "x", factBasis: "y", confidence: "high" },
});

// Fake LLM: distinguishes generate / verify / single-card-revise by the prompt.
function makeFakeLLM({ weakInitially = [4, 6] } = {}) {
  const revised = new Set();
  const calls = { generate: 0, verify: 0, revise: [] };
  async function callLLM(system, user) {
    if (system.includes("편집장")) {
      // verify: weak = still-unrevised cards in weakInitially
      calls.verify += 1;
      const cards = [1, 2, 3, 4, 5, 6].map((n) => {
        const weak = weakInitially.includes(n) && !revised.has(n);
        return {
          n,
          novelty: weak ? 2 : 4,
          truth: 5,
          human: 4,
          issues: weak ? "약함" : "",
          fix: weak ? "더 새롭게" : "",
        };
      });
      const verdict = cards.every((c) => c.novelty >= 3) ? "pass" : "revise";
      return JSON.stringify({
        verdict,
        cards,
        overall: "",
        reviseInstructions: "",
      });
    }
    const m = user.match(/(\d+)번 카드 하나만 다시 써라/);
    if (m) {
      const n = Number(m[1]);
      revised.add(n);
      calls.revise.push(n);
      return JSON.stringify(CARD(n, `REVISED-${n}`));
    }
    calls.generate += 1;
    return JSON.stringify({
      topic: "t",
      hook: "h",
      cards: [1, 2, 3, 4, 5, 6].map((n) => CARD(n)),
      cta: "c",
      styleSpec: "s",
      caption:
        "카드에서 다룬 내용을 내 경험에 연결해 읽어보자. 나중에 다시 볼 수 있게 저장해두자.",
      hashtags: ["인사이트", "배움", "저장콘텐츠"],
    });
  }
  return { callLLM, calls, revised };
}

const factAllOk = async (carousel) => ({
  cards: carousel.cards.map((c) => ({
    n: c.n,
    supported: true,
    confidence: "high",
    sources: [`https://example.org/${c.n}`],
    issue: "",
  })),
  overall: "ok",
  _citations: [],
});

test("convergence: rewrites only weak cards, locks the rest, reaches passed", async () => {
  const fake = makeFakeLLM({ weakInitially: [4, 6] });
  const r = await generateCarousel({
    topic: "t",
    maxRevisions: 3,
    callLLM: fake.callLLM,
    factChecker: factAllOk,
  });

  assert.equal(r.passed, true, "should converge to passed");
  assert.deepEqual(
    [...fake.revised].sort(),
    [4, 6],
    "only cards 4 and 6 revised",
  );
  assert.equal(
    fake.calls.generate,
    1,
    "generated the whole carousel exactly once (no whack-a-mole)",
  );

  const byN = Object.fromEntries(r.carousel.cards.map((c) => [c.n, c]));
  assert.match(byN[4].headline, /REVISED-4/);
  assert.match(byN[6].headline, /REVISED-6/);
  assert.equal(byN[1].headline, "Head1", "good card untouched");
  assert.equal(byN[3].headline, "Head3", "good card untouched");
  assert.ok(
    r.locked.includes(1) &&
      r.locked.includes(2) &&
      r.locked.includes(3) &&
      r.locked.includes(5),
  );
});

test("facts override locks: a card that becomes web-unsupported is re-worked despite an earlier lock", async () => {
  const fake = makeFakeLLM({ weakInitially: [4] });
  let fcall = 0;
  const factFlip = async (carousel) => {
    fcall += 1;
    return {
      cards: carousel.cards.map((c) => ({
        n: c.n,
        supported: !(c.n === 6 && fcall === 2), // card 6 flips unsupported only on round 2
        confidence: "high",
        sources: [`https://example.org/round-${fcall}/card-${c.n}`],
        issue: "",
      })),
      overall: "",
      _citations: [],
    };
  };
  const r = await generateCarousel({
    topic: "t",
    maxRevisions: 4,
    callLLM: fake.callLLM,
    factChecker: factFlip,
  });
  assert.ok(
    fake.calls.revise.includes(6),
    "card 6 must be re-worked after the late fact flip",
  );
  assert.equal(r.passed, true, "converges once the flipped card is fixed");
});

test("a later editorial failure unlocks a card that passed an earlier round", async () => {
  const revised = new Set();
  const calls = [];
  const base = {
    topic: "t",
    hook: "h",
    cards: [1, 2, 3, 4, 5].map((n) => CARD(n)),
    cta: "c",
    styleSpec: "s",
    caption:
      "카드에서 다룬 내용을 내 경험에 연결해 읽어보자. 나중에 다시 볼 수 있게 저장해두자.",
    hashtags: ["인사이트", "배움", "저장콘텐츠"],
  };
  let verifyCalls = 0;
  const callLLM = async (system, user) => {
    if (system.includes("편집장")) {
      verifyCalls += 1;
      const weakN = verifyCalls === 1 ? 4 : verifyCalls === 2 ? 2 : null;
      const cards = base.cards.map((card) => ({
        n: card.n,
        novelty: card.n === weakN && !revised.has(card.n) ? 2 : 4,
        truth: 5,
        human: 4,
        issues: card.n === weakN ? "뒤늦게 발견한 약점" : "",
        fix: "더 구체적으로",
      }));
      return JSON.stringify({
        verdict: cards.some((card) => card.novelty < 3) ? "revise" : "pass",
        cards,
        overall: "",
        reviseInstructions: "",
      });
    }
    const match = user.match(/(\d+)번 카드 하나만 다시 써라/);
    if (match) {
      const n = Number(match[1]);
      revised.add(n);
      calls.push(n);
      return JSON.stringify(CARD(n, `REVISED-${n}`));
    }
    return JSON.stringify(base);
  };

  const result = await generateCarousel({
    topic: "t",
    maxRevisions: 3,
    callLLM,
    factChecker: factAllOk,
  });
  assert.equal(result.passed, true);
  assert.deepEqual(calls, [4, 2]);
});

test("global caption feedback rewrites only Instagram copy and re-verifies", async () => {
  const base = {
    topic: "t",
    hook: "h",
    cards: [1, 2, 3, 4, 5].map((n) => CARD(n)),
    cta: "c",
    styleSpec: "s",
    caption:
      "처음 만든 캡션은 구조만 통과하지만 편집 기준에서는 너무 뻔해서 다시 써야 하는 문장이다.",
    hashtags: ["인사이트", "배움", "저장콘텐츠"],
  };
  let verifyCalls = 0;
  let copyCalls = 0;
  const callLLM = async (system, user) => {
    if (system.includes("편집장")) {
      verifyCalls += 1;
      return JSON.stringify({
        verdict: verifyCalls === 1 ? "revise" : "pass",
        cards: base.cards.map((card) => ({
          n: card.n,
          novelty: 4,
          truth: 5,
          human: 4,
          issues: "",
          fix: "",
        })),
        overall: verifyCalls === 1 ? "캡션이 카드 내용을 반복한다." : "통과",
        reviseInstructions: "캡션만 다시 쓸 것",
      });
    }
    if (user.includes("caption과 hashtags만")) {
      copyCalls += 1;
      return JSON.stringify({
        caption:
          "읽고 넘기는 데서 끝내지 말고, 다음 선택을 바꿀 한 문장만 골라보자.\n\n나중에 필요할 때 다시 볼 수 있게 저장해두자.",
        hashtags: ["인사이트", "행동변화", "저장콘텐츠"],
      });
    }
    return JSON.stringify(base);
  };

  const result = await generateCarousel({
    topic: "t",
    maxRevisions: 2,
    callLLM,
    factChecker: factAllOk,
  });
  assert.equal(result.passed, true);
  assert.equal(copyCalls, 1);
  assert.equal(verifyCalls, 2);
  assert.match(result.carousel.caption, /다음 선택/);
  assert.equal(
    result.carousel.cards[0].headline,
    "Head1",
    "cards stay untouched",
  );
});

test("card and caption feedback are both revised in the same round", async () => {
  const base = {
    topic: "t",
    hook: "h",
    cards: [1, 2, 3, 4, 5].map((n) => CARD(n)),
    cta: "c",
    styleSpec: "s",
    caption:
      "처음 캡션은 카드 내용을 그대로 반복해서 게시 문구로 쓰기 어렵다. 다시 쓸 필요가 있다.",
    hashtags: ["인사이트", "배움", "저장콘텐츠"],
  };
  let verifyCalls = 0;
  const revisions = [];
  const callLLM = async (system, user) => {
    if (system.includes("편집장")) {
      verifyCalls += 1;
      return JSON.stringify({
        verdict: verifyCalls === 1 ? "revise" : "pass",
        cards: base.cards.map((card) => ({
          n: card.n,
          novelty: verifyCalls === 1 && card.n === 3 ? 2 : 4,
          truth: 5,
          human: 4,
          issues: card.n === 3 ? "약함" : "",
          fix: "구체화",
        })),
        overall:
          verifyCalls === 1
            ? "3번 카드와 caption이 카드 내용을 반복한다."
            : "통과",
        reviseInstructions: verifyCalls === 1 ? "3번과 캡션을 고쳐라." : "",
      });
    }
    if (user.includes("caption과 hashtags만")) {
      revisions.push("caption");
      return JSON.stringify({
        caption:
          "내가 바꿀 행동 한 가지를 먼저 골라보자. 필요할 때 다시 확인할 수 있도록 저장해두자.",
        hashtags: ["인사이트", "행동변화", "저장콘텐츠"],
      });
    }
    const match = user.match(/(\d+)번 카드 하나만 다시 써라/);
    if (match) {
      revisions.push(Number(match[1]));
      return JSON.stringify(CARD(Number(match[1]), "REVISED-3"));
    }
    return JSON.stringify(base);
  };

  const result = await generateCarousel({
    topic: "t",
    maxRevisions: 2,
    callLLM,
    factChecker: factAllOk,
  });
  assert.equal(result.passed, true);
  assert.deepEqual(revisions, [3, "caption"]);
});

test("fact-check failure cannot become a verified production result", async () => {
  const fake = makeFakeLLM({ weakInitially: [] });
  const result = await generateCarousel({
    topic: "t",
    maxRevisions: 1,
    callLLM: fake.callLLM,
    factChecker: async () => {
      throw new Error("search unavailable");
    },
  });
  assert.equal(result.passed, false);
});

test("transient fact-check failures retry without consuming a revision round", async () => {
  const fake = makeFakeLLM({ weakInitially: [] });
  let factCalls = 0;
  const result = await generateCarousel({
    topic: "t",
    maxRevisions: 0,
    callLLM: fake.callLLM,
    factChecker: async (carousel) => {
      factCalls += 1;
      if (factCalls === 1) throw new Error("temporary network error");
      return factAllOk(carousel);
    },
  });
  assert.equal(result.passed, true);
  assert.equal(factCalls, 2);
  assert.equal(result.attempts, 1);
});

test("incomplete fact-check coverage cannot become a verified production result", async () => {
  const fake = makeFakeLLM({ weakInitially: [] });
  const result = await generateCarousel({
    topic: "t",
    maxRevisions: 1,
    callLLM: fake.callLLM,
    factChecker: async (carousel) => ({
      cards: carousel.cards.slice(0, -1).map((card) => ({
        n: card.n,
        supported: true,
        sources: [`https://example.org/${card.n}`],
      })),
      _citations: [],
    }),
  });
  assert.equal(result.passed, false);
  assert.deepEqual(
    fake.calls.revise,
    [],
    "missing verdicts are retried instead of rewriting valid cards",
  );
});

test("no-verify fast path returns after a single generation", async () => {
  const fake = makeFakeLLM();
  const r = await generateCarousel({
    topic: "t",
    verify: false,
    callLLM: fake.callLLM,
    factChecker: factAllOk,
  });
  assert.equal(fake.calls.verify, 0);
  assert.equal(fake.calls.generate, 1);
  assert.equal(r.passed, true);
});

test("resume path skips full generation and verifies an existing carousel", async () => {
  const fake = makeFakeLLM({ weakInitially: [] });
  const initialCarousel = {
    topic: "saved",
    hook: "h",
    cards: [1, 2, 3, 4, 5, 6].map((n) => CARD(n)),
    cta: "c",
    styleSpec: "s",
    caption:
      "저장된 캐러셀을 처음부터 다시 만들지 않고 이어서 검증하는 충분히 긴 캡션이다.",
    hashtags: ["인사이트", "배움", "저장콘텐츠"],
  };
  const result = await generateCarousel({
    topic: "saved",
    initialCarousel,
    maxRevisions: 0,
    callLLM: fake.callLLM,
    factChecker: factAllOk,
  });
  assert.equal(result.passed, true);
  assert.equal(fake.calls.generate, 0);
  assert.equal(fake.calls.verify, 1);
  assert.notEqual(
    result.carousel,
    initialCarousel,
    "resume should not mutate the saved input object",
  );
});

test("validateCarousel: accepts 5-8 cards and rejects out-of-range or incomplete packages", () => {
  const mk = (n) => ({
    hook: "h",
    cta: "c",
    styleSpec: "s",
    caption:
      "카드에서 다룬 내용을 내 경험에 연결해 읽어보자. 나중에 다시 볼 수 있게 저장해두자.",
    hashtags: ["인사이트", "배움", "저장콘텐츠"],
    cards: Array.from({ length: n }, (_, i) => CARD(i + 1)),
  });
  assert.deepEqual(validateCarousel(mk(5)), [], "5 cards OK");
  assert.deepEqual(validateCarousel(mk(6)), [], "6 cards OK");
  assert.deepEqual(validateCarousel(mk(8)), [], "8 cards OK");
  assert.ok(
    validateCarousel(mk(4)).some((e) => /range/.test(e)),
    "4 cards rejected",
  );
  assert.ok(
    validateCarousel(mk(9)).some((e) => /range/.test(e)),
    "9 cards rejected",
  );

  const thin = mk(5);
  thin.cards[0].body = "짧음";
  assert.ok(validateCarousel(thin).some((e) => /body too thin/.test(e)));
  const low = mk(5);
  low.cards[0].audit.confidence = "low";
  assert.ok(validateCarousel(low).some((e) => /low-confidence/.test(e)));
  const noHook = mk(5);
  delete noHook.hook;
  assert.ok(validateCarousel(noHook).some((e) => /hook/.test(e)));

  const wrongOrder = mk(5);
  wrongOrder.cards[2].n = 7;
  assert.ok(validateCarousel(wrongOrder).some((e) => /n must equal 3/.test(e)));

  const noCaption = mk(5);
  delete noCaption.caption;
  assert.ok(validateCarousel(noCaption).some((e) => /caption/.test(e)));
});

test("extractJson: fences, trailing junk, and concatenated objects", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('{"a":1}\nsome trailing prose'), { a: 1 });
  assert.deepEqual(extractJson('prefix {"a":{"b":2}} {"c":3}'), {
    a: { b: 2 },
  });
  assert.deepEqual(extractJson('{"s":"has } brace in string"}'), {
    s: "has } brace in string",
  });
  assert.throws(() => extractJson("no json here"));
});
