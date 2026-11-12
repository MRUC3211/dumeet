// DU Meet · Ludo for two: four tokens each from opposite corners. A six brings a token
// out and gives another roll (three sixes in a row lose the turn), landing on the other
// one's token sends it home and gives another roll, stars and start squares are safe,
// and you need the exact number to reach home.

(() => {
  "use strict";
  const A = window.DU.arena;
  const { esc, q } = A;
  const K = "ludo";

  // the 52-square track, clockwise, starting next to the top-left base
  const TRACK = [];
  const seg = (cells) => TRACK.push(...cells);
  const range = (a, b) => { const out = []; const s = a <= b ? 1 : -1; for (let i = a; i !== b + s; i += s) out.push(i); return out; };
  seg(range(1, 5).map((c) => [6, c]));
  seg(range(5, 0).map((r) => [r, 6]));
  seg([[0, 7], [0, 8]]);
  seg(range(1, 5).map((r) => [r, 8]));
  seg(range(9, 14).map((c) => [6, c]));
  seg([[7, 14], [8, 14]]);
  seg(range(13, 9).map((c) => [8, c]));
  seg(range(9, 14).map((r) => [r, 8]));
  seg([[14, 7], [14, 6]]);
  seg(range(13, 9).map((r) => [r, 6]));
  seg(range(5, 0).map((c) => [8, c]));
  seg([[7, 0], [6, 0]]);

  const P = [
    { start: 0, home: range(1, 5).map((c) => [7, c]), base: [[2, 2], [2, 4], [4, 2], [4, 4]], color: "#0a84ff", name: "blue" },
    { start: 26, home: range(13, 9).map((c) => [7, c]), base: [[11, 11], [11, 13], [13, 11], [13, 13]], color: "#ff375f", name: "pink" },
  ];
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
  const FINISH = 56; // 0..50 on the track, 51..55 the home lane, 56 home

  const trackIndex = (pl, prog) => (P[pl].start + prog) % 52;
  function cellOf(pl, tok, prog) {
    if (prog < 0) return P[pl].base[tok];
    if (prog <= 50) { const [r, c] = TRACK[trackIndex(pl, prog)]; return [r + 0.5, c + 0.5]; }
    if (prog < FINISH) { const [r, c] = P[pl].home[prog - 51]; return [r + 0.5, c + 0.5]; }
    return [7.5 + (pl ? 0.55 : -0.55), 7.5 + (tok - 1.5) * 0.42];
  }

  let L = null;

  function start() {
    const other = A.other()?.name;
    if (!other) return;
    const names = [me.name, other];
    begin(names, 0);
    send(K, { t: "start", names, first: 0 });
  }

  function begin(names, first) {
    A.open(K, "Ludo", "");
    A.panel("");
    A.live(true);
    L = { names, toks: [[-1, -1, -1, -1], [-1, -1, -1, -1]], turn: first, roll: 0, rolled: false, sixes: 0, busy: false, over: false };
    const body = q(".ar-body", A.current().el);
    body.innerHTML = `${A.duel(names, [P[0].color, P[1].color])}
      <div class="ld-wrap"><div class="ld-board">${boardHtml()}<div class="ld-toks"></div></div></div>
      <div class="ld-ctrl"><button class="ld-die" aria-label="Roll the dice"><span class="ld-face" data-v="1"></span></button><small class="ld-hint"></small></div>`;
    q(".ld-die", body).addEventListener("click", roll);
    q(".ld-toks", body).addEventListener("click", (e) => {
      const t = e.target.closest("[data-tok]");
      if (t) pick(Number(t.dataset.pl), Number(t.dataset.tok));
    });
    paint();
  }

  function boardHtml() {
    let cells = "";
    const lane = new Map();
    P.forEach((p, i) => p.home.forEach(([r, c]) => lane.set(`${r},${c}`, i)));
    TRACK.forEach(([r, c], i) => {
      const owner = i === P[0].start ? 0 : i === P[1].start ? 1 : -1;
      const star = SAFE.has(i) && owner < 0;
      cells += `<i class="ld-c${owner >= 0 ? ` st p${owner}` : ""}${star ? " star" : ""}" style="grid-area:${r + 1}/${c + 1}"></i>`;
    });
    for (const [k, i] of lane) { const [r, c] = k.split(",").map(Number); cells += `<i class="ld-c lane p${i}" style="grid-area:${r + 1}/${c + 1}"></i>`; }
    const base = (r, c, cls) => `<div class="ld-base ${cls}" style="grid-area:${r + 1}/${c + 1}/span 6/span 6"><span></span><span></span><span></span><span></span></div>`;
    return `<div class="ld-grid">${cells}${base(0, 0, "p0")}${base(0, 9, "off a")}${base(9, 0, "off b")}${base(9, 9, "p1")}<div class="ld-mid" style="grid-area:7/7/span 3/span 3"></div></div>`;
  }

  const mine = () => L && L.names[L.turn] === me.name;

  function movable(pl, value) {
    return L.toks[pl].map((prog, t) => {
      if (prog === FINISH) return -1;
      if (prog < 0) return value === 6 ? t : -1;
      return prog + value <= FINISH ? t : -1;
    }).filter((t) => t >= 0);
  }

  function paint() {
    if (!L || !A.current()) return;
    const el = A.current().el;
    const layer = q(".ld-toks", el);
    const stack = new Map();
    const can = L.rolled && mine() && !L.busy ? new Set(movable(L.turn, L.roll)) : new Set();
    let html = "";
    L.toks.forEach((list, pl) => list.forEach((prog, t) => {
      const [r, c] = cellOf(pl, t, prog);
      const k = `${r},${c}`;
      const n = prog >= 0 && prog < FINISH ? (stack.get(k) || 0) : 0;
      stack.set(k, n + 1);
      const off = n * 0.18;
      html += `<button class="ld-tok p${pl}${pl === L.turn && can.has(t) ? " can" : ""}${prog === FINISH ? " done" : ""}" data-pl="${pl}" data-tok="${t}"
        style="--x:${c - 0.5 + off};--y:${r - 0.5 - off}" aria-label="${esc(L.names[pl])} token ${t + 1}" ${pl === L.turn && can.has(t) ? "" : "tabindex=-1"}></button>`;
    }));
    // keep the same elements where possible so moves glide
    const old = [...layer.children];
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    if (old.length === 8) {
      [...tmp.children].forEach((n, i) => { old[i].className = n.className; old[i].style.cssText = n.style.cssText; old[i].tabIndex = n.tabIndex; });
    } else layer.innerHTML = html;
    const home = L.toks.map((list) => list.filter((p) => p === FINISH).length);
    A.setDuel({ turn: L.over ? -1 : L.turn, scores: home.map((h) => `${h}/4`), subs: ["", ""] });
    const die = q(".ld-die", el);
    die.disabled = !mine() || L.rolled || L.busy || L.over;
    die.style.setProperty("--pc", P[L.turn].color);
    die.classList.toggle("ready", !die.disabled);
    q(".ld-face", el).dataset.v = L.roll || 1;
    const hint = q(".ld-hint", el);
    hint.textContent = L.over ? "" : mine() ? (L.rolled ? (can.size ? "Tap a glowing token" : "No move possible") : "Your turn: roll the dice") : `${L.names[L.turn]}'s turn`;
    A.status(mine() ? "Your turn" : `${L.names[L.turn]}'s turn`);
  }

  function roll() {
    if (!mine() || L.rolled || L.busy || L.over) return;
    const v = A.rand(6) + 1;
    send(K, { t: "roll", v });
    applyRoll(v);
  }

  function applyRoll(v) {
    L.busy = true;
    A.sound("dice");
    const die = q(".ld-die", A.current().el);
    die.classList.remove("spin");
    void die.offsetWidth;
    die.classList.add("spin");
    let n = 0;
    const face = q(".ld-face", die);
    const spin = setInterval(() => { face.dataset.v = (n++ % 6) + 1; }, 70);
    setTimeout(() => {
      clearInterval(spin);
      L.roll = v; L.rolled = true; L.busy = false;
      L.sixes = v === 6 ? L.sixes + 1 : 0;
      if (L.sixes === 3) { toast("Three sixes, turn lost 😅"); return setTimeout(() => endTurn(false), 700); }
      const options = movable(L.turn, v);
      paint();
      if (!options.length) return setTimeout(() => endTurn(false), 900);
      // only one sensible choice: do it automatically
      const distinct = new Set(options.map((t) => L.toks[L.turn][t]));
      if (mine() && distinct.size === 1) setTimeout(() => pick(L.turn, options[0]), 500);
    }, 560);
  }

  function pick(pl, tok) {
    if (!mine() || pl !== L.turn || !L.rolled || L.busy) return;
    if (!movable(pl, L.roll).includes(tok)) return;
    send(K, { t: "move", tok });
    applyMove(tok);
  }

  function applyMove(tok) {
    const pl = L.turn;
    const from = L.toks[pl][tok];
    const to = from < 0 ? 0 : from + L.roll;
    L.busy = true;
    const steps = from < 0 ? [0] : range(from + 1, to);
    let i = 0;
    const hop = () => {
      L.toks[pl][tok] = steps[i];
      A.sound("tick");
      paint();
      if (++i < steps.length) return setTimeout(hop, 150);
      setTimeout(() => land(pl, tok, to, from), 120);
    };
    hop();
  }

  function land(pl, tok, to, from) {
    let bonus = L.roll === 6;
    if (to <= 50) {
      const spot = trackIndex(pl, to);
      if (!SAFE.has(spot)) {
        const o = 1 - pl;
        L.toks[o].forEach((prog, t) => {
          if (prog >= 0 && prog <= 50 && trackIndex(o, prog) === spot) {
            L.toks[o][t] = -1;
            bonus = true;
            A.sound("capture");
            toast(pl === L.names.indexOf(me.name) ? "Gotcha! Sent home 😈" : `${L.names[pl]} sent your token home 😤`);
          }
        });
      }
    }
    if (to === FINISH) { bonus = true; A.sound("good"); }
    if (from < 0) A.sound("good");
    L.busy = false;
    if (L.toks[pl].every((p) => p === FINISH)) {
      L.over = true;
      paint();
      return setTimeout(() => A.over(K, L.names, pl, "All four tokens home", rematch), 600);
    }
    endTurn(bonus);
  }

  function endTurn(again) {
    if (!L || L.over) return;
    if (!again) { L.turn = 1 - L.turn; L.sixes = 0; }
    L.rolled = false;
    L.busy = false;
    paint();
  }

  function rematch() {
    const names = L.names;
    const first = L.names.indexOf(me.name) === 0 ? 1 : 0;
    begin(names, first);
    send(K, { t: "start", names, first });
  }

  function onMsg(d, peer) {
    if (d.t === "start") { begin(d.names, d.first || 0); toast(`${peer.name} started Ludo`); return; }
    if (!L || L.over) return;
    // wait for this phone's own animation to catch up before applying the next step
    const when = (ready, fn) => { if (!L || L.over) return; if (!ready()) return setTimeout(() => when(ready, fn), 100); fn(); };
    if (d.t === "roll" && !mine()) when(() => !L.busy && !L.rolled, () => applyRoll(Number(d.v)));
    if (d.t === "move" && !mine()) when(() => !L.busy && L.rolled, () => applyMove(Number(d.tok)));
  }

  A.register(K, { start, onMsg, cleanup() { L = null; } });
})();
