// DU Meet · Colour clash: a two-player card game in the "crazy eights" family. Match the top
// card by colour or symbol; Skip and Swap give you another turn, +2 and Wild +4 make the
// other player pick up, a Wild changes the colour. First to empty their hand wins.
// Both phones shuffle with the same seed, so only moves travel (play / draw / pass).

(() => {
  "use strict";
  const A = window.DU.arena;
  const { q } = A;
  const K = "clash";
  const COLS = { r: ["Red", "#ff3b30"], y: ["Yellow", "#ffcc00"], g: ["Green", "#34c759"], b: ["Blue", "#0a84ff"] };

  // seeded shuffle, the same on both phones
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffled(list, r) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  const CARDS = [];
  for (const c of Object.keys(COLS)) {
    CARDS.push({ c, v: "0" });
    for (const v of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "swap", "d2"]) CARDS.push({ c, v }, { c, v });
  }
  for (let i = 0; i < 4; i++) CARDS.push({ c: "w", v: "wild" }, { c: "w", v: "w4" });

  const GLYPH = { skip: "⊘", swap: "⇆", d2: "+2", wild: "★", w4: "+4" };
  const LABEL = { skip: "Skip", swap: "Swap", d2: "Draw 2", wild: "Wild", w4: "Wild +4" };
  function cardHtml(id, { play = false, small = false } = {}) {
    const k = CARDS[id];
    const g = GLYPH[k.v] || k.v;
    const name = `${k.c === "w" ? "" : `${COLS[k.c][0]} `}${LABEL[k.v] || k.v}`;
    return `<button class="cc cc-${k.c}${play ? " ok" : ""}${small ? " sm" : ""}${/^\d$/.test(k.v) ? "" : " act"}" data-card="${id}" aria-label="${name}"><i>${g}</i><b>${g}</b><i>${g}</i></button>`;
  }

  let G = null;

  function begin(names, seed, first) {
    const el = A.open(K, "Colour clash", "");
    A.panel(""); A.live(true);
    const r = rng(seed);
    let deck = shuffled(CARDS.map((_, i) => i), r);
    const hands = [[], []];
    for (let i = 0; i < 7; i++) { hands[0].push(deck.pop()); hands[1].push(deck.pop()); }
    // the first face-up card is a number
    let at = deck.length - 1;
    while (!/^\d$/.test(CARDS[deck[at]].v)) at -= 1;
    const top = deck.splice(at, 1)[0];
    G = { el, names, seed, r, first, turn: first, deck, discard: [top], col: CARDS[top].c, hands, drew: -1, over: false, picking: null };
    q(".ar-body", el).innerHTML = `${A.duel(names)}
      <div class="cl">
        <div class="cl-opp" aria-label="Their cards"></div>
        <div class="cl-mid"><button class="cl-pile" aria-label="Draw a card"><span>Draw</span></button><div class="cl-top"></div><span class="cl-col" aria-live="polite"></span></div>
        <div class="cl-msg" aria-live="polite"></div>
        <div class="cl-hand"></div>
        <div class="cl-acts"><button class="btn ghost cl-pass" hidden>Keep it, pass</button></div>
      </div>`;
    q(".cl-pile", el).addEventListener("click", () => myMove({ t: "draw" }));
    q(".cl-pass", el).addEventListener("click", () => myMove({ t: "pass" }));
    q(".cl-hand", el).addEventListener("click", (e) => {
      const c = e.target.closest("[data-card]");
      if (!c) return;
      const id = Number(c.dataset.card);
      if (!canPlay(id)) { c.animate([{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "none" }], { duration: 200 }); return; }
      if (CARDS[id].c === "w") return pickColour(id);
      myMove({ t: "play", id });
    });
    paint();
  }

  const me_ = () => G.names.indexOf(me.name);
  const myTurn = () => !G.over && G.turn === me_();
  function canPlay(id) {
    if (!myTurn()) return false;
    if (G.drew >= 0 && id !== G.drew) return false; // after drawing you may only play that card
    const k = CARDS[id], top = CARDS[G.discard[G.discard.length - 1]];
    return k.c === "w" || k.c === G.col || k.v === top.v;
  }

  function pickColour(id) {
    const p = A.panel(`<b class="ar-ptitle">Pick a colour</b><div class="cl-pick">${Object.entries(COLS).map(([k, [n, hex]]) => `<button data-col="${k}" style="--c:${hex}" aria-label="${n}"></button>`).join("")}</div><div class="ar-row"><button class="btn ghost" data-col="">Cancel</button></div>`);
    p.onclick = (e) => {
      const b = e.target.closest("[data-col]");
      if (!b) return;
      A.panel("");
      if (b.dataset.col) myMove({ t: "play", id, col: b.dataset.col });
    };
  }

  function myMove(m) {
    if (!G || !myTurn()) return;
    if (m.t === "draw" && G.drew >= 0) return;
    if (m.t === "pass" && G.drew < 0) return;
    send(K, m);
    apply(m, me_());
  }

  function drawOne(p) {
    if (!G.deck.length) {
      const top = G.discard.pop();
      G.deck = shuffled(G.discard, G.r);
      G.discard = [top];
      if (!G.deck.length) return -1;
    }
    const id = G.deck.pop();
    G.hands[p].push(id);
    return id;
  }

  function apply(m, p) {
    if (G.over || p !== G.turn) return;
    const o = 1 - p, who = G.names[p] === me.name ? "You" : G.names[p];
    if (m.t === "draw") {
      const id = drawOne(p);
      A.sound("tick");
      const k = id >= 0 ? CARDS[id] : null;
      const top = CARDS[G.discard[G.discard.length - 1]];
      if (k && (k.c === "w" || k.c === G.col || k.v === top.v)) { G.drew = id; msg(`${who} drew a card${p === me_() ? " — play it or pass" : ""}`); }
      else { G.drew = -1; G.turn = o; msg(`${who} drew a card`); }
    } else if (m.t === "pass") {
      G.drew = -1; G.turn = o; msg(`${who} passed`);
    } else if (m.t === "play") {
      const id = Number(m.id), i = G.hands[p].indexOf(id);
      if (i < 0) return;
      G.hands[p].splice(i, 1);
      G.discard.push(id);
      G.drew = -1;
      const k = CARDS[id];
      G.col = k.c === "w" ? (COLS[m.col] ? m.col : "r") : k.c;
      let again = false, text = `${who} played ${k.c === "w" ? `${LABEL[k.v]} → ${COLS[G.col][0]}` : `${COLS[k.c][0]} ${LABEL[k.v] || k.v}`}`;
      if (k.v === "skip" || k.v === "swap") again = true;
      if (k.v === "d2" || k.v === "w4") {
        const n = k.v === "d2" ? 2 : 4;
        for (let j = 0; j < n; j++) drawOne(o);
        again = true;
        text += ` · ${G.names[o] === me.name ? "you pick" : `${G.names[o]} picks`} up ${n}`;
      }
      A.sound(k.v === "d2" || k.v === "w4" ? "capture" : "move");
      if (!G.hands[p].length) {
        G.over = true; paint();
        return setTimeout(() => G && A.over(K, G.names, p, `${G.hands[o].length} card${G.hands[o].length === 1 ? "" : "s"} left in the other hand`, rematch), 500);
      }
      if (G.hands[p].length === 1) text += " · LAST CARD!";
      G.turn = again ? p : o;
      msg(text);
    }
    paint();
  }

  const msg = (t) => {
    const m = G && q(".cl-msg", G.el); if (m) { m.textContent = t; m.classList.remove("pop"); void m.offsetWidth; m.classList.add("pop"); }
    if (G && t) A.event(`Colour clash: ${t.replace(/\bYou\b/g, me.name).replace(/\byou pick\b/g, `${me.name} picks`).replace(/ — play it or pass/, "")} (cards left: ${G.names.map((n, i) => `${n} ${G.hands[i].length}`).join(", ")})`);
  };

  function paint() {
    if (!G) return;
    const mi = me_(), oi = 1 - mi;
    const el = G.el;
    q(".cl-opp", el).innerHTML = G.hands[oi].map(() => `<span class="cc-back"></span>`).join("");
    const top = G.discard[G.discard.length - 1];
    q(".cl-top", el).innerHTML = cardHtml(top);
    q(".cl-top", el).style.setProperty("--ring", COLS[G.col][1]);
    q(".cl-col", el).textContent = CARDS[top].c === "w" ? `Colour: ${COLS[G.col][0]}` : "";
    q(".cl-col", el).style.color = COLS[G.col][1];
    const hand = [...G.hands[mi]].sort((a, b) => (CARDS[a].c + CARDS[a].v).localeCompare(CARDS[b].c + CARDS[b].v));
    q(".cl-hand", el).innerHTML = hand.map((id) => cardHtml(id, { play: canPlay(id) })).join("");
    q(".cl-pile", el).classList.toggle("ok", myTurn() && G.drew < 0);
    q(".cl-pile span", el).textContent = `Draw · ${G.deck.length}`;
    q(".cl-pass", el).hidden = !(myTurn() && G.drew >= 0);
    A.setDuel({ turn: G.over ? -1 : G.turn, scores: G.hands.map((h) => `${h.length} 🂠`) });
    A.status(G.over ? "Game over" : myTurn() ? (G.drew >= 0 ? "Play the card you drew, or pass" : "Your turn") : `${G.names[G.turn]}'s turn`);
  }

  function start() {
    const names = [me.name, A.other().name];
    const seed = Math.floor(Math.random() * 2 ** 31);
    begin(names, seed, 0);
    send(K, { t: "start", names, seed, first: 0 });
  }
  function rematch() {
    const seed = Math.floor(Math.random() * 2 ** 31), f = 1 - G.first;
    begin(G.names, seed, f);
    send(K, { t: "start", names: G.names, seed, first: f });
  }
  function onMsg(d, peer) {
    if (d.t === "start") { begin(d.names, Number(d.seed) || 1, d.first || 0); toast(`${peer.name} started Colour clash`); return; }
    if (!G) return;
    const p = G.names.indexOf(peer.name);
    if (p >= 0) apply(d, p);
  }
  A.register(K, { start, onMsg, cleanup() { G = null; } });
})();
