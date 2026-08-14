export const CAROUSEL_LIMITS = Object.freeze({ min: 5, max: 8 });
export const INSTAGRAM_IMAGE = Object.freeze({
  width: 1080,
  height: 1350,
  aspectRatio: "4:5",
});

function text(value) {
  return String(value || "").trim();
}

export function normalizeHashtags(values) {
  const items = Array.isArray(values)
    ? values
    : String(values || "").split(/[\s,]+/);
  const seen = new Set();
  const normalized = [];
  for (const value of items) {
    const tag = text(value)
      .replace(/^#+/, "")
      .replace(/[\s#]+/g, "");
    if (!tag) continue;
    const key = tag.toLocaleLowerCase("ko-KR");
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
  }
  return normalized;
}

export function validateCard(card, position = 1) {
  const errors = [];
  const where = `card ${position}`;
  if (!card || typeof card !== "object") return [`${where}: not an object`];
  if (!Number.isInteger(Number(card.n)) || Number(card.n) !== position)
    errors.push(`${where}: n must equal ${position}`);
  if (text(card.headline).length < 4)
    errors.push(`${where}: missing/short headline`);
  if (text(card.body).length < 20)
    errors.push(`${where}: body too thin (needs real content)`);
  if (text(card.imagePrompt).length < 10)
    errors.push(`${where}: missing imagePrompt`);
  if (text(card.audit?.confidence).toLowerCase() === "low")
    errors.push(`${where}: low-confidence claim must be removed`);
  return errors;
}

export function validateCarousel(carousel) {
  const errors = [];
  if (!carousel || typeof carousel !== "object") return ["not an object"];
  if (!Array.isArray(carousel.cards)) {
    errors.push("cards is not an array");
  } else {
    if (
      carousel.cards.length < CAROUSEL_LIMITS.min ||
      carousel.cards.length > CAROUSEL_LIMITS.max
    ) {
      errors.push(
        `card count ${carousel.cards.length} out of range (${CAROUSEL_LIMITS.min}-${CAROUSEL_LIMITS.max})`,
      );
    }
    carousel.cards.forEach((card, index) =>
      errors.push(...validateCard(card, index + 1)),
    );
  }
  if (!text(carousel.hook)) errors.push("missing hook");
  if (!text(carousel.cta)) errors.push("missing cta");
  if (!text(carousel.styleSpec)) errors.push("missing styleSpec");
  if (text(carousel.caption).length < 30)
    errors.push("missing/short Instagram caption");
  const hashtags = normalizeHashtags(carousel.hashtags);
  if (hashtags.length < 3 || hashtags.length > 12)
    errors.push("hashtags must contain 3-12 unique tags");
  return errors;
}
