let STATE = null;
let LAST = null; // last TEST result
let NICHES = {};

function esc(s) {
  return String(s ?? "").replace(
    /[&<>"]/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m],
  );
}
function fileUrl(path) {
  return "/file?path=" + encodeURIComponent(path);
}
function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

async function boot() {
  STATE = await (await fetch("/api/state")).json();
  document.getElementById("content").value = STATE.content;
  document.getElementById("verify").value = STATE.verify;
  document.getElementById("niches").value = STATE.niches;
  const tm = document.getElementById("s-textModel");
  tm.innerHTML = STATE.textModels
    .map(
      (m) =>
        `<option ${m === STATE.settings.textModel ? "selected" : ""}>${m}</option>`,
    )
    .join("");
  const ef = document.getElementById("s-effort");
  ef.innerHTML = STATE.efforts
    .map(
      (m) =>
        `<option ${m === STATE.settings.effort ? "selected" : ""}>${m}</option>`,
    )
    .join("");
  const md = document.getElementById("s-mood");
  md.innerHTML = (STATE.moods || ["dark", "light"])
    .map(
      (m) =>
        `<option ${m === (STATE.settings.imageMood || "dark") ? "selected" : ""}>${m}</option>`,
    )
    .join("");
  const tone = document.getElementById("s-tone");
  tone.innerHTML = (STATE.tones || [])
    .map(
      ({ id, label, description }) =>
        `<option value="${esc(id)}" ${id === (STATE.settings.tone || "casual") ? "selected" : ""}>${esc(label)} — ${esc(description)}</option>`,
    )
    .join("");
  document.getElementById("s-maxRevisions").value =
    STATE.settings.maxRevisions ?? 2;
  try {
    NICHES = JSON.parse(STATE.niches).niches || {};
  } catch {
    NICHES = {};
  }
  const pn = document.getElementById("p-niche");
  pn.innerHTML = Object.entries(NICHES)
    .map(([k, v]) => `<option value="${esc(k)}">${esc(v.label || k)}</option>`)
    .join("");
  pn.onchange = fillKeywords;
  fillKeywords();
  document.getElementById("p-keyword").onchange = (e) => {
    if (e.target.value)
      document.getElementById("p-topic").value = e.target.value;
  };
  loadLibrary();
}

function fillKeywords() {
  const k = NICHES[document.getElementById("p-niche").value];
  const list = (k && k.keywords) || [];
  document.getElementById("p-keyword").innerHTML =
    `<option value="">— 키워드 선택 —</option>` +
    list.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
}

function toast(id) {
  const el = document.getElementById("toast-" + id);
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1400);
}

async function save(target) {
  const content = document.getElementById(target).value;
  const r = await fetch("/api/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target, content }),
  });
  if (r.ok) toast(target);
  else alert("저장 실패: " + (await r.text()));
}

async function saveSettings() {
  const settings = {
    ...STATE.settings,
    textModel: document.getElementById("s-textModel").value,
    effort: document.getElementById("s-effort").value,
    tone: document.getElementById("s-tone").value,
    imageMood: document.getElementById("s-mood").value,
    maxRevisions: Number(document.getElementById("s-maxRevisions").value) || 2,
  };
  const r = await fetch("/api/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      target: "settings",
      content: JSON.stringify(settings),
    }),
  });
  if (r.ok) {
    STATE.settings = settings;
    toast("settings");
  } else alert("저장 실패");
}

document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => {
    document
      .querySelectorAll("nav button")
      .forEach((x) => x.classList.remove("active"));
    document
      .querySelectorAll(".tab")
      .forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    document.getElementById("tab-" + b.dataset.tab).classList.add("active");
    if (b.dataset.tab === "prod") loadLibrary();
  }),
);

document.getElementById("prodBtn").addEventListener("click", produce);
document.getElementById("genBtn").addEventListener("click", generate);
document.getElementById("imgBtn").addEventListener("click", genImages);
document
  .getElementById("save-content")
  .addEventListener("click", () => save("content"));
document
  .getElementById("save-verify")
  .addEventListener("click", () => save("verify"));
document
  .getElementById("save-niches")
  .addEventListener("click", () => save("niches"));
document
  .getElementById("save-settings")
  .addEventListener("click", saveSettings);

