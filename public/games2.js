// DU Meet · four more two-player games on the shared game stage (arena.js):
//   Tug of war          tap as fast as you can to pull the rope to your side
//   Two truths & a lie  write three things about you, one false; the other spots the lie
//   Hangman             pick a real word for the other to guess, letter by letter
//   Typing race         same sentence, both type; first to finish wins

(() => {
  "use strict";
  const A = window.DU.arena;
  const { q, esc } = A;
  const COLORS = ["#0a84ff", "#ff375f"];
  const P = () => window.DU.party;

  // =================================================================
  // Tug of war
  // =================================================================
  {
    const K = "tug";
    const WIN = 40; // tap lead needed
    let T = null;
    const mine = () => T.names.indexOf(me.name);
    function begin(names) {
      const el = A.open(K, "Tug of war", "");
      A.panel(""); A.live(true);
      T = { el, names, taps: [0, 0], sent: 0, over: false, go: false, flush: 0 };
      q(".ar-body", el).innerHTML = `${A.duel(names, COLORS)}<div class="tw">
        <div class="tw-field"><i class="tw-line"></i><div class="tw-rope"><span class="tw-k">🎀</span></div>
          <span class="tw-end l">${esc(names[0])}</span><span class="tw-end r">${esc(names[1])}</span></div>
        <b class="tw-count" aria-live="polite">3</b>
        <button class="tw-tap" type="button" disabled>PULL! 💪</button><small class="tw-tip">Tap as fast as you can (or hold Space)</small></div>`;
      const tap = (e) => { e.preventDefault(); pull(); };
      q(".tw-tap", el).addEventListener("pointerdown", tap);
      el.tabIndex = -1;
      el.addEventListener("keydown", (e) => { if (e.code === "Space" && !e.repeat) tap(e); });
      let n = 3;
      const cnt = q(".tw-count", el);
      const tick = setInterval(() => {
        n -= 1;
        if (!T || T.el !== el) return clearInterval(tick);
        if (n > 0) { cnt.textContent = n; A.sound("tick"); return; }
        clearInterval(tick);
        cnt.textContent = "GO!"; A.sound("good");
        T.go = true; q(".tw-tap", el).disabled = false; el.focus({ preventScroll: true });
        setTimeout(() => { if (cnt.textContent === "GO!") cnt.textContent = ""; }, 800);
      }, 800);
      T.flush = setInterval(() => { if (T && T.taps[mine()] > T.sent) { T.sent = T.taps[mine()]; send(K, { t: "taps", by: mine(), n: T.sent }); } }, 120);
      paint();
      A.status("Get ready…");
    }
    function pull() {
      if (!T || !T.go || T.over) return;
      T.taps[mine()] += 1;
      const b = q(".tw-tap", T.el); b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
      P()?.tone(220 + (T.taps[mine()] % 8) * 20, 0, 0.05, 0.05, "square");
      paint(); check();
    }
    function paint() {
      if (!T) return;
      const lead = T.taps[0] - T.taps[1]; // + = left (player 0) is winning
      const pos = Math.max(-1, Math.min(1, lead / WIN));
      q(".tw-rope", T.el).style.transform = `translateX(${(-pos * 38).toFixed(2)}%)`;
      A.setDuel({ turn: lead === 0 ? -1 : lead > 0 ? 0 : 1, scores: T.taps });
      if (T.go && !T.over) A.status(lead === 0 ? "Dead even!" : `${(lead > 0) === (mine() === 0) ? "You're" : `${T.names[lead > 0 ? 0 : 1]} is`} winning!`);
    }
    function check() {
      const lead = T.taps[0] - T.taps[1];
      if (Math.abs(lead) < WIN || T.over) return;
      const w = lead > 0 ? 0 : 1;
      send(K, { t: "won", w, taps: T.taps });
      end(w);
    }
    function end(w) {
      if (!T || T.over) return;
      T.over = true; T.go = false;
      clearInterval(T.flush);
      q(".tw-tap", T.el).disabled = true;
      P()?.particles(["💪", "🎉", "🏆"], { mode: "burst", n: 40 });
      A.over(K, T.names, w, `${T.taps[0]} – ${T.taps[1]} taps`, () => { begin([T.names[1], T.names[0]]); send(K, { t: "start", names: T.names }); });
    }
    A.register(K, {
      start() { const names = [me.name, A.other().name]; begin(names); send(K, { t: "start", names }); },
      onMsg(d, peer) {
        if (d.t === "start" && Array.isArray(d.names)) { begin(d.names.map(String)); toast(`${peer.name} started Tug of war`); return; }
        if (!T) return;
        if (d.t === "taps") { const by = Number(d.by); if (by === 0 || by === 1) { T.taps[by] = Math.max(T.taps[by], Number(d.n) || 0); paint(); check(); } }
        if (d.t === "won") { if (Array.isArray(d.taps)) T.taps = d.taps.map(Number); paint(); end(Number(d.w)); }
      },
      describe: () => T && { taps: T.taps, needed_lead: WIN },
      cleanup() { if (T) clearInterval(T.flush); T = null; },
    });
  }

  // =================================================================
  // Two truths and a lie
  // =================================================================
  {
    const K = "ttl";
    let G = null;
    const mine = () => G.names.indexOf(me.name);
    const IDEAS = ["I once cried at a cartoon", "I've never eaten sushi", "I can whistle with my fingers", "I was scared of the dark till 12", "I've been on TV", "I broke a bone as a kid", "I hate chocolate", "I talk in my sleep", "I can cook one dish perfectly", "I've stayed awake 30 hours"];
    function begin(names) {
      const el = A.open(K, "Two truths & a lie", "");
      A.panel(""); A.live(true);
      G = { el, names, sets: [null, null], guesses: [null, null], scores: [0, 0], over: false };
      q(".ar-body", el).innerHTML = `${A.duel(names, COLORS)}<div class="tl"></div>`;
      writeForm();
      A.setDuel({ turn: -1, scores: G.scores });
    }
    function writeForm() {
      const box = q(".tl", G.el);
      box.innerHTML = `<p class="tl-h">Write 3 things about you. Two true, one lie. Tap the lie.</p>
        <form class="tl-form">${[0, 1, 2].map((i) => `<label class="tl-row"><input type="radio" name="lie" value="${i}" aria-label="Statement ${i + 1} is the lie" ${i === 2 ? "checked" : ""}><span class="tl-tag">Lie?</span>
          <input class="field" name="s${i}" maxlength="80" required placeholder="${esc(IDEAS[(i * 3 + Math.floor(Math.random() * 3)) % IDEAS.length])}" aria-label="Statement ${i + 1}"></label>`).join("")}
          <button class="btn primary"><span class="icon">lock</span>Lock them in</button></form><p class="tl-msg" aria-live="polite"></p>`;
      q(".tl-form", box).addEventListener("submit", (e) => {
        e.preventDefault();
        const f = e.target;
        const items = [0, 1, 2].map((i) => f.elements[`s${i}`].value.trim().slice(0, 80));
        if (items.some((x) => !x)) return;
        const lie = Number(f.elements.lie.value);
        // shuffle so the lie isn't always last
        const order = [0, 1, 2].sort(() => Math.random() - 0.5);
        const set = { items: order.map((i) => items[i]), lie: order.indexOf(lie) };
        G.sets[mine()] = set;
        send(K, { t: "set", by: mine(), set });
        f.querySelectorAll("input, button").forEach((x) => { x.disabled = true; });
        q(".tl-msg", box).textContent = `Locked! Waiting for ${G.names[1 - mine()]}…`;
        A.sound("move");
        maybeGuess();
      });
      A.status("Write your two truths and a lie");
    }
    function maybeGuess() {
      if (!G.sets[0] || !G.sets[1]) return;
      const them = G.sets[1 - mine()];
      q(".tl", G.el).innerHTML = `<p class="tl-h">Which one is ${esc(G.names[1 - mine()])}'s lie? 🤥</p><div class="tl-opts">${them.items.map((s, i) => `<button data-g="${i}">${esc(s)}</button>`).join("")}</div><p class="tl-msg" aria-live="polite"></p><div class="tl-mine"></div>`;
      q(".tl-opts", G.el).addEventListener("click", (e) => {
        const b = e.target.closest("[data-g]");
        if (!b || G.guesses[mine()] !== null) return;
        G.guesses[mine()] = Number(b.dataset.g);
        b.classList.add("chosen");
        send(K, { t: "guess", by: mine(), g: G.guesses[mine()] });
        q(".tl-msg", G.el).textContent = `Waiting for ${G.names[1 - mine()]} to guess yours…`;
        reveal();
      });
      A.status("Spot the lie");
    }
    function reveal() {
      if (G.guesses[0] === null || G.guesses[1] === null || G.over) return;
      G.over = true;
      const me0 = mine(), them = 1 - me0;
      [0, 1].forEach((p) => { if (G.guesses[p] === G.sets[1 - p].lie) G.scores[p] += 1; });
      const theirSet = G.sets[them], mySet = G.sets[me0];
      q(".tl-opts", G.el).querySelectorAll("button").forEach((b, i) => { b.disabled = true; b.classList.remove("chosen"); if (i === theirSet.lie) b.classList.add("lie"); else if (i === G.guesses[me0]) b.classList.add("bad"); });
      const gotMine = G.guesses[me0] === theirSet.lie, gotTheirs = G.guesses[them] === mySet.lie;
      q(".tl-msg", G.el).textContent = gotMine ? "You caught the lie! 🕵️" : "Fooled you! 😄";
      q(".tl-mine", G.el).innerHTML = `<small>${esc(G.names[them])} guessed your lie: ${gotTheirs ? "caught ✅" : "fooled ❌"}</small>`;
      A.sound(gotMine ? "good" : "bad");
      A.setDuel({ turn: -1, scores: G.scores });
      A.event(`Two truths & a lie: ${G.names[0]} ${G.guesses[0] === G.sets[1].lie ? "caught" : "missed"} the lie, ${G.names[1]} ${G.guesses[1] === G.sets[0].lie ? "caught" : "missed"} it`);
      setTimeout(() => {
        if (!G) return;
        const [a, b] = G.scores;
        A.over(K, G.names, a === b ? -1 : a > b ? 0 : 1, a === b ? (a ? "You both caught the lie" : "You both got fooled 😂") : "Detective of the day 🕵️", () => { begin(G.names); send(K, { t: "start", names: G.names }); });
      }, 3200);
    }
    A.register(K, {
      start() { const names = [me.name, A.other().name]; begin(names); send(K, { t: "start", names }); },
      onMsg(d, peer) {
        if (d.t === "start" && Array.isArray(d.names)) { begin(d.names.map(String)); toast(`${peer.name} started Two truths & a lie`); return; }
        if (!G) return;
        const by = Number(d.by);
        if (d.t === "set" && (by === 0 || by === 1) && Array.isArray(d.set?.items)) {
          G.sets[by] = { items: d.set.items.map((s) => String(s).slice(0, 80)).slice(0, 3), lie: Number(d.set.lie) };
          if (!G.sets[mine()]) q(".tl-msg", G.el).textContent = `${G.names[by]} is ready. Your turn!`;
          maybeGuess();
        }
        if (d.t === "guess" && (by === 0 || by === 1)) { G.guesses[by] = Number(d.g); reveal(); }
      },
      describe: () => G && { written: G.sets.map(Boolean), guessed: G.guesses.map((x) => x !== null), score: G.scores },
      cleanup() { G = null; },
    });
  }

  // =================================================================
  // Hangman (the setter picks a real word; the other guesses letters)
  // =================================================================
  {
    const K = "hang";
    const LIVES = 7;
    let H = null;
    const mine = () => H.names.indexOf(me.name);
    const HEARTS = (n) => "❤️".repeat(n) + "🤍".repeat(LIVES - n);
    function begin(names, round = 0, scores = [0, 0]) {
      const el = A.open(K, "Hangman", "");
      A.panel(""); A.live(true);
      H = { el, names, setter: round % 2, round, scores, word: "", hint: "", guessed: [], lives: LIVES, over: false };
      q(".ar-body", el).innerHTML = `${A.duel(names, COLORS)}<div class="hm"></div>`;
      A.setDuel({ turn: H.setter, scores, subs: names.map((_, i) => (i === H.setter ? "picks the word" : "guesses")) });
      if (H.setter === mine()) setForm(); else q(".hm", el).innerHTML = `<p class="hm-wait">${esc(names[H.setter])} is choosing a secret word… 🤫</p>`;
      A.status(H.setter === mine() ? "Pick a secret word" : "Waiting for the word");
    }
    function setForm() {
      const box = q(".hm", H.el);
      box.innerHTML = `<form class="hm-set"><p class="tl-h">Pick a real English word for ${esc(H.names[1 - mine()])} to guess</p>
        <input class="field" name="w" maxlength="14" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. butterfly" required aria-label="Secret word">
        <input class="field" name="h" maxlength="40" placeholder="A hint (optional): an insect" aria-label="Hint">
        <button class="btn primary"><span class="icon">lock</span>Start</button><p class="tl-msg" aria-live="polite"></p></form>`;
      q(".hm-set", box).addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target, w = f.elements.w.value.trim().toLowerCase();
        const msg = q(".tl-msg", f);
        if (!/^[a-z]{3,14}$/.test(w)) { msg.textContent = "3 to 14 letters, no spaces or numbers"; return; }
        msg.textContent = "Checking the dictionary…";
        let ok = null;
        try { const r = await fetch(`/api/word?w=${encodeURIComponent(w)}`); ok = r.ok ? (await r.json()).ok : null; } catch { /* offline */ }
        if (ok === false) { msg.textContent = `“${w}” isn't in the dictionary. Pick a real word.`; A.sound("bad"); return; }
        if (!H || H.over) return;
        H.word = w; H.hint = f.elements.h.value.trim().slice(0, 40);
        send(K, { t: "word", w: H.word, h: H.hint, round: H.round });
        board();
      });
    }
    function board() {
      const guesser = H.setter !== mine();
      const box = q(".hm", H.el);
      box.innerHTML = `<div class="hm-lives" aria-label="Lives"></div>${H.hint ? `<small class="hm-hint">Hint: ${esc(H.hint)}</small>` : ""}<div class="hm-word" aria-live="polite"></div>
        <div class="hm-keys">${"qwertyuiopasdfghjklzxcvbnm".split("").map((c) => `<button data-k="${c}" ${guesser ? "" : "disabled"}>${c}</button>`).join("")}</div><p class="tl-msg" aria-live="polite"></p>`;
      if (guesser) {
        q(".hm-keys", box).addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (b) guess(b.dataset.k, true); });
        H.key = (e) => { if (/^[a-z]$/i.test(e.key) && !e.metaKey && !e.ctrlKey && document.activeElement?.tagName !== "INPUT") guess(e.key.toLowerCase(), true); };
        addEventListener("keydown", H.key);
      }
      paint();
    }
    function guess(c, local) {
      if (!H || H.over || !H.word || H.guessed.includes(c)) return;
      H.guessed.push(c);
      if (local) send(K, { t: "guess", c });
      if (!H.word.includes(c)) { H.lives -= 1; A.sound("bad"); } else A.sound("good");
      paint();
      const solved = H.word.split("").every((x) => H.guessed.includes(x));
      if (solved || H.lives <= 0) done(solved);
    }
    function paint() {
      const box = q(".hm", H.el);
      q(".hm-lives", box).textContent = HEARTS(H.lives);
      const guesser = H.setter !== mine();
      q(".hm-word", box).innerHTML = H.word.split("").map((x) => `<span class="${H.guessed.includes(x) ? "on" : ""}">${H.guessed.includes(x) || !guesser || H.over ? x : ""}</span>`).join("");
      box.querySelectorAll("[data-k]").forEach((b) => { const k = b.dataset.k; if (H.guessed.includes(k)) { b.disabled = true; b.classList.add(H.word.includes(k) ? "good" : "bad"); } });
      A.status(guesser ? `Guess the letters · ${H.lives} lives` : `${H.names[1 - H.setter]} is guessing your word`);
    }
    function done(solved) {
      H.over = true;
      removeEventListener("keydown", H.key || (() => {}));
      const guesser = 1 - H.setter;
      H.scores[solved ? guesser : H.setter] += 1;
      paint();
      q(".tl-msg", H.el).textContent = solved ? `${guesser === mine() ? "You" : H.names[guesser]} got it: “${H.word}” 🎉` : `Out of lives! The word was “${H.word}”`;
      A.setDuel({ turn: -1, scores: H.scores });
      A.event(`Hangman: ${H.names[guesser]} ${solved ? "solved" : "missed"} "${H.word}". Score ${H.scores[0]} – ${H.scores[1]}`);
      if (solved && guesser === mine()) P()?.particles(["🎉", "✨", "🔤"], { mode: "burst", n: 30 });
      setTimeout(() => {
        if (!H) return;
        const next = H.round + 1;
        if (next < 4) { const { names, scores } = H; begin(names, next, scores); return; }
        const [a, b] = H.scores;
        A.over(K, H.names, a === b ? -1 : a > b ? 0 : 1, `${a} – ${b} after 4 words`, () => { begin(H.names); send(K, { t: "start", names: H.names }); });
      }, 2600);
    }
    A.register(K, {
      start() { const names = [me.name, A.other().name]; begin(names); send(K, { t: "start", names }); },
      onMsg(d, peer) {
        if (d.t === "start" && Array.isArray(d.names)) { begin(d.names.map(String)); toast(`${peer.name} started Hangman`); return; }
        if (!H) return;
        if (d.t === "word" && Number(d.round) === H.round && !H.word) { H.word = String(d.w).toLowerCase().replace(/[^a-z]/g, "").slice(0, 14); H.hint = String(d.h || "").slice(0, 40); board(); }
        if (d.t === "guess") guess(String(d.c).slice(0, 1), false);
      },
      describe: () => H && { round: H.round + 1, lives: H.lives, score: H.scores, pattern: H.word ? H.word.split("").map((x) => (H.guessed.includes(x) ? x : "_")).join(" ") : "" },
      cleanup() { if (H?.key) removeEventListener("keydown", H.key); H = null; },
    });
  }

  // =================================================================
  // Typing race
  // =================================================================
  {
    const K = "typing";
    const LINES = [
      "You are my favourite notification and my best decision.",
      "Distance means so little when someone means so much.",
      "I would split my last slice of pizza with you, probably.",
      "Every love story is beautiful, but ours is my favourite.",
      "Let's order momos, watch a movie and talk till three.",
      "You make my heart smile even on the most boring days.",
      "Chai in one hand, your call in the other, life is good.",
      "I still get butterflies when your name pops up on my phone.",
      "Home is not a place, it is the person on this call.",
      "One day we will laugh about how much we missed each other.",
      "The quick brown fox jumps over the lazy dog twice.",
      "Some people are worth staying up late for, and you are one.",
    ];
    let R = null;
    const mine = () => R.names.indexOf(me.name);
    function begin(names, line) {
      const el = A.open(K, "Typing race", "");
      A.panel(""); A.live(true);
      R = { el, names, line, prog: [0, 0], start: 0, over: false };
      q(".ar-body", el).innerHTML = `${A.duel(names, COLORS)}<div class="tr">
        <div class="tr-tracks">${names.map((n, i) => `<div class="tr-track"><small>${esc(n)}</small><div class="tr-bar"><i style="background:${COLORS[i]}"></i><span>${i ? "🏎️" : "🚗"}</span></div></div>`).join("")}</div>
        <p class="tr-line" aria-label="Type this">${line.split("").map((c) => `<span>${esc(c)}</span>`).join("")}</p>
        <textarea class="field tr-in" rows="2" autocomplete="off" autocapitalize="off" spellcheck="false" disabled aria-label="Type the sentence"></textarea><b class="tw-count" aria-live="polite">3</b></div>`;
      const input = q(".tr-in", el);
      input.addEventListener("paste", (e) => e.preventDefault());
      input.addEventListener("input", () => typed(input.value));
      let n = 3;
      const cnt = q(".tw-count", el);
      const tick = setInterval(() => {
        n -= 1;
        if (!R || R.el !== el) return clearInterval(tick);
        if (n > 0) { cnt.textContent = n; A.sound("tick"); return; }
        clearInterval(tick); cnt.textContent = ""; A.sound("good");
        input.disabled = false; input.focus({ preventScroll: true });
        R.start = Date.now();
        A.status("Type!");
      }, 800);
      paint();
      A.status("Get ready…");
    }
    function typed(v) {
      if (!R || R.over) return;
      let ok = 0;
      while (ok < v.length && v[ok] === R.line[ok]) ok += 1;
      R.el.querySelectorAll(".tr-line span").forEach((s, i) => { s.className = i < ok ? "ok" : i < v.length ? "bad" : i === v.length ? "cur" : ""; });
      const p = ok / R.line.length;
      if (p !== R.prog[mine()]) { R.prog[mine()] = p; send(K, { t: "prog", by: mine(), p }); paint(); }
      if (ok === R.line.length) { const secs = (Date.now() - R.start) / 1000; send(K, { t: "done", by: mine(), secs }); finish(mine(), secs); }
    }
    function paint() {
      R.el.querySelectorAll(".tr-bar").forEach((b, i) => { const pct = Math.round(R.prog[i] * 100); b.querySelector("i").style.width = `${pct}%`; b.querySelector("span").style.left = `calc(${pct}% - ${pct > 4 ? 22 : 0}px)`; });
      A.setDuel({ turn: -1, scores: R.prog.map((p) => `${Math.round(p * 100)}%`) });
    }
    function finish(w, secs) {
      if (!R || R.over) return;
      R.over = true;
      q(".tr-in", R.el).disabled = true;
      const wpm = Math.round((R.line.length / 5) / (secs / 60));
      P()?.particles(["🏁", "⚡", "🎉"], { mode: "burst", n: 30 });
      A.over(K, R.names, w, `${secs.toFixed(1)} s · ${wpm} words a minute`, () => { const line = LINES[Math.floor(Math.random() * LINES.length)]; begin(R.names, line); send(K, { t: "start", names: R.names, line }); });
    }
    A.register(K, {
      start() { const names = [me.name, A.other().name], line = LINES[Math.floor(Math.random() * LINES.length)]; begin(names, line); send(K, { t: "start", names, line }); },
      onMsg(d, peer) {
        if (d.t === "start" && Array.isArray(d.names)) { const line = String(d.line || LINES[0]).slice(0, 120); begin(d.names.map(String), line); toast(`${peer.name} started a Typing race`); return; }
        if (!R) return;
        const by = Number(d.by);
        if (d.t === "prog" && (by === 0 || by === 1)) { R.prog[by] = Math.max(0, Math.min(1, Number(d.p) || 0)); paint(); }
        if (d.t === "done" && (by === 0 || by === 1)) { R.prog[by] = 1; paint(); finish(by, Number(d.secs) || 30); }
      },
      describe: () => R && { progress: R.prog.map((p) => Math.round(p * 100)), sentence: R.line },
      cleanup() { R = null; },
    });
  }
})();
