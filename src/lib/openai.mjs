import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import OpenAI from "openai";

function createClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const timeout = Math.max(
    60_000,
    Number(process.env.INSTAGRAM_OPENAI_TIMEOUT_MS) || 300_000,
  );
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout });
}

function responseText(response) {
  if (response?.output_text) return String(response.output_text);
  return (response?.output || [])
    .filter((item) => item?.type === "message")
    .flatMap((item) => item.content || [])
    .filter((item) => item?.type === "output_text")
    .map((item) => item.text || "")
    .join("");
}

export function collectResponseUrls(value) {
  const urls = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.url === "string" && /^https?:\/\//i.test(node.url))
      urls.add(node.url);
    for (const child of Array.isArray(node) ? node : Object.values(node))
      visit(child);
  };
  visit(value?.output || value);
  return [...urls];
}

export async function openaiComplete(systemPrompt, userPrompt, opts = {}) {
  const client = opts.client || createClient();
  const response = await client.responses.create({
    model: opts.model || process.env.INSTAGRAM_OPENAI_MODEL || "gpt-5.6",
    reasoning: {
      effort: opts.effort || process.env.INSTAGRAM_OPENAI_EFFORT || "medium",
    },
    instructions: String(systemPrompt ?? ""),
    input: String(userPrompt ?? ""),
  });
  const text = responseText(response).trim();
  if (!text) throw new Error("OpenAI returned an empty text response");
  return text;
}

export async function openaiGrounded(systemPrompt, userPrompt, opts = {}) {
  const client = opts.client || createClient();
  const response = await client.responses.create({
    model: opts.model || process.env.INSTAGRAM_OPENAI_MODEL || "gpt-5.6",
    reasoning: {
      effort: opts.effort || process.env.INSTAGRAM_OPENAI_EFFORT || "medium",
    },
    instructions: String(systemPrompt ?? ""),
    input: String(userPrompt ?? ""),
    tools: [{ type: "web_search" }],
  });
  const text = responseText(response).trim();
  if (!text)
    throw new Error("OpenAI web search returned an empty text response");
  return { text, sources: collectResponseUrls(response) };
}

export async function openaiImageToFile(prompt, outPath, opts = {}) {
  const client = opts.client || createClient();
  const result = await client.images.generate({
    model: opts.model || process.env.INSTAGRAM_IMAGE_MODEL || "gpt-image-2",
    prompt: String(prompt || ""),
    size: opts.size || process.env.INSTAGRAM_IMAGE_SIZE || "1024x1536",
  });
  const imageBase64 = result?.data?.[0]?.b64_json;
  if (!imageBase64) throw new Error("OpenAI returned no image data");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, Buffer.from(imageBase64, "base64"));
  return outPath;
}
