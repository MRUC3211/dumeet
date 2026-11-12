// DU Meet · Memory match for two: flip two cards; a pair scores and you go again.
// Moves go through the relay (send) and both phones apply them the same way.
// Uses window.DU.arena for the game window.

(() => {
  "use strict";
  const A = window.DU.arena;
  const { q } = A;
  const COLORS = ["#0a84ff", "#ff375f"];
  const firstFor = (names, last) => (last == null ? 0 : 1 - last);

  {
    const K = "memo";
    const FACES = ["💖", "🌹", "🍕", "🎧", "🐼", "🌙", "☕", "🎁", "🍫", "🦋", "🍓", "🌻", "🐧", "🎈", "🍩", "⭐", "🐶", "🍉", "🎸", "🌈", "🦄"]; // 21 pairs, 42 cards
    let M = null;

    const start = () => {
      const names = [me.name, A.other().name];
      const deck = A.shuffle([...FACES, ...FACES]);
      begin(names, deck, 0);
      send(K, { t: "start", names, deck, first: 0 });
    };

    function begin(names, deck, first) {
      A.open(K, "Memory match", "");
      A.panel(""); A.live(true);
      M = { names, deck, first, turn: first, open: [], owner: new Array(deck.length).fill(-1), scores: [0, 0], lock: false, over: false };
      const body = q(".ar-body", A.current().el);
      body.innerHTML = `${A.duel(names, COLORS)}<div class="mm">${deck.map((f, i) => `<button class="mm-card" data-i="${i}" aria-label="Card ${i + 1}"><span class="mm-in"><span class="mm-back"></span><span class="mm-front">${f}</span></span></button>`).join("")}</div>`;
      q(".mm", body).addEventListener("click", (e) => {
        const card = e.target.closest("[data-i]");
        if (!card || M.lock || M.over || M.names[M.turn] !== me.name) return;
        const i = Number(card.dataset.i);
        if (M.owner[i] >= 0 || M.open.includes(i)) return;
        send(K, { t: "flip", i });
        flip(i);
      });
      paint();
    }

    function paint() {
      const el = A.current().el;
      el.querySelectorAll(".mm-card").forEach((c, i) => {
        c.classList.toggle("up", M.open.includes(i) || M.owner[i] >= 0);
        c.classList.toggle("got", M.owner[i] >= 0);
        if (M.owner[i] >= 0) c.style.setProperty("--pc", COLORS[M.owner[i]]);
      });
      q(".mm", el).classList.toggle("mine", !M.over && M.names[M.turn] === me.name && !M.lock);
      A.setDuel({ turn: M.over ? -1 : M.turn, scores: M.scores });
      A.status(M.over ? "Game over" : M.names[M.turn] === me.name ? "Your turn: flip two cards" : `${M.names[M.turn]}'s turn`);
    }

    function flip(i) {
      M.open.push(i);
      A.sound("tick");
      paint();
      if (M.open.length < 2) return;
      const [a, b] = M.open;
      M.lock = true;
      if (M.deck[a] === M.deck[b]) {
        setTimeout(() => {
          M.owner[a] = M.owner[b] = M.turn;
          M.scores[M.turn] += 1;
          M.open = []; M.lock = false;
          A.sound("good");
          if (M.owner.every((o) => o >= 0)) {
            M.over = true; paint();
            const w = M.scores[0] === M.scores[1] ? -1 : M.scores[0] > M.scores[1] ? 0 : 1;
            return setTimeout(() => A.over(K, M.names, w, `${M.scores[0]} – ${M.scores[1]} pairs`, rematch), 500);
          }
          paint();
        }, 450);
      } else {
        setTimeout(() => { M.open = []; M.lock = false; M.turn = 1 - M.turn; paint(); }, 1000);
      }
    }

    function rematch() {
      const f = firstFor(M.names, M.first);
      const deck = A.shuffle(M.deck);
      begin(M.names, deck, f);
      send(K, { t: "start", names: M.names, deck, first: f });
    }
    function onMsg(d, peer) {
      if (d.t === "start") { begin(d.names, d.deck, d.first || 0); toast(`${peer.name} started Memory match`); return; }
      if (d.t !== "flip" || !M || M.over) return;
      const go = () => { if (!M) return; if (M.lock) return setTimeout(go, 100); flip(Number(d.i)); };
      go();
    }
    A.register(K, { start, onMsg, cleanup() { M = null; } });
  }
})();
