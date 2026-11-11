// DU Meet · things just for the two of you, during a call:
// countdown till you meet, questions to talk about, and a game of tic-tac-toe.
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

  // ---------- tic-tac-toe ----------

  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  let game = null; // { board, turn, X, O, winner, line, score }

  function winnerOf(board) {
    for (const line of LINES) {
      const [a, b, c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) return { mark: board[a], line };
    }
    return board.every(Boolean) ? { mark: "draw", line: [] } : null;
  }

  function newGame() {
    toggleTray(false);
    const other = [...peers.values()][0];
    if (!other) return toast("Tic-tac-toe needs two people in the call");
    const score = game?.score || {};
    // whoever lost (or the other player) starts the next round
    const starter = game?.winner && game.winner !== "draw" ? (game.winner === "X" ? game.O : game.X) : me.name;
    const X = starter;
    const O = starter === me.name ? other.name : me.name;
    game = { board: Array(9).fill(""), turn: "X", X, O, winner: "", line: [], score };
    send("ttt", { game });
    paintGame();
  }

  function playAt(index) {
    if (!game || game.winner || game.board[index]) return;
    if (game[game.turn] !== me.name) return toast(`It's ${game[game.turn]}'s turn`);
    game.board[index] = game.turn;
    const result = winnerOf(game.board);
    if (result) {
      game.winner = result.mark;
      game.line = result.line;
      if (result.mark !== "draw") game.score[game[result.mark]] = (game.score[game[result.mark]] || 0) + 1;
    } else game.turn = game.turn === "X" ? "O" : "X";
    send("ttt", { game });
    paintGame();
  }

  function paintGame() {
    const card = q("#tg-game");
    if (!game) { card.hidden = true; return; }
    const myMark = game.X === me.name ? "X" : "O";
    const status = game.winner === "draw" ? "It's a draw"
      : game.winner ? (game[game.winner] === me.name ? "You won!" : `${game[game.winner]} won`)
        : game[game.turn] === me.name ? "Your turn" : `${game[game.turn]}'s turn`;
    const names = [game.X, game.O];
    card.innerHTML = `
      <header class="g-head"><span class="cw-grip" aria-hidden="true"></span><b>Tic-tac-toe</b><button class="icon-btn" data-tg="ttt-close" aria-label="Close game"><span class="icon">close</span></button></header>
      <div class="g-score">${names.map((n) => `<span class="${n === me.name ? "me" : ""}"><i class="m-${n === game.X ? "x" : "o"}"></i>${esc(n === me.name ? "You" : n)} <b>${game.score[n] || 0}</b></span>`).join("")}</div>
      <div class="g-board ${game.winner ? "over" : ""}">${game.board.map((v, i) => `<button data-cell="${i}" class="${v ? `m-${v.toLowerCase()}` : ""} ${game.line.includes(i) ? "win" : ""}" aria-label="Cell ${i + 1}${v ? `, ${v}` : ""}" ${v || game.winner ? "disabled" : ""}></button>`).join("")}</div>
      <p class="g-status ${game.winner ? "done" : ""}">${esc(status)} <small>· you are ${myMark === "X" ? "✕" : "○"}</small></p>
      ${game.winner ? `<button class="btn primary small-btn g-again" data-tg="ttt-new"><span class="icon">replay</span>Play again</button>` : ""}`;
    card.hidden = false;
    placeSavedSafe(card);
  }
  function placeSavedSafe(card) { window.DU.place?.(card, "du-game-pos"); }

  q("#tg-game").addEventListener("click", (event) => {
    const cell = event.target.closest("[data-cell]");
    if (cell) playAt(Number(cell.dataset.cell));
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
        ttt: newGame,
        "ttt-new": newGame,
        "ttt-close": () => { game = null; paintGame(); send("ttt", { close: true }); },
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
      if (message.type === "ttt") {
        if (data.close) { game = null; return paintGame(); }
        const g = data.game;
        if (!g || !Array.isArray(g.board) || g.board.length !== 9) return;
        const fresh = !game || game.board.every((v) => !v);
        game = { board: g.board.map((v) => (v === "X" || v === "O" ? v : "")), turn: g.turn === "O" ? "O" : "X", X: String(g.X), O: String(g.O), winner: ["X", "O", "draw"].includes(g.winner) ? g.winner : "", line: Array.isArray(g.line) ? g.line.map(Number) : [], score: g.score && typeof g.score === "object" ? g.score : {} };
        if (fresh && game.board.every((v) => !v) && q("#tg-game").hidden) toast(`${peer.name} started tic-tac-toe`);
        return paintGame();
      }
      if (message.type !== "couple-sync") return;
      if (data.c === "settings") {
        refreshCountdown();
        if (isOpen("countdown")) { tool.docs.dates = (await getDates()) || {}; RENDER.countdown(); }
      }
    },
    onCouplePeer() {
      if (game) setTimeout(() => send("ttt", { game }), 1500);
    },
    onCoupleJoin() { refreshCountdown(true); },
    onCoupleLeave() {
      q("#tg-question").hidden = true;
      game = null;
      paintGame();
      tool.name = "";
    },
  });
})();
