/* Tia's Roadmap — Rehearsal Stage
 * 4레인 리듬 게임. 각 무대(학년)를 클리어하면 그 해의 기록이 열린다.
 * 음원 파일 없이 Web Audio로 메트로놈 비트를 직접 만든다.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const LANES = 4;
  const KEYMAP = {
    ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3,
    KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3,
  };
  const ROTATION = [-Math.PI / 2, Math.PI, 0, Math.PI / 2]; // ← ↓ ↑ →
  const WINDOW = { perfect: 0.07, good: 0.14, miss: 0.18 };
  const CLEAR_ACCURACY = 0.6;
  const BEATS = 32;
  const LEAD_IN = 4;
  // 무대가 진행될수록 촘촘해진다: [박자당 스텝 수, 노트 확률, 동시치기 확률]
  const DIFFICULTY = [[1, 0.6, 0], [1, 0.85, 0], [2, 0.5, 0.05], [2, 0.55, 0.05]];

  const C = { paper: "#fbf8f2", ink: "#2b2a27", line: "#e2dccf", matcha: "#7f9c7a", pink: "#d6a2a0", muted: "#8a857b" };

  const state = {
    portfolio: null,
    cleared: new Set(),
    best: {},          // stageIndex -> best score
    current: null,     // 진행 중인 무대
  };

  // ------------------------------------------------------------ storage (선택적 편의 기능)
  function loadProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem("tia-progress") || "{}");
      (saved.cleared || []).forEach((i) => state.cleared.add(i));
      state.best = saved.best || {};
    } catch (_) { /* 저장소를 못 써도 게임은 동작 */ }
  }
  function saveProgress() {
    try {
      localStorage.setItem("tia-progress", JSON.stringify({ cleared: [...state.cleared], best: state.best }));
    } catch (_) { /* ignore */ }
  }
  const totalScore = () => Object.values(state.best).reduce((a, b) => a + b, 0);

  // ------------------------------------------------------------ screens
  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    window.scrollTo({ top: 0 });
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // d0부터 step 간격으로 한 줄씩 떠오르게 하는 data-reveal 속성
  const rv = (ms) => `data-reveal style="--d:${ms}ms"`;

  // metric은 있는 항목에만 붙인다
  const metricHTML = (it) => (it.metric ? `<em class="metric">${esc(it.metric)}</em>` : "");

  // 커튼콜 프로그램북 목록: 태그 | 제목·설명 | 수치
  function itemsHTML(stage, d0) {
    return stage.items.map((it, k) =>
      `<li ${rv(d0 + k * 70)}><span class="tag ${esc(it.tag)}">${esc(it.tag)}</span>
        <span>${it.title ? `<b>${esc(it.title)}</b>` : ""}${esc(it.text)}</span>${metricHTML(it)}</li>`).join("");
  }

  // 클리어 화면: 항목마다 칩 카드 한 장
  function chipsHTML(stage, d0) {
    return stage.items.map((it, k) =>
      `<li class="chip" ${rv(d0 + k * 60)}><span class="tag ${esc(it.tag)}">${esc(it.tag)}</span>
        ${it.title ? `<strong>${esc(it.title)}</strong>` : ""}<span class="chip-text">${esc(it.text)}</span>${metricHTML(it)}</li>`).join("");
  }

  function chapterHTML(stage, d0 = 0) {
    const hl = stage.highlight
      ? `<div class="hl"><span class="hl-value">${esc(stage.highlight.value)}</span><span class="hl-label">${esc(stage.highlight.label)}</span></div>`
      : "";
    return `<div class="ch-head" ${rv(d0)}><h3>${esc(stage.year)} · ${esc(stage.title)}</h3><span class="muted">${esc(stage.grade)}</span></div>
      <div class="ch-hl" ${rv(d0 + 80)}>${hl}<p>${esc(stage.summary)}</p></div>
      <ul class="chips">${chipsHTML(stage, d0 + 180)}</ul>`;
  }

  // 커튼콜 프로그램북의 한 페이지: 왼쪽에 연도·하이라이트, 오른쪽에 그 해의 기록
  function programHTML(stage, d0) {
    const hl = stage.highlight
      ? `<span class="p-hl">${esc(stage.highlight.value)}<small>${esc(stage.highlight.label)}</small></span>` : "";
    return `<article class="program">
      <div ${rv(d0)}><span class="p-year">${esc(stage.year)}</span><span class="p-grade">${esc(stage.grade)}</span>${hl}</div>
      <div><h4 ${rv(d0 + 60)}>${esc(stage.title)}<small>${esc(stage.subtitle)}</small></h4>
        <p ${rv(d0 + 120)}>${esc(stage.summary)}</p><ul class="items">${itemsHTML(stage, d0 + 180)}</ul></div>
    </article>`;
  }

  function renderSetlist() {
    if (!state.portfolio) return;
    const list = $("setlist");
    list.innerHTML = "";
    const row = (i, cls, no, body, bpm, stateHTML, disabled, onClick) => {
      // 등장 효과(transform)는 li가, 호버 효과는 button이 맡아 서로 덮어쓰지 않게 한다
      const li = document.createElement("li");
      li.dataset.reveal = "";
      li.style.setProperty("--d", `${260 + i * 80}ms`);
      li.innerHTML = `<button type="button" class="set-row ${cls}" ${disabled ? "disabled" : ""}>
          <span class="set-no">${no}</span><span class="set-body">${body}</span>${bpm}
          <span class="set-state">${stateHTML}</span></button>`;
      li.querySelector("button").addEventListener("click", onClick);
      list.appendChild(li);
    };
    state.portfolio.stages.forEach((st, i) => {
      const unlocked = i === 0 || state.cleared.has(i - 1);
      const cleared = state.cleared.has(i);
      row(i, "", String(i + 1).padStart(2, "0"),
        `<span class="set-year">${st.year} · ${esc(st.grade)}</span><span class="set-title">${esc(st.title)}<small>${esc(st.subtitle)}</small></span>`,
        `<span class="set-bpm"><i style="--beat:${60 / st.bpm}s"></i>${st.bpm} BPM</span>`,
        cleared ? `<em class="stamp">Clear</em><b>${(state.best[i] || 0).toLocaleString()}</b>`
          : unlocked ? `Play <span class="arr">→</span>` : "Locked",
        !unlocked, () => startStage(i));
    });
    if (state.cleared.size === state.portfolio.stages.length) {
      row(state.portfolio.stages.length, "encore", "∞",
        `<span class="set-year">All stages cleared</span><span class="set-title">커튼콜<small>Curtain Call</small></span>`,
        "<span></span>", `Open <span class="arr">→</span>`, false, openCurtain);
    }
    show("select");
  }

  // ------------------------------------------------------------ audio
  let audio = null;
  function ensureAudio() {
    if (audio) return audio;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audio = new Ctx();
    return audio;
  }
  const now = () => (audio ? audio.currentTime : performance.now() / 1000);

  function click(time, freq, gain = 0.15, dur = 0.05, type = "sine") {
    if (!audio) return;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), time + dur);
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    o.connect(g).connect(audio.destination);
    o.start(time);
    o.stop(time + dur + 0.02);
  }

  function scheduleBeat(start, beatDur) {
    for (let b = -LEAD_IN; b < BEATS; b++) {
      const t = start + b * beatDur;
      if (b < 0) { click(t, 880, 0.12, 0.06); continue; }        // 카운트인
      click(t, b % 4 === 0 ? 120 : 95, 0.35, 0.12);               // 킥
      click(t + beatDur / 2, 3200, 0.03, 0.02, "square");          // 하이햇
      if (b % 4 === 2) click(t, 220, 0.12, 0.08, "triangle");      // 스네어 느낌
    }
  }

  // ------------------------------------------------------------ chart
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function buildChart(index, stage, start) {
    const [perBeat, prob, chordProb] = DIFFICULTY[index] || DIFFICULTY[DIFFICULTY.length - 1];
    const rand = rng(stage.year * 31 + index);
    const step = 60 / stage.bpm / perBeat;
    const notes = [];
    let last = -1;
    for (let i = 0; i < BEATS * perBeat; i++) {
      const onBeat = i % perBeat === 0;
      if (rand() > (onBeat ? prob : prob * 0.7)) continue;
      let lane = Math.floor(rand() * LANES);
      if (lane === last && rand() < 0.6) lane = (lane + 1 + Math.floor(rand() * 3)) % LANES;
      last = lane;
      const t = start + i * step;
      notes.push({ t, lane, judged: false });
      if (onBeat && rand() < chordProb) notes.push({ t, lane: (lane + 2) % LANES, judged: false });
    }
    return notes;
  }

  // ------------------------------------------------------------ gameplay
  const canvas = $("canvas");
  const ctx2d = canvas.getContext("2d");
  const W = 360, H = 520, LANE_W = W / LANES, JUDGE_Y = H - 72, SPEED = 380;
  (function setupCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  })();

  function startStage(index) {
    ensureAudio();
    if (audio && audio.state === "suspended") audio.resume();
    const stage = state.portfolio.stages[index];
    const beatDur = 60 / stage.bpm;
    const start = now() + 0.6 + LEAD_IN * beatDur;
    scheduleBeat(start, beatDur);
    state.current = {
      index, stage, start, beatDur,
      notes: buildChart(index, stage, start),
      end: start + BEATS * beatDur + 0.8,
      score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0,
      flash: { text: "", t: 0 }, laneFlash: [0, 0, 0, 0], running: true,
    };
    $("hudStage").textContent = `Stage ${index + 1} · ${stage.grade}`;
    $("hudTitle").textContent = `${stage.year} ${stage.title}`;
    updateHud();
    show("play");
    requestAnimationFrame(loop);
  }

  function judge(note, dt) {
    const g = state.current;
    note.judged = true;
    const a = Math.abs(dt);
    if (a <= WINDOW.perfect) { g.perfect++; g.combo++; g.score += 300; flash("PERFECT"); }
    else if (a <= WINDOW.good) { g.good++; g.combo++; g.score += 120; flash("GOOD"); }
    else { g.miss++; g.combo = 0; flash("MISS"); return; }
    g.score += Math.floor(g.combo / 10) * 20;
    g.maxCombo = Math.max(g.maxCombo, g.combo);
    click(now(), 1400, 0.05, 0.03, "triangle");
  }

  function flash(text) { state.current.flash = { text, t: now() }; updateHud(); }

  function press(lane) {
    const g = state.current;
    if (!g || !g.running) return;
    g.laneFlash[lane] = now();
    const t = now();
    let target = null;
    for (const n of g.notes) {
      if (n.judged || n.lane !== lane) continue;
      const dt = t - n.t;
      if (Math.abs(dt) <= WINDOW.miss && (!target || Math.abs(dt) < Math.abs(t - target.t))) target = n;
    }
    if (target) judge(target, t - target.t);
  }

  function updateHud() {
    const g = state.current;
    if (!g) return;
    $("hudScore").textContent = g.score.toLocaleString();
    $("hudCombo").textContent = g.combo > 1 ? `${g.combo} combo` : "";
  }

  function drawArrow(x, y, lane, fill, stroke, size = 26) {
    ctx2d.save();
    ctx2d.translate(x, y);
    ctx2d.rotate(ROTATION[lane]);
    ctx2d.beginPath();
    ctx2d.moveTo(0, -size);
    ctx2d.lineTo(size, 2);
    ctx2d.lineTo(size * 0.42, 2);
    ctx2d.lineTo(size * 0.42, size);
    ctx2d.lineTo(-size * 0.42, size);
    ctx2d.lineTo(-size * 0.42, 2);
    ctx2d.lineTo(-size, 2);
    ctx2d.closePath();
    if (fill) { ctx2d.fillStyle = fill; ctx2d.fill(); }
    if (stroke) { ctx2d.lineWidth = 2; ctx2d.strokeStyle = stroke; ctx2d.stroke(); }
    ctx2d.restore();
  }

  function loop() {
    const g = state.current;
    if (!g || !g.running) return;
    const t = now();

    for (const n of g.notes) {
      if (!n.judged && t - n.t > WINDOW.miss) { n.judged = true; g.miss++; g.combo = 0; flash("MISS"); }
    }

    ctx2d.clearRect(0, 0, W, H);
    ctx2d.fillStyle = C.paper; ctx2d.fillRect(0, 0, W, H);
    for (let l = 0; l < LANES; l++) {
      const x = l * LANE_W;
      if (t - g.laneFlash[l] < 0.12) { ctx2d.fillStyle = "rgba(127,156,122,0.12)"; ctx2d.fillRect(x, 0, LANE_W, H); }
      if (l > 0) { ctx2d.fillStyle = C.line; ctx2d.fillRect(x, 0, 1, H); }
      drawArrow(x + LANE_W / 2, JUDGE_Y, l, null, t - g.laneFlash[l] < 0.12 ? C.matcha : C.muted);
    }
    ctx2d.fillStyle = C.ink; ctx2d.fillRect(12, JUDGE_Y + 34, W - 24, 1);

    for (const n of g.notes) {
      if (n.judged) continue;
      const y = JUDGE_Y - (n.t - t) * SPEED;
      if (y < -40 || y > H + 40) continue;
      drawArrow(n.lane * LANE_W + LANE_W / 2, y, n.lane, n.lane % 3 === 0 ? C.pink : C.matcha);
    }

    // 박자 표시 (판정선 아래 점)
    const beat = Math.floor((t - g.start) / g.beatDur);
    if (beat >= 0 && beat < BEATS) {
      for (let i = 0; i < 4; i++) {
        ctx2d.fillStyle = i === ((beat % 4) + 4) % 4 ? C.ink : C.line;
        ctx2d.beginPath(); ctx2d.arc(W / 2 - 27 + i * 18, H - 18, 4, 0, Math.PI * 2); ctx2d.fill();
      }
    }

    const age = t - g.flash.t;
    if (g.flash.text && age < 0.45) {
      ctx2d.globalAlpha = 1 - age / 0.45;
      ctx2d.fillStyle = g.flash.text === "MISS" ? C.pink : C.matcha;
      ctx2d.font = "700 22px Pretendard, sans-serif";
      ctx2d.textAlign = "center";
      ctx2d.fillText(g.flash.text, W / 2, H * 0.42);
      ctx2d.globalAlpha = 1;
    }

    const lead = g.start - t;
    $("countdown").textContent = lead > 0 ? Math.ceil(lead / g.beatDur) : "";

    if (t >= g.end) return finishStage();
    requestAnimationFrame(loop);
  }

  function finishStage() {
    const g = state.current;
    g.running = false;
    const total = g.notes.length || 1;
    const acc = (g.perfect + g.good * 0.6) / total;
    const clear = acc >= CLEAR_ACCURACY;
    const i = g.index;
    const isLast = i === state.portfolio.stages.length - 1;

    if (clear) {
      state.cleared.add(i);
      state.best[i] = Math.max(state.best[i] || 0, g.score);
      saveProgress();
    }

    $("resultCard").classList.toggle("is-clear", clear);
    $("resultEyebrow").textContent = clear ? `Stage ${i + 1} · ${g.stage.grade} · Clear` : `Stage ${i + 1} · Retry`;
    $("resultTitle").textContent = clear ? `${g.stage.year}, ${g.stage.title}` : "박자를 조금 놓쳤어요";
    const stats = [
      ["Accuracy", acc * 100, (v) => `${v.toFixed(1)}%`],
      ["Score", g.score, (v) => Math.round(v).toLocaleString()],
      ["Max Combo", g.maxCombo, (v) => Math.round(v)],
      ["Perfect", g.perfect, (v) => Math.round(v)],
      ["Good", g.good, (v) => Math.round(v)],
      ["Miss", g.miss, (v) => Math.round(v)],
    ];
    $("resultStats").innerHTML = stats.map(([k]) => `<div><dt>${k}</dt><dd></dd></div>`).join("");
    $("resultStats").querySelectorAll("dd").forEach((dd, k) => countUp(dd, stats[k][1], stats[k][2]));
    $("chapter").innerHTML = clear ? chapterHTML(g.stage, 600) : "";

    const actions = $("resultActions");
    actions.innerHTML = "";
    const btn = (label, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = cls; b.textContent = label; b.addEventListener("click", fn);
      actions.appendChild(b);
    };
    if (clear) {
      if (isLast) btn("커튼콜로 가기", "primary", openCurtain);
      else btn("다음 무대", "primary", () => startStage(i + 1));
      btn("셋리스트", "ghost", renderSetlist);
    } else {
      btn("다시 도전하기", "primary", () => startStage(i));
      btn("이 해의 기록만 보기", "ghost", () => { $("chapter").innerHTML = chapterHTML(g.stage); });
      btn("셋리스트", "ghost", renderSetlist);
    }
    show("result");
  }

  // ------------------------------------------------------------ curtain call (DB tier)
  async function api(path, body) {
    const res = await fetch(path, body ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    } : undefined);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function dbError(e) { $("dbNote").textContent = `데이터베이스에 연결하지 못했어요 (${e.message}). 잠시 후 다시 시도해주세요.`; }

  async function refreshBoard() {
    try {
      const [{ scores }, { cheers }] = await Promise.all([api("/api/scores"), api("/api/cheers")]);
      // 서버가 저장 전에 HTML 이스케이프하므로 그대로 출력해도 안전하다.
      $("ranking").innerHTML = scores.length
        ? scores.map((s) => `<li>${s.name}<span>${s.score.toLocaleString()}</span></li>`).join("")
        : `<li class="muted">아직 기록이 없어요. 첫 번째 관객이 되어주세요.</li>`;
      $("cheers").innerHTML = cheers.length
        ? cheers.map((c) => `<li><b>${c.name}</b>${c.message}<time>${new Date(c.at * 1000).toLocaleString("ko-KR")}</time></li>`).join("")
        : `<li class="muted">첫 응원을 남겨주세요.</li>`;
      $("dbNote").textContent = "";
    } catch (e) { dbError(e); }
  }

  function openCurtain() {
    const p = state.portfolio;
    if (!p) return;
    curtainTransition(() => {
      $("ownerHeadline").textContent = p.headline;
      $("ownerAbout").textContent = p.about;
      $("ownerLinks").innerHTML = (p.links || [])
        .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("");
      $("ownerFacts").innerHTML = (p.facts || [])
        .map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join("");
      $("timeline").innerHTML = p.stages.map((s, k) => programHTML(s, 1250 + k * 120)).join("");
      $("roadmap").innerHTML = (p.roadmap || [])
        .map((r) => `<li><span class="r-year">${esc(r.year)}</span><h4>${esc(r.title)}</h4><p>${esc(r.text)}</p></li>`).join("");
      const total = totalScore();
      $("myScore").textContent = total > 0
        ? `내 총점 ${total.toLocaleString()}점 (클리어한 무대 ${state.cleared.size}/${p.stages.length})`
        : "무대를 하나 이상 클리어하면 점수를 남길 수 있어요.";
      $("scoreForm").querySelector("button").disabled = total === 0;
      show("curtain");
      refreshBoard();
    });
  }

  // 막이 닫히고 → 그 사이 화면을 바꾸고 → 막이 양옆으로 걷힌다
  let curtainBusy = false;
  function curtainTransition(swap) {
    if (!MOTION) return swap();
    if (curtainBusy) return;
    curtainBusy = true;
    const box = $("curtains"), [L, R] = box.querySelectorAll("div"), label = box.querySelector(".c-label");
    box.classList.add("on");
    const close = { duration: 650, easing: "cubic-bezier(.6, 0, .3, 1)", fill: "forwards" };
    const open = { duration: 1500, easing: "cubic-bezier(.7, 0, .2, 1)", fill: "forwards" };
    const side = (dir) => [
      { transform: "none" },
      { transform: `translateX(${dir * 10}%) scaleX(.94)`, offset: 0.25 },
      { transform: `translateX(${dir * 101}%) scaleX(.6)` },
    ];
    Promise.all([
      L.animate([{ transform: "translateX(-101%)" }, { transform: "none" }], close).finished,
      R.animate([{ transform: "translateX(101%)" }, { transform: "none" }], close).finished,
      label.animate([{ opacity: 0 }, { opacity: 1 }], { ...close, delay: 250 }).finished,
    ])
      .then(() => { swap(); return new Promise((r) => setTimeout(r, 350)); })
      .then(() => {
        label.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
        return Promise.all([L.animate(side(-1), open).finished, R.animate(side(1), open).finished]);
      })
      .finally(() => {
        box.classList.remove("on");
        L.getAnimations().concat(R.getAnimations(), label.getAnimations()).forEach((a) => a.cancel());
        curtainBusy = false;
      });
  }

  // 결과 숫자가 0부터 차오른다
  function countUp(el, to, fmt) {
    if (!MOTION) { el.textContent = fmt(to); return; }
    const t0 = performance.now() + 350, D = 900;
    const step = (t) => {
      const k = Math.min(1, Math.max(0, (t - t0) / D));
      el.textContent = fmt(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = fmt(0);
    requestAnimationFrame(step);
  }

  $("scoreForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/scores", { name: $("scoreName").value, score: totalScore() });
      $("myScore").textContent = `${r.rank}위로 기록됐어요.`;
      refreshBoard();
    } catch (err) { dbError(err); }
  });

  $("cheerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/cheers", { name: $("cheerName").value, message: $("cheerMsg").value });
      $("cheerMsg").value = "";
      refreshBoard();
    } catch (err) { dbError(err); }
  });

  // ------------------------------------------------------------ input
  document.addEventListener("keydown", (e) => {
    if (!state.current || !state.current.running) return;
    if (e.code === "Escape") { state.current.running = false; renderSetlist(); return; }
    const lane = KEYMAP[e.code];
    if (lane === undefined || e.repeat) return;
    e.preventDefault();
    press(lane);
  });
  document.querySelectorAll("#pads button").forEach((b) => {
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      press(Number(b.dataset.lane));
      b.classList.add("hit");
      setTimeout(() => b.classList.remove("hit"), 100);
    });
  });

  // ------------------------------------------------------------ intro ticket
  const MOTION = document.documentElement.classList.contains("motion");
  const FINE = matchMedia("(pointer: fine)").matches;
  const ticket = $("ticket");

  // 셋리스트 줄은 HTML에 미리 있고 글자만 바꿔서, 등장 애니메이션이 다시 시작되지 않게 한다
  function renderTicket(p) {
    document.querySelectorAll("#ticketSetlist li").forEach((li, i) => {
      const st = p.stages[i];
      if (!st) return;
      li.querySelector(".y").textContent = st.year;
      li.querySelector(".ti").innerHTML = `${esc(st.title)}<small>${esc(st.subtitle)}</small>`;
      li.querySelector(".bpm b").textContent = st.bpm;
      li.querySelector(".bpm i").style.setProperty("--beat", `${60 / st.bpm}s`);
    });
  }

  // 마우스를 따라 티켓이 살짝 기울고 빛 반사가 따라온다
  if (MOTION && FINE) {
    const clamp = (v) => Math.min(1, Math.max(0, v));
    $("intro").addEventListener("pointermove", (e) => {
      const r = ticket.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width), y = clamp((e.clientY - r.top) / r.height);
      ticket.classList.add("tilting");
      ticket.style.setProperty("--ry", `${(x - 0.5) * 8}deg`);
      ticket.style.setProperty("--rx", `${(0.5 - y) * 8}deg`);
      ticket.style.setProperty("--mx", `${e.clientX - r.left}px`);
      ticket.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
    $("intro").addEventListener("pointerleave", () => {
      ticket.classList.remove("tilting");
      ticket.style.setProperty("--rx", "0deg");
      ticket.style.setProperty("--ry", "0deg");
    });
  }

  // 입장: 꼬리표가 찢겨 나간 뒤 셋리스트로
  $("startBtn").addEventListener("click", (e) => {
    ensureAudio();
    if (!MOTION || !state.portfolio) return renderSetlist();
    e.currentTarget.disabled = true;
    ticket.classList.remove("tilting");
    ticket.classList.add("torn");
    setTimeout(renderSetlist, 700);
  });

  // ------------------------------------------------------------ cursor trail
  // 마우스가 지나간 길을 짧게 남긴다 (말차 → 핑크). 꼬리가 다 사라지면 그리기를 멈춘다
  (() => {
    const cv = $("trail");
    const cx = cv.getContext("2d");
    if (!MOTION || !FINE || !cx) return;
    const LIFE = 350, HEAD = [127, 156, 122], TAIL = [214, 162, 160];
    const mix = (a, b, f) => a + (b - a) * f;
    let pts = [], frame = 0;

    function resize() {
      const d = window.devicePixelRatio || 1;
      cv.width = innerWidth * d; cv.height = innerHeight * d;
      cx.setTransform(d, 0, 0, d, 0, 0);
    }
    function draw() {
      const t = performance.now();
      pts = pts.filter((p) => t - p.t < LIFE);
      cx.clearRect(0, 0, innerWidth, innerHeight);
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], b = pts[i], c = pts[i + 1];
        const f = Math.min(1, (t - b.t) / LIFE);
        const [r, g, bl] = HEAD.map((h, k) => Math.round(mix(h, TAIL[k], f)));
        cx.strokeStyle = `rgba(${r}, ${g}, ${bl}, ${1 - f})`;
        cx.lineWidth = mix(3, 0.5, f);
        cx.beginPath();
        cx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
        cx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
        cx.stroke();
      }
      frame = pts.length ? requestAnimationFrame(draw) : 0;
    }

    resize();
    addEventListener("resize", resize);
    addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of evs.length ? evs : [e]) pts.push({ x: ev.clientX, y: ev.clientY, t: performance.now() });
      if (!frame) frame = requestAnimationFrame(draw);
    });
  })();

  $("skipBtn").addEventListener("click", () => {
    if (state.current) state.current.running = false;
    openCurtain();
  });
  $("replayBtn").addEventListener("click", renderSetlist);

  // ------------------------------------------------------------ boot
  loadProgress();
  fetch("/api/portfolio")
    .then((r) => r.json())
    .then((p) => {
      state.portfolio = p;
      renderTicket(p);
    })
    .catch(() => { $("introNote").textContent = "포트폴리오 데이터를 불러오지 못했어요. 잠시 후 새로고침해주세요."; });
  fetch("/api/info").then((r) => r.json())
    .then((i) => { $("podInfo").textContent = `served by pod ${i.pod} · OpenShift Developer Sandbox`; })
    .catch(() => {});
})();
