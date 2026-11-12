// DU Meet · Zameen: a live land-claim game for two.
// Leave your land to draw a trail, come back to claim everything you circled.
// Cut the other one's open trail and they lose all their land. One minute, most land wins.
// The one who starts runs the game and sends the board to the other ~8 times a second over
// the direct channel (sendFast); the other only sends which way they turn.

(() => {
  "use strict";
  const { q, esc, getDocs, putDoc } = window.DU.kit;

  const N = 30;                 // board is N × N cells
  const TICK = 130;             // ms per step
  const ROUND = 60000;          // one round
  const COUNT = 3000;           // 3-2-1 before it starts
  const BACK_IN = 2000;         // knocked out → back after
  const SHIELD = 2500;          // fresh spawn can't be cut, can't cut
  const COLORS = [
    { head: "#0a84ff", land: "rgba(10, 132, 255, .38)", trail: "#64b5ff" },
    { head: "#ff375f", land: "rgba(255, 55, 95, .38)", trail: "#ff8fa6" },
  ];
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  let ui = null;          // overlay elements while open
  let role = "";          // "host" | "guest"
  let names = ["", ""];   // [host, guest]
  let gameId = "";
  let sim = null;         // host only
  let view = null;        // last snapshot both sides draw
  let prevPos = null;     // for smooth movement
  let snapAt = 0;
  let loop = 0, raf = 0;
  let closedId = "";       // a game this side closed; late boards for it are ignored
  const faces = new Map();

  const meIndex = () => (role === "host" ? 0 : 1);
  const otherName = () => names[1 - meIndex()];
  const msg = (data) => send("zm", data);
  const anyDirect = () => [...peers.values()].some((p) => p.dc?.readyState === "open");

  // ---------- host: the game itself ----------

  function newSim() {
    const s = { own: new Uint8Array(N * N), trail: new Uint8Array(N * N), seq: 0, phase: "count", t0: Date.now(), events: [], players: [] };
    [[6, 6, "right"], [N - 7, N - 7, "left"]].forEach(([x, y, d], i) => {
      s.players.push({ x, y, dir: DIRS[d], q: [], alive: true, backAt: 0, shieldUntil: 0, kills: 0, trailLen: 0 });
      paintBase(s, i, x, y);
    });
    return s;
  }

  function paintBase(s, i, cx, cy) {
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) if (x >= 0 && y >= 0 && x < N && y < N) s.own[y * N + x] = i + 1;
  }

  function knockOut(s, i, by) {
    const p = s.players[i];
    for (let c = 0; c < N * N; c++) { if (s.own[c] === i + 1) s.own[c] = 0; if (s.trail[c] === i + 1) s.trail[c] = 0; }
    p.alive = false; p.trailLen = 0; p.q = [];
    p.backAt = Date.now() + BACK_IN;
    if (by !== null) s.players[by].kills++;
    s.events.push({ k: "ko", who: i, by });
  }

  function respawn(s, i) {
    const p = s.players[i];
    let spot = null;
    for (let tries = 0; tries < 300 && !spot; tries++) {
      const x = 2 + Math.floor(Math.random() * (N - 4)), y = 2 + Math.floor(Math.random() * (N - 4));
      let free = true;
      for (let yy = y - 2; yy <= y + 2 && free; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (s.own[yy * N + xx] || s.trail[yy * N + xx]) { free = false; break; }
      if (free) spot = [x, y];
    }
    spot ||= [2 + Math.floor(Math.random() * (N - 4)), 2 + Math.floor(Math.random() * (N - 4))];
    Object.assign(p, { x: spot[0], y: spot[1], dir: Object.values(DIRS)[Math.floor(Math.random() * 4)], q: [], alive: true, shieldUntil: Date.now() + SHIELD, trailLen: 0 });
    paintBase(s, i, p.x, p.y);
  }

  function capture(s, i) {
    const me1 = i + 1;
    let gained = 0;
    for (let c = 0; c < N * N; c++) if (s.trail[c] === me1) { s.trail[c] = 0; if (s.own[c] !== me1) gained++; s.own[c] = me1; }
    // everything not reachable from the edge without crossing my land is now enclosed
    const seen = new Uint8Array(N * N);
    const stack = [];
    for (let k = 0; k < N; k++) for (const c of [k, (N - 1) * N + k, k * N, k * N + N - 1]) if (s.own[c] !== me1 && !seen[c]) { seen[c] = 1; stack.push(c); }
    while (stack.length) {
      const c = stack.pop(), x = c % N, y = (c - x) / N;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const n = ny * N + nx;
        if (!seen[n] && s.own[n] !== me1) { seen[n] = 1; stack.push(n); }
      }
    }
    for (let c = 0; c < N * N; c++) if (!seen[c] && s.own[c] !== me1) { s.own[c] = me1; gained++; if (s.trail[c] && s.trail[c] !== me1) s.trail[c] = 0; }
    s.players[i].trailLen = 0;
    if (gained >= 3) s.events.push({ k: "gain", who: i, pct: Math.round((gained / (N * N)) * 100) });
  }

  function step(s) {
    const now = Date.now();
    const shielded = (p) => p.shieldUntil > now;
    s.players.forEach((p, i) => {
      if (!p.alive) { if (now >= p.backAt) respawn(s, i); return; }
      while (p.q.length) {
        const d = p.q.shift();
        const reverse = d[0] === -p.dir[0] && d[1] === -p.dir[1];
        if (d[0] === p.dir[0] && d[1] === p.dir[1]) continue;
        if (reverse && p.trailLen) continue;
        p.dir = d; break;
      }
      const nx = p.x + p.dir[0], ny = p.y + p.dir[1];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) return; // the wall just stops you
      p.x = nx; p.y = ny;
      const c = ny * N + nx;
      if (s.trail[c] === i + 1) return knockOut(s, i, null); // ran into your own trail
      const j = 1 - i;
      if (s.trail[c] === j + 1 && !shielded(p) && !shielded(s.players[j])) knockOut(s, j, i);
      if (s.own[c] === i + 1) { if (p.trailLen) capture(s, i); }
      else { s.trail[c] = i + 1; p.trailLen++; }
    });
  }

  const pack = (arr) => { let out = ""; for (let c = 0; c < arr.length; c++) out += arr[c]; return out; };

  function snapshot(s) {
    const now = Date.now();
    const left = s.phase === "count" ? COUNT - (now - s.t0) : s.phase === "play" ? ROUND - (now - s.t0) : 0;
    const snap = {
      t: "s", id: gameId, n: names, seq: ++s.seq, ph: s.phase, left: Math.max(0, left),
      o: pack(s.own), tr: pack(s.trail), ev: s.events.splice(0),
      p: s.players.map((p) => [p.x, p.y, p.alive ? 1 : 0, Math.max(0, p.shieldUntil - now), p.kills, Math.max(0, p.backAt - now)]),
    };
    return snap;
  }

  function hostTick() {
    const s = sim;
    if (!s) return;
    if (!peers.size) { stop(); toast(`${otherName()} left the call`); return; }
    const now = Date.now();
    if (s.phase === "count" && now - s.t0 >= COUNT) { s.phase = "play"; s.t0 = now; }
    if (s.phase === "play") {
      step(s);
      if (now - s.t0 >= ROUND) { s.phase = "over"; }
    }
    const snap = snapshot(s);
    // direct channel: every tick; through the server only every other tick
    if (anyDirect() || s.seq % 2 === 0) sendFast("zm", snap);
    apply(snap);
    if (s.phase === "over") {
      clearInterval(loop); loop = 0;
      msg(snap); // the final board goes the reliable way too
      record(snap);
    }
  }

  function startRound() {
    sim = newSim();
    clearInterval(loop);
    loop = setInterval(hostTick, TICK);
    hostTick();
  }

  // ---------- both: drawing ----------

  function face(name) {
    if (faces.has(name)) return faces.get(name);
    const url = window.DU.faceFor?.(name) || "";
    const img = url ? Object.assign(new Image(), { src: url }) : null;
    if (img) faces.set(name, img);
    return img;
  }

  function open(mode) {
    close(false);
    const el = document.createElement("div");
    el.className = "zm";
    el.innerHTML = `
      <div class="zm-top">
        <div class="zm-p a"><span class="zm-face"></span><div><b class="zm-pct">0%</b><small class="zm-ko"><span class="icon">swords</span>0</small></div></div>
        <div class="zm-time">1:00</div>
        <div class="zm-p b"><div><b class="zm-pct">0%</b><small class="zm-ko"><span class="icon">swords</span>0</small></div><span class="zm-face"></span></div>
        <button class="zm-x" aria-label="Leave game"><span class="icon">close</span></button>
      </div>
      <div class="zm-stage"><canvas></canvas><div class="zm-banner" hidden></div><div class="zm-panel" hidden></div></div>
      <p class="zm-hint">Swipe or use the arrow keys. Leave your land, come back to claim it. Cut their trail, they lose it all.</p>`;
    document.body.append(el);
    ui = { el, canvas: q("canvas", el), ctx: q("canvas", el).getContext("2d"), banner: q(".zm-banner", el), panel: q(".zm-panel", el) };
    q(".zm-x", el).addEventListener("click", () => { msg({ t: "quit", id: gameId }); close(); });
    el.addEventListener("click", onPanelClick);
    bindInput(el);
    ui.ro = new ResizeObserver(sizeCanvas);
    ui.ro.observe(q(".zm-stage", el));
    paintHud();
    if (mode) showPanel(mode);
    raf = requestAnimationFrame(draw);
  }

  function close(clear = true) {
    clearInterval(loop); loop = 0;
    cancelAnimationFrame(raf);
    ui?.ro?.disconnect();
    window.removeEventListener("keydown", onKey, true);
    ui?.el.remove();
    ui = null;
    if (clear && gameId) closedId = gameId;
    if (clear) { sim = null; view = null; role = ""; }
  }
  const stop = () => close();

  function sizeCanvas() {
    if (!ui) return;
    const box = q(".zm-stage", ui.el).getBoundingClientRect();
    const side = Math.floor(Math.min(box.width, box.height));
    if (side < 10 || side === ui.side) return;
    ui.side = side;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    Object.assign(ui.canvas.style, { width: `${side}px`, height: `${side}px` });
    ui.canvas.width = ui.canvas.height = side * dpr;
    ui.cell = (side * dpr) / N;
    ui.dpr = dpr;
  }

  function paintHud() {
    if (!ui) return;
    const pcts = [0, 0];
    if (view) for (let c = 0; c < view.o.length; c++) { const v = view.o.charCodeAt(c) - 48; if (v) pcts[v - 1]++; }
    ["a", "b"].forEach((k, i) => {
      const box = q(`.zm-p.${k}`, ui.el);
      const img = window.DU.faceFor?.(names[i]);
      const f = q(".zm-face", box);
      if (f.dataset.n !== names[i]) {
        f.dataset.n = names[i];
        f.innerHTML = img ? `<img src="${esc(img)}" alt="">` : esc((names[i] || "?")[0].toUpperCase());
      }
      q(".zm-pct", box).textContent = `${Math.round((pcts[i] / (N * N)) * 100)}%`;
      q(".zm-ko", box).lastChild.textContent = view ? view.p[i][4] : 0;
      box.classList.toggle("me", i === meIndex());
    });
    const left = view ? Math.ceil(view.left / 1000) : 60;
    const t = q(".zm-time", ui.el);
    t.textContent = view?.ph === "count" ? `${left}` : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    t.classList.toggle("hot", view?.ph === "play" && left <= 10);
    return pcts;
  }

  function draw() {
    if (!ui) return;
    raf = requestAnimationFrame(draw);
    const { ctx, cell } = ui;
    const W = ui.canvas.width;
    ctx.clearRect(0, 0, W, W);
    // board
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      ctx.fillStyle = (x + y) % 2 ? "#26262a" : "#2c2c31";
      ctx.fillRect(x * cell, y * cell, cell + .5, cell + .5);
    }
    if (!view) return;
    for (let c = 0; c < N * N; c++) {
      const o = view.o.charCodeAt(c) - 48, t = view.tr.charCodeAt(c) - 48;
      const x = (c % N) * cell, y = Math.floor(c / N) * cell;
      if (o) { ctx.fillStyle = COLORS[o - 1].land; ctx.fillRect(x, y, cell + .5, cell + .5); }
      if (t) { ctx.fillStyle = COLORS[t - 1].trail; const m = cell * .22; ctx.fillRect(x + m, y + m, cell - 2 * m, cell - 2 * m); }
    }
    // land edges, a soft outline so shapes read clearly
    ctx.lineWidth = Math.max(1, cell * .1);
    for (let c = 0; c < N * N; c++) {
      const o = view.o.charCodeAt(c) - 48;
      if (!o) continue;
      const cx = c % N, cy = Math.floor(c / N);
      ctx.strokeStyle = COLORS[o - 1].head;
      const edge = (nx, ny) => nx < 0 || ny < 0 || nx >= N || ny >= N || view.o.charCodeAt(ny * N + nx) - 48 !== o;
      ctx.beginPath();
      if (edge(cx, cy - 1)) { ctx.moveTo(cx * cell, cy * cell); ctx.lineTo((cx + 1) * cell, cy * cell); }
      if (edge(cx, cy + 1)) { ctx.moveTo(cx * cell, (cy + 1) * cell); ctx.lineTo((cx + 1) * cell, (cy + 1) * cell); }
      if (edge(cx - 1, cy)) { ctx.moveTo(cx * cell, cy * cell); ctx.lineTo(cx * cell, (cy + 1) * cell); }
      if (edge(cx + 1, cy)) { ctx.moveTo((cx + 1) * cell, cy * cell); ctx.lineTo((cx + 1) * cell, (cy + 1) * cell); }
      ctx.stroke();
    }
    // players
    const k = Math.min(1, (performance.now() - snapAt) / TICK);
    view.p.forEach((p, i) => {
      if (!p[2]) return;
      let [x, y] = p;
      const before = prevPos?.[i];
      if (before && Math.abs(before[0] - x) + Math.abs(before[1] - y) === 1) { x = before[0] + (x - before[0]) * k; y = before[1] + (y - before[1]) * k; }
      const cx = (x + .5) * cell, cy = (y + .5) * cell, r = cell * .95;
      if (p[3] > 0) {
        ctx.beginPath(); ctx.arc(cx, cy, r + cell * .45, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${.12 + .08 * Math.sin(performance.now() / 120)})`; ctx.fill();
      }
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, .55)"; ctx.shadowBlur = cell * .6;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = COLORS[i].head; ctx.fill();
      ctx.restore();
      const img = face(names[i]);
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r - cell * .16, 0, Math.PI * 2); ctx.clip();
      if (img?.complete && img.naturalWidth) {
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, cx - r, cy - r, r * 2, r * 2);
      } else {
        ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.round(r)}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText((names[i] || "?")[0].toUpperCase(), cx, cy + 1);
      }
      ctx.restore();
      if (i === meIndex()) {
        ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.round(cell * .62)}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillText("you", cx, cy - r - cell * .15);
      }
    });
  }

  let bannerTimer = 0;
  let koText = "";
  function banner(text, tone = "") {
    if (!ui) return;
    ui.banner.textContent = text;
    ui.banner.className = `zm-banner ${tone}`;
    ui.banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { if (ui) ui.banner.hidden = true; }, 1800);
  }

  function apply(snap) {
    if (view && snap.seq <= view.seq && snap.id === view.id) return;
    if (view && snap.id === view.id) prevPos = view.p.map((p) => [p[0], p[1]]);
    else prevPos = null;
    names = snap.n;
    gameId = snap.id;
    const wasPhase = view?.ph;
    view = snap;
    snapAt = performance.now();
    if (!ui) open();
    const mine = meIndex();
    for (const e of snap.ev || []) {
      if (e.k === "ko" && e.who === mine) { koText = e.by === null ? "You crossed your own trail" : `${names[e.by]} cut your trail`; banner(koText, "bad"); navigator.vibrate?.([120, 60, 120]); }
      else if (e.k === "ko" && e.by === mine) { banner(`You cut ${names[e.who]}'s trail!`, "good"); navigator.vibrate?.(60); }
      else if (e.k === "ko") banner(`${names[e.who]} crossed their own trail`, "good");
      else if (e.k === "gain" && e.who === mine) banner(`+${e.pct}% land`, "gain");
    }
    const me = snap.p[mine];
    if (me[2] && ui.banner.textContent.includes("back in")) { ui.banner.hidden = true; koText = ""; }
    if (snap.ph === "play" && !me[2]) { ui.banner.textContent = `${koText ? `${koText} · ` : ""}back in ${Math.ceil(me[5] / 1000) || 1}…`; ui.banner.className = "zm-banner bad"; ui.banner.hidden = false; }
    if (snap.ph === "count" && wasPhase !== "count") ui.panel.hidden = true;
    const pcts = paintHud();
    if (snap.ph === "over" && wasPhase !== "over") showResult(pcts);
  }

  // ---------- panels: invite, waiting, result ----------

  function showPanel(kind, extra = "") {
    if (!ui) return;
    const other = esc(otherName());
    ui.panel.innerHTML = {
      wait: `<span class="icon zm-spin">progress_activity</span><b>Waiting for ${other}…</b><small>They get an invite on their screen</small><button class="btn ghost small-btn" data-zm="cancel">Cancel</button>`,
      invite: `<span class="zm-big-face">${faceHtml(names[0])}</span><b>${esc(names[0])} wants to play Zameen</b><small>Claim the most land in one minute</small><div class="zm-row"><button class="btn ghost" data-zm="later">Later</button><button class="btn primary" data-zm="accept">Play</button></div>`,
    }[kind] || extra;
    ui.panel.hidden = false;
  }

  const faceHtml = (name) => { const u = window.DU.faceFor?.(name); return u ? `<img src="${esc(u)}" alt="">` : esc((name || "?")[0].toUpperCase()); };

  let allTime = null;
  async function loadAllTime() {
    try { allTime = (await getDocs("settings")).find((d) => d.id === "game-scores")?.data || {}; } catch { allTime ||= {}; }
    return allTime;
  }

  async function showResult(pcts) {
    const [a, b] = pcts;
    const win = a === b ? -1 : a > b ? 0 : 1;
    const pct = (v) => Math.round((v / (N * N)) * 100);
    const title = win < 0 ? "It's a draw" : win === meIndex() ? "You win! 🎉" : `${esc(names[win])} wins`;
    const body = (t) => `
      ${win >= 0 ? `<span class="zm-big-face win">${faceHtml(names[win])}<i class="icon">workspace_premium</i></span>` : ""}
      <b class="zm-result">${title}</b>
      <div class="zm-score"><span>${esc(names[0])} <b>${pct(a)}%</b></span><span>${esc(names[1])} <b>${pct(b)}%</b></span></div>
      ${t}
      <div class="zm-row"><button class="btn ghost" data-zm="close">Close</button><button class="btn primary" data-zm="again"><span class="icon">replay</span>Play again</button></div>`;
    showPanel("", body(""));
    if (win >= 0 && meIndex() === win) navigator.vibrate?.([60, 40, 60, 40, 120]);
    const t = (await loadAllTime()).zm;
    if (t && ui && !ui.panel.hidden) {
      const row = `<small class="zm-alltime">All time · ${esc(names[0])} ${t[names[0]] || 0} · ${esc(names[1])} ${t[names[1]] || 0}${t.draws ? ` · ${t.draws} draw${t.draws === 1 ? "" : "s"}` : ""}</small>`;
      showPanel("", body(row));
    }
  }

  const recorded = new Set();
  async function record(snap) {
    if (role !== "host" || recorded.has(snap.id)) return;
    recorded.add(snap.id);
    const pcts = [0, 0];
    for (let c = 0; c < snap.o.length; c++) { const v = snap.o.charCodeAt(c) - 48; if (v) pcts[v - 1]++; }
    try {
      const all = await loadAllTime();
      const t = { ...(all.zm || {}) };
      if (pcts[0] === pcts[1]) t.draws = (t.draws || 0) + 1;
      else { const w = names[pcts[0] > pcts[1] ? 0 : 1]; t[w] = (t[w] || 0) + 1; }
      allTime = { ...all, zm: t };
      await putDoc("settings", allTime, "game-scores");
      send("couple-sync", { c: "game-scores" });
      msg({ t: "scores", id: snap.id });
      if (ui && !ui.panel.hidden) showResult(pcts);
    } catch { /* offline */ }
  }

  function onPanelClick(event) {
    const b = event.target.closest("[data-zm]");
    if (!b) return;
    const act = b.dataset.zm;
    if (act === "cancel" || act === "close") { msg({ t: "quit", id: gameId }); close(); }
    else if (act === "later") { msg({ t: "decline", id: gameId }); close(); }
    else if (act === "accept") { msg({ t: "accept", id: gameId }); ui.panel.innerHTML = `<span class="icon zm-spin">progress_activity</span><b>Starting…</b>`; }
    else if (act === "again") {
      if (role === "host") { gameId = `${Date.now()}`; view = null; startRound(); }
      else { msg({ t: "again", id: gameId }); ui.panel.innerHTML = `<span class="icon zm-spin">progress_activity</span><b>Starting…</b>`; }
    }
  }

  // ---------- input ----------

  function turn(name) {
    if (!view || view.ph !== "play") return;
    const d = DIRS[name];
    if (role === "host") { const p = sim?.players[0]; if (p && p.q.length < 2) p.q.push(d); }
    else { sendFast("zm", { t: "d", id: gameId, d }); setTimeout(() => sendFast("zm", { t: "d", id: gameId, d, again: 1 }), 40); }
  }

  function onKey(e) {
    if (!ui) return;
    const k = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right", W: "up", S: "down", A: "left", D: "right" }[e.key];
    if (!k || e.target.closest?.("input, textarea")) return;
    e.preventDefault(); e.stopPropagation();
    turn(k);
  }

  function bindInput(el) {
    window.addEventListener("keydown", onKey, true);
    let start = null;
    el.addEventListener("pointerdown", (e) => { if (!e.target.closest("button")) start = [e.clientX, e.clientY]; });
    el.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start[0], dy = e.clientY - start[1];
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
      turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
      start = [e.clientX, e.clientY];
    });
    const end = () => { start = null; };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  // ---------- messages ----------

  let lastGuestInput = new Map();
  function handle(data, peer) {
    if (!data || typeof data !== "object") return;
    switch (data.t) {
      case "invite":
        if (sim) return; // already hosting
        role = "guest"; gameId = String(data.id); names = [String(data.from || peer.name).slice(0, 40), me.name]; view = null;
        open("invite");
        navigator.vibrate?.(80);
        break;
      case "accept":
        if (role === "host" && data.id === gameId && !loop) { names[1] = peer.name; startRound(); }
        break;
      case "again":
        if (role === "host" && ui && (!sim || sim.phase === "over")) { gameId = `${Date.now()}`; view = null; startRound(); }
        break;
      case "decline":
        if (role === "host" && data.id === gameId) { close(); toast(`${peer.name} will play later`); }
        break;
      case "quit":
        if (ui && data.id === gameId) { close(); toast(`${peer.name} left the game`); }
        break;
      case "d":
        if (role === "host" && sim && Array.isArray(data.d)) {
          const d = Object.values(DIRS).find((v) => v[0] === data.d[0] && v[1] === data.d[1]);
          const p = sim.players[1];
          if (!d) return;
          // the same turn is sent twice in case one gets lost
          const key = `${d}`; const last = lastGuestInput.get(key) || 0;
          if (data.again && Date.now() - last < 120) return;
          lastGuestInput.set(key, Date.now());
          if (p.q.length < 2) p.q.push(d);
        }
        break;
      case "s":
        if (role === "host") return;
        if (!ui && data.ph === "over") return;
        if (data.id === closedId) return;
        role = "guest";
        if (typeof data.o === "string" && data.o.length === N * N && Array.isArray(data.p)) apply(data);
        break;
      case "scores":
        if (ui && view?.ph === "over") loadAllTime().then(() => { const p = paintHud(); showResult(p); });
        break;
    }
  }

  function invite() {
    window.DU.kit.toggleTray(false);
    if (peers.size !== 1) return toast(peers.size ? "Zameen is for two people" : "Zameen needs someone in the call");
    role = "host"; gameId = `${Date.now()}`; closedId = "";
    names = [me.name, [...peers.values()][0].name];
    view = null; sim = null;
    open("wait");
    msg({ t: "invite", id: gameId, from: me.name });
  }

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave, fast: window.DU.onFast };
  Object.assign(window.DU, {
    onCoupleClick(button) { if (button.dataset.tg === "zameen") invite(); else prev.click?.(button); },
    onCouple(message, peer) { if (message.type === "zm") handle(message.data, peer); else prev.msg?.(message, peer); },
    onFast(message, peer) { if (message.type === "zm") handle(message.data, peer); else prev.fast?.(message, peer); },
    onCoupleLeave(...args) { prev.leave?.(...args); close(); },
  });
})();
