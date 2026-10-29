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

  function chapterHTML(stage) {
    const items = stage.items.map((it) =>
      `<li><span class="tag ${esc(it.tag)}">${esc(it.tag)}</span><span>${esc(it.text)}</span></li>`).join("");
    return `<div class="ch-head"><h3>${esc(stage.year)} · ${esc(stage.title)}</h3><span class="muted">${esc(stage.grade)}</span></div>
      <p>${esc(stage.summary)}</p><ul class="items">${items}</ul>`;
  }

  function renderSetlist() {
    if (!state.portfolio) return;
    const list = $("setlist");
    list.innerHTML = "";
    state.portfolio.stages.forEach((st, i) => {
      const unlocked = i === 0 || state.cleared.has(i - 1);
      const cleared = state.cleared.has(i);
      const li = document.createElement("li");
      li.innerHTML = `<button type="button" ${unlocked ? "" : "disabled"}>
          <span class="set-year">${st.year}</span>
          <span class="set-title">${esc(st.title)}<small>${esc(st.subtitle)} · ${st.bpm} BPM</small></span>
          <span class="set-state ${cleared ? "cleared" : ""}">${cleared ? `CLEAR ${state.best[i] || 0}` : unlocked ? "PLAY" : "LOCKED"}</span>
        </button>`;
      li.querySelector("button").addEventListener("click", () => startStage(i));
      list.appendChild(li);
    });
    if (state.cleared.size === state.portfolio.stages.length) {
      const li = document.createElement("li");
      li.innerHTML = `<button type="button"><span class="set-year">∞</span><span class="set-title">커튼콜<small>Curtain Call</small></span><span class="set-state cleared">OPEN</span></button>`;
      li.querySelector("button").addEventListener("click", openCurtain);
      list.appendChild(li);
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

    $("resultEyebrow").textContent = clear ? `Stage ${i + 1} Clear` : `Stage ${i + 1}`;
    $("resultTitle").textContent = clear ? `${g.stage.year}, ${g.stage.title}` : "박자를 조금 놓쳤어요";
    $("resultStats").textContent =
      `정확도 ${(acc * 100).toFixed(1)}% · Perfect ${g.perfect} · Good ${g.good} · Miss ${g.miss} · 최대 콤보 ${g.maxCombo} · ${g.score.toLocaleString()}점`;
    $("chapter").innerHTML = clear ? chapterHTML(g.stage) : "";

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
    $("ownerHeadline").textContent = p.headline;
    $("ownerAbout").textContent = p.about;
    $("ownerLinks").innerHTML = (p.links || [])
      .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("");
    $("timeline").innerHTML = p.stages.map((s) => `<article class="chapter">${chapterHTML(s)}</article>`).join("");
    const total = totalScore();
    $("myScore").textContent = total > 0
      ? `내 총점 ${total.toLocaleString()}점 (클리어한 무대 ${state.cleared.size}/${p.stages.length})`
      : "무대를 하나 이상 클리어하면 점수를 남길 수 있어요.";
    $("scoreForm").querySelector("button").disabled = total === 0;
    show("curtain");
    refreshBoard();
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

  $("startBtn").addEventListener("click", () => { ensureAudio(); renderSetlist(); });
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
      if (p.about) $("aboutText").textContent = p.about;
    })
    .catch(() => { $("aboutText").textContent = "포트폴리오 데이터를 불러오지 못했어요. 잠시 후 새로고침해주세요."; });
  fetch("/api/info").then((r) => r.json())
    .then((i) => { $("podInfo").textContent = `served by pod ${i.pod} · OpenShift Developer Sandbox`; })
    .catch(() => {});
})();
