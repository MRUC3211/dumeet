// DU Meet · Chess for the two of you, with every rule: castling, en passant, promotion,
// check, checkmate, stalemate, threefold repetition, the 50-move rule and insufficient
// material. Clocks with increment, move list, captured pieces, takeback, draw offers,
// resign, drag or tap to move, and the board turns round for black.

(() => {
  "use strict";
  const A = window.DU.arena;
  const { esc, q } = A;
  const K = "chess";

  // ---------- rules ----------

  const FILES = "abcdefgh";
  const sqName = (sq) => FILES[sq & 7] + (8 - (sq >> 3));
  const colorOf = (p) => (p ? (p === p.toUpperCase() ? "w" : "b") : null);
  const opp = (c) => (c === "w" ? "b" : "w");
  const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  function initial() {
    const rows = ["rnbqkbnr", "pppppppp", "", "", "", "", "PPPPPPPP", "RNBQKBNR"];
    const b = [];
    for (const row of rows) for (let c = 0; c < 8; c++) b.push(row[c] || "");
    return { b, turn: "w", castle: "KQkq", ep: -1, half: 0, full: 1 };
  }

  function attacked(b, sq, by) {
    const r = sq >> 3, c = sq & 7;
    const at = (rr, cc) => (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 ? b[rr * 8 + cc] : null);
    const mine = (p, t) => p && colorOf(p) === by && p.toLowerCase() === t;
    const pr = by === "w" ? r + 1 : r - 1;
    if (mine(at(pr, c - 1), "p") || mine(at(pr, c + 1), "p")) return true;
    for (const [dr, dc] of KN) if (mine(at(r + dr, c + dc), "n")) return true;
    for (const [dr, dc] of KG) if (mine(at(r + dr, c + dc), "k")) return true;
    for (const [dirs, kinds] of [[DIAG, "bq"], [ORTH, "rq"]]) {
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          const p = b[rr * 8 + cc];
          if (p) { if (colorOf(p) === by && kinds.includes(p.toLowerCase())) return true; break; }
          rr += dr; cc += dc;
        }
      }
    }
    return false;
  }

  function pseudo(s) {
    const out = [], b = s.b, us = s.turn, them = opp(us);
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p || colorOf(p) !== us) continue;
      const r = sq >> 3, c = sq & 7, t = p.toLowerCase();
      const add = (to, extra = {}) => out.push({ from: sq, to, p, cap: b[to] || "", ...extra });
      if (t === "p") {
        const dir = us === "w" ? -1 : 1, start = us === "w" ? 6 : 1, last = us === "w" ? 0 : 7;
        const push = (to, ex = {}) => {
          if ((to >> 3) === last) for (const pr of "qrbn") add(to, { ...ex, promo: us === "w" ? pr.toUpperCase() : pr });
          else add(to, ex);
        };
        const one = sq + dir * 8;
        if (r + dir >= 0 && r + dir < 8 && !b[one]) {
          push(one);
          if (r === start && !b[one + dir * 8]) add(one + dir * 8, { double: true });
        }
        for (const dc of [-1, 1]) {
          const cc = c + dc, rr = r + dir;
          if (cc < 0 || cc > 7 || rr < 0 || rr > 7) continue;
          const to = rr * 8 + cc;
          if (b[to] && colorOf(b[to]) === them) push(to);
          else if (to === s.ep) add(to, { ep: true, cap: us === "w" ? "p" : "P" });
        }
      } else if (t === "n" || t === "k") {
        for (const [dr, dc] of t === "n" ? KN : KG) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
          const to = rr * 8 + cc;
          if (!b[to] || colorOf(b[to]) === them) add(to);
        }
        if (t === "k") {
          const home = us === "w" ? 60 : 4, rook = us === "w" ? "R" : "r";
          const [ks, qs] = us === "w" ? ["K", "Q"] : ["k", "q"];
          if (sq === home && !attacked(b, home, them)) {
            if (s.castle.includes(ks) && !b[home + 1] && !b[home + 2] && b[home + 3] === rook && !attacked(b, home + 1, them) && !attacked(b, home + 2, them)) add(home + 2, { castle: "K" });
            if (s.castle.includes(qs) && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === rook && !attacked(b, home - 1, them) && !attacked(b, home - 2, them)) add(home - 2, { castle: "Q" });
          }
        }
      } else {
        for (const [dr, dc] of t === "b" ? DIAG : t === "r" ? ORTH : DIAG.concat(ORTH)) {
          let rr = r + dr, cc = c + dc;
          while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
            const to = rr * 8 + cc;
            if (b[to]) { if (colorOf(b[to]) === them) add(to); break; }
            add(to);
            rr += dr; cc += dc;
          }
        }
      }
    }
    return out;
  }

  function make(s, m) {
    const b = s.b.slice();
    b[m.to] = m.promo || m.p;
    b[m.from] = "";
    if (m.ep) b[m.to + (m.p === "P" ? 8 : -8)] = "";
    if (m.castle) {
      const row = m.p === "K" ? 56 : 0;
      if (m.castle === "K") { b[row + 5] = b[row + 7]; b[row + 7] = ""; } else { b[row + 3] = b[row]; b[row] = ""; }
    }
    let castle = s.castle;
    if (m.p === "K") castle = castle.replace(/[KQ]/g, "");
    if (m.p === "k") castle = castle.replace(/[kq]/g, "");
    for (const [sq, ch] of [[63, "K"], [56, "Q"], [7, "k"], [0, "q"]]) if (m.from === sq || m.to === sq) castle = castle.replace(ch, "");
    return {
      b, turn: opp(s.turn), castle, ep: m.double ? (m.from + m.to) / 2 : -1,
      half: m.p.toLowerCase() === "p" || m.cap ? 0 : s.half + 1, full: s.full + (s.turn === "b" ? 1 : 0),
    };
  }

  const kingSq = (b, c) => b.indexOf(c === "w" ? "K" : "k");
  const inCheck = (s) => attacked(s.b, kingSq(s.b, s.turn), opp(s.turn));
  const legal = (s) => pseudo(s).filter((m) => { const n = make(s, m); return !attacked(n.b, kingSq(n.b, s.turn), n.turn); });
  const posKey = (s) => `${s.b.map((p) => p || "-").join("")}${s.turn}${s.castle}${s.ep}`;

  function san(s, m, list) {
    let out;
    if (m.castle) out = m.castle === "K" ? "O-O" : "O-O-O";
    else if (m.p.toLowerCase() === "p") {
      out = (m.cap ? `${FILES[m.from & 7]}x` : "") + sqName(m.to) + (m.promo ? `=${m.promo.toUpperCase()}` : "");
    } else {
      out = m.p.toUpperCase();
      const amb = list.filter((x) => x.p === m.p && x.to === m.to && x.from !== m.from);
      if (amb.length) {
        if (!amb.some((x) => (x.from & 7) === (m.from & 7))) out += FILES[m.from & 7];
        else if (!amb.some((x) => (x.from >> 3) === (m.from >> 3))) out += 8 - (m.from >> 3);
        else out += sqName(m.from);
      }
      out += (m.cap ? "x" : "") + sqName(m.to);
    }
    const n = make(s, m);
    if (inCheck(n)) out += legal(n).length ? "+" : "#";
    return out;
  }

  function insufficient(b) {
    const rest = b.filter((p) => p && p.toLowerCase() !== "k");
    if (!rest.length) return true;
    if (rest.length === 1 && "nb".includes(rest[0].toLowerCase())) return true;
    if (rest.every((p) => p.toLowerCase() === "b")) {
      const shades = new Set(b.map((p, i) => (p && p.toLowerCase() === "b" ? ((i >> 3) + (i & 7)) % 2 : -1)).filter((x) => x >= 0));
      return shades.size === 1;
    }
    return false;
  }

  // ---------- game state ----------

  const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
  const TCS = [
    { id: "3+2", base: 180, inc: 2, label: "3 | 2", small: "Blitz" },
    { id: "5+0", base: 300, inc: 0, label: "5 min", small: "Blitz" },
    { id: "10+0", base: 600, inc: 0, label: "10 min", small: "Rapid" },
    { id: "none", base: 0, inc: 0, label: "No clock", small: "Relaxed" },
  ];
  let G = null;
  let setup = { tc: "10+0", side: "random" };

  const myColor = () => (G.names[0] === me.name ? "w" : "b");
  const myTurn = () => G && !G.over && G.s.turn === myColor();
  const idx = (c) => (c === "w" ? 0 : 1);

  function start() {
    A.open(K, "Chess", `<div class="cs-wait"></div>`, { mine: true });
    paintSetup();
  }

  function paintSetup() {
    const p = A.panel(`<span class="ar-pic">♞</span><b class="ar-ptitle">New game</b>
      <div class="cs-opts" data-g="tc">${TCS.map((t) => `<button data-v="${t.id}" aria-pressed="${t.id === setup.tc}"><b>${t.label}</b><small>${t.small}</small></button>`).join("")}</div>
      <div class="cs-opts three" data-g="side">${[["w", "White"], ["random", "Random"], ["b", "Black"]].map(([v, l]) => `<button data-v="${v}" aria-pressed="${v === setup.side}"><span class="cs-sw ${v}"></span><b>${l}</b></button>`).join("")}</div>
      <div class="ar-row"><button class="btn primary" data-go><span class="icon" aria-hidden="true">play_arrow</span>Start</button></div>`);
    p.onclick = (e) => {
      const opt = e.target.closest("[data-v]");
      if (opt) { setup[opt.parentElement.dataset.g] = opt.dataset.v; return paintSetup(); }
      if (e.target.closest("[data-go]")) {
        const other = A.other()?.name;
        if (!other) return toast("Your partner left the call");
        const side = setup.side === "random" ? (A.rand(2) ? "w" : "b") : setup.side;
        const names = side === "w" ? [me.name, other] : [other, me.name];
        begin(names, setup.tc);
        send(K, { t: "start", names, tc: setup.tc });
      }
    };
  }

  function begin(names, tcId) {
    const tc = TCS.find((t) => t.id === tcId) || TCS[2];
    if (A.current()?.kind !== K) A.open(K, "Chess", "");
    A.panel("");
    A.live(true);
    G = {
      names, tc, s: initial(), hist: [], keys: {}, over: false, sel: -1, flip: false, last: null, drag: null,
      clocks: [tc.base * 1000, tc.base * 1000], turnStart: Date.now(), pendingPromo: null, asked: null,
    };
    G.flip = myColor() === "b";
    G.keys[posKey(G.s)] = 1;
    const body = q(".ar-body", A.current().el);
    body.innerHTML = `<div class="cs">
      <div class="cs-main">
        <div class="cs-bar" data-c="top"></div>
        <div class="cs-board" role="grid" aria-label="Chess board"></div>
        <div class="cs-bar" data-c="bottom"></div>
      </div>
      <aside class="cs-side">
        <ol class="cs-moves" aria-label="Moves"></ol>
        <div class="cs-acts">
          <button data-a="undo" title="Ask for a takeback"><span class="icon" aria-hidden="true">undo</span><span>Takeback</span></button>
          <button data-a="draw" title="Offer a draw"><span class="icon" aria-hidden="true">handshake</span><span>Draw</span></button>
          <button data-a="resign" title="Resign"><span class="icon" aria-hidden="true">flag</span><span>Resign</span></button>
          <button data-a="flip" title="Turn the board"><span class="icon" aria-hidden="true">sync</span><span>Flip</span></button>
        </div>
      </aside></div>`;
    bindBoard(q(".cs-board", body));
    q(".cs-acts", body).addEventListener("click", onAction);
    G.timer = setInterval(tickClock, 200);
    A.current().game = G;
    render();
    A.sound("move");
  }

  // ---------- drawing ----------

  function render(anim) {
    if (!G) return;
    const el = A.current()?.el;
    if (!el) return;
    const board = q(".cs-board", el);
    const legalNow = myTurn() ? legal(G.s) : [];
    const targets = G.sel >= 0 ? legalNow.filter((m) => m.from === G.sel) : [];
    const checkSq = inCheck(G.s) ? kingSq(G.s.b, G.s.turn) : -1;
    let html = "";
    for (let i = 0; i < 64; i++) {
      const sq = G.flip ? 63 - i : i;
      const r = sq >> 3, c = sq & 7;
      const p = G.s.b[sq];
      const cls = ["cs-sq", (r + c) % 2 ? "d" : "l"];
      if (G.last && (G.last.from === sq || G.last.to === sq)) cls.push("last");
      if (sq === G.sel) cls.push("sel");
      if (sq === checkSq) cls.push("check");
      const t = targets.find((m) => m.to === sq);
      if (t) cls.push(p || t.ep ? "cap" : "dot");
      const fileLbl = i >= 56 ? `<i class="cs-f">${FILES[c]}</i>` : "";
      const rankLbl = i % 8 === 0 ? `<i class="cs-r">${8 - r}</i>` : "";
      html += `<div class="${cls.join(" ")}" data-sq="${sq}" role="gridcell" aria-label="${sqName(sq)}${p ? ` ${colorOf(p) === "w" ? "white" : "black"} ${p.toLowerCase()}` : ""}">${rankLbl}${fileLbl}${p ? `<span class="cs-pc ${colorOf(p)}${myTurn() && colorOf(p) === myColor() ? " mine" : ""}">${GLYPH[p.toLowerCase()]}&#xFE0E;</span>` : ""}</div>`;
    }
    board.innerHTML = html;
    if (anim) animate(board, anim);
    paintBars();
    paintMoves();
    const who = G.s.turn === "w" ? 0 : 1;
    A.status(G.over ? "Game over" : myTurn() ? (checkSq >= 0 ? "Check! Your move" : "Your move") : `${G.names[who]} is thinking…`);
  }

  function animate(board, m) {
    const pc = board.querySelector(`[data-sq="${m.to}"] .cs-pc`);
    if (!pc) return;
    const sign = G.flip ? -1 : 1;
    const dx = ((m.from & 7) - (m.to & 7)) * sign, dy = ((m.from >> 3) - (m.to >> 3)) * sign;
    pc.style.transition = "none";
    pc.style.transform = `translate(${dx * 100}%, ${dy * 100}%)`;
    pc.style.zIndex = "3";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pc.style.transition = "transform .18s cubic-bezier(.2,.8,.2,1)";
      pc.style.transform = "";
    }));
  }

  function material() {
    const count = { w: {}, b: {} };
    for (const p of G.s.b) if (p) { const c = colorOf(p), t = p.toLowerCase(); count[c][t] = (count[c][t] || 0) + 1; }
    const full = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const lost = { w: [], b: [] };
    let score = { w: 0, b: 0 };
    for (const c of ["w", "b"]) {
      for (const t of "qrbnp") {
        const missing = Math.max(0, full[t] - (count[c][t] || 0));
        for (let i = 0; i < missing; i++) lost[c].push(t);
      }
      score[c] = Object.entries(count[c]).reduce((s, [t, n]) => s + VAL[t] * n, 0);
    }
    return { lost, diff: score.w - score.b };
  }

  const clockText = (ms) => {
    const s = Math.max(0, ms) / 1000;
    if (s < 10) return `${Math.floor(s)}.${Math.floor((s % 1) * 10)}`;
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  };
  const running = () => G && !G.over && G.tc.base && G.hist.length >= 2;
  const timeLeft = (i) => G.clocks[i] - (running() && idx(G.s.turn) === i ? Date.now() - G.turnStart : 0);

  function paintBars() {
    const el = A.current()?.el;
    const { lost, diff } = material();
    const bottomColor = G.flip ? "b" : "w";
    for (const [pos, c] of [["bottom", bottomColor], ["top", opp(bottomColor)]]) {
      const bar = q(`.cs-bar[data-c="${pos}"]`, el);
      const i = idx(c), name = G.names[i];
      const adv = c === "w" ? diff : -diff;
      const turn = !G.over && G.s.turn === c;
      bar.className = `cs-bar${turn ? " turn" : ""}`;
      bar.dataset.c = pos;
      bar.innerHTML = `<span class="ar-face">${A.faceHtml(name)}</span>
        <span class="cs-who"><b>${name === me.name ? "You" : esc(name)}</b>
        <small class="cs-caps">${lost[opp(c)].map((t) => `<i class="${opp(c)}">${GLYPH[t]}&#xFE0E;</i>`).join("")}${adv > 0 ? `<em>+${adv}</em>` : ""}</small></span>
        ${G.tc.base ? `<span class="cs-clock${turn && running() ? " on" : ""}${timeLeft(i) < 20000 ? " low" : ""}">${clockText(timeLeft(i))}</span>` : ""}`;
    }
  }

  function paintMoves() {
    const list = q(".cs-moves", A.current().el);
    let html = "";
    for (let i = 0; i < G.hist.length; i += 2) {
      html += `<li><i>${i / 2 + 1}.</i><span${i === G.hist.length - 1 ? ' class="now"' : ""}>${esc(G.hist[i].san)}</span><span${i + 1 === G.hist.length - 1 ? ' class="now"' : ""}>${esc(G.hist[i + 1]?.san || "")}</span></li>`;
    }
    list.innerHTML = html || `<li class="cs-empty">Moves show up here</li>`;
    list.scrollTop = list.scrollHeight;
    list.scrollLeft = list.scrollWidth;
  }

  function tickClock() {
    if (!G || G.over || !A.current()) return;
    if (running()) {
      paintBars();
      const t = idx(G.s.turn);
      // the player whose clock ran out says so; the other one claims it if that doesn't arrive
      if ((G.s.turn === myColor() && timeLeft(t) <= 0) || (G.s.turn !== myColor() && timeLeft(t) <= -2500)) {
        send(K, { t: "flag", c: G.s.turn });
        onFlag(G.s.turn);
      }
    }
  }

  // ---------- moving ----------

  function bindBoard(board) {
    board.addEventListener("pointerdown", (e) => {
      const cell = e.target.closest("[data-sq]");
      if (!cell || !G || G.over) return;
      const sq = Number(cell.dataset.sq);
      if (G.sel >= 0 && sq !== G.sel && tryMove(G.sel, sq)) return;
      const p = G.s.b[sq];
      if (myTurn() && p && colorOf(p) === myColor()) {
        G.sel = sq;
        render();
        const pc = board.querySelector(`[data-sq="${sq}"] .cs-pc`);
        if (pc && e.isPrimary) startDrag(e, pc, sq);
      } else if (G.sel >= 0) { G.sel = -1; render(); }
    });
  }

  function startDrag(e, pc, from) {
    const rect = pc.getBoundingClientRect();
    const ghost = pc.cloneNode(true);
    ghost.classList.add("cs-ghost");
    Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px`, fontSize: getComputedStyle(pc).fontSize });
    let moved = false;
    const x0 = e.clientX, y0 = e.clientY;
    const place = (ev) => { ghost.style.transform = `translate(${ev.clientX - rect.width / 2}px, ${ev.clientY - rect.height / 2}px) scale(1.12)`; };
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) { moved = true; document.body.append(ghost); pc.style.opacity = ".25"; }
      if (moved) place(ev);
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!moved) return;
      ghost.remove();
      pc.style.opacity = "";
      const cell = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.(".cs-board [data-sq]");
      const to = cell ? Number(cell.dataset.sq) : -1;
      if (to >= 0 && to !== from && tryMove(from, to, true)) return;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function tryMove(from, to, dragged = false) {
    if (!myTurn()) return false;
    const options = legal(G.s).filter((m) => m.from === from && m.to === to);
    if (!options.length) return false;
    if (options.length > 1) { askPromo(options); return true; }
    play(options[0], true, !dragged);
    return true;
  }

  function askPromo(options) {
    const c = myColor();
    const p = A.panel(`<b class="ar-ptitle">Promote to</b><div class="cs-promo">${"qrbn".split("").map((t) => `<button data-p="${t}" aria-label="${({ q: "Queen", r: "Rook", b: "Bishop", n: "Knight" })[t]}"><span class="cs-pc ${c}">${GLYPH[t]}&#xFE0E;</span></button>`).join("")}</div>
      <button class="btn ghost" data-p="x">Cancel</button>`);
    p.onclick = (e) => {
      const pick = e.target.closest("[data-p]")?.dataset.p;
      if (!pick) return;
      A.panel("");
      if (pick === "x") { G.sel = -1; return render(); }
      const m = options.find((o) => o.promo.toLowerCase() === pick);
      if (m) play(m, true, true);
    };
  }

  function play(m, mine, anim = true) {
    const list = legal(G.s);
    const notation = san(G.s, m, list);
    const moverIdx = idx(G.s.turn);
    const before = { s: G.s, clocks: [...G.clocks], last: G.last };
    if (mine) {
      if (running()) G.clocks[moverIdx] = G.clocks[moverIdx] - (Date.now() - G.turnStart) + G.tc.inc * 1000;
      send(K, { t: "move", from: m.from, to: m.to, promo: m.promo || "", left: G.clocks[moverIdx] });
    }
    G.hist.push({ ...before, san: notation });
    G.s = make(G.s, m);
    G.turnStart = Date.now();
    G.last = { from: m.from, to: m.to };
    G.sel = -1;
    const key = posKey(G.s);
    G.keys[key] = (G.keys[key] || 0) + 1;
    A.sound(notation.includes("+") || notation.includes("#") ? "check" : m.cap ? "capture" : "move");
    render(anim ? m : null);
    checkEnd(key);
  }

  function checkEnd(key) {
    const moves = legal(G.s);
    if (!moves.length) {
      if (inCheck(G.s)) return finish(idx(opp(G.s.turn)), "by checkmate");
      return finish(-1, "Stalemate");
    }
    if (G.keys[key] >= 3) return finish(-1, "Same position three times");
    if (G.s.half >= 100) return finish(-1, "50 moves without a capture or pawn move");
    if (insufficient(G.s.b)) return finish(-1, "Not enough pieces left to checkmate");
  }

  function onFlag(c) {
    if (!G || G.over) return;
    const winner = opp(c);
    // a flag is a draw if the other side can't possibly checkmate
    const theirs = G.s.b.filter((p) => p && colorOf(p) === winner && p.toLowerCase() !== "k");
    if (!theirs.length || (theirs.length === 1 && "nb".includes(theirs[0].toLowerCase()))) return finish(-1, "Time ran out, but no mate was possible");
    finish(idx(winner), "on time");
  }

  function finish(winner, why) {
    if (G.over) return;
    G.over = true;
    clearInterval(G.timer);
    render();
    const detail = winner < 0 ? why : `${G.names[winner] === me.name ? "You" : G.names[winner]} won ${why}`;
    setTimeout(() => A.over(K, G.names, winner, detail, rematch), 700);
  }

  function rematch() {
    const names = [G.names[1], G.names[0]];
    const tc = G.tc.id;
    begin(names, tc);
    send(K, { t: "start", names, tc });
  }

  async function onAction(e) {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a || !G) return;
    if (a === "flip") { G.flip = !G.flip; return render(); }
    if (G.over) return;
    if (a === "resign") {
      if (!(await window.DU.kit.confirmBox({ title: "Resign this game?", text: "Your partner wins this one.", ok: "Resign", cancel: "Keep playing" }))) return;
      send(K, { t: "resign" });
      return finish(1 - idx(myColor()), "by resignation");
    }
    if (a === "draw") { send(K, { t: "offer" }); return toast("Draw offered"); }
    if (a === "undo") {
      const mineLast = G.hist.length && (G.s.turn !== myColor() ? 1 : G.hist.length >= 2 ? 2 : 0);
      if (!mineLast) return toast("Nothing of yours to take back");
      send(K, { t: "undo-ask", n: mineLast });
      toast("Takeback asked");
    }
  }

  function undo(n) {
    for (let i = 0; i < n && G.hist.length; i++) {
      const h = G.hist.pop();
      const key = posKey(G.s);
      G.keys[key] = Math.max(0, (G.keys[key] || 1) - 1);
      G.s = h.s; G.clocks = h.clocks; G.last = h.last;
    }
    G.turnStart = Date.now();
    G.sel = -1;
    render();
  }

  function ask(title, text, yes) {
    const p = A.panel(`<b class="ar-ptitle">${esc(title)}</b><small>${esc(text)}</small>
      <div class="ar-row"><button class="btn ghost" data-y="0">No</button><button class="btn primary" data-y="1">Yes</button></div>`);
    p.onclick = (e) => {
      const y = e.target.closest("[data-y]")?.dataset.y;
      if (y == null) return;
      A.panel("");
      yes(y === "1");
    };
  }

  function onMsg(d, peer) {
    if (d.t === "start") { begin(d.names, d.tc); toast(`${peer.name} started a game of chess`); return; }
    if (!G || G.over) return;
    switch (d.t) {
      case "move": {
        const m = legal(G.s).find((x) => x.from === d.from && x.to === d.to && (x.promo || "") === (d.promo || ""));
        if (!m) return;
        const i = idx(G.s.turn);
        play(m, false);
        if (G.tc.base && typeof d.left === "number" && G.hist.length > 2) G.clocks[i] = d.left;
        paintBars();
        break;
      }
      case "flag": onFlag(d.c); break;
      case "resign": finish(idx(myColor()), "by resignation"); break;
      case "offer":
        ask("Draw?", `${peer.name} offers a draw.`, (yes) => {
          send(K, { t: "offer-ans", yes });
          if (yes) finish(-1, "Draw by agreement");
        });
        break;
      case "offer-ans":
        if (d.yes) finish(-1, "Draw by agreement"); else toast(`${peer.name} wants to play on`);
        break;
      case "undo-ask":
        ask("Takeback?", `${peer.name} wants to take back their last move.`, (yes) => {
          send(K, { t: "undo-ans", yes, n: d.n });
          if (yes) undo(d.n);
        });
        break;
      case "undo-ans":
        if (d.yes) { undo(d.n); toast("Takeback accepted"); } else toast(`${peer.name} said no to the takeback`);
        break;
    }
  }

  A.register(K, {
    start,
    onMsg,
    cleanup() { if (G) clearInterval(G.timer); G = null; },
  });
})();
