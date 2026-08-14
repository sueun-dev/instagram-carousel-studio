import test from "node:test";
import assert from "node:assert/strict";
import {
  codexAuthStatus,
  createCodexProvider,
  extractHttpUrls,
} from "../src/lib/codex.mjs";

test("Codex provider keeps text context and isolates grounded calls", async () => {
  const textPrompts = [];
  const groundedPrompts = [];
  const runTextTurn = async (prompt, { signal }) => {
    assert.equal(signal.aborted, false);
    textPrompts.push(prompt);
    return { finalResponse: '{"ok":true}' };
  };
  const runGroundedTurn = async (prompt, { signal }) => {
    assert.equal(signal.aborted, false);
    groundedPrompts.push(prompt);
    return { finalResponse: '{"sources":["https://example.org/source"]}' };
  };
  const provider = createCodexProvider({
    runTextTurn,
    runGroundedTurn,
    timeoutMs: 1_000,
  });

  assert.equal(await provider.complete("system", "request"), '{"ok":true}');
  assert.deepEqual(await provider.grounded("fact rules", "claims"), {
    text: '{"sources":["https://example.org/source"]}',
    sources: ["https://example.org/source"],
  });
  assert.equal(textPrompts.length, 1);
  assert.equal(groundedPrompts.length, 1);
  assert.match(textPrompts[0], /Do not use tools/);
  assert.match(groundedPrompts[0], /Use live web search/);
  assert.match(textPrompts[0], /<system_instructions>\nsystem/);
});

test("Codex URL extraction deduplicates direct sources", () => {
  assert.deepEqual(
    extractHttpUrls(
      "https://example.org/a, https://example.org/a and https://openai.com/b.",
    ),
    ["https://example.org/a", "https://openai.com/b"],
  );
});

test("Codex auth status reports only method and availability", async () => {
  const status = await codexAuthStatus({
    run: async () => ({ stdout: "Logged in using ChatGPT\n", stderr: "" }),
  });
  assert.deepEqual(status, {
    available: true,
    signedIn: true,
    method: "chatgpt",
  });
});

test("Codex auth failures return an actionable login message", async () => {
  const provider = createCodexProvider({
    runTurn: async () => {
      throw new Error("Not logged in. Run codex login");
    },
    timeoutMs: 1_000,
  });
  await assert.rejects(
    () => provider.complete("system", "request"),
    /codex login/,
  );
});