function renderResult(result, cardsId, verdictId) {
  const c = result.carousel,
    v = result.verdict,
    byN = {};
  (v?.cards || []).forEach((x) => (byN[x.n] = x));
  document.getElementById(cardsId).innerHTML = (c.cards || [])
    .map((card) => {
      const s = byN[card.n];
      const badges = s
        ? `<div class="badges"><span class="badge ${s.novelty >= 3 ? "g" : "r"}">novelty ${s.novelty}</span><span class="badge ${s.truth >= 4 ? "g" : "r"}">truth ${s.truth}</span><span class="badge ${s.human >= 3 ? "g" : "r"}">human ${s.human ?? "–"}</span></div>`
        : "";
      const srcs = (card.sources || [])
        .map(safeHttpUrl)
        .filter(Boolean)
        .slice(0, 3)
        .map(
          (u, i) =>
            `<a href="${esc(u)}" target="_blank" rel="noreferrer" style="color:var(--accent2)">출처${i + 1}</a>`,
        )
        .join(" ");
      const factBadge =
        card.factSupported === false
          ? `<span class="badge r">사실 미확인</span>`
          : card.sources && card.sources.length
            ? `<span class="badge g">웹 확인</span>`
            : "";
      return `<div class="cell"><div class="k">${esc(card.kicker || "· " + card.n)}</div><div class="h">${esc(card.headline || "")}</div><div class="b">${esc(card.body || "")}</div><div class="a">근거: ${esc(card.audit?.factBasis || "")} · ${esc(card.audit?.confidence || "")}</div><div class="badges">${factBadge}${badges ? badges.replace(/^<div class="badges">|<\/div>$/g, "") : ""} <span style="font-size:11px">${srcs}</span></div></div>`;
    })
    .join("");
  document.getElementById(verdictId).innerHTML = v
    ? `<div class="verdict">심사: <b>${esc(v.verdict)}</b> — ${esc(v.overall || "")}</div>`
    : `<div class="verdict">검증 스킵(생성만).</div>`;
}

function publishText(carousel) {
  const tags = (carousel.hashtags || [])
    .map((tag) => "#" + String(tag).replace(/^#+/, "").replace(/\s+/g, ""))
    .join(" ");
  return [carousel.caption || "", tags].filter(Boolean).join("\n\n");
}

function renderPackage(
  carousel,
  dir,
  targetId,
  imagesReady = false,
  packageReady = true,
) {
  const el = document.getElementById(targetId);
  if (!el || !carousel) return;
  if (!packageReady) {
    el.innerHTML = `<div class="publish-package"><h3>이전 형식 제작물</h3><p class="hint" style="margin:0">캡션·해시태그 패키지가 도입되기 전 결과입니다. 현재 형식으로 다시 생성하면 게시용 글과 1080×1350 PNG가 함께 저장됩니다.</p></div>`;
    return;
  }
  const links = [
    `<a href="${fileUrl(dir + "/caption.txt")}" download>캡션 TXT</a>`,
    `<a href="${fileUrl(dir + "/instagram-post.json")}" download>게시 계약 JSON</a>`,
    `<a href="${fileUrl(dir + "/sources.txt")}" download>출처 TXT</a>`,
  ];
  if (imagesReady) {
    for (const card of carousel.cards || []) {
      const filename = "instagram-" + String(card.n).padStart(2, "0") + ".png";
      links.push(
        `<a href="${fileUrl(dir + "/" + filename)}" download>${card.n}장 PNG</a>`,
      );
    }
  }
  el.innerHTML = `<div class="publish-package"><h3>Instagram 게시글</h3><pre class="publish-copy">${esc(publishText(carousel))}</pre><div class="downloads"><button class="ghost copy-publish" type="button">글 복사</button>${links.join("")}</div></div>`;
  el.querySelector(".copy-publish").addEventListener("click", async (event) => {
    await navigator.clipboard.writeText(publishText(carousel));
    event.currentTarget.textContent = "복사됨 ✓";
    setTimeout(() => {
      event.currentTarget.textContent = "글 복사";
    }, 1400);
  });
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
function darkerSide(canvas) {
  const t = document.createElement("canvas");
  t.width = 24;
  t.height = 30;
  const tc = t.getContext("2d");
  tc.drawImage(canvas, 0, 0, 24, 30);
  const d = tc.getImageData(0, 0, 24, 30).data;
  let L = 0,
    R = 0;
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 24; x++) {
      const i = (y * 24 + x) * 4,
        lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (x < 12) L += lum;
      else R += lum;
    }
  return L <= R ? "left" : "right";
}
function loadImg(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("img"));
    im.src = src;
  });
}
function canvasBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("PNG encoding failed")),
      "image/png",
    ),
  );
}

async function persistPublishImage(canvas, dir, cardNumber) {
  const response = await fetch(
    `/api/publish-image?dir=${encodeURIComponent(dir)}&card=${encodeURIComponent(cardNumber)}`,
    {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: await canvasBlob(canvas),
    },
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `card ${cardNumber} save failed`);
  }
}

