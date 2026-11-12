// DU Meet · three more two-player games on the shared game stage (arena.js):
//   Dots & boxes  draw lines in turns; close a box to own it and go again
//   Word chain    say a word that starts with the last letter of the previous one, in 20 s
//   Emoji riddles guess the movie, song or phrase from emojis; fastest right tap wins the point
// The first player's phone is the referee where timing matters, so both phones agree.

(() => {
  "use strict";
  const A = window.DU.arena;
  const { q, esc } = A;
  const COLORS = ["#0a84ff", "#ff375f"];
  const D = () => window.DU.deck;

  // =================================================================
  // Dots & boxes
  // =================================================================
  {
    const K = "dots";
    const N = 4; // boxes per side
    let G = null;
    const mine = () => G.names.indexOf(me.name);
    const lines = () => {
      const out = [];
      for (let r = 0; r <= N; r++) for (let c = 0; c < N; c++) out.push(`h${r}-${c}`);
      for (let r = 0; r < N; r++) for (let c = 0; c <= N; c++) out.push(`v${r}-${c}`);
      return out;
    };
    const sides = (r, c) => [`h${r}-${c}`, `h${r + 1}-${c}`, `v${r}-${c}`, `v${r}-${c + 1}`];

    function begin(names) {
      const el = A.open(K, "Dots & boxes", "");
      A.panel(""); A.live(true);
      G = { el, names, taken: {}, boxes: {}, turn: 0, scores: [0, 0], over: false };
      const S = 52, P = 14, W = N * S + P * 2;
      let svg = `<svg class="db-svg" viewBox="0 0 ${W} ${W}" role="img" aria-label="Dots and boxes board">`;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) svg += `<rect class="db-box" data-b="${r}-${c}" x="${P + c * S + 4}" y="${P + r * S + 4}" width="${S - 8}" height="${S - 8}" rx="8"/>`;
      for (const id of lines()) {
        const h = id[0] === "h", [r, c] = id.slice(1).split("-").map(Number);
        const x1 = P + c * S, y1 = P + r * S, x2 = h ? x1 + S : x1, y2 = h ? y1 : y1 + S;
        svg += `<g class="db-line" data-l="${id}" tabindex="0" role="button" aria-label="Line ${id}"><line class="db-hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><line class="db-ln" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/></g>`;
      }
      for (let r = 0; r <= N; r++) for (let c = 0; c <= N; c++) svg += `<circle class="db-dot" cx="${P + c * S}" cy="${P + r * S}" r="5"/>`;
      q(".ar-body", el).innerHTML = `${A.duel(names, COLORS)}<div class="db">${svg}</svg></div><p class="db-tip">Close a box to own it and play again.</p>`;
      const tap = (e) => { const l = e.target.closest("[data-l]"); if (l) move(l.dataset.l); };
      q(".db-svg", el).addEventListener("click", tap);
      q(".db-svg", el).addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(e); } });
      paint();
    }
    function move(id) {
      if (!G || G.over || G.taken[id] !== undefined) return;
      if (G.turn !== mine()) return A.status(`${G.names[G.turn]}'s turn`);
      apply(id, mine());
      send(K, { t: "line", id, by: mine() });
    }
    function apply(id, who) {
      if (!G || G.taken[id] !== undefined || who !== G.turn) return;
      G.taken[id] = who;
      let closed = 0;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const k = `${r}-${c}`;
        if (G.boxes[k] === undefined && sides(r, c).every((s) => G.taken[s] !== undefined)) { G.boxes[k] = who; G.scores[who] += 1; closed += 1; }
      }
      if (!closed) G.turn = 1 - G.turn;
      A.sound(closed ? "good" : "move");
      if (closed) A.event(`Dots & boxes: ${G.names[who]} closed ${closed} box${closed > 1 ? "es" : ""}. Score ${G.names[0]} ${G.scores[0]} – ${G.scores[1]} ${G.names[1]}`);
      paint();
      if (Object.keys(G.taken).length === lines().length) {
        G.over = true;
        const [a, b] = G.scores;
        A.over(K, G.names, a === b ? -1 : a > b ? 0 : 1, `${a} – ${b} boxes`, () => { begin([G.names[1], G.names[0]]); send(K, { t: "start", names: G.names }); });
      }
    }
    function paint() {
      if (!G) return;
      G.el.querySelectorAll("[data-l]").forEach((g) => {
        const t = G.taken[g.dataset.l];
        g.classList.toggle("on", t !== undefined);
        g.style.setProperty("--pc", t !== undefined ? COLORS[t] : COLORS[G.turn]);
        g.classList.toggle("can", t === undefined && G.turn === mine() && !G.over);
      });
      G.el.querySelectorAll("[data-b]").forEach((b) => { const o = G.boxes[b.dataset.b]; b.style.fill = o === undefined ? "" : COLORS[o]; b.classList.toggle("own", o !== undefined); });
      A.setDuel({ turn: G.over ? -1 : G.turn, scores: G.scores });
      if (!G.over) A.status(G.turn === mine() ? "Your turn: draw a line" : `${G.names[G.turn]} is thinking…`);
    }
    function start() { const names = [me.name, A.other().name]; begin(names); send(K, { t: "start", names }); }
    A.register(K, {
      start,
      onMsg(d, peer) {
        if (d.t === "start" && Array.isArray(d.names)) { begin(d.names.map(String)); toast(`${peer.name} started Dots & boxes`); return; }
        if (d.t === "line" && G) apply(String(d.id), Number(d.by));
      },
      describe: () => G && { boxes_left: N * N - Object.keys(G.boxes).length, lines_left: lines().length - Object.keys(G.taken).length, score: G.scores, turn: G.names[G.turn] },
      cleanup() { G = null; },
    });
  }

  // =================================================================
  // Word chain
  // =================================================================
  {
    const K = "chain";
    const LIMIT = 20000, LIVES = 3;
    const LETTERS = "abcdefghiklmnoprstw";
    let C = null;
    const mine = () => C.names.indexOf(me.name);
    const lastLetter = () => {
      const w = C.words[C.words.length - 1]?.w;
      return w ? w.replace(/[^a-z]/g, "").slice(-1) : C.first;
    };

    function begin(names, first) {
      const el = A.open(K, "Word chain", "");
      A.panel(""); A.live(true);
      C = { el, names, first, words: [], turn: 0, lives: [LIVES, LIVES], timer: 0, tick: 0, deadline: 0, over: false };
      q(".ar-body", el).innerHTML = `${A.duel(names, COLORS)}<div class="wc">
        <div class="wc-letter"><small>Next word starts with</small><b></b><i class="wc-bar"><i></i></i></div>
        <form class="wc-form"><input class="field" maxlength="24" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type a word…" aria-label="Your word"><button class="btn primary">Go</button></form>
        <p class="wc-msg" aria-live="polite"></p><ul class="wc-words"></ul>
        <p class="wc-tip">Real words only, no repeats. Think a word is fake? Tap ✋ on it to challenge.</p></div>`;
      q(".wc-form", el).addEventListener("submit", (e) => { e.preventDefault(); submit(); });
      q(".wc-words", el).addEventListener("click", (e) => { const b = e.target.closest("[data-ch]"); if (b) challenge(Number(b.dataset.ch), true); });
      turnStart();
    }
    function turnStart() {
      if (!C || C.over) return;
      clearTimeout(C.timer); clearInterval(C.tick);
      C.deadline = Date.now() + LIMIT;
      const yours = C.turn === mine();
      const input = q(".wc-form input", C.el);
      input.disabled = !yours; q(".wc-form .btn", C.el).disabled = !yours;
      input.value = "";
      if (yours) setTimeout(() => input.focus({ preventScroll: true }), 60);
      // only the player whose turn it is runs the clock, so there's one decision
      if (yours) C.timer = setTimeout(() => { send(K, { t: "miss", turn: C.turn, n: C.words.length }); miss(C.turn, "Time's up"); }, LIMIT);
      C.tick = setInterval(paintBar, 200);
      paint();
    }
    function submit() {
      if (!C || C.over || C.turn !== mine()) return;
      const input = q(".wc-form input", C.el);
      const w = input.value.trim().toLowerCase().replace(/[^a-z]/g, "");
      const msg = q(".wc-msg", C.el);
      if (w.length < 3) { msg.textContent = "At least 3 letters"; return; }
      if (w[0] !== lastLetter()) { msg.textContent = `It has to start with “${lastLetter().toUpperCase()}”`; A.sound("bad"); return; }
      if (C.words.some((x) => x.w === w)) { msg.textContent = "Already used! Try another"; A.sound("bad"); return; }
      send(K, { t: "word", w, turn: C.turn, n: C.words.length });
      add(w, C.turn);
    }
    function add(w, who) {
      if (!C || who !== C.turn) return;
      C.words.push({ w, by: who });
      q(".wc-msg", C.el).textContent = "";
      A.sound("move");
      A.event(`Word chain: ${C.names[who]} said "${w}"`);
      C.turn = 1 - C.turn;
      turnStart();
    }
    function miss(who, why) {
      if (!C || C.over || who !== C.turn) return;
      C.lives[who] -= 1;
      A.sound("bad");
      q(".wc-msg", C.el).textContent = `${who === mine() ? "You" : C.names[who]} lost a heart · ${why}`;
      A.event(`Word chain: ${C.names[who]} lost a heart (${why}). Hearts ${C.lives[0]} – ${C.lives[1]}`);
      if (C.lives[who] <= 0) return finish(1 - who);
      C.first = LETTERS[Math.floor(((C.words.length * 7) + who * 3 + C.lives[0] * 5) % LETTERS.length)];
      C.words.push({ w: "", by: -1, reset: C.first });
      C.turn = 1 - who;
      turnStart();
    }
    // the other player says the last word isn't real: it's taken back and that player loses a heart
    function challenge(i, mineTap) {
      if (!C || C.over) return;
      const x = C.words[i];
      if (!x || x.by < 0 || x.challenged || i !== C.words.length - 1) return;
      if (mineTap && x.by === mine()) return;
      x.challenged = true;
      if (mineTap) send(K, { t: "challenge", i });
      C.words.splice(i, 1);
      C.turn = x.by;
      miss(x.by, `“${x.w}” was challenged`);
    }
    function finish(winner) {
      C.over = true;
      clearTimeout(C.timer); clearInterval(C.tick);
      A.over(K, C.names, winner, `${C.words.filter((x) => x.w).length} words in the chain`, () => {
        const f = LETTERS[Math.floor(Math.random() * LETTERS.length)];
        begin([C.names[1], C.names[0]], f); send(K, { t: "start", names: C.names, first: f });
      });
    }
    function paintBar() {
      if (!C) return;
      const left = Math.max(0, C.deadline - Date.now());
      const bar = q(".wc-bar i", C.el);
      if (bar) { bar.style.width = `${(left / LIMIT) * 100}%`; bar.classList.toggle("low", left < 5000); }
    }
    function paint() {
      const L = lastLetter().toUpperCase();
      q(".wc-letter b", C.el).textContent = L;
      const words = C.words.map((x, i) => ({ ...x, i })).filter((x) => x.w).slice(-12).reverse();
      const lastI = C.words.length - 1;
      q(".wc-words", C.el).innerHTML = words.map((x) => `<li style="--pc:${COLORS[x.by]}"><b>${esc(x.w)}</b><small>${x.by === mine() ? "You" : esc(C.names[x.by])}</small>${x.i === lastI && x.by !== mine() && !C.over ? `<button class="icon-btn" data-ch="${x.i}" aria-label="Challenge ${esc(x.w)}" title="Not a real word?">✋</button>` : ""}</li>`).join("");
      A.setDuel({ turn: C.over ? -1 : C.turn, scores: C.lives.map((n) => "♥".repeat(Math.max(0, n)) || "–") });
      A.status(C.turn === mine() ? `Your turn · a word with “${L}”` : `${C.names[C.turn]} is thinking of a “${L}” word…`);
      paintBar();
    }
    function start() {
      const names = [me.name, A.other().name], first = LETTERS[Math.floor(Math.random() * LETTERS.length)];
      begin(names, first); send(K, { t: "start", names, first });
    }
    A.register(K, {
      start,
      onMsg(d, peer) {
        if (d.t === "start" && Array.isArray(d.names)) { begin(d.names.map(String), String(d.first || "s").slice(0, 1)); toast(`${peer.name} started Word chain`); return; }
        if (!C) return;
        if (d.t === "word" && Number(d.n) === C.words.length) add(String(d.w).replace(/[^a-z]/g, "").slice(0, 24), Number(d.turn));
        if (d.t === "miss" && Number(d.n) === C.words.length) miss(Number(d.turn), "Time's up");
        if (d.t === "challenge") challenge(Number(d.i), false);
      },
      describe: () => C && { next_letter: lastLetter(), words: C.words.filter((x) => x.w).map((x) => `${C.names[x.by]}: ${x.w}`).slice(-10), hearts: C.lives, turn: C.names[C.turn] },
      cleanup() { if (C) { clearTimeout(C.timer); clearInterval(C.tick); } C = null; },
    });
  }

  // =================================================================
  // Emoji riddles
  // =================================================================
  {
    const K = "emoji";
    const ROUNDS = 10, LIMIT = 20000, LOCK = 1500;
    // [emojis, answer, wrong options…, category]
    const BANK = [
      ["👑🦁", "The Lion King", "Jungle Book", "Madagascar", "Movie"], ["🚢🧊💔", "Titanic", "Frozen", "Life of Pi", "Movie"],
      ["🕷️🧑", "Spider-Man", "Ant-Man", "Batman", "Movie"], ["🦇🧑", "Batman", "Iron Man", "Superman", "Movie"],
      ["❄️👸", "Frozen", "Cinderella", "Moana", "Movie"], ["🧙‍♂️💍🌋", "The Lord of the Rings", "Harry Potter", "The Hobbit sequel", "Movie"],
      ["🦖🏝️", "Jurassic Park", "King Kong", "Godzilla", "Movie"], ["👻🚫", "Ghostbusters", "Casper", "The Others", "Movie"],
      ["🏏🇮🇳🏆", "Lagaan", "83", "Iqbal", "Bollywood"], ["🤼‍♀️👨‍👧‍👧", "Dangal", "Sultan", "Mary Kom", "Bollywood"],
      ["🧠🔄🎓", "3 Idiots", "Chhichhore", "Taare Zameen Par", "Bollywood"], ["🚂💃🌼", "Dilwale Dulhania Le Jayenge", "Kuch Kuch Hota Hai", "Jab We Met", "Bollywood"],
      ["👽📻", "PK", "Koi... Mil Gaya", "Ra.One", "Bollywood"], ["🌧️🎤🕺", "Singin' in the Rain", "La La Land", "Mamma Mia", "Movie"],
      ["🐒👑🏹", "Ramayana", "Mahabharata", "Bahubali", "Story"], ["🏰⚔️👑💪", "Baahubali", "Padmaavat", "Bajirao Mastani", "Bollywood"],
      ["🚀🔴🇮🇳👩‍🔬", "Mission Mangal", "Interstellar", "Gravity", "Movie"], ["💃🔴🌹", "Lady in Red", "Roses are Red", "Red Dress", "Phrase"],
      ["🌍🔥", "Global warming", "Wildfire", "Hot planet", "Phrase"], ["⏰💸", "Time is money", "Money time", "Late fee", "Phrase"],
      ["🍎👁️", "Apple of my eye", "Eye candy", "Bad apple", "Phrase"], ["🐘🏠", "Elephant in the room", "Big house", "Animal farm", "Phrase"],
      ["🌧️🐱🐶", "Raining cats and dogs", "Pet weather", "Storm pets", "Phrase"], ["💔❤️‍🩹", "Heal a broken heart", "Heart attack", "Love bite", "Phrase"],
      ["🍰🚶", "Piece of cake", "Cake walk", "Sweet tooth", "Phrase"], ["🌙🍯", "Honeymoon", "Moonlight", "Sweet night", "Word"],
      ["🔥🦊", "Firefox", "Hot dog", "Red fox", "Word"], ["☀️🌻", "Sunflower", "Daylight", "Summer", "Word"],
      ["⭐🐟", "Starfish", "Goldfish", "Sunfish", "Word"], ["🌈🦄", "Magic", "Dream", "Fairy tale", "Word"],
      ["🥔🍟", "French fries", "Potato chips", "Aloo tikki", "Food"], ["🍚🍗🥘", "Biryani", "Pulao", "Khichdi", "Food"],
      ["🫓🥔", "Aloo paratha", "Samosa", "Vada pav", "Food"], ["🍵☕🇮🇳", "Chai", "Coffee", "Lassi", "Food"],
      ["🎂🕯️🎉", "Birthday party", "Wedding", "Diwali", "Event"], ["🪔✨🎆", "Diwali", "Holi", "New Year", "Festival"],
      ["🎨💦🌈", "Holi", "Diwali", "Pongal", "Festival"], ["🌙⭐🕌", "Eid", "Diwali", "Christmas", "Festival"],
      ["🎄🎅", "Christmas", "New Year", "Thanksgiving", "Festival"], ["💍💒", "Wedding", "Engagement", "Birthday", "Event"],
      ["🧲❤️", "Attraction", "Magnet", "Crush", "Word"], ["📱🧟", "Phone addict", "Zombie movie", "Screen time", "Phrase"],
      ["🐝🦵", "Bee's knees", "Bee sting", "Honey leg", "Phrase"], ["🌊🏄‍♂️", "Surfing", "Swimming", "Sailing", "Word"],
    ];
    let E = null;
    const mine = () => E.names.indexOf(me.name);
    const ref = () => E.names[0] === me.name;
    const rnd = (seed) => { let x = seed || 1; return () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; };

    function begin(names, ids, seed) {
      const el = A.open(K, "Emoji riddles", "");
      A.panel(""); A.live(true);
      E = { el, names, ids, seed, r: -1, scores: [0, 0], decided: {}, lockUntil: 0, timer: 0, over: false };
      ids.forEach((i) => { D()?.mark("emoji", i); D()?.count("emoji", true); });
      q(".ar-body", el).innerHTML = `${A.duel(names, COLORS)}<div class="em">
        <small class="em-n"></small><div class="md-bar"><i></i></div>
        <p class="em-q" aria-live="polite"></p><small class="em-cat"></small><div class="md-opts em-opts"></div><p class="md-msg" aria-live="polite"></p></div>`;
      q(".em-opts", el).addEventListener("click", (e) => { const b = e.target.closest("[data-o]"); if (b) tap(Number(b.dataset.o), b); });
      next();
    }
    function next() {
      if (!E) return;
      E.r += 1;
      if (E.r >= E.ids.length) return finish();
      const [emo, ans, ...rest] = BANK[E.ids[E.r]];
      const cat = rest.pop();
      const r = rnd(E.seed + E.r * 31);
      const opts = [ans, ...rest].map((t, i) => ({ t, i, k: r() })).sort((a, b) => a.k - b.k);
      q(".em-n", E.el).textContent = `Riddle ${E.r + 1} of ${E.ids.length}`;
      const qq = q(".em-q", E.el); qq.textContent = emo; qq.classList.remove("in"); void qq.offsetWidth; qq.classList.add("in");
      q(".em-cat", E.el).textContent = cat;
      q(".em-opts", E.el).innerHTML = opts.map((o) => `<button data-o="${o.i}">${esc(o.t)}</button>`).join("");
      q(".md-msg", E.el).textContent = "";
      E.lockUntil = 0;
      const bar = q(".md-bar i", E.el);
      bar.style.transition = "none"; bar.style.width = "100%"; void bar.offsetWidth;
      bar.style.transition = `width ${LIMIT}ms linear`; bar.style.width = "0%";
      clearTimeout(E.timer);
      if (ref()) E.timer = setTimeout(() => decide(E.r, -1), LIMIT);
      A.setDuel({ turn: -1, scores: E.scores });
      A.status("Tap the right answer first");
    }
    function tap(i, b) {
      if (!E || E.over || E.decided[E.r] !== undefined || Date.now() < E.lockUntil) return;
      if (i !== 0) {
        b.classList.add("bad"); E.lockUntil = Date.now() + LOCK; A.sound("bad");
        q(".md-msg", E.el).textContent = "Nope! Frozen for a moment…";
        return;
      }
      b.classList.add("good");
      if (ref()) decide(E.r, mine()); else send(K, { t: "claim", r: E.r });
    }
    function decide(r, who) {
      if (!E || E.decided[r] !== undefined || r !== E.r) return;
      send(K, { t: "point", r, who });
      point(r, who);
    }
    function point(r, who) {
      if (!E || E.decided[r] !== undefined) return;
      E.decided[r] = who;
      clearTimeout(E.timer);
      const bar = q(".md-bar i", E.el);
      bar.style.width = `${bar.getBoundingClientRect().width}px`; bar.style.transition = "none";
      if (who >= 0) E.scores[who] += 1;
      const [emo, ans] = BANK[E.ids[r]];
      E.el.querySelectorAll(".em-opts button").forEach((b) => { b.disabled = true; if (b.dataset.o === "0") b.classList.add("good"); });
      q(".md-msg", E.el).textContent = who < 0 ? `Time's up! It was “${ans}”` : who === mine() ? "Point to you! 🎯" : `${E.names[who]} got it first`;
      A.sound(who === mine() ? "good" : "tick");
      A.setDuel({ turn: who, scores: E.scores });
      A.event(`Emoji riddles ${r + 1}: ${emo} = ${ans}. ${who < 0 ? "Nobody got it" : `${E.names[who]} got it`}. Score ${E.scores[0]} – ${E.scores[1]}`);
      setTimeout(next, 1600);
    }
    function finish() {
      E.over = true;
      const [a, b] = E.scores;
      A.over(K, E.names, a === b ? -1 : a > b ? 0 : 1, `${a} – ${b}`, () => { if (D()?.can("emoji", "Emoji riddles") === false) return; fresh(E.names); });
    }
    function fresh(names) {
      const ids = (D()?.order("emoji", BANK.length) || BANK.map((_, i) => i)).slice(0, ROUNDS), seed = Math.floor(Math.random() * 1e9);
      begin(names, ids, seed); send(K, { t: "start", names, ids, seed });
    }
    function start() {
      if (D()?.can("emoji", "Emoji riddles") === false) return;
      fresh([me.name, A.other().name]);
    }
    A.register(K, {
      start,
      onMsg(d, peer) {
        if (d.t === "start" && Array.isArray(d.ids)) { begin(d.names.map(String), d.ids.map(Number).filter((i) => BANK[i]).slice(0, ROUNDS), Number(d.seed) || 1); toast(`${peer.name} started Emoji riddles`); return; }
        if (!E) return;
        if (d.t === "claim" && ref()) decide(Number(d.r), E.names.indexOf(peer.name));
        if (d.t === "point") point(Number(d.r), Number(d.who));
      },
      describe: () => E && { riddle: E.r + 1, of: E.ids.length, emojis: BANK[E.ids[E.r]]?.[0], score: E.scores },
      cleanup() { if (E) clearTimeout(E.timer); E = null; },
    });
  }
})();
