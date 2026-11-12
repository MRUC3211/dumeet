// DU Meet · Story time: Hey Lord's AI starts a story with a hook, you take turns adding what
// happens next (speak it or type it), and the AI weaves in a twist after each round. New AI
// parts can be read aloud. Both phones show the same story. Hey Lord can add lines for you when
// she's in the call ("Hey Lord, add to the story: …").

(() => {
  "use strict";
  const { q, esc, store } = window.DU.kit;
  const W = () => window.DU.win;
  const V = () => window.DU.voice;
  const other = () => [...peers.values()][0];
  const tray = () => window.DU.kit.toggleTray(false);
  const players = () => [me.name, other()?.name].filter(Boolean).sort();

  const GENRES = [["romance", "💞", "Romance"], ["comedy", "😂", "Comedy"], ["mystery", "🕵️", "Mystery"], ["adventure", "🗺️", "Adventure"], ["fantasy", "🐉", "Fantasy"], ["spooky", "👻", "Spooky (not too scary)"]];
  const S = { on: false, genre: "", title: "", lines: [], busy: false, aloud: store.get("du-story-aloud", true), ended: false };
  const humanCount = () => S.lines.filter((l) => !l.ai).length;
  // lines added since the storyteller last spoke
  const sinceAi = () => { let n = 0; for (let i = S.lines.length - 1; i >= 0 && !S.lines[i].ai; i--) n++; return n; };
  // a suggested turn (the other person after each line); anyone can still add any time
  const turnName = () => {
    const p = players(), last = [...S.lines].reverse().find((l) => !l.ai);
    if (!last) return S.starter && p.includes(S.starter) ? S.starter : p[0];
    return p.find((n) => n !== last.by) || p[0];
  };

  // ---------- built-in story pieces, used when the AI can't be reached ----------
  const HOOKS = {
    romance: ["The Last Train Home", "{a} and {b} both reach the last train of the night, only to find one seat left and a note on it that says: \"For the two of you. Don't open the window.\" Then the lights go out."],
    comedy: ["The Wrong Wedding", "{a} and {b} walk into a wedding hall for free food, only to be welcomed as the bride and groom. The pandit is waiting, the band starts playing, and someone hands {a} a garland."],
    mystery: ["The Locked Room", "{a} finds a key in an old book from {b}'s shelf. It opens a door neither of them has ever noticed in the flat, and inside is a photo of the two of them, taken tomorrow."],
    adventure: ["The Map in the Chai Cup", "At a roadside dhaba, {b} spots a tiny map painted at the bottom of {a}'s chai cup. It points to a waterfall nobody has heard of, and a jeep with the keys inside is parked right outside."],
    fantasy: ["The Wish Shop", "{a} and {b} wander into a shop that sells wishes by the gram. The shopkeeper says they have exactly one wish left between them, and it must be used before the clock strikes twelve."],
    spooky: ["The Midnight Call", "At 11:59 pm, {a}'s phone rings with a video call from {b}, but {b} is sitting right next to {a}. On the screen, the other {b} whispers: \"Don't look behind you.\""],
  };
  const TWISTS = [
    "Suddenly the power goes out, and when it comes back, something on the table has changed. What is it?",
    "A stranger taps {a} on the shoulder and says, \"I've been waiting for you two for a year.\" Who are they?",
    "The phone buzzes with a message from an unknown number: \"You have 10 minutes.\" What do they do?",
    "Just then it starts pouring, and the only shelter is a tiny shop with a sign that says CLOSED FOREVER. Do they go in?",
    "{b} finds a letter in their pocket that they never put there. What does it say?",
    "Out of nowhere, a dog runs up holding a ring box in its mouth. Whose is it?",
    "Everything freezes except the two of them. Time has stopped. What's the first thing they do?",
  ];
  const ENDS = ["And somehow, after all of it, they ended up exactly where they started: together, laughing, and already planning the next adventure. The end.",
    "In the end it didn't matter how strange the night had been. What mattered was whose hand they were holding when the sun came up. The end."];
  const fill = (t) => { const [a, b] = [me.name, other()?.name || "their partner"].sort(() => Math.random() - .5); return t.replaceAll("{a}", a).replaceAll("{b}", b); };
  const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
  let offlineToast = 0;
  const offline = () => { if (Date.now() - offlineToast > 60000) { offlineToast = Date.now(); toast("Hey Lord's AI isn't answering, so the built-in storyteller takes over"); } };

  function open() {
    tray();
    if (W().get("story")) return paint();
    W().open({ id: "story", title: "Story time", icon: "auto_stories", w: 380, h: 580, tone: "night",
      onClose: () => V().stopSpeaking(),
      html: `<div class="sy"><div class="sy-body"></div></div>` });
    const w = W().get("story");
    w.body.onclick = (e) => {
      const g = e.target.closest("[data-genre]");
      if (g) return start(g.dataset.genre);
      const a = e.target.closest("[data-sy]")?.dataset.sy;
      if (a === "aloud") { S.aloud = !S.aloud; store.set("du-story-aloud", S.aloud); if (!S.aloud) V().stopSpeaking(); paint(); }
      if (a === "end") end();
      if (a === "new") { Object.assign(S, { on: false, lines: [], title: "", ended: false }); send("story", { t: "reset" }); paint(); }
      if (a === "share") shareStory();
    };
    paint();
  }

  async function start(genre) {
    if (S.busy) return;
    S.busy = true; S.genre = genre; paint();
    let r;
    try { r = await V().api("story", { op: "start", genre }); } catch { /* use a built-in opening */ }
    if (!r?.text) { offline(); const [title, hook] = HOOKS[genre] || HOOKS.romance; r = { title, text: fill(hook) }; }
    Object.assign(S, { on: true, ended: false, starter: me.name, title: r.title || "Our story", lines: [{ ai: true, text: r.text }] });
    send("story", { t: "start", genre, title: S.title, text: r.text, starter: me.name });
    say(r.text);
    S.busy = false;
    paint();
  }

  async function addLine(text, by = me.name, mine = true) {
    text = String(text || "").trim().slice(0, 400);
    if (!text || !S.on || S.ended) return false;
    S.lines.push({ by, text });
    if (mine) send("story", { t: "line", by, text });
    paint();
    // after two lines (one each, usually) the storyteller adds a twist; whoever added the second asks
    if (mine && sinceAi() >= Math.max(2, players().length)) await twist();
    return true;
  }

  async function twist() {
    S.busy = true; paint();
    send("story", { t: "busy" });
    let text = "";
    try { text = (await V().api("story", { op: "next", genre: S.genre, lines: lines() })).text; } catch { /* built-in twist */ }
    if (!text) { offline(); text = fill(pickOne(TWISTS)); }
    S.lines.push({ ai: true, text });
    send("story", { t: "ai", text });
    say(text);
    S.busy = false;
    paint();
  }

  async function end() {
    if (S.busy || !S.on) return;
    S.busy = true; paint();
    let r;
    try { r = await V().api("story", { op: "end", genre: S.genre, lines: lines() }); } catch { /* built-in ending */ }
    if (!r?.text) { offline(); r = { text: pickOne(ENDS), title: S.title }; }
    S.lines.push({ ai: true, text: r.text, end: true });
    S.title = r.title || S.title; S.ended = true;
    send("story", { t: "end", text: r.text, title: S.title });
    say(r.text);
    S.busy = false;
    paint();
  }

  const lines = () => S.lines.map((l) => ({ by: l.ai ? "Storyteller" : l.by, text: l.text }));
  const say = (text) => { if (S.aloud) V().speak(text, { rate: 1.02 }); };
  async function shareStory() {
    const text = `${S.title}\n\n${S.lines.map((l) => (l.ai ? l.text : `${l.by}: ${l.text}`)).join("\n\n")}`;
    try { if (navigator.share) await navigator.share({ title: S.title, text }); else { await navigator.clipboard.writeText(text); toast("Story copied"); } } catch { /* cancelled */ }
  }

  function paint() {
    const w = W().get("story");
    if (!w) return;
    const body = q(".sy-body", w.body);
    if (!S.on) {
      body.innerHTML = `<p class="fw-note">Pick a vibe. Hey Lord starts the story, then you two take turns. Speak or type your part.</p>
        <div class="sy-genres">${GENRES.map(([k, e, l]) => `<button data-genre="${k}"${S.busy ? " disabled" : ""}><span>${e}</span><b>${l}</b></button>`).join("")}</div>
        ${S.busy ? `<div class="gr-load"><span class="sa-orb live"><i></i></span><small>Writing the opening…</small></div>` : ""}`;
      return;
    }
    const mine = turnName() === me.name;
    const canAdd = !S.busy;
    const scroller = q(".sy-lines", w.body);
    const atBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
    body.innerHTML = `<div class="sy-top"><b class="sy-title">${esc(S.title || "Our story")}</b>
        <button class="sy-ic${S.aloud ? " on" : ""}" data-sy="aloud" aria-label="Read aloud"><span class="icon">${S.aloud ? "volume_up" : "volume_off"}</span></button></div>
      <div class="sy-lines">${S.lines.map((l) => (l.ai ? `<p class="sy-ai${l.end ? " end" : ""}">${esc(l.text)}</p>` : `<p class="sy-me${l.by === me.name ? " mine" : ""}"><small>${esc(l.by === me.name ? "You" : l.by)}</small>${esc(l.text)}</p>`)).join("")}
        ${S.busy ? `<p class="sy-ai typing"><i></i><i></i><i></i></p>` : ""}</div>
      ${S.ended
        ? `<div class="sy-acts"><button class="btn ghost" data-sy="share"><span class="icon">ios_share</span>Share</button><button class="btn primary" data-sy="new"><span class="icon">add</span>New story</button></div>`
        : `<form class="sy-add${canAdd ? "" : " wait"}"><textarea class="field" rows="2" maxlength="400" placeholder="${mine ? "What happens next? Speak or type…" : `${esc(turnName())}'s turn, or add yours…`}"${canAdd ? "" : " disabled"}></textarea><button class="btn primary" aria-label="Add to the story"${canAdd ? "" : " disabled"}><span class="icon">send</span></button></form>
           <div class="sy-foot"><small>${S.busy ? "The storyteller is writing…" : mine ? "Your turn" : `${esc(turnName())}'s turn`}</small><button class="btn ghost" data-sy="end"${S.busy ? " disabled" : ""}><span class="icon">flag</span>End the story</button></div>`}`;
    const form = q(".sy-add", w.body);
    if (form) {
      const ta = q("textarea", form);
      if (canAdd) form.insertBefore(V().micButton(ta, { onDone: (t) => { if (t) { addLine(t); } } }), q(".btn", form));
      form.onsubmit = (e) => { e.preventDefault(); if (ta.value.trim()) addLine(ta.value); };
      ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
    }
    const sc = q(".sy-lines", w.body);
    if (sc && atBottom) sc.scrollTop = sc.scrollHeight;
  }

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) { if (button.dataset.tg === "story") open(); else prev.click?.(button); },
    onCouple(message, peer) {
      if (message.type !== "story") return prev.msg?.(message, peer);
      const d = message.data || {};
      const txt = String(d.text || "").slice(0, 900);
      if (d.t === "start") { Object.assign(S, { on: true, ended: false, busy: false, starter: String(d.starter || peer.name), genre: String(d.genre || ""), title: String(d.title || "Our story").slice(0, 80), lines: [{ ai: true, text: txt }] }); if (!W().get("story")) { open(); toast(`${peer.name} started a story 📖`); } say(txt); }
      if (d.t === "line") addLine(txt, players().includes(d.by) ? d.by : peer.name, false);
      if (d.t === "busy") S.busy = true;
      if (d.t === "idle") S.busy = false;
      if (d.t === "ai") { S.busy = false; S.lines.push({ ai: true, text: txt }); say(txt); }
      if (d.t === "end") { S.busy = false; S.ended = true; S.title = String(d.title || S.title).slice(0, 80); S.lines.push({ ai: true, text: txt, end: true }); say(txt); }
      if (d.t === "reset") Object.assign(S, { on: false, lines: [], title: "", ended: false, busy: false });
      paint();
    },
    onCoupleLeave(...args) { prev.leave?.(...args); },
  });

  window.DU.saathiTools.push(
    { name: "start_story", description: "Open Story time and start a new story game for them.",
      parameters: { type: "OBJECT", properties: { genre: { type: "STRING", enum: GENRES.map((g) => g[0]) } } },
      run: async (a) => { open(); await start(GENRES.some((g) => g[0] === a.genre) ? a.genre : "romance"); return { started: S.on, title: S.title, opening: S.lines[0]?.text || "" }; } },
    { name: "add_to_story", description: "Add what one of them just said to the story, as their turn.",
      parameters: { type: "OBJECT", properties: { person: { type: "STRING", description: "Who is adding it" }, text: { type: "STRING" } }, required: ["text"] },
      run: async (a) => { if (!S.on) return { error: "No story running; start one first" }; const names = players(); const by = names.find((n) => n.toLowerCase() === String(a.person || "").toLowerCase()) || turnName(); await addLine(a.text, by, true); return { added: true, next: S.ended ? "" : turnName() }; } },
  );
})();
