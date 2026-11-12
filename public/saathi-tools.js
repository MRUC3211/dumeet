// DU Meet · what Hey Lord can see and do in the app, beyond each feature's own tools.
//
// How it fits together:
//  - Hey Lord runs on one phone (whoever called her). Tools marked `personal` act on one
//    person's own phone: ai.js works out who asked (the name she passes, else whoever was
//    just talking) and, for the partner, sends the call over and gets the result back.
//  - `screen` lets her read and press anything that's open (cards, games, windows), so a
//    feature works by voice even without a tool of its own.
//  - Games tell her each move (arena.event); with commentary on she reacts as they play.

(() => {
  "use strict";
  const T = (window.DU.saathiTools ||= []);
  // on screen (offsetParent is null for fixed windows, so look at the boxes instead)
  const visible = (el) => Boolean(el && !el.closest("[hidden]") && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
  const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();
  const PERSON = { type: "STRING", description: "Whose phone: their name. Leave empty for the person who just asked." };

  // ---------- what's on this phone's screen ----------
  function surfaces() {
    const out = [];
    const ar = window.DU.arena?.current();
    if (ar) out.push({ kind: "game", title: ar.el.querySelector(".ar-title")?.textContent || ar.kind, el: ar.el });
    document.querySelectorAll(".fw").forEach((w) => visible(w) && out.push({ kind: "window", title: clean(w.querySelector(".fw-title, .fw-head b")?.textContent) || w.dataset.win, el: w }));
    document.querySelectorAll(".modal.open").forEach((m) => out.push({ kind: "sheet", title: clean(m.querySelector("h2, .sheet-head b")?.textContent) || m.id, el: m }));
    ["#tg-calw", "#tg-game"].forEach((sel) => { const el = document.querySelector(sel); if (el && !el.hidden && visible(el)) out.push({ kind: "panel", title: sel === "#tg-calw" ? "Calendar" : "Game", el }); });
    const tray = document.querySelector("#tg-tray");
    if (tray && !tray.hidden) out.push({ kind: "tools menu", title: "Tools", el: tray });
    return out;
  }
  // a button's words, without the icon names inside it ("style", "close"…)
  function label(b) {
    const own = b.getAttribute("aria-label") || b.title;
    if (own) return clean(own).slice(0, 60);
    const c = b.cloneNode(true);
    c.querySelectorAll(".icon, [aria-hidden=true]").forEach((x) => x.remove());
    return clean(c.textContent).slice(0, 60);
  }
  // the button someone means: same words first, then starts-with, then a whole word; a
  // "Close …" button only when they said close
  const norm = (t) => String(t || "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
  function bestButton(list, what) {
    const want = norm(what);
    if (!want) return null;
    let best = null, top = 0;
    for (const b of list) {
      const l = norm(label(b));
      if (!l) continue;
      let score = l === want ? 100 : l.startsWith(want) ? 80 : new RegExp(`(^| )${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(l) ? 60 : l.includes(want) ? 40
        : want.split(" ").filter((w) => w.length > 2 && l.includes(w)).length * 12;
      if (/^(close|leave|resize)\b/.test(l) && !/^(close|leave|resize)/.test(want)) score -= 45;
      score -= Math.min(15, Math.abs(l.length - want.length) / 3);
      if (score > top) { top = score; best = b; }
    }
    return top >= 20 ? best : null;
  }
  const buttons = (root) => [...root.querySelectorAll("button, [role=button], a[href]")].filter((b) => visible(b) && !b.disabled && label(b));

  T.push(
    { name: "screen", personal: true,
      description: "See what's open on someone's screen right now (games, cards, windows, popups) with every button, or press one of those buttons by its label (e.g. 'Next card', 'Truth', 'Roll', 'Start', 'I have'). Use this for anything in the app that has no tool of its own.",
      parameters: { type: "OBJECT", properties: {
        person: PERSON,
        action: { type: "STRING", enum: ["read", "press"] },
        button: { type: "STRING", description: "For press: the button's label" },
        where: { type: "STRING", description: "For press, optional: which window (its title)" },
      }, required: ["action"] },
      run: (a) => {
        const list = surfaces();
        if (a.action === "press") {
          const scope = a.where ? list.filter((s) => clean(s.title).toLowerCase().includes(String(a.where).toLowerCase())) : list;
          const all = (scope.length ? scope : list).flatMap((s) => buttons(s.el));
          const b = bestButton(all, a.button);
          if (!b) return { error: `No button like "${a.button}"`, buttons: all.map(label).slice(0, 40) };
          b.click();
          return { pressed: label(b) };
        }
        if (!list.length) return { open: "Nothing is open; just the video call." };
        return { open: list.map((s) => ({ kind: s.kind, title: s.title, text: clean(s.el.innerText).slice(0, 700), buttons: [...new Set(buttons(s.el).map(label))].slice(0, 30) })) };
      } },

    { name: "microphone", personal: true,
      description: "Mute or unmute someone's microphone (mic, mute, unmute, awaaz band/chalu). Note: once muted, you can't hear that person until they unmute.",
      parameters: { type: "OBJECT", properties: { person: PERSON, on: { type: "BOOLEAN", description: "true = unmute, false = mute" } }, required: ["on"] },
      run: (a) => { if (!micTrack()) return { error: "No microphone" }; setMic(Boolean(a.on)); return { mic: me.mic ? "on" : "muted" }; } },

    { name: "camera", personal: true,
      description: "Turn someone's camera/video on or off (video band karo, camera chalu karo), or flip between front and back camera.",
      parameters: { type: "OBJECT", properties: { person: PERSON, action: { type: "STRING", enum: ["on", "off", "flip"] } }, required: ["action"] },
      run: async (a) => {
        if (a.action === "flip") { await flipCamera(); return { flipped: true }; }
        await setCamera(a.action === "on");
        return { camera: me.cam ? "on" : "off" };
      } },

    { name: "call_info",
      description: "Facts about the call right now: how long it has been going, who is in it, whose mic and camera are on, who has a raised hand, the connection, what's open, the date and time.",
      parameters: { type: "OBJECT", properties: {} },
      run: () => {
        const mins = joinedAt ? Math.floor((Date.now() - joinedAt) / 60000) : 0;
        const people = [
          { name: me.name, mic: me.mic, camera: me.cam, hand: Boolean(me.hand), sharing_screen: Boolean(me.screenTrack) },
          ...[...peers.values()].map((p) => ({ name: p.name, mic: Boolean(p.mic), camera: Boolean(p.cam), hand: Boolean(p.hand), sharing_screen: Boolean(p.screen) })),
        ];
        return {
          duration: joinedAt ? formatDuration(Date.now() - joinedAt) : "not in a call", minutes: mins,
          started_at: joinedAt ? new Date(joinedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "",
          now: new Date().toLocaleString("en-IN", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }),
          people, saathi_runs_on: window.DU.saathi?.host?.() || "",
          connection: document.querySelector(".net-bars, .tile-net")?.getAttribute("aria-label") || undefined,
          open_on_this_phone: surfaces().map((s) => s.title),
        };
      } },

    { name: "game_state",
      description: "The game they're playing right now, in words: players, whose turn, scores, recent moves; for chess the whole board, move list, material and clocks. Use it before commenting on or helping with a game.",
      parameters: { type: "OBJECT", properties: {} },
      run: () => {
        const g = window.DU.arena?.describe();
        if (g) return g;
        const other = surfaces().filter((s) => s.kind !== "tools menu");
        return other.length ? { game: "none in the game area", open: other.map((s) => ({ title: s.title, text: clean(s.el.innerText).slice(0, 600) })) } : { game: "No game is open" };
      } },

    { name: "start_game",
      description: "Start a game for both of them straight away. Chess can take a clock and who plays white.",
      parameters: { type: "OBJECT", properties: {
        game: { type: "STRING", enum: ["chess", "ludo", "snl", "quiz", "clash", "maths", "memo", "dots", "chain", "emoji"], description: "snl = Snakes & ladders, clash = Colour clash cards, memo = Memory match, dots = Dots & boxes, chain = Word chain, emoji = Emoji riddles" },
        clock: { type: "STRING", enum: ["3+2", "5+0", "10+0", "none"] },
        white: { type: "STRING", description: "Chess: who plays white (a name)" },
      }, required: ["game"] },
      run: (a) => {
        const A = window.DU.arena;
        if (!A?.has(a.game)) {
          const b = document.querySelector(`#tg-tray [data-tg="${CSS.escape(String(a.game))}"]`);
          if (!b) return { error: "No such game" };
          b.click();
          return { opened: a.game };
        }
        return A.startQuick(a.game, { clock: a.clock, white: a.white });
      } },

    { name: "chess_move", personal: true,
      description: "Play a chess move for someone when they say it (\"e4\", \"knight to f3\", \"Nf3\", \"e2 to e4\", \"castle kingside\", ghoda f3). It must be their turn. Pass the person whose move it is.",
      parameters: { type: "OBJECT", properties: { person: PERSON, move: { type: "STRING" } }, required: ["move"] },
      run: (a) => (window.DU.chessMove ? window.DU.chessMove(a.move) : { error: "No chess game running" }) },

    { name: "commentary",
      description: "Turn live game commentary on or off: when on, every move is told to you as it happens and you react in one short lively line.",
      parameters: { type: "OBJECT", properties: { on: { type: "BOOLEAN" } }, required: ["on"] },
      run: (a) => {
        const r = window.DU.saathi?.commentary(a.on);
        if (r === null || r === undefined) return { error: "Only works on the phone running Hey Lord" };
        return { commentary: r ? "on" : "off", game: window.DU.arena?.current()?.kind || "none yet" };
      } },

    { name: "see_video",
      description: "Start or stop seeing their cameras: you then get a picture of the call every couple of seconds (to see faces, things they show you, the room).",
      parameters: { type: "OBJECT", properties: { on: { type: "BOOLEAN" } }, required: ["on"] },
      run: (a) => {
        const r = window.DU.saathi?.see(a.on);
        if (r === null || r === undefined) return { error: "Only works on the phone running Hey Lord" };
        return { seeing: r };
      } },
  );
})();
