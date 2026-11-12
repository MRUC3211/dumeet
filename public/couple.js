// DU Meet · things just for the two of you, during a call:
// countdown till you meet, questions to talk about, and games that stay in sync.
// The countdown is saved on the server (Supabase), so it is still there next time.
// Uses globals from app.js (send, peers, me, toast, joinedAt) and helpers from tools.js.

(() => {
  "use strict";
  const { q, esc, store, parseDay, getDocs, putDoc, toggleTray } = window.DU.kit;
  const { openModal, closeModal } = window.DU;

  const DAY = 86400000;
  const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const daysUntil = (key) => Math.round((parseDay(key) - today0()) / DAY);
  const empty = (icon, text) => `<div class="empty-art"><span class="icon">${icon}</span><p>${esc(text)}</p></div>`;

  // ---------- one sheet, many tools ----------

  const tool = { name: "", docs: {} };
  const body = () => q("#tool-body");
  const isOpen = (name) => tool.name === name && !q("#m-tool").hidden;

  function openTool(name, title) {
    toggleTray(false);
    tool.name = name;
    q("#tool-title").textContent = title;
    q("#m-tool .sheet").dataset.tool = name;
    body().innerHTML = `<div class="loading"><span class="spinner"></span></div>`;
    openModal(q("#m-tool"));
  }
  const failed = () => { body().innerHTML = empty("cloud_off", "Couldn't load this. Check the internet and try again."); };
  const tell = (c) => send("couple-sync", { c });

  const RENDER = {};

  // ---------- countdown ----------

  async function getDates() {
    try { return (await getDocs("settings")).find((d) => d.id === "dates")?.data || {}; } catch { return null; }
  }
  RENDER.countdown = () => {
    const dates = tool.docs.dates || {};
    const left = dates.next ? daysUntil(dates.next) : null;
    const together = dates.since ? -daysUntil(dates.since) : null;
    const big = left === null || left < 0
      ? `<div class="cd-big muted-big"><span class="icon">hourglass_empty</span><p>When do you meet next? Set the date below.</p></div>`
      : left === 0 ? `<div class="cd-big today"><b>Today</b><span>${esc(dates.label || "You meet today")}</span></div>`
        : `<div class="cd-big"><b>${left}</b><span>day${left > 1 ? "s" : ""} until ${esc(dates.label || "we meet")}</span><small>${esc(parseDay(dates.next).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }))}</small></div>`;
    body().innerHTML = `
      ${big}
      ${together !== null && together >= 0 ? `<div class="cd-since"><span class="icon">favorite</span><span><b>${together.toLocaleString()}</b> days together</span></div>` : ""}
      <form class="cd-form" data-form="dates">
        <label><span>Next time we meet</span><input class="field" type="date" name="next" value="${esc(dates.next || "")}"></label>
        <label><span>What's the plan?</span><input class="field" name="label" maxlength="40" placeholder="e.g. Diwali at home" value="${esc(dates.label || "")}"></label>
        <label><span>Together since</span><input class="field" type="date" name="since" value="${esc(dates.since || "")}"></label>
        <button class="btn primary wide">Save</button>
      </form>`;
  };
  async function openCountdown() {
    openTool("countdown", "Countdown");
    const dates = await getDates();
    if (dates === null) return failed();
    tool.docs.dates = dates;
    RENDER.countdown();
  }
  async function refreshCountdown(greet = false) {
    const dates = await getDates();
    const line = q("#tray-count");
    if (!dates?.next || daysUntil(dates.next) < 0) { line.textContent = "Till we meet"; return; }
    const left = daysUntil(dates.next);
    line.textContent = left === 0 ? "It's today!" : `${left} day${left > 1 ? "s" : ""} to go`;
    if (greet && left === 0) toast(`Today's the day: ${dates.label || "you meet today"}`);
  }

  // ---------- questions ----------

  const DECKS = {
    "Deep talk": [
      "What's something you've never told anyone?", "When did you feel closest to me?", "What are you most afraid of right now?",
      "What does a perfect day with me look like?", "What's one thing you'd change about how we talk?", "What made you fall for me?",
      "What's a dream you've quietly given up on?", "When do you feel most like yourself?", "What's something I do that makes you feel loved?",
      "What's the hardest thing about being apart for you?", "What do you want us to be like in 10 years?", "What's a memory you replay often?",
    ],
    Fun: [
      "If we swapped lives for a day, what would you do first?", "What's the weirdest food you'd actually eat?", "Which movie character am I most like?",
      "What's your most useless talent?", "If you could have one superpower for a week, which one?", "What song describes us?",
      "What's the funniest thing that happened to you this week?", "Pineapple on pizza, final answer?", "What would your villain name be?",
      "What's the most embarrassing thing on your phone?", "If we had a pet together, what would we name it?", "What's your guilty-pleasure show?",
    ],
    "Would you rather": [
      "Would you rather travel the world or have a dream house?", "Would you rather read my mind or have me read yours?",
      "Would you rather live in the mountains or by the sea?", "Would you rather never use social media again or never watch movies again?",
      "Would you rather have a long weekend every week or double salary?", "Would you rather relive our first date or skip to our next one?",
      "Would you rather cook together or order in forever?", "Would you rather be famous or rich?", "Would you rather always be early or always be late?",
      "Would you rather have breakfast in Paris or dinner in Tokyo?",
    ],
    "Future us": [
      "Where should we travel first together?", "What does our home look like?", "What tradition should we start?",
      "What's one thing we must do before we turn 30?", "City life or a quiet town?", "What would our Sunday mornings be like?",
      "What's something you want to learn together?", "How do we celebrate our anniversaries?", "What's on your list for our next meet?",
    ],
    Memories: [
      "What's your favourite memory of us?", "What did you first think when you saw me?", "What's the best gift you've ever got?",
      "What's a moment you wish you could relive?", "Which of our calls do you remember the most?", "What was the best day of this year so far?",
      "What's a song that reminds you of me?", "What's the funniest fight we've had?", "What's the sweetest thing I've done for you?",
    ],
  };
  const asked = new Set(store.get("du-asked", []));
  let deck = store.get("du-deck", "Deep talk");

  function pickQuestion(name) {
    const list = DECKS[name] || DECKS["Deep talk"];
    let pool = list.filter((text) => !asked.has(text));
    if (!pool.length) { list.forEach((text) => asked.delete(text)); pool = list; }
    const text = pool[Math.floor(Math.random() * pool.length)];
    asked.add(text);
    store.set("du-asked", [...asked].slice(-200));
    return text;
  }
  function ask(name = deck) {
    const text = pickQuestion(name);
    showQuestion({ deck: name, text, by: me.name });
    send("question", { deck: name, text });
    closeModal(q("#m-tool"));
  }
  function showQuestion({ deck: name, text, by }) {
    const card = q("#tg-question");
    card.innerHTML = `<small><span class="icon">forum</span>${esc(name)} · ${by === me.name ? "you asked" : `${esc(by)} asked`}</small>
      <p>${esc(text)}</p>
      <div class="q-actions"><button class="btn small-btn q-next" data-tg="q-next"><span class="icon">shuffle</span>Next</button><button class="icon-btn" data-tg="q-close" aria-label="Close"><span class="icon">close</span></button></div>`;
    card.dataset.deck = name;
    card.hidden = false;
    card.classList.remove("in");
    void card.offsetWidth;
    card.classList.add("in");
  }
  RENDER.questions = () => {
    body().innerHTML = `<p class="muted">Pick a deck. The question shows up for both of you.</p>
      <div class="decks">${Object.keys(DECKS).map((name, i) => `<button class="deck d${i}" data-deck="${esc(name)}"><b>${esc(name)}</b><small>${DECKS[name].length} questions</small></button>`).join("")}</div>`;
  };

  // ---------- games: tic-tac-toe, 4 in a row, rock paper scissors, spin to decide, breathe ----------
  // Both phones hold the whole game. Every change bumps a version number and goes out as
  // the full state. The higher version wins (on a tie, the same player wins on both sides),
  // and whoever moved last re-sends until the other phone confirms it, so a lost message
  // can't leave the two boards different.

  const GAMES = {
    ttt: { title: "Tic-tac-toe", size: 9, cols: 3, rows: 3, need: 3 },
    c4: { title: "4 in a row", size: 42, cols: 7, rows: 6, need: 4 },
    rps: { title: "Rock paper scissors" },
    wheel: { title: "Spin to decide", solo: true },
    breathe: { title: "Breathe together", solo: true },
    land: { title: "Land grab" },
  };
  const LAND = { side: 8, secs: 45 };
  const WHEEL_DEFAULT = ["Movie", "Songs", "A game", "Just talk", "Sleep call"];
  const HANDS = { rock: "Rock", paper: "Paper", scissors: "Scissors" };
  const HAND_ICON = { rock: "back_hand", paper: "front_hand", scissors: "content_cut" };
  let game = null;
  let acked = 0;

  function lineWin(board, cols, rows, need) {
    const at = (r, c) => (r >= 0 && r < rows && c >= 0 && c < cols ? board[r * cols + c] : "");
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const mark = at(r, c);
        if (!mark) continue;
        for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
          const line = [r * cols + c];
          while (line.length < need && at(r + dr * line.length, c + dc * line.length) === mark) line.push((r + dr * line.length) * cols + c + dc * line.length);
          if (line.length === need) return { mark, line };
        }
      }
    }
    return board.every(Boolean) ? { mark: "draw", line: [] } : null;
  }

  function commit(next) {
    next.v = Math.max(game?.v || 0, next.v || 0) + 1;
    next.by = me.name;
    game = next;
    if (game.kind === "land" && !game.closed) landSeen(game);
    send("game", { g: game });
    paintGame();
  }

  function startGame(kind) {
    toggleTray(false);
    const other = [...peers.values()][0];
    if (!other && !GAMES[kind].solo) return toast(`${GAMES[kind].title} needs two people in the call`);
    const again = game?.kind === kind && !game.closed;
    const players = again && game.players.length === 2 ? [game.players[1], game.players[0]] : [me.name, other?.name || ""];
    commit({
      kind, players, round: (again ? game.round : 0) + 1, turn: 0, closed: false,
      board: Array(GAMES[kind].size || 0).fill(""), winner: "", line: [], last: -1,
      score: again ? game.score : {}, picks: {},
      options: game?.options || WHEEL_DEFAULT, spin: null, startedBy: me.name, id: Date.now(),
      cells: kind === "land" ? landStart() : [], left: LAND.secs * 1000,
    });
  }

  // ---------- land grab: claim squares next to yours; take theirs when 2 of yours touch it ----------
  // Both play at the same time, so each square carries a counter and the two boards are
  // merged square by square (the newer claim wins) instead of one board replacing the other.
  let landEnd = 0;
  let landRound = "";
  let landTick = 0;
  let landPrev = [];
  function landStart() {
    const cells = Array.from({ length: LAND.side ** 2 }, () => ({ o: "", t: 0 }));
    cells[0] = { o: "0", t: 1 };
    cells[cells.length - 1] = { o: "1", t: 1 };
    return cells;
  }
  const landKey = (g) => `${g.id}-${g.round}`;
  const landLeft = () => Math.max(0, landEnd - Date.now());
  const near = (i) => {
    const n = LAND.side, r = Math.floor(i / n), c = i % n, out = [];
    if (r) out.push(i - n); if (r < n - 1) out.push(i + n); if (c) out.push(i - 1); if (c < n - 1) out.push(i + 1);
    return out;
  };
  const landCount = (g, who) => g.cells.filter((c) => c.o === who).length;
  function canClaim(g, i, mine) {
    const cell = g.cells[i];
    if (cell.o === mine) return false;
    const touching = near(i).filter((j) => g.cells[j].o === mine).length;
    return cell.o ? touching >= 2 : touching >= 1;
  }
  function newer(a, b, i) {
    if (a.t !== b.t) return a.t > b.t ? a : b;
    if (a.o === b.o) return a;
    return (i + game.round) % 2 ? (a.o > b.o ? a : b) : (a.o < b.o ? a : b);
  }
  function landSeen(g) {
    if (landRound === landKey(g)) return;
    landRound = landKey(g);
    landEnd = Date.now() + Math.min(LAND.secs * 1000, Number(g.left) || LAND.secs * 1000);
    clearInterval(landTick);
    landTick = setInterval(landClock, 250);
  }
  function landClock() {
    if (game?.kind !== "land" || game.closed || landRound !== landKey(game)) return clearInterval(landTick);
    const left = landLeft();
    const card = q("#tg-game");
    const bar = q(".land-bar i", card);
    if (bar) bar.style.transform = `scaleX(${left / (LAND.secs * 1000)})`;
    const time = q(".land-time", card);
    if (time) time.textContent = game.winner ? "" : `${Math.ceil(left / 1000)}s`;
    if (left > 0 || game.winner) return;
    q(".g-board.land", card)?.classList.add("over");
    const st = q(".g-status", card);
    if (st) st.textContent = "Time's up · counting";
    clearInterval(landTick);
    // the one who started settles the result once both boards have met
    if (game.startedBy === me.name) setTimeout(() => {
      if (game?.kind !== "land" || game.winner) return;
      const [a, b] = [landCount(game, "0"), landCount(game, "1")];
      const next = structuredClone(game);
      next.winner = a === b ? "draw" : a > b ? "0" : "1";
      if (next.winner !== "draw") next.score[next.players[+next.winner]] = (next.score[next.players[+next.winner]] || 0) + 1;
      commit(next);
    }, 1800);
  }
  function landTap(i) {
    if (game?.kind !== "land" || game.winner || !landLeft()) return;
    const mine = String(game.players.indexOf(me.name));
    if (mine === "-1") return toast("You're watching this round");
    if (!canClaim(game, i, mine)) {
      const cell = q(`#tg-game [data-land="${i}"]`);
      cell?.classList.remove("nope"); void cell?.offsetWidth; cell?.classList.add("nope");
      return;
    }
    const t = Math.max(...game.cells.map((c) => c.t)) + 1;
    game.cells[i] = { o: mine, t };
    send("game", { g: { ...game, left: landLeft() } });
    paintGame();
  }
  // keep both boards meeting while the clock runs
  setInterval(() => {
    if (game?.kind === "land" && !game.closed && !game.winner && landLeft() && polling && peers.size) send("game", { g: { ...game, left: landLeft() } });
  }, 1200);

  function play(cell) {
    const rules = GAMES[game?.kind];
    if (!game || game.winner || !rules?.size) return;
    const mine = game.players.indexOf(me.name);
    if (mine < 0) return toast("You're watching this round");
    if (mine !== game.turn) return toast(`It's ${game.players[game.turn]}'s turn`);
    let index = cell;
    if (game.kind === "c4") {
      index = -1;
      for (let r = rules.rows - 1; r >= 0; r--) if (!game.board[r * rules.cols + cell]) { index = r * rules.cols + cell; break; }
      if (index < 0) return;
    } else if (game.board[index]) return;
    const next = structuredClone(game);
    next.board[index] = String(mine);
    next.last = index;
    const result = lineWin(next.board, rules.cols, rules.rows, rules.need);
    if (result) {
      next.winner = result.mark;
      next.line = result.line;
      if (result.mark !== "draw") next.score[next.players[+result.mark]] = (next.score[next.players[+result.mark]] || 0) + 1;
    } else next.turn = 1 - mine;
    commit(next);
  }

  function settleHands(g) {
    const [a, b] = g.players.map((p) => g.picks[p]);
    if (!a || !b || g.winner) return;
    const beats = { rock: "scissors", paper: "rock", scissors: "paper" };
    g.winner = a === b ? "draw" : beats[a] === b ? "0" : "1";
    if (g.winner !== "draw") g.score[g.players[+g.winner]] = (g.score[g.players[+g.winner]] || 0) + 1;
  }
  function pickHand(hand) {
    if (game?.kind !== "rps" || game.winner || !HANDS[hand]) return;
    if (!game.players.includes(me.name)) return toast("You're watching this round");
    if (game.picks[me.name]) return;
    const next = structuredClone(game);
    next.picks[me.name] = hand;
    settleHands(next);
    commit(next);
  }

  function spin() {
    if (game?.kind !== "wheel") return;
    const next = structuredClone(game);
    next.spin = { n: (game.spin?.n || 0) + 1, pick: Math.floor(Math.random() * game.options.length), by: me.name };
    commit(next);
  }

  function closeGame() {
    if (!game) return;
    commit({ ...structuredClone(game), closed: true });
  }

  const validGame = (g) => g && GAMES[g.kind] && Number.isFinite(g.v) && typeof g.by === "string"
    && (g.kind !== "land" || (Array.isArray(g.cells) && g.cells.length === LAND.side ** 2 && g.cells.every((c) => c && ["", "0", "1"].includes(c.o) && Number.isFinite(c.t))))
    && Array.isArray(g.players) && Array.isArray(g.board) && g.board.length === (GAMES[g.kind].size || 0)
    && g.picks && typeof g.picks === "object" && g.score && typeof g.score === "object" && Array.isArray(g.options);

  function receiveGame(g, peer) {
    if (!validGame(g)) return;
    // land grab while the clock runs: merge the two boards square by square
    if (game && !game.closed && !g.closed && g.kind === "land" && game.kind === "land" && landKey(g) === landKey(game) && !g.winner && !game.winner) {
      game.cells = game.cells.map((c, i) => newer(c, g.cells[i], i));
      game.v = Math.max(game.v, g.v);
      return paintGame();
    }
    send("game-ack", { v: g.v }, peer.id);
    // Both picked a hand at the same moment: keep both picks.
    if (game && !game.closed && g.kind === "rps" && game.kind === "rps" && g.round === game.round && !g.winner && !game.winner) {
      const picks = { ...g.picks, ...game.picks };
      if (Object.keys(picks).length > Object.keys(g.picks).length) {
        const next = { ...structuredClone(g), picks, v: Math.max(g.v, game.v) };
        settleHands(next);
        return commit(next);
      }
    }
    if (game && (g.v < game.v || (g.v === game.v && g.by <= game.by))) return;
    const isNew = !g.closed && (!game || game.closed || game.kind !== g.kind || game.round !== g.round);
    game = g;
    if (g.kind === "land" && !g.closed) landSeen(g);
    if (isNew && g.startedBy !== me.name && q("#tg-game").hidden) toast(`${peer.name} started ${GAMES[g.kind].title.toLowerCase()}`);
    paintGame();
  }

  // the last mover keeps sending until the other side confirms
  setInterval(() => {
    if (game && game.by === me.name && acked < game.v && polling && peers.size) send("game", { g: game });
  }, 2500);

  // ---------- all-time scores, kept in Supabase (settings doc "game-scores") ----------
  // Player one of each round writes the result, so a round is never counted twice.
  let allTime = {};
  const recorded = new Set();
  getDocs("settings").then((docs) => { allTime = docs.find((d) => d.id === "game-scores")?.data || {}; }).catch(() => {});
  async function recordResult(g) {
    const key = `${g.kind}-${g.id}-${g.round}`;
    if (!g.winner || g.players[0] !== me.name || recorded.has(key) || GAMES[g.kind].solo) return;
    recorded.add(key);
    try {
      allTime = (await getDocs("settings")).find((d) => d.id === "game-scores")?.data || {};
      const t = { ...(allTime[g.kind] || {}) };
      if (g.winner === "draw") t.draws = (t.draws || 0) + 1;
      else t[g.players[+g.winner]] = (t[g.players[+g.winner]] || 0) + 1;
      allTime = { ...allTime, [g.kind]: t };
      await putDoc("settings", allTime, "game-scores");
      send("couple-sync", { c: "game-scores" });
      paintGame();
    } catch { /* offline: the round still counts on screen */ }
  }

  let wheelShown = 0;
  let breatheTimer = 0;
  function paintGame() {
    const card = q("#tg-game");
    if (game?.winner) recordResult(game);
    clearInterval(breatheTimer);
    if (!game || game.closed) { card.hidden = true; return; }
    const rules = GAMES[game.kind];
    const mine = game.players.indexOf(me.name);
    const name = (n) => (n === me.name ? "You" : n);
    const scoreRow = rules.solo || game.kind === "land" ? "" : `<div class="g-score">${game.players.map((n, i) => `<span class="${n === me.name ? "me" : ""}"><i class="m-${game.kind === "c4" ? `d${i}` : i ? "o" : "x"}"></i>${esc(name(n))} <b>${game.score[n] || 0}</b></span>`).join("")}</div>`;
    const winnerName = game.winner && game.winner !== "draw" ? game.players[+game.winner] : "";
    let status = game.winner === "draw" ? "It's a draw" : winnerName ? (winnerName === me.name ? "You won!" : `${winnerName} won`) : "";
    let middle = "";
    if (rules.size) {
      if (!status) status = mine === game.turn ? "Your turn" : `${game.players[game.turn]}'s turn`;
      const cells = game.board.map((v, i) => `<button data-cell="${game.kind === "c4" ? i % 7 : i}" class="${v ? `m-${game.kind === "c4" ? `d${v}` : v === "0" ? "x" : "o"}` : ""}${game.line.includes(i) ? " win" : ""}${i === game.last ? " last" : ""}" style="--row:${Math.floor(i / (rules.cols || 3))}" aria-label="${game.kind === "c4" ? `Column ${(i % 7) + 1}` : `Cell ${i + 1}`}${v ? `, ${game.players[+v] === me.name ? "yours" : "theirs"}` : ""}" ${game.winner || (game.kind === "ttt" && v) ? "disabled" : ""}></button>`).join("");
      middle = `<div class="g-board ${game.kind}${game.winner ? " over" : ""}${mine === game.turn && !game.winner ? " my-turn" : ""}">${cells}</div>`;
    } else if (game.kind === "rps") {
      const picked = game.picks[me.name];
      const other = game.players.find((p) => p !== me.name) || "";
      if (!status) status = picked ? (game.picks[other] ? "" : `Waiting for ${other}…`) : game.picks[other] ? `${other} has chosen. Your move` : "Choose your move";
      middle = game.winner
        ? `<div class="rps-reveal">${game.players.map((p, i) => `<div class="${game.winner === String(i) ? "win" : ""}"><span class="icon">${HAND_ICON[game.picks[p]]}</span><small>${esc(name(p))} · ${HANDS[game.picks[p]]}</small></div>`).join("<b>vs</b>")}</div>`
        : `<div class="rps-hands">${Object.keys(HANDS).map((h) => `<button data-hand="${h}" class="${picked === h ? "on" : ""}" ${picked ? "disabled" : ""}><span class="icon">${HAND_ICON[h]}</span><small>${HANDS[h]}</small></button>`).join("")}</div>`;
    } else if (game.kind === "wheel") {
      const seg = 360 / game.options.length;
      const turn = game.spin ? game.spin.n * 1800 + 360 - (game.spin.pick + 0.5) * seg : 0;
      const colors = ["#0a84ff", "#bf5af2", "#ff375f", "#ff9f0a", "#30d158", "#64d2ff", "#5e5ce6", "#ffd60a"];
      const fill = game.options.map((_, i) => `${colors[i % colors.length]} ${i * seg}deg ${(i + 1) * seg}deg`).join(",");
      const fresh = game.spin && wheelShown !== game.spin.n;
      status = game.spin && !fresh ? game.options[game.spin.pick] : game.spin ? "Spinning…" : "Add your choices, then spin";
      middle = `<div class="wheel-wrap"><i class="wheel-pin" aria-hidden="true"></i><div class="wheel" style="background:conic-gradient(${fill});transform:rotate(${fresh ? turn - 1800 : turn}deg)">${game.options.map((o, i) => `<span style="--a:${(i + 0.5) * seg}deg">${esc(o.slice(0, 12))}</span>`).join("")}</div><button class="wheel-go" data-g="spin" aria-label="Spin">Spin</button></div>
        <form class="wheel-edit" data-form="wheel"><input name="options" value="${esc(game.options.join(", "))}" aria-label="Choices, separated by commas" maxlength="160"><button class="icon-btn" aria-label="Save choices"><span class="icon">check</span></button></form>`;
      if (fresh) {
        requestAnimationFrame(() => requestAnimationFrame(() => { const w = q(".wheel", card); if (w) { w.classList.add("spinning"); w.style.transform = `rotate(${turn}deg)`; } }));
        setTimeout(() => { wheelShown = game?.spin?.n || 0; if (game?.kind === "wheel") { const s = q(".g-status", card); if (s) { s.textContent = game.options[game.spin.pick]; s.classList.add("done"); } } }, 3700);
      }
    } else if (game.kind === "land") {
      const mine = String(game.players.indexOf(me.name));
      const live = !game.winner && landLeft() > 0;
      if (!status) status = live ? "Tap squares next to yours" : "Counting…";
      const tone = (n, i) => (/^diya$/i.test(n) ? "#ff375f" : /^uday$/i.test(n) ? "#0a84ff" : i ? "#ff375f" : "#0a84ff");
      const face = (n) => { const url = window.DU.faceFor?.(n); return url ? `<img src="${esc(url)}" alt="">` : esc((n || "?")[0].toUpperCase()); };
      card.style.setProperty("--p0", tone(game.players[0], 0));
      card.style.setProperty("--p1", tone(game.players[1], 1));
      middle = `<div class="land-top">${game.players.map((n, i) => `<span class="lp${i}"><i class="land-face">${face(n)}</i><span><small>${esc(name(n))}</small><b>${landCount(game, String(i))}</b></span></span>`).join(`<em class="land-time">${live ? Math.ceil(landLeft() / 1000) + "s" : ""}</em>`)}</div>
        <div class="land-bar"><i style="transform:scaleX(${landLeft() / (LAND.secs * 1000)})"></i></div>
        <div class="g-board land${live ? "" : " over"}">${game.cells.map((c, i) => `<button data-land="${i}" class="${c.o ? `o${c.o}` : ""}${c.o && landPrev[i] !== c.o ? " new" : ""}${live && canClaim(game, i, mine) ? " can" : ""}" aria-label="Square ${i + 1}"></button>`).join("")}</div>`;
      landPrev = game.cells.map((c) => c.o);
    } else if (game.kind === "breathe") {
      middle = `<div class="breath"><div class="breath-ring"></div><b class="breath-word">Breathe in</b></div>`;
      const word = () => { const w = q(".breath-word", card); if (w) w.textContent = (Date.now() / 1000) % 10 < 5 ? "Breathe in" : "Breathe out"; };
      status = "In for 5, out for 5. Together.";
      setTimeout(word);
      breatheTimer = setInterval(word, 250);
    }
    const tally = allTime[game.kind];
    const allTimeRow = !rules.solo && tally ? `<p class="g-alltime">All time · ${game.players.map((n) => `${esc(name(n))} ${tally[n] || 0}`).join(" · ")}${tally.draws ? ` · ${tally.draws} draw${tally.draws > 1 ? "s" : ""}` : ""}</p>` : "";
    const again = game.winner ? `<button class="btn primary small-btn g-again" data-tg="g-${game.kind}"><span class="icon">replay</span>Play again</button>` : "";
    card.innerHTML = `
      <header class="g-head"><span class="cw-grip" aria-hidden="true"></span><b>${rules.title}</b><button class="icon-btn" data-tg="g-close" aria-label="Close"><span class="icon">close</span></button></header>
      ${scoreRow}${middle}
      ${allTimeRow}<p class="g-status ${game.winner || (game.kind === "wheel" && game.spin && wheelShown === game.spin.n) ? "done" : ""}" aria-live="polite">${esc(status)}</p>${again}`;
    card.dataset.kind = game.kind;
    if (game.kind === "breathe") q(".breath-ring", card).style.animationDelay = `-${(Date.now() / 1000) % 10}s`;
    card.hidden = false;
    window.DU.place?.(card, "du-game-pos");
  }

  q("#tg-game").addEventListener("click", (event) => {
    const cell = event.target.closest("[data-cell]");
    if (cell) return play(Number(cell.dataset.cell));
    const land = event.target.closest("[data-land]");
    if (land) return landTap(Number(land.dataset.land));
    const hand = event.target.closest("[data-hand]");
    if (hand) return pickHand(hand.dataset.hand);
    if (event.target.closest("[data-g=spin]")) spin();
  });
  q("#tg-game").addEventListener("submit", (event) => {
    event.preventDefault();
    const options = event.target.options.value.split(",").map((o) => o.trim()).filter(Boolean).slice(0, 8);
    if (options.length < 2) return toast("Add at least two choices");
    commit({ ...structuredClone(game), options, spin: null });
  });

  // ---------- forms inside the sheet ----------

  q("#tool-body").addEventListener("click", (event) => {
    const deckButton = event.target.closest("[data-deck]");
    if (deckButton) { deck = deckButton.dataset.deck; store.set("du-deck", deck); ask(deck); }
  });

  q("#tool-body").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.dataset.form !== "dates") return;
    const data = Object.fromEntries(new FormData(form));
    const button = form.querySelector("button:last-child");
    button.disabled = true;
    try {
      const dates = { next: data.next, label: data.label.trim(), since: data.since, by: me.name };
      await putDoc("settings", dates, "dates");
      tool.docs.dates = dates;
      refreshCountdown();
      toast("Saved");
      tell("settings");
      RENDER.countdown();
    } catch {
      toast("Couldn't save. Check the internet.");
      button.disabled = false;
    }
  });

  window.DU = Object.assign(window.DU, {
    onCoupleClick(button) {
      ({
        countdown: openCountdown,
        questions: () => { openTool("questions", "Questions"); RENDER.questions(); },
        ttt: () => startGame("ttt"),
        c4: () => startGame("c4"),
        rps: () => startGame("rps"),
        wheel: () => startGame("wheel"),
        breathe: () => startGame("breathe"),
        "g-ttt": () => startGame("ttt"),
        "g-c4": () => startGame("c4"),
        "g-rps": () => startGame("rps"),
        "g-land": () => startGame("land"),
        land: () => startGame("land"),
        "g-close": closeGame,
        "q-next": () => ask(q("#tg-question").dataset.deck || deck),
        "q-close": () => { q("#tg-question").hidden = true; send("question", { close: true }); },
      })[button.dataset.tg]?.();
    },
    async onCouple(message, peer) {
      const data = message.data || {};
      if (message.type === "question") {
        if (data.close) q("#tg-question").hidden = true;
        else if (DECKS[data.deck]) showQuestion({ deck: data.deck, text: String(data.text).slice(0, 300), by: peer.name });
        return;
      }
      if (message.type === "game") return receiveGame(data.g, peer);
      if (message.type === "game-ack") { if (game && data.v === game.v) acked = Math.max(acked, data.v); return; }
      if (message.type !== "couple-sync") return;
      if (data.c === "game-scores") {
        getDocs("settings").then((docs) => { allTime = docs.find((d) => d.id === "game-scores")?.data || {}; paintGame(); }).catch(() => {});
        return;
      }
      if (data.c === "settings") {
        refreshCountdown();
        if (isOpen("countdown")) { tool.docs.dates = (await getDates()) || {}; RENDER.countdown(); }
      }
    },
    onCouplePeer() {
      acked = 0;
      if (game && !game.closed) setTimeout(() => send("game", { g: game }), 1500);
    },
    onCoupleJoin() { refreshCountdown(true); },
    onCoupleLeave() {
      q("#tg-question").hidden = true;
      game = null;
      acked = 0;
      paintGame();
      tool.name = "";
    },
  });
})();
