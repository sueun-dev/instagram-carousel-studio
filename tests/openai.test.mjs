import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectResponseUrls,
  openaiComplete,
  openaiGrounded,
  openaiImageToFile,
} from "../src/lib/openai.mjs";

test("OpenAI text requests keep instructions separate from user input", async () => {
  let request;
  const client = {
    responses: {
      create: async (body) => {
        request = body;
        return { output_text: '{"ok":true}' };
      },
    },
  };
  assert.equal(
    await openaiComplete("system rules", "user topic", {
      client,
      model: "test-model",
      effort: "low",
    }),
    '{"ok":true}',
  );
  assert.equal(request.instructions, "system rules");
  assert.equal(request.input, "user topic");
  assert.deepEqual(request.reasoning, { effort: "low" });
});

test("grounded responses enable web search and collect source URLs", async () => {
  let request;
  const response = {
    output_text: '{"cards":[]}',
    output: [
      {
        type: "web_search_call",
        action: { sources: [{ url: "https://example.org/source" }] },
      },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: '{"cards":[]}',
            annotations: [
              { type: "url_citation", url: "https://example.org/source" },
            ],
          },
        ],
      },
    ],
  };
  const client = {
    responses: { create: async (body) => ((request = body), response) },
  };
  const result = await openaiGrounded("fact rules", "facts", { client });
  assert.deepEqual(request.tools, [{ type: "web_search" }]);
  assert.deepEqual(result.sources, ["https://example.org/source"]);
  assert.deepEqual(collectResponseUrls(response), [
    "https://example.org/source",
  ]);
});

test("image responses are decoded to the requested file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "instagram-openai-test-"));
  const file = join(directory, "card.png");
  const bytes = Buffer.from("fake-png");
  let request;
  const client = {
    images: {
      generate: async (body) => {
        request = body;
        return { data: [{ b64_json: bytes.toString("base64") }] };
      },
    },
  };
  try {
    assert.equal(
      await openaiImageToFile("editorial", file, {
        client,
        model: "image-test",
        size: "1024x1536",
      }),
      file,
    );
    assert.deepEqual(await readFile(file), bytes);
    assert.equal(request.model, "image-test");
    assert.equal(request.size, "1024x1536");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
