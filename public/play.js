// DU Meet · two live games for the two of you:
//  Pictionary: one draws a word, the other guesses; 6 rounds, roles swap each round.
//  Reaction race: wait for green, tap first; 5 rounds, each reaction is timed on its own phone.
// The one who starts runs the game; messages go through the normal relay (send).

(() => {
  "use strict";
  const { q, esc, getDocs, putDoc } = window.DU.kit;
  const other = () => [...peers.values()][0];
  const faceHtml = (n) => { const u = window.DU.faceFor?.(n); return u ? `<img src="${esc(u)}" alt="">` : esc((n || "?")[0].toUpperCase()); };

  // ---------- a shared full-screen frame ----------

  let ov = null; // { el, kind, ... }
  function frame(kind, names, body) {
    closeFrame();
    const el = document.createElement("div");
    el.className = `pl pl-${kind}`;
    el.innerHTML = `
      <header class="pl-top">
        <div class="pl-p a"><span class="pl-face">${faceHtml(names[0])}</span><b class="pl-score">0</b></div>
        <div class="pl-mid"><small class="pl-round"></small><b class="pl-clock"></b></div>
        <div class="pl-p b"><b class="pl-score">0</b><span class="pl-face">${faceHtml(names[1])}</span></div>
        <button class="pl-x" aria-label="Leave game"><span class="icon">close</span></button>
      </header>
      <div class="pl-body">${body}</div>
      <div class="pl-panel" hidden></div>`;
    document.body.append(el);
    ov = { el, kind, names };
    q(".pl-x", el).addEventListener("click", () => { send(kind === "pict" ? "pict" : "race", { t: "quit" }); closeFrame(); });
    return el;
  }
  function closeFrame() { if (!ov) return; ov.cleanup?.(); ov.el.remove(); ov = null; }
  function setScores(s) { if (!ov) return; ov.el.querySelectorAll(".pl-score").forEach((b, i) => { b.textContent = s[i]; }); }
  function panel(html) { if (!ov) return; const p = q(".pl-panel", ov.el); p.innerHTML = html; p.hidden = !html; }
  const iAm = (names) => names.indexOf(me.name);

  async function saveWin(kind, names, scores) {
    if (names[0] !== me.name) return; // the starter records it, once
    try {
      const all = (await getDocs("settings")).find((d) => d.id === "game-scores")?.data || {};
      const t = { ...(all[kind] || {}) };
      if (scores[0] === scores[1]) t.draws = (t.draws || 0) + 1;
      else { const w = names[scores[0] > scores[1] ? 0 : 1]; t[w] = (t[w] || 0) + 1; }
      await putDoc("settings", { ...all, [kind]: t }, "game-scores");
      send("couple-sync", { c: "game-scores" });
    } catch { /* offline */ }
  }
  function finalPanel(kind, names, scores, again) {
    const mine = iAm(names);
    const win = scores[0] === scores[1] ? -1 : scores[0] > scores[1] ? 0 : 1;
    const title = win < 0 ? "It's a draw" : win === mine ? "You win! 🎉" : `${esc(names[win])} wins`;
    panel(`${win >= 0 ? `<span class="pl-big-face">${faceHtml(names[win])}<i class="icon">workspace_premium</i></span>` : ""}
      <b class="pl-title">${title}</b>
      <div class="pl-final"><span>${esc(names[0])} <b>${scores[0]}</b></span><span>${esc(names[1])} <b>${scores[1]}</b></span></div>
      <div class="pl-row"><button class="btn ghost" data-pl="close">Close</button><button class="btn primary" data-pl="again"><span class="icon">replay</span>Play again</button></div>`);
    q(".pl-panel", ov.el).onclick = (e) => {
      const a = e.target.closest("[data-pl]")?.dataset.pl;
      if (a === "close") { send(kind, { t: "quit" }); closeFrame(); }
      if (a === "again") again();
    };
    if (win >= 0 && win === mine) navigator.vibrate?.([60, 40, 60, 40, 120]);
  }

  // ---------- Pictionary ----------

  const WORDS = ["umbrella", "pizza", "rainbow", "guitar", "elephant", "bicycle", "sunflower", "rocket", "butterfly", "castle", "dinosaur", "volcano", "mermaid", "snowman", "lighthouse", "camera", "airplane", "cupcake", "pineapple", "giraffe", "octopus", "tent", "ladder", "kite", "anchor", "candle", "crown", "dragon", "glasses", "headphones", "ice cream", "jellyfish", "key", "lion", "moon", "mushroom", "owl", "penguin", "pyramid", "robot", "scissors", "shark", "spider", "star", "sun", "teapot", "tiger", "tree", "turtle", "unicorn", "whale", "windmill", "zebra", "balloon", "bridge", "cactus", "clock", "cloud", "diamond", "door", "egg", "feather", "fish", "flower", "football", "frog", "ghost", "gift", "hamburger", "heart", "helicopter", "house", "island", "lamp", "leaf", "mango", "map", "monkey", "mountain", "noodles", "paint brush", "parrot", "pencil", "phone", "piano", "rabbit", "ring", "sandwich", "ship", "shoe", "smile", "snake", "sofa", "spoon", "strawberry", "suitcase", "sword", "toothbrush", "train", "trophy", "truck", "watch", "watermelon", "auto rickshaw", "samosa", "chai", "kite flying", "taj mahal", "cricket bat", "mehendi", "diya", "peacock", "coconut", "scooter", "pani puri", "ludo", "rangoli", "temple", "jalebi", "selfie", "bed", "kiss", "hug", "date night", "popcorn", "movie", "beach", "rain", "snow", "birthday cake", "wedding", "dog", "cat"];
  const ROUNDS = 6, ROUND_MS = 80000;
  const COLORS = ["#ffffff", "#ff453a", "#ffd60a", "#30d158", "#0a84ff", "#bf5af2", "#ff9f0a", "#1c1c1e"];
  const pc = { names: [], drawer: 0, n: 0, word: "", len: [], hint: [], scores: [0, 0], ends: 0, color: "#ffffff", size: 6, erase: false, timer: 0, guessed: false, strokes: [], cur: null, outbox: [], flush: 0, choosing: false };
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");
  const blanks = (word, reveal) => [...word].map((ch, i) => (ch === " " ? "&nbsp;&nbsp;" : reveal.includes(i) ? esc(ch.toUpperCase()) : "_")).join(" ");

  function pictUi() {
    const el = frame("pict", pc.names, `
      <div class="pc-word"></div>
      <div class="pc-board"><canvas></canvas><div class="pc-feed"></div></div>
      <div class="pc-tools">${COLORS.map((c) => `<button class="pc-col" data-col="${c}" style="--c:${c}" aria-label="Colour"></button>`).join("")}<span class="pc-sep"></span><button class="pc-tool" data-size="4" aria-label="Thin"><i style="width:5px;height:5px"></i></button><button class="pc-tool" data-size="10" aria-label="Thick"><i style="width:11px;height:11px"></i></button><button class="pc-tool" data-erase aria-label="Eraser"><span class="icon">ink_eraser</span></button><button class="pc-tool" data-clear aria-label="Clear"><span class="icon">delete</span></button></div>
      <form class="pc-guess"><input class="field" maxlength="40" placeholder="Type your guess…" autocomplete="off" autocapitalize="off"><button class="btn primary" aria-label="Guess"><span class="icon">send</span></button></form>`);
    const canvas = q("canvas", el);
    const ro = new ResizeObserver(() => sizeBoard(canvas));
    ro.observe(q(".pc-board", el));
    sizeBoard(canvas);
    ov.cleanup = () => { ro.disconnect(); clearInterval(pc.timer); clearInterval(pc.flush); };
    bindDraw(canvas);
    q(".pc-tools", el).addEventListener("click", (e) => {
      const col = e.target.closest("[data-col]"), size = e.target.closest("[data-size]");
      if (col) { pc.color = col.dataset.col; pc.erase = false; }
      if (size) pc.size = Number(size.dataset.size);
      if (e.target.closest("[data-erase]")) pc.erase = !pc.erase;
      if (e.target.closest("[data-clear]")) { pc.strokes = []; redraw(canvas); send("pict", { t: "clr" }); }
      paintTools();
    });
    q(".pc-guess", el).addEventListener("submit", (e) => {
      e.preventDefault();
      const input = q("input", e.currentTarget);
      const text = input.value.trim().slice(0, 40);
      if (!text || pc.guessed) return;
      input.value = "";
      send("pict", { t: "guess", text });
      feed(me.name, text);
    });
    paintTools();
  }
  function paintTools() {
    if (!ov) return;
    ov.el.querySelectorAll("[data-col]").forEach((b) => b.classList.toggle("on", !pc.erase && b.dataset.col === pc.color));
    ov.el.querySelectorAll("[data-size]").forEach((b) => b.classList.toggle("on", Number(b.dataset.size) === pc.size));
    q("[data-erase]", ov.el).classList.toggle("on", pc.erase);
  }
  function sizeBoard(canvas) {
    const box = canvas.parentElement.getBoundingClientRect();
    const side = Math.floor(Math.min(box.width, box.height));
    if (side < 20) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = canvas.style.height = `${side}px`;
    canvas.width = canvas.height = side * dpr;
    redraw(canvas);
  }
  function drawStroke(ctx, s, W) {
    if (!s.p.length) return;
    ctx.strokeStyle = s.e ? "#1c1c1e" : s.c;
    ctx.lineWidth = (s.e ? s.w * 3 : s.w) * (W / 400);
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(s.p[0][0] * W, s.p[0][1] * W);
    if (s.p.length === 1) ctx.lineTo(s.p[0][0] * W + .1, s.p[0][1] * W);
    for (const [x, y] of s.p.slice(1)) ctx.lineTo(x * W, y * W);
    ctx.stroke();
  }
  function redraw(canvas) {
    const ctx = canvas.getContext("2d"), W = canvas.width;
    ctx.fillStyle = "#1c1c1e"; ctx.fillRect(0, 0, W, W);
    pc.strokes.forEach((s) => drawStroke(ctx, s, W));
  }
  function bindDraw(canvas) {
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.width))].map((v) => Math.round(v * 1000) / 1000); };
    canvas.addEventListener("pointerdown", (e) => {
      if (!canDraw()) return;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      pc.cur = { id: `${Date.now()}${Math.random()}`.slice(-9), c: pc.color, w: pc.size, e: pc.erase, p: [pos(e)] };
      pc.strokes.push(pc.cur);
      pc.outbox.push({ id: pc.cur.id, c: pc.cur.c, w: pc.cur.w, e: pc.cur.e, p: [...pc.cur.p] });
      redraw(canvas);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!pc.cur) return;
      const pt = pos(e);
      pc.cur.p.push(pt);
      const last = pc.outbox.find((o) => o.id === pc.cur.id);
      if (last) last.p.push(pt); else pc.outbox.push({ id: pc.cur.id, c: pc.cur.c, w: pc.cur.w, e: pc.cur.e, p: [pc.cur.p.at(-2), pt] });
      const ctx = canvas.getContext("2d");
      drawStroke(ctx, { ...pc.cur, p: pc.cur.p.slice(-2) }, canvas.width);
    });
    const end = () => { pc.cur = null; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    clearInterval(pc.flush);
    pc.flush = setInterval(() => { if (pc.outbox.length) { send("pict", { t: "st", s: pc.outbox }); pc.outbox = []; } }, 90);
  }
  const canDraw = () => ov?.kind === "pict" && iAm(pc.names) === pc.drawer && pc.word && !pc.guessed && Date.now() < pc.ends;

  function feed(name, text, tone = "") {
    if (!ov) return;
    const f = q(".pc-feed", ov.el);
    const b = document.createElement("span");
    b.className = `pc-bubble ${tone}`;
    b.innerHTML = `<b>${esc(name)}</b> ${esc(text)}`;
    f.append(b);
    setTimeout(() => b.remove(), 4000);
    while (f.children.length > 4) f.firstChild.remove();
  }

  function paintRole() {
    if (!ov) return;
    const mine = iAm(pc.names), drawing = mine === pc.drawer;
    ov.el.classList.toggle("drawing", drawing);
    q(".pl-round", ov.el).textContent = `Round ${pc.n} of ${ROUNDS}`;
    const w = q(".pc-word", ov.el);
    if (pc.choosing) w.innerHTML = drawing ? "Pick a word to draw" : `${esc(pc.names[pc.drawer])} is picking a word…`;
    else if (drawing) w.innerHTML = `<small>Draw</small> <b>${esc(pc.word.toUpperCase())}</b>`;
    else w.innerHTML = `<span class="pc-blanks">${blanks(pc.len.map((sp) => (sp ? " " : "x")).join(""), [])}</span>`;
    setScores(pc.scores);
  }
  function paintBlanks() {
    if (!ov || iAm(pc.names) === pc.drawer || pc.choosing) return;
    const w = q(".pc-word", ov.el);
    const shape = pc.len.map((sp, i) => (sp ? " " : pc.hint.find((h) => h[0] === i)?.[1] || "_"));
    w.innerHTML = `<span class="pc-blanks">${shape.map((ch) => (ch === " " ? "&nbsp;&nbsp;" : ch === "_" ? "_" : esc(ch.toUpperCase()))).join(" ")}</span><small>${pc.len.filter((x) => !x).length} letters</small>`;
  }
  function runClock() {
    clearInterval(pc.timer);
    pc.timer = setInterval(() => {
      if (!ov) return clearInterval(pc.timer);
      const left = Math.max(0, Math.ceil((pc.ends - Date.now()) / 1000));
      const c = q(".pl-clock", ov.el);
      c.textContent = pc.choosing ? "" : `${left}s`;
      c.classList.toggle("hot", left <= 10 && !pc.choosing);
      // the drawer gives a letter as a hint at 40s and 20s left
      if (iAm(pc.names) === pc.drawer && !pc.choosing && !pc.guessed) {
        if ((left === 40 && pc.hint.length < 1) || (left === 20 && pc.hint.length < 2)) {
          const free = [...pc.word].map((ch, i) => [i, ch]).filter(([i, ch]) => ch !== " " && !pc.hint.some((h) => h[0] === i));
          const pick = free[Math.floor(Math.random() * free.length)];
          if (pick) { pc.hint.push(pick); send("pict", { t: "hint", h: pc.hint }); }
        }
        if (left === 0) endRound(null);
      }
    }, 250);
  }

  // drawer side
  function chooseWord() {
    pc.choosing = true; pc.word = ""; pc.guessed = false; pc.hint = []; pc.strokes = [];
    if (ov) redraw(q("canvas", ov.el));
    const picks = [...WORDS].sort(() => Math.random() - .5).slice(0, 3);
    send("pict", { t: "choosing", n: pc.n, drawer: pc.drawer, scores: pc.scores, names: pc.names });
    paintRole(); runClock();
    panel(`<b class="pl-title">Your turn to draw</b><small>Pick a word</small><div class="pc-picks">${picks.map((w) => `<button class="btn outline" data-word="${esc(w)}">${esc(w)}</button>`).join("")}</div>`);
    q(".pl-panel", ov.el).onclick = (e) => {
      const b = e.target.closest("[data-word]");
      if (!b) return;
      panel("");
      pc.word = b.dataset.word; pc.choosing = false; pc.ends = Date.now() + ROUND_MS;
      pc.len = [...pc.word].map((ch) => ch === " ");
      send("pict", { t: "round", n: pc.n, drawer: pc.drawer, len: pc.len, left: ROUND_MS, scores: pc.scores, names: pc.names });
      paintRole();
    };
  }
  function endRound(by) {
    if (pc.guessed) return;
    pc.guessed = true;
    const left = Math.max(0, pc.ends - Date.now());
    if (by !== null) { pc.scores[1 - pc.drawer] += 10 + Math.round(left / 4000); pc.scores[pc.drawer] += 5; }
    send("pict", { t: "done", word: pc.word, by, scores: pc.scores });
    showDone(pc.word, by);
    setTimeout(() => {
      if (!ov || ov.kind !== "pict") return;
      if (pc.n >= ROUNDS) { send("pict", { t: "end", scores: pc.scores }); showEnd(); }
      else send("pict", { t: "next", n: pc.n + 1, scores: pc.scores }), panel(`<span class="icon pl-spin">progress_activity</span><b>${esc(pc.names[1 - pc.drawer])}'s turn to draw</b>`);
    }, 3200);
  }
  function showDone(word, by) {
    setScores(pc.scores);
    const name = by === null ? "" : pc.names[by];
    panel(`<span class="pc-done ${by === null ? "miss" : "hit"}"><span class="icon">${by === null ? "timer_off" : "celebration"}</span></span><b class="pl-title">${by === null ? "Time's up" : `${esc(name === me.name ? "You" : name)} guessed it!`}</b><small>The word was <b>${esc(word.toUpperCase())}</b></small>`);
    if (by !== null) navigator.vibrate?.(80);
  }
  function showEnd() {
    clearInterval(pc.timer);
    finalPanel("pict", pc.names, pc.scores, () => startPict());
    saveWin("pict", pc.names, pc.scores);
  }
  function startPict() {
    const p = other();
    window.DU.kit.toggleTray(false);
    if (!p) return toast("Pictionary needs someone in the call");
    Object.assign(pc, { names: [me.name, p.name], drawer: 0, n: 1, scores: [0, 0], strokes: [] });
    send("pict", { t: "start", names: pc.names });
    pictUi();
    chooseWord();
  }

  function onPict(d, peer) {
    switch (d.t) {
      case "start":
        Object.assign(pc, { names: d.names, drawer: 0, n: 1, scores: [0, 0], strokes: [], word: "", choosing: true });
        pictUi(); paintRole(); panel(""); break;
      case "choosing":
        if (!ov || ov.kind !== "pict") { Object.assign(pc, { names: d.names }); pictUi(); }
        Object.assign(pc, { n: d.n, drawer: d.drawer, scores: d.scores, choosing: true, word: "", strokes: [], hint: [], guessed: false });
        redraw(q("canvas", ov.el)); panel(""); paintRole(); runClock(); break;
      case "round":
        if (!ov || ov.kind !== "pict") { pc.names = d.names; pictUi(); }
        Object.assign(pc, { n: d.n, drawer: d.drawer, scores: d.scores, len: d.len, hint: [], choosing: false, guessed: false, word: "", ends: Date.now() + Number(d.left || ROUND_MS) });
        panel(""); paintRole(); paintBlanks(); runClock();
        setTimeout(() => q(".pc-guess input", ov?.el)?.focus({ preventScroll: true }), 50); break;
      case "st":
        if (!ov || ov.kind !== "pict" || !Array.isArray(d.s)) return;
        for (const s of d.s) {
          let st = pc.strokes.find((x) => x.id === s.id);
          if (!st) { st = { id: String(s.id), c: String(s.c), w: Number(s.w) || 6, e: Boolean(s.e), p: [] }; pc.strokes.push(st); }
          st.p.push(...(s.p || []).filter((pt) => Array.isArray(pt)));
        }
        redraw(q("canvas", ov.el)); break;
      case "clr": pc.strokes = []; if (ov) redraw(q("canvas", ov.el)); break;
      case "hint": pc.hint = Array.isArray(d.h) ? d.h : []; paintBlanks(); break;
      case "guess":
        if (iAm(pc.names) !== pc.drawer || pc.guessed || pc.choosing) return;
        if (norm(d.text) === norm(pc.word)) endRound(1 - pc.drawer);
        else { feed(peer.name, String(d.text).slice(0, 40)); send("pict", { t: "wrong", text: String(d.text).slice(0, 40) }); }
        break;
      case "wrong": if (ov) { const i = q(".pc-guess input", ov.el); i?.classList.remove("nope"); void i?.offsetWidth; i?.classList.add("nope"); } break;
      case "done": pc.guessed = true; pc.scores = d.scores; showDone(String(d.word), d.by); break;
      case "next":
        pc.scores = d.scores; pc.n = d.n; pc.drawer = iAm(pc.names);
        if (ov?.kind === "pict") chooseWord(); break;
      case "end": pc.scores = d.scores; setScores(pc.scores); showEnd(); break;
      case "quit": if (ov?.kind === "pict") { closeFrame(); toast(`${peer.name} left Pictionary`); } break;
    }
  }

  // ---------- Reaction race ----------

  const RR = 5;
  const rc = { names: [], r: 0, scores: [0, 0], state: "idle", greenAt: 0, armTimer: 0, rts: [null, null], timeout: 0 };
  function raceUi() {
    const el = frame("race", rc.names, `<button class="rr-pad" aria-label="Tap"><span class="rr-big"></span><span class="rr-sub"></span></button>`);
    q(".rr-pad", el).addEventListener("pointerdown", (e) => { e.preventDefault(); tapRace(); });
    ov.cleanup = () => { clearTimeout(rc.armTimer); clearTimeout(rc.timeout); };
    setScores(rc.scores);
  }
  function racePaint(state, big, sub = "") {
    if (!ov) return;
    rc.state = state;
    const pad = q(".rr-pad", ov.el);
    pad.className = `rr-pad ${state}`;
    q(".rr-big", pad).innerHTML = big;
    q(".rr-sub", pad).innerHTML = sub;
    q(".pl-round", ov.el).textContent = rc.r ? `Round ${rc.r} of ${RR}` : "";
  }
  function arm(r, delay) {
    rc.r = r; rc.rts = [null, null];
    panel("");
    racePaint("wait", "Wait for green…", "Don't tap yet");
    clearTimeout(rc.armTimer); clearTimeout(rc.timeout);
    rc.armTimer = setTimeout(() => {
      rc.greenAt = performance.now();
      racePaint("go", "TAP!", "");
      navigator.vibrate?.(30);
      rc.timeout = setTimeout(() => { if (rc.state === "go") report(1500, false); }, 1500);
    }, delay);
  }
  function tapRace() {
    if (rc.state === "wait") { clearTimeout(rc.armTimer); report(1500, true); return; }
    if (rc.state === "go") { clearTimeout(rc.timeout); report(Math.round(performance.now() - rc.greenAt), false); }
  }
  function report(ms, foul) {
    racePaint("sent", foul ? "Too early!" : `${ms} ms`, foul ? "You tapped before green" : `Waiting for ${esc(other()?.name || "them")}…`);
    const mine = iAm(rc.names);
    if (mine === 0) { rc.rts[0] = { ms, foul }; settleRace(); }
    else send("race", { t: "rt", r: rc.r, ms, foul });
  }
  function settleRace() { // starter only
    if (!rc.rts[0] || !rc.rts[1]) return;
    const [a, b] = rc.rts;
    const av = a.foul ? 9999 : a.ms, bv = b.foul ? 9999 : b.ms;
    const w = av === bv ? -1 : av < bv ? 0 : 1;
    if (w >= 0) rc.scores[w]++;
    const res = { t: "res", r: rc.r, rts: rc.rts, w, scores: rc.scores };
    send("race", res);
    showRes(res);
    setTimeout(() => {
      if (!ov || ov.kind !== "race") return;
      if (rc.r >= RR) { send("race", { t: "end", scores: rc.scores }); endRace(); }
      else nextRace();
    }, 2600);
  }
  function showRes(res) {
    rc.scores = res.scores; setScores(rc.scores);
    const mine = iAm(rc.names);
    const line = (i) => `<div class="rr-line ${res.w === i ? "win" : ""}"><span class="pl-face sm">${faceHtml(rc.names[i])}</span><span>${esc(i === mine ? "You" : rc.names[i])}</span><b>${res.rts[i].foul ? "Too early" : `${res.rts[i].ms} ms`}</b></div>`;
    racePaint("res", res.w < 0 ? "Tie!" : res.w === mine ? "You win this round" : `${esc(rc.names[res.w])} wins this round`, `${line(0)}${line(1)}`);
  }
  function nextRace() {
    const r = rc.r + 1, delay = 1400 + Math.round(Math.random() * 2600);
    send("race", { t: "arm", r, delay });
    arm(r, delay);
  }
  function endRace() {
    racePaint("res", "", "");
    finalPanel("race", rc.names, rc.scores, () => startRace());
    saveWin("race", rc.names, rc.scores);
  }
  function startRace() {
    const p = other();
    window.DU.kit.toggleTray(false);
    if (!p) return toast("Reaction race needs someone in the call");
    Object.assign(rc, { names: [me.name, p.name], r: 0, scores: [0, 0] });
    send("race", { t: "start", names: rc.names });
    raceUi();
    racePaint("ready", "Get ready", "Tap the moment the screen turns green");
    setTimeout(() => { if (ov?.kind === "race") nextRace(); }, 2200);
  }
  function onRace(d, peer) {
    switch (d.t) {
      case "start":
        Object.assign(rc, { names: d.names, r: 0, scores: [0, 0] });
        raceUi(); racePaint("ready", "Get ready", "Tap the moment the screen turns green"); break;
      case "arm": if (ov?.kind === "race") arm(Number(d.r), Math.max(800, Math.min(5000, Number(d.delay) || 2000))); break;
      case "rt":
        if (iAm(rc.names) === 0 && Number(d.r) === rc.r) { rc.rts[1] = { ms: Math.max(0, Math.min(9999, Number(d.ms) || 1500)), foul: Boolean(d.foul) }; settleRace(); }
        break;
      case "res": if (ov?.kind === "race") showRes(d); break;
      case "end": rc.scores = d.scores; setScores(rc.scores); endRace(); break;
      case "quit": if (ov?.kind === "race") { closeFrame(); toast(`${peer.name} left the race`); } break;
    }
  }

  // ---------- hooks ----------

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      if (button.dataset.tg === "pictionary") startPict();
      else if (button.dataset.tg === "race") startRace();
      else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type === "pict") onPict(message.data || {}, peer);
      else if (message.type === "race") onRace(message.data || {}, peer);
      else prev.msg?.(message, peer);
    },
    onCoupleLeave(...args) { prev.leave?.(...args); closeFrame(); },
  });
})();
