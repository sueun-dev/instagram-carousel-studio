export const IMAGE_MOODS = {
  dark: "Cinematic editorial photograph, near-black background, warm amber rim light, deep shadows, moody, volumetric haze, subtle film grain, one clear subject, generous empty dark negative space on one side for text, portrait 4:5, no letters, no typography, no logos.",
  light:
    "Bright high-key studio photograph on a clean pure-white or very light background, evenly lit with soft flat light, no dark areas, minimal and crisp, one clear subject with bright empty space on one side for text, portrait 4:5, no letters, no typography, no logos.",
};

const DARK_TERMS =
  /\b(near-?black|pure black|jet black|black background|dark(?:er)? (?:background|space|scene|room|tones?|mood)|dark background|deep shadows?|moody|dramatic lighting|dim(?:ly)?|low-key|noir|shadowy|amber(?: rim| glow| light)?|warm rim light|volumetric haze|film grain|cinematic)\b/gi;

export function cardImagePrompt(card, styleSpec, mood) {
  const subject = card.imagePrompt || card.headline || "";
  if (mood === "light") {
    const cleaned = subject
      .replace(DARK_TERMS, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.])/g, "$1")
      .trim();
    return `${IMAGE_MOODS.light} Subject: ${cleaned}`.trim();
  }
  return `${styleSpec || IMAGE_MOODS.dark} ${subject}`.trim();
}
