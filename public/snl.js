// DU Meet · Snakes & ladders for two. Roll the dice, climb ladders, slide down snakes;
// land exactly on 100 to win, a six rolls again. Rolls travel through the relay (send)
// and both phones move the tokens the same way. Uses window.DU.arena for the window.

(() => {
  "use strict";
  const A = window.DU.arena;
  const { q } = A;
  const K = "snl";
  const COLORS = ["#0a84ff", "#ff375f"];
  const LADDERS = { 3: 22, 8: 30, 20: 41, 28: 76, 36: 55, 50: 67, 63: 81, 71: 92 };
  const SNAKES = { 99: 78, 93: 66, 87: 57, 64: 42, 54: 31, 47: 26, 33: 12, 17: 7 };
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let S = null;

  // cell n (1..100) → centre in board percent; row 0 is the bottom, rows snake left/right
  function at(n) {
    if (n <= 0) return { x: 5, y: 95 }; // waiting at the start, on square 1
    const r = Math.floor((n - 1) / 10), c = r % 2 === 0 ? (n - 1) % 10 : 9 - ((n - 1) % 10);
    return { x: c * 10 + 5, y: (9 - r) * 10 + 5 };
  }

  function boardSvg() {
    let s = "";
    for (const [a, b] of Object.entries(LADDERS)) {
      const p = at(+a), t = at(b);
      const dx = t.x - p.x, dy = t.y - p.y, len = Math.hypot(dx, dy), nx = (-dy / len) * 1.8, ny = (dx / len) * 1.8;
      const rungs = Math.max(2, Math.round(len / 4.5));
      let r = "";
      for (let i = 1; i < rungs; i++) { const k = i / rungs, x = p.x + dx * k, y = p.y + dy * k; r += `<line x1="${x - nx}" y1="${y - ny}" x2="${x + nx}" y2="${y + ny}"/>`; }
      s += `<g class="sl-ladder"><line x1="${p.x - nx}" y1="${p.y - ny}" x2="${t.x - nx}" y2="${t.y - ny}"/><line x1="${p.x + nx}" y1="${p.y + ny}" x2="${t.x + nx}" y2="${t.y + ny}"/>${r}</g>`;
    }
    const hues = ["#30d158", "#ff9f0a", "#bf5af2", "#ff375f", "#64d2ff", "#ffd60a", "#ff6b3d", "#5e5ce6"];
    Object.entries(SNAKES).forEach(([a, b], i) => {
      const h = at(+a), t = at(b);
      const dx = t.x - h.x, dy = t.y - h.y, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len, w = Math.min(7, len / 4);
      const c1 = `${h.x + dx * .3 + nx * w} ${h.y + dy * .3 + ny * w}`, c2 = `${h.x + dx * .7 - nx * w} ${h.y + dy * .7 - ny * w}`;
      const d = `M${h.x} ${h.y} C${c1} ${c2} ${t.x} ${t.y}`;
      s += `<g class="sl-snake" style="--sc:${hues[i % hues.length]}"><path class="sl-sb" d="${d}"/><path class="sl-sp" d="${d}"/><circle cx="${h.x}" cy="${h.y}" r="2.3"/><circle class="sl-eye" cx="${h.x - .7}" cy="${h.y - .5}" r=".5"/><circle class="sl-eye" cx="${h.x + .7}" cy="${h.y - .5}" r=".5"/></g>`;
    });
    return `<svg class="sl-art" viewBox="0 0 100 100" aria-hidden="true">${s}</svg>`;
  }

  function boardHtml(names) {
    let cells = "";
    for (let row = 9; row >= 0; row--) {
      for (let col = 0; col < 10; col++) {
        const n = row * 10 + (row % 2 === 0 ? col + 1 : 10 - col);
        cells += `<span class="sl-c${(row + col) % 2 ? " alt" : ""}${n === 100 ? " goal" : ""}">${n === 100 ? "🏁" : n}</span>`;
      }
    }
    return `${A.duel(names, COLORS)}
      <div class="sl-wrap"><div class="sl-board"><div class="sl-cells">${cells}</div>${boardSvg()}
        ${names.map((n, i) => `<span class="sl-tok" data-p="${i}" style="--pc:${COLORS[i]}">${A.faceHtml(n)}</span>`).join("")}</div></div>
      <div class="sl-foot"><button class="sl-dice" type="button" aria-label="Roll the dice"><span class="sl-face"></span></button><small class="sl-msg" aria-live="polite"></small></div>`;
  }

  function placeTok(i, n, hop = false) {
    const t = S?.el.querySelector(`.sl-tok[data-p="${i}"]`);
    if (!t) return;
    const p = at(n), same = S.pos[0] === S.pos[1];
    t.style.left = `${p.x + (same ? (i ? 2 : -2) : 0)}%`;
    t.style.top = `${p.y + (same ? (i ? 1.5 : -1.5) : 0)}%`;
    if (hop) { t.classList.remove("hop"); void t.offsetWidth; t.classList.add("hop"); }
  }
  function showDie(v) {
    const f = S && q(".sl-face", S.el);
    if (f) f.innerHTML = Array.from({ length: 9 }, (_, i) => `<i${PIPS[v].includes(i) ? ' class="on"' : ""}></i>`).join("");
  }
  const msg = (t) => {
    const m = S && q(".sl-msg", S.el); if (m) m.textContent = t;
    if (t && !/^Tap /.test(t)) A.event(`Snakes & ladders: ${t.replace(/\bYou\b/g, me.name)}`);
  };

  function paint() {
    if (!S) return;
    const mine = !S.over && !S.busy && S.names[S.turn] === me.name;
    q(".sl-dice", S.el).classList.toggle("ready", mine);
    q(".sl-dice", S.el).disabled = !mine;
    A.setDuel({ turn: S.over ? -1 : S.turn, scores: S.pos.map((p) => (p ? p : "–")), subs: ["", ""] });
    A.status(S.over ? "Game over" : S.busy ? "Moving…" : S.names[S.turn] === me.name ? "Your turn: roll the dice" : `${S.names[S.turn]}'s turn`);
  }

  function begin(names, first) {
    const el = A.open(K, "Snakes & ladders", "");
    A.panel(""); A.live(true);
    S = { el, names, first, turn: first, pos: [0, 0], busy: false, over: false, queue: [] };
    q(".ar-body", el).innerHTML = boardHtml(names);
    names.forEach((_, i) => placeTok(i, 0));
    showDie(1);
    msg(S.names[first] === me.name ? "Tap the dice to roll" : "");
    q(".sl-dice", el).addEventListener("click", () => {
      if (!S || S.over || S.busy || S.names[S.turn] !== me.name) return;
      const v = A.rand(6) + 1;
      send(K, { t: "roll", v, p: S.turn });
      apply(v);
    });
    paint();
  }

  async function apply(v) {
    if (!S) return;
    if (S.busy) { S.queue.push(v); return; }
    S.busy = true; paint();
    const who = S.turn, name = S.names[who] === me.name ? "You" : S.names[who];
    const dice = q(".sl-dice", S.el);
    dice.classList.add("roll"); A.sound("dice");
    for (let i = 0; i < 6; i++) { showDie(1 + A.rand(6)); await wait(70); }
    dice.classList.remove("roll"); showDie(v);
    await wait(250);
    if (!S) return;
    const from = S.pos[who];
    if (from + v > 100) {
      msg(`${name} rolled ${v} · need exactly ${100 - from}`);
      A.sound("bad");
    } else {
      for (let n = from + 1; n <= from + v; n++) { S.pos[who] = n; placeTok(who, n, true); A.sound("tick"); await wait(190); if (!S) return; }
      const land = S.pos[who], jump = LADDERS[land] || SNAKES[land];
      if (jump) {
        await wait(150);
        const up = jump > land;
        msg(up ? `${name} climbed a ladder! ${land} → ${jump} 🪜` : `Snake! ${name} slid ${land} → ${jump} 🐍`);
        A.sound(up ? "good" : "lose");
        const t = S.el.querySelector(`.sl-tok[data-p="${who}"]`);
        t.classList.add("slide");
        S.pos[who] = jump; placeTok(who, jump); placeTok(1 - who, S.pos[1 - who]);
        await wait(750);
        if (!S) return;
        t.classList.remove("slide");
      } else msg(`${name} rolled ${v}`);
      placeTok(1 - who, S.pos[1 - who]);
    }
    if (S.pos[who] === 100) {
      S.over = true; S.busy = false; paint();
      setTimeout(() => S && A.over(K, S.names, who, "First to 100", rematch), 600);
      return;
    }
    if (v === 6 && from + v <= 100) msg(`${name} rolled a 6 · roll again!`);
    else S.turn = 1 - who;
    S.busy = false;
    paint();
    if (S.queue.length) apply(S.queue.shift());
  }

  function start() {
    const names = [me.name, A.other().name];
    begin(names, 0);
    send(K, { t: "start", names, first: 0 });
  }
  function rematch() {
    const f = 1 - S.first;
    begin(S.names, f);
    send(K, { t: "start", names: S.names, first: f });
  }
  function onMsg(d, peer) {
    if (d.t === "start") { begin(d.names, d.first || 0); toast(`${peer.name} started Snakes & ladders`); return; }
    if (d.t === "roll" && S && !S.over && d.v >= 1 && d.v <= 6) apply(d.v);
  }
  A.register(K, { start, onMsg, cleanup() { S = null; } });
})();
