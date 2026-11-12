// DU Meet · four more games for two: Dots & boxes, Memory match, Sea battle and
// Checkers. All are turn based; moves go through the relay (send) and both phones apply
// them the same way. Uses window.DU.arena for the full-screen stage.

(() => {
  "use strict";
  const A = window.DU.arena;
  const { esc, q } = A;
  const COLORS = ["#0a84ff", "#ff375f"];
  const myIdx = (names) => names.indexOf(me.name);
  const firstFor = (names, last) => (last == null ? 0 : 1 - last);

  // =================================================================
  // Dots & boxes: draw lines in turn; close a box to score and go again.
  // =================================================================
  {
    const K = "dots";
    const N = 5; // dots per side
    let D = null;

    const start = () => { const names = [me.name, A.other().name]; begin(names, 0); send(K, { t: "start", names, first: 0 }); };

    function begin(names, first) {
      A.open(K, "Dots & boxes", "");
      A.panel(""); A.live(true);
      D = { names, turn: first, first, lines: new Map(), boxes: new Map(), scores: [0, 0], over: false, last: "" };
      const body = q(".ar-body", A.current().el);
      body.innerHTML = `${A.duel(names, COLORS)}<div class="db-wrap"><svg class="db" viewBox="-0.4 -0.4 ${N - 0.2} ${N - 0.2}"></svg></div>`;
      q(".db", body).addEventListener("click", (e) => {
        const id = e.target.closest("[data-l]")?.dataset.l;
        if (id && !D.over && D.names[D.turn] === me.name && !D.lines.has(id)) { send(K, { t: "line", id }); line(id); }
      });
      paint();
    }

    function paint() {
      const svg = q(".db", A.current().el);
      let html = "";
      for (const [k, who] of D.boxes) {
        const [r, c] = k.split(",").map(Number);
        html += `<rect class="db-box" x="${c + 0.06}" y="${r + 0.06}" width=".88" height=".88" rx=".12" fill="${COLORS[who]}"/><text x="${c + 0.5}" y="${r + 0.62}" class="db-ini">${esc((D.names[who] || "?")[0].toUpperCase())}</text>`;
      }
      const lineEl = (id, x1, y1, x2, y2) => {
        const who = D.lines.get(id);
        return `<g data-l="${id}" class="db-l${who != null ? " on" : ""}${id === D.last ? " new" : ""}"><line class="hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
          <line class="vis" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${who != null ? `stroke="${COLORS[who]}"` : ""}/></g>`;
      };
      for (let r = 0; r < N; r++) for (let c = 0; c < N - 1; c++) html += lineEl(`h${r}-${c}`, c + 0.12, r, c + 0.88, r);
      for (let r = 0; r < N - 1; r++) for (let c = 0; c < N; c++) html += lineEl(`v${r}-${c}`, c, r + 0.12, c, r + 0.88);
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) html += `<circle class="db-dot" cx="${c}" cy="${r}" r=".09"/>`;
      svg.innerHTML = html;
      svg.classList.toggle("mine", !D.over && D.names[D.turn] === me.name);
      A.setDuel({ turn: D.over ? -1 : D.turn, scores: D.scores });
      A.status(D.over ? "Game over" : D.names[D.turn] === me.name ? "Your turn: draw a line" : `${D.names[D.turn]}'s turn`);
    }

    function line(id) {
      D.lines.set(id, D.turn);
      D.last = id;
      const done = [];
      for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) {
        const k = `${r},${c}`;
        if (D.boxes.has(k)) continue;
        if ([`h${r}-${c}`, `h${r + 1}-${c}`, `v${r}-${c}`, `v${r}-${c + 1}`].every((x) => D.lines.has(x))) done.push(k);
      }
      for (const k of done) { D.boxes.set(k, D.turn); D.scores[D.turn] += 1; }
      A.sound(done.length ? "good" : "tick");
      if (!done.length) D.turn = 1 - D.turn;
      if (D.boxes.size === (N - 1) ** 2) {
        D.over = true;
        paint();
        const w = D.scores[0] === D.scores[1] ? -1 : D.scores[0] > D.scores[1] ? 0 : 1;
        return setTimeout(() => A.over(K, D.names, w, `${D.scores[0]} – ${D.scores[1]}`, rematch), 500);
      }
      paint();
    }

    function rematch() { const f = firstFor(D.names, D.first); begin(D.names, f); send(K, { t: "start", names: D.names, first: f }); }
    function onMsg(d, peer) {
      if (d.t === "start") { begin(d.names, d.first || 0); toast(`${peer.name} started Dots & boxes`); return; }
      if (d.t === "line" && D && !D.over && !D.lines.has(d.id)) line(String(d.id));
    }
    A.register(K, { start, onMsg, cleanup() { D = null; } });
  }

  // =================================================================
  // Memory match: flip two cards; a pair scores and you go again.
  // =================================================================
  {
    const K = "memo";
    const FACES = ["💖", "🌹", "🍕", "🎧", "🐼", "🌙", "☕", "🎁", "🍫", "🦋"];
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

  // =================================================================
  // Sea battle: hide your fleet, then take shots; a hit means shoot again.
  // =================================================================
  {
    const K = "sea";
    const S8 = 8;
    const SHIPS = [4, 3, 3, 2, 2];
    let B = null;

    function randomFleet() {
      for (;;) {
        const taken = new Set(), ships = [];
        let ok = true;
        for (const len of SHIPS) {
          let placed = false;
          for (let tries = 0; tries < 200 && !placed; tries++) {
            const horiz = A.rand(2) === 0;
            const r = A.rand(horiz ? S8 : S8 - len + 1), c = A.rand(horiz ? S8 - len + 1 : S8);
            const cells = Array.from({ length: len }, (_, k) => (horiz ? r * S8 + c + k : (r + k) * S8 + c));
            // ships never touch, not even at the corners
            const near = (i) => { const rr = Math.floor(i / S8), cc = i % S8; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const r2 = rr + dr, c2 = cc + dc; if (r2 >= 0 && r2 < S8 && c2 >= 0 && c2 < S8 && taken.has(r2 * S8 + c2)) return true; } return false; };
            if (cells.some(near)) continue;
            cells.forEach((x) => taken.add(x));
            ships.push(cells);
            placed = true;
          }
          if (!placed) { ok = false; break; }
        }
        if (ok) return ships;
      }
    }

    const start = () => { const names = [me.name, A.other().name]; begin(names, 0); send(K, { t: "start", names, first: 0 }); };

    function begin(names, first) {
      A.open(K, "Sea battle", "");
      A.panel(""); A.live(true);
      B = { names, first, turn: first, phase: "place", fleet: randomFleet(), ready: [false, false], incoming: new Map(), shots: new Map(), sunkCells: new Set(), hits: [0, 0], over: false, waiting: false };
      const body = q(".ar-body", A.current().el);
      body.innerHTML = `${A.duel(names, COLORS)}
        <div class="sb">
          <section class="sb-them"><h4>Their sea</h4><div class="sb-grid big" data-g="them"></div></section>
          <section class="sb-me"><h4>Your fleet</h4><div class="sb-grid" data-g="me"></div>
            <div class="sb-place"><button class="btn ghost" data-sb="shuffle"><span class="icon" aria-hidden="true">shuffle</span>Shuffle</button><button class="btn primary" data-sb="ready"><span class="icon" aria-hidden="true">check</span>Ready</button></div></section>
        </div>`;
      body.addEventListener("click", (e) => {
        const act = e.target.closest("[data-sb]")?.dataset.sb;
        if (act === "shuffle" && B.phase === "place" && !B.ready[myIdx(B.names)]) { B.fleet = randomFleet(); paint(); }
        if (act === "ready" && B.phase === "place") { B.ready[myIdx(B.names)] = true; send(K, { t: "ready" }); A.sound("tick"); maybeFight(); paint(); }
        const cell = e.target.closest('[data-g="them"] [data-i]');
        if (cell && B.phase === "fight" && !B.over && !B.waiting && B.names[B.turn] === me.name) {
          const i = Number(cell.dataset.i);
          if (B.shots.has(i)) return;
          B.waiting = true;
          send(K, { t: "shot", i });
          cell.classList.add("aim");
        }
      });
      paint();
    }

    function maybeFight() {
      if (B.ready.every(Boolean) && B.phase === "place") { B.phase = "fight"; A.sound("good"); }
    }

    function paint() {
      const el = A.current().el;
      const shipAt = new Map();
      B.fleet.forEach((cells, s) => cells.forEach((i) => shipAt.set(i, s)));
      let mine = "", them = "";
      for (let i = 0; i < S8 * S8; i++) {
        const inc = B.incoming.get(i);
        mine += `<i class="${shipAt.has(i) ? "ship" : ""}${inc === "hit" ? " hit" : inc === "miss" ? " miss" : ""}${B.fleet.some((cells) => cells.includes(i) && cells.every((x) => B.incoming.get(x) === "hit")) ? " sunk" : ""}"></i>`;
        const s = B.shots.get(i);
        them += `<button data-i="${i}" class="${s || ""}${B.sunkCells.has(i) ? " sunk" : ""}" aria-label="${String.fromCharCode(65 + Math.floor(i / S8))}${(i % S8) + 1}${s ? `, ${s}` : ""}" ${s ? "disabled" : ""}></button>`;
      }
      q('[data-g="me"]', el).innerHTML = mine;
      q('[data-g="them"]', el).innerHTML = them;
      const meI = myIdx(B.names);
      q(".sb-place", el).hidden = B.phase !== "place";
      q(".sb-place [data-sb=ready]", el).disabled = B.ready[meI];
      q(".sb-place [data-sb=shuffle]", el).disabled = B.ready[meI];
      el.querySelector(".sb").classList.toggle("placing", B.phase === "place");
      q('[data-g="them"]', el).classList.toggle("mine", B.phase === "fight" && !B.over && B.names[B.turn] === me.name);
      const total = SHIPS.reduce((a, b) => a + b, 0);
      A.setDuel({ turn: B.phase === "fight" && !B.over ? B.turn : -1, scores: B.hits.map((h) => `${h}/${total}`), subs: B.phase === "place" ? B.ready.map((r) => (r ? "Ready" : "Placing ships…")) : ["", ""] });
      A.status(B.phase === "place" ? (B.ready[meI] ? `Waiting for ${B.names[1 - meI]}…` : "Place your fleet, then tap Ready") : B.over ? "Game over" : B.names[B.turn] === me.name ? "Your shot: tap their sea" : `${B.names[B.turn]} is aiming…`);
    }

    // I was shot at: answer honestly from my own fleet
    function incoming(i) {
      const ship = B.fleet.find((cells) => cells.includes(i));
      const hit = Boolean(ship);
      B.incoming.set(i, hit ? "hit" : "miss");
      const sunk = hit && ship.every((x) => B.incoming.get(x) === "hit") ? ship : null;
      const over = B.fleet.every((cells) => cells.every((x) => B.incoming.get(x) === "hit"));
      send(K, { t: "res", i, hit, sunk, over });
      settle(1 - myIdx(B.names), hit, over);
      A.sound(hit ? "boom" : "splash");
      if (sunk) toast("They sank one of your ships 💥");
    }

    function result(d) {
      B.waiting = false;
      B.shots.set(d.i, d.hit ? "hit" : "miss");
      if (d.sunk) { d.sunk.forEach((x) => B.sunkCells.add(x)); toast("Ship sunk! 🎯"); }
      A.sound(d.hit ? "boom" : "splash");
      settle(myIdx(B.names), d.hit, d.over);
    }

    function settle(shooter, hit, over) {
      if (hit) B.hits[shooter] += 1;
      else B.turn = 1 - B.turn;
      if (over) {
        B.over = true;
        paint();
        return setTimeout(() => A.over(K, B.names, shooter, "Whole fleet sunk", rematch), 700);
      }
      paint();
    }

    function rematch() { const f = firstFor(B.names, B.first); begin(B.names, f); send(K, { t: "start", names: B.names, first: f }); }
    function onMsg(d, peer) {
      if (d.t === "start") { begin(d.names, d.first || 0); toast(`${peer.name} started Sea battle`); return; }
      if (!B || B.over) return;
      if (d.t === "ready") { B.ready[1 - myIdx(B.names)] = true; maybeFight(); paint(); }
      if (d.t === "shot" && B.phase === "fight") incoming(Number(d.i));
      if (d.t === "res") result(d);
    }
    A.register(K, { start, onMsg, cleanup() { B = null; } });
  }

  // =================================================================
  // Checkers (English rules): captures are compulsory and continue in a chain;
  // a man that reaches the far row is crowned and can move backwards.
  // =================================================================
  {
    const K = "chk";
    let C = null;
    // 1/2: player 0 man/king (starts at the bottom), 3/4: player 1 man/king
    const owner = (v) => (v === 1 || v === 2 ? 0 : v === 3 || v === 4 ? 1 : -1);
    const isKing = (v) => v === 2 || v === 4;

    function initial() {
      const b = new Array(64).fill(0);
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) {
        if (r < 3) b[r * 8 + c] = 3;
        if (r > 4) b[r * 8 + c] = 1;
      }
      return b;
    }

    function dirs(v) { const p = owner(v); if (isKing(v)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]]; return p === 0 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]; }

    // all complete moves for a player: lists of squares [from, ..., to]
    function moves(b, p) {
      const jumps = [], steps = [];
      const chain = (board, sq, v, path) => {
        let extended = false;
        const r = sq >> 3, c = sq & 7;
        for (const [dr, dc] of dirs(v)) {
          const mr = r + dr, mc = c + dc, tr = r + 2 * dr, tc = c + 2 * dc;
          if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
          const mid = mr * 8 + mc, to = tr * 8 + tc;
          if (owner(board[mid]) === 1 - p && board[to] === 0) {
            const nb = board.slice();
            nb[to] = v; nb[sq] = 0; nb[mid] = 0;
            const crowned = !isKing(v) && ((p === 0 && tr === 0) || (p === 1 && tr === 7));
            extended = true;
            if (crowned) jumps.push([...path, to]);
            else chain(nb, to, v, [...path, to]);
          }
        }
        if (!extended && path.length > 1) jumps.push(path);
      };
      for (let sq = 0; sq < 64; sq++) {
        if (owner(b[sq]) !== p) continue;
        chain(b, sq, b[sq], [sq]);
        const r = sq >> 3, c = sq & 7;
        for (const [dr, dc] of dirs(b[sq])) {
          const tr = r + dr, tc = c + dc;
          if (tr >= 0 && tr < 8 && tc >= 0 && tc < 8 && b[tr * 8 + tc] === 0) steps.push([sq, tr * 8 + tc]);
        }
      }
      return jumps.length ? jumps : steps;
    }

    function apply(b, path) {
      const nb = b.slice();
      let v = nb[path[0]];
      const p = owner(v);
      let captured = 0;
      for (let k = 1; k < path.length; k++) {
        const a = path[k - 1], z = path[k];
        if (Math.abs((a >> 3) - (z >> 3)) === 2) { nb[(a + z) / 2] = 0; captured++; }
        nb[a] = 0;
        nb[z] = v;
      }
      const end = path[path.length - 1];
      if (!isKing(v) && ((p === 0 && end >> 3 === 0) || (p === 1 && end >> 3 === 7))) nb[end] = v + 1;
      return { b: nb, captured };
    }

    const start = () => { const names = [me.name, A.other().name]; begin(names, 0); send(K, { t: "start", names, first: 0 }); };

    function begin(names, first) {
      A.open(K, "Checkers", "");
      A.panel(""); A.live(true);
      C = { names, first, turn: first, b: initial(), sel: [], last: null, quiet: 0, over: false };
      // player index 0 keeps the bottom pieces; "first" only decides who moves first
      const body = q(".ar-body", A.current().el);
      body.innerHTML = `${A.duel(names, ["#2c2c2e", "#ff375f"])}<div class="ck-wrap"><div class="ck" role="grid" aria-label="Checkers board"></div></div>`;
      q(".ck", body).addEventListener("click", onTap);
      paint();
    }

    const flip = () => myIdx(C.names) === 1;

    function paint() {
      const el = A.current().el;
      const myTurn = !C.over && C.names[C.turn] === me.name;
      const all = myTurn ? moves(C.b, C.turn) : [];
      const fitting = all.filter((m) => C.sel.every((s, k) => m[k] === s));
      const can = new Set(myTurn && !C.sel.length ? all.map((m) => m[0]) : []);
      const next = new Set(C.sel.length ? fitting.map((m) => m[C.sel.length]).filter((x) => x != null) : []);
      let html = "";
      for (let i = 0; i < 64; i++) {
        const sq = flip() ? 63 - i : i;
        const dark = ((sq >> 3) + (sq & 7)) % 2 === 1;
        const v = C.b[sq];
        const cls = ["ck-sq", dark ? "d" : "l"];
        if (C.last?.includes(sq)) cls.push("last");
        if (C.sel.includes(sq)) cls.push("sel");
        if (next.has(sq)) cls.push("to");
        html += `<div class="${cls.join(" ")}" data-sq="${sq}">${v ? `<span class="ck-pc p${owner(v)}${isKing(v) ? " king" : ""}${can.has(sq) ? " can" : ""}"></span>` : ""}</div>`;
      }
      q(".ck", el).innerHTML = html;
      const left = [0, 1].map((p) => C.b.filter((v) => owner(v) === p).length);
      A.setDuel({ turn: C.over ? -1 : C.turn, scores: left, subs: ["", ""] });
      const forced = myTurn && all.length && all[0].length > 1 && Math.abs((all[0][0] >> 3) - (all[0][1] >> 3)) === 2;
      A.status(C.over ? "Game over" : myTurn ? (forced ? "You must capture" : "Your move") : `${C.names[C.turn]}'s move`);
    }

    function onTap(e) {
      const cell = e.target.closest("[data-sq]");
      if (!cell || C.over || C.names[C.turn] !== me.name) return;
      const sq = Number(cell.dataset.sq);
      const all = moves(C.b, C.turn);
      if (!C.sel.length || all.some((m) => m[0] === sq)) {
        if (all.some((m) => m[0] === sq)) { C.sel = [sq]; paint(); }
        return;
      }
      const path = [...C.sel, sq];
      const fit = all.filter((m) => path.every((s, k) => m[k] === s));
      if (!fit.length) { C.sel = []; return paint(); }
      const done = fit.find((m) => m.length === path.length);
      if (done && fit.length === 1) { send(K, { t: "move", path: done }); play(done); }
      else { C.sel = path; A.sound("tick"); paint(); }
    }

    function play(path) {
      const { b, captured } = apply(C.b, path);
      C.b = b;
      C.last = path;
      C.sel = [];
      C.quiet = captured ? 0 : C.quiet + 1;
      A.sound(captured ? "capture" : "move");
      C.turn = 1 - C.turn;
      if (!moves(C.b, C.turn).length) {
        C.over = true; paint();
        return setTimeout(() => A.over(K, C.names, 1 - C.turn, C.b.some((v) => owner(v) === C.turn) ? "No moves left" : "All pieces taken", rematch), 600);
      }
      if (C.quiet >= 80) {
        C.over = true; paint();
        return setTimeout(() => A.over(K, C.names, -1, "40 moves each without a capture", rematch), 600);
      }
      paint();
    }

    function rematch() { const f = firstFor(C.names, C.first); begin(C.names, f); send(K, { t: "start", names: C.names, first: f }); }
    function onMsg(d, peer) {
      if (d.t === "start") { begin(d.names, d.first || 0); toast(`${peer.name} started Checkers`); return; }
      if (d.t !== "move" || !C || C.over || !Array.isArray(d.path)) return;
      const path = d.path.map(Number);
      if (moves(C.b, C.turn).some((m) => m.length === path.length && m.every((s, k) => s === path[k]))) play(path);
    }
    A.register(K, { start, onMsg, cleanup() { C = null; } });
  }
})();