async function composite(cards, files, imgsId, persistDir = "") {
  const wrapEl = document.getElementById(imgsId);
  wrapEl.innerHTML = "";
  const W = STATE?.publishImage?.width || 1080,
    H = STATE?.publishImage?.height || 1350;
  const mood = (STATE && STATE.settings && STATE.settings.imageMood) || "dark";
  const P =
    mood === "light"
      ? {
          g0: "rgba(250,248,244,0.16)",
          g1: "rgba(250,248,244,0.04)",
          g2: "rgba(247,245,240,0.5)",
          s0: "rgba(252,251,249,0.965)",
          s1: "rgba(252,251,249,0)",
          ink: "#191d25",
          accent: "#a85f2e",
          body: "rgba(38,42,50,0.95)",
        }
      : {
          g0: "rgba(4,5,8,0.4)",
          g1: "rgba(4,5,8,0.15)",
          g2: "rgba(3,4,7,0.9)",
          s0: "rgba(3,4,7,0.86)",
          s1: "rgba(3,4,7,0)",
          ink: "#f3efe6",
          accent: "#e7a35d",
          body: "rgba(238,232,223,0.9)",
        };
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d");
    let rendered = false;
    try {
      const img = await loadImg(files[i]);
      const s = Math.max(W / img.width, H / img.height),
        dw = img.width * s,
        dh = img.height * s;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      const imageDarkSide = darkerSide(cv);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, P.g0);
      g.addColorStop(0.5, P.g1);
      g.addColorStop(1, P.g2);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // dark mood: text over the darker side; light mood: over the lighter side (so the scrim + ink read well either way)
      const left =
        mood === "light" ? imageDarkSide !== "left" : imageDarkSide === "left";
      const scStop =
        mood === "light"
          ? left
            ? W * 0.66
            : W * 0.34
          : left
            ? W * 0.72
            : W * 0.28;
      const sc = ctx.createLinearGradient(left ? 0 : W, 0, scStop, 0);
      sc.addColorStop(0, P.s0);
      if (mood === "light") sc.addColorStop(0.7, P.s0);
      sc.addColorStop(1, P.s1);
      ctx.fillStyle = sc;
      ctx.fillRect(0, 0, W, H);
      const mx = Math.round(W * 0.09),
        tw = Math.round(W * 0.68),
        x = left ? mx : W - mx - tw;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      if (mood === "light") {
        ctx.shadowColor = "rgba(255,255,255,0.9)";
        ctx.shadowBlur = 12;
      }
      ctx.fillStyle = P.accent;
      ctx.font = "700 32px sans-serif";
      ctx.fillText(card.kicker || "· " + card.n, x, 72);
      let y = Math.round(H * 0.42);
      ctx.fillStyle = P.ink;
      ctx.font = "800 66px sans-serif";
      for (const line of wrap(ctx, card.headline || "", tw)) {
        ctx.fillText(line, x, y);
        y += 78;
      }
      y += 18;
      ctx.fillStyle = P.accent;
      ctx.fillRect(x, y, 108, 6);
      y += 36;
      ctx.fillStyle = P.body;
      ctx.font = "400 34px sans-serif";
      for (const line of wrap(ctx, card.body || "", tw)) {
        ctx.fillText(line, x, y);
        y += 50;
      }
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      rendered = true;
    } catch (_error) {
      ctx.fillStyle = "#333";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#e6737a";
      ctx.font = "32px sans-serif";
      ctx.fillText("이미지 없음", 48, 48);
    }
    wrapEl.appendChild(cv);
    if (persistDir && rendered)
      await persistPublishImage(cv, persistDir, card.n);
  }
}

