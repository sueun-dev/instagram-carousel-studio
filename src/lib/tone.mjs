export const DEFAULT_TONE = "casual";

export const TONES = Object.freeze([
  Object.freeze({
    id: "casual",
    label: "친근한 반말",
    description: "친구에게 알려주듯 편하고 자연스럽게",
    instruction:
      "친근한 반말과 평어를 사용한다. 짧게 끊고 직접 말하되, 억지 유행어·과한 밈·무례한 표현은 쓰지 않는다.",
  }),
  Object.freeze({
    id: "polite",
    label: "친근한 존댓말",
    description: "부드럽고 신뢰감 있는 대화체",
    instruction:
      "친근한 존댓말을 사용한다. 독자에게 부드럽게 설명하되, 고객센터 문구나 딱딱한 안내문처럼 쓰지 않는다.",
  }),
  Object.freeze({
    id: "expert",
    label: "차분한 전문가",
    description: "정확하고 절제된 전문가 대화체",
    instruction:
      "짧고 단정한 존댓말로 쓴다. 정확한 어휘와 차분한 확신을 유지하되, 논문체·보도체·권위적인 훈계조는 피한다.",
  }),
  Object.freeze({
    id: "punchy",
    label: "짧고 강한 직설",
    description: "군더더기 없이 빠르고 선명하게",
    instruction:
      "짧고 강한 반말과 평어를 사용한다. 첫 문장부터 결론을 선명하게 말하되, 선정적 낚시·과장·공격적인 표현은 쓰지 않는다.",
  }),
  Object.freeze({
    id: "storyteller",
    label: "몰입형 스토리텔링",
    description: "장면과 흐름이 살아 있는 이야기체",
    instruction:
      "독자가 장면을 따라가듯 자연스러운 존댓말로 쓴다. 구체적인 상황, 변화, 깨달음을 연결하되 허구의 경험·인물·감정은 만들어내지 않는다.",
  }),
  Object.freeze({
    id: "witty",
    label: "가벼운 위트",
    description: "재치 있지만 가볍지 않은 대화체",
    instruction:
      "센스 있는 반말과 평어를 사용한다. 짧은 비유나 예상 밖의 표현으로 재미를 더하되, 억지 밈·비꼼·아재개그·정보를 가리는 농담은 쓰지 않는다.",
  }),
  Object.freeze({
    id: "teacher",
    label: "친절한 설명형",
    description: "처음 보는 사람도 이해하기 쉽게",
    instruction:
      "쉬운 존댓말로 차근차근 설명한다. 어려운 개념은 일상적인 예시와 짧은 정의로 풀되, 독자를 어린아이처럼 대하거나 같은 말을 반복하지 않는다.",
  }),
  Object.freeze({
    id: "analytical",
    label: "논리적인 분석형",
    description: "원인·근거·결론이 선명한 문체",
    instruction:
      "단정하고 중립적인 존댓말로 쓴다. 원인, 근거, 결과의 연결을 분명히 하되 보고서체·과도한 전문용어·근거 없는 단정은 피한다.",
  }),
]);

export function getTone(id = DEFAULT_TONE) {
  const tone = TONES.find((candidate) => candidate.id === id);
  if (!tone) {
    throw new Error(
      `unknown tone '${id}'. available: ${TONES.map((candidate) => candidate.id).join(", ")}`,
    );
  }
  return tone;
}

export function normalizeTone(id) {
  return TONES.some((tone) => tone.id === id) ? id : DEFAULT_TONE;
}

export function toneInstruction(id = DEFAULT_TONE) {
  const tone = getTone(id);
  return [
    "## 이번 생성에서 선택된 글 말투",
    `- 프리셋: ${tone.label} (${tone.id})`,
    `- 지침: ${tone.instruction}`,
    "- headline, body, cta, caption에 같은 말투를 일관되게 적용한다.",
    "- 말투가 달라도 새로움·사실성·간결함 기준은 절대 낮추지 않는다.",
  ].join("\n");
}

export function withToneInstruction(systemPrompt, id = DEFAULT_TONE) {
  return `${String(systemPrompt).trim()}\n\n${toneInstruction(id)}\n`;
}
