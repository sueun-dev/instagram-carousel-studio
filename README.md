# Instagram Carousel Studio

Create a complete Instagram carousel package from one topic: 5–8 source-checked cards, AI-generated backgrounds, publish-ready 1080×1350 PNGs, caption, hashtags, alt text, and source files.

The Studio runs locally. API keys stay on your machine and generated posts stay in the ignored `output/` directory.

## What it does

1. Generates a 5–8 card carousel and Instagram post copy.
2. Reviews every card for novelty, factual quality, and natural writing.
3. Uses OpenAI web search to attach sources and block unsupported claims.
4. Rewrites only weak cards instead of regenerating the whole carousel.
5. Generates one visual per card with GPT Image.
6. Composites and saves final 4:5 PNGs plus the full post package.

## Requirements

- Node.js 20 or newer
- An OpenAI API key with access to the configured text and image models
- API organization verification may be required for GPT Image models

The default models are `gpt-5.6` for text and `gpt-image-2` for images. Both can be changed in `.env` or the Studio settings.

## Setup

```bash
git clone https://github.com/sueun-dev/instagram-carousel-studio.git
cd instagram-carousel-studio
npm install
cp .env.example .env
```

Add your key to `.env`:

```dotenv
OPENAI_API_KEY=your_key_here
```

Start the Studio:

```bash
npm start
```

Open `http://127.0.0.1:5273/`.

## CLI

```bash
# Generate and verify carousel content
npm run generate -- --topic "How caffeine timing changes sleep"

# Generate content without the review loop
npm run generate -- --topic "How caffeine timing changes sleep" --generate-only

# Resume review from an existing result
npm run generate -- \
  --in output/<result>/carousel.json \
  --max-revisions 3 \
  --out output/resumed-carousel.json

# Generate source background images for an existing result
npm run images -- \
  --in output/<result>/carousel.json \
  --out output/<result>
```

Generation exits with code `0` when the package passes verification and code `2` when it does not.

## Output

Each run gets a unique `output/<topic>-<timestamp>/` directory:

- `carousel.json` — generated content, review result, fact-check result, and sources
- `card-N.png` — AI-generated source backgrounds
- `instagram-01.png` through `instagram-08.png` — final 1080×1350 cards
- `caption.txt` — caption and hashtags ready to copy
- `instagram-post.json` — image list, alt text, dimensions, and post metadata
- `sources.txt` — source URLs used during fact-checking

## Project structure

```text
src/
  config/              editable model and topic settings
  lib/                 API, validation, packaging, and runtime helpers
  prompts/             generation, review, and fact-check instructions
  studio/              browser UI, styles, and canvas compositor
  generate-carousel.mjs
  generate-images.mjs
  studio-server.mjs
tests/                  deterministic unit and HTTP integration tests
examples/               verified sample carousel JSON
output/                 local generated files; ignored by Git
```

## Checks

```bash
npm run check
```

The test suite does not call external APIs. It covers the 5–8 card contract, targeted revisions, fact-check failure handling, source extraction, image retries, path traversal protection, unique output directories, and the full Studio HTTP workflow.

## Security

- `.env` and generated outputs are ignored by Git.
- Never put API keys in source files, prompts, examples, screenshots, or issues.
- The server binds to `127.0.0.1` by default. It is a local tool, not a hardened multi-user service.

## 한국어 요약

주제 하나를 입력하면 5–8장 Instagram 캐러셀, 출처 검증, AI 이미지, 1080×1350 게시 PNG, 캡션·해시태그를 한 번에 만듭니다. `.env.example`을 `.env`로 복사하고 `OPENAI_API_KEY`만 설정한 뒤 `npm start`를 실행하면 됩니다.

## License

MIT