async function generate() {
  const topic = document.getElementById("topic").value.trim();
  if (!topic) return alert("주제를 입력하세요");
  const verify = document.getElementById("doVerify").checked;
  const btn = document.getElementById("genBtn");
  btn.disabled = true;
  document.getElementById("cards").innerHTML = "";
  document.getElementById("verdict").innerHTML = "";
  document.getElementById("package").innerHTML = "";
  document.getElementById("imgBar").style.display = "none";
  document.getElementById("imgs").innerHTML = "";
  document.getElementById("genStatus").innerHTML =
    `<span class="spinner"></span> 생성 중… (${verify ? "검증 포함, 수 분" : "생성만, ~2분"})`;
  try {
    const r = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic, verify }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "실패");
    LAST = data;
    renderResult(data.result, "cards", "verdict");
    renderPackage(data.result.carousel, data.dir, "package");
    document.getElementById("genStatus").textContent =
      `완료 · passed=${data.result.passed} · attempts=${data.result.attempts}`;
    document.getElementById("imgBar").style.display = "flex";
  } catch (e) {
    document.getElementById("genStatus").textContent = "에러: " + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function genImages() {
  if (!LAST) return;
  const btn = document.getElementById("imgBtn");
  btn.disabled = true;
  document.getElementById("imgStatus").innerHTML =
    `<span class="spinner"></span> 이미지 생성 중… (${LAST.result.carousel.cards.length}장)`;
  try {
    const r = await fetch("/api/images", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dir: LAST.dir }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "실패");
    document.getElementById("imgStatus").textContent = "완료. 카드 합성 중…";
    await composite(LAST.result.carousel.cards, data.files, "imgs", LAST.dir);
    renderPackage(LAST.result.carousel, LAST.dir, "package", true);
    document.getElementById("imgStatus").textContent =
      "1080×1350 게시용 PNG 저장 완료";
  } catch (e) {
    document.getElementById("imgStatus").textContent = "에러: " + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function produce() {
  const topic = document.getElementById("p-topic").value.trim();
  if (!topic) return alert("주제를 선택하거나 입력하세요");
  const btn = document.getElementById("prodBtn");
  btn.disabled = true;
  document.getElementById("prodCards").innerHTML = "";
  document.getElementById("prodVerdict").innerHTML = "";
  document.getElementById("prodPackage").innerHTML = "";
  document.getElementById("prodImgs").innerHTML = "";
  document.getElementById("prodStatus").innerHTML =
    `<span class="spinner"></span> 콘텐츠 생성+검증 중… (수 분)`;
  try {
    const r = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic, verify: true }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "실패");
    renderResult(data.result, "prodCards", "prodVerdict");
    renderPackage(data.result.carousel, data.dir, "prodPackage");
    if (!data.result.passed) {
      document.getElementById("prodStatus").textContent =
        "검증 미통과 · 이미지 제작을 중단했습니다. 카드/캡션 피드백을 확인하세요.";
      return;
    }
    document.getElementById("prodStatus").innerHTML =
      `콘텐츠 완료(passed=${data.result.passed}) · <span class="spinner"></span> 이미지 생성 중… (gpt-image-2)`;
    const ri = await fetch("/api/images", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dir: data.dir }),
    });
    const idata = await ri.json();
    if (!ri.ok) throw new Error(idata.error || "이미지 실패");
    await composite(
      data.result.carousel.cards,
      idata.files,
      "prodImgs",
      data.dir,
    );
    renderPackage(data.result.carousel, data.dir, "prodPackage", true);
    document.getElementById("prodStatus").textContent =
      `제작 완료 · Instagram 게시 패키지 저장됨 (${data.dir})`;
    loadLibrary();
  } catch (e) {
    document.getElementById("prodStatus").textContent = "에러: " + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function loadLibrary() {
  try {
    const { items } = await (await fetch("/api/outputs")).json();
    const el = document.getElementById("library");
    if (!items.length) {
      el.classList.add("hint");
      el.textContent = "아직 제작물이 없습니다.";
      return;
    }
    el.classList.remove("hint");
    el.innerHTML = items
      .map(
        (it, index) =>
          `<button class="cell lib-item" type="button" data-index="${index}" style="margin-bottom:10px"><b>${esc(it.topic)}</b> <span class="hint">· ${it.cards}장 · ${it.hasPublishImages ? "게시 PNG 완료" : it.hasImages ? "배경 이미지 완료" : it.backgroundImageCount ? "배경 " + it.backgroundImageCount + "/" + it.cards : "이미지 없음"} · ${it.hasPostPackage ? "글 패키지 있음" : "글 패키지 없음"}</span></button>`,
      )
      .join("");
    el.querySelectorAll(".lib-item").forEach((button) =>
      button.addEventListener("click", () =>
        openSaved(items[Number(button.dataset.index)]),
      ),
    );
  } catch (_error) {
    document.getElementById("library").textContent = "목록 로드 실패";
  }
}

async function openSaved(item) {
  const dir = item.dir;
  document.getElementById("prodStatus").innerHTML =
    `<span class="spinner"></span> 불러오는 중…`;
  try {
    const result = await (
      await fetch("/file?path=" + encodeURIComponent(dir + "/carousel.json"))
    ).json();
    renderResult(result, "prodCards", "prodVerdict");
    const cards = result.carousel.cards;
    if (item.hasPublishImages) {
      document.getElementById("prodImgs").innerHTML = cards
        .map(
          (card) =>
            `<img src="${fileUrl(dir + "/instagram-" + String(card.n).padStart(2, "0") + ".png")}" alt="${esc(card.headline || "Instagram card")}" />`,
        )
        .join("");
    } else if (item.hasImages) {
      const files = cards.map((c) => fileUrl(dir + "/card-" + c.n + ".png"));
      await composite(cards, files, "prodImgs", dir);
      item.hasPublishImages = true;
    } else {
      document.getElementById("prodImgs").innerHTML = "";
    }
    renderPackage(
      result.carousel,
      dir,
      "prodPackage",
      item.hasPublishImages,
      item.hasPostPackage,
    );
    document.getElementById("prodStatus").textContent = `불러옴: ${dir}`;
  } catch (e) {
    document.getElementById("prodStatus").textContent =
      "불러오기 실패: " + e.message;
  }
}

boot();
