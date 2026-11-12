// DU Meet · Story time: Saathi's AI starts a story with a hook, you take turns adding what
// happens next (speak it or type it), and the AI weaves in a twist after each round. New AI
// parts can be read aloud. Both phones show the same story. Saathi can add lines for you when
// she's in the call ("Saathi, add to the story: …").

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
  const turnName = () => { const p = players(); return p[humanCount() % p.length]; };

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
    try {
      const r = await V().api("story", { op: "start", genre });
      Object.assign(S, { on: true, ended: false, title: r.title, lines: [{ ai: true, text: r.text }] });
      send("story", { t: "start", genre, title: r.title, text: r.text });
      say(r.text);
    } catch (error) { toast(error.message); }
    S.busy = false;
    paint();
  }

  async function addLine(text, by = me.name, mine = true) {
    text = String(text || "").trim().slice(0, 400);
    if (!text || !S.on || S.ended) return false;
    S.lines.push({ by, text });
    if (mine) send("story", { t: "line", by, text });
    paint();
    // after everyone has had a turn, the AI adds a twist (done by whoever finished the round)
    if (mine && humanCount() % players().length === 0) await twist();
    return true;
  }

  async function twist() {
    S.busy = true; paint();
    send("story", { t: "busy" });
    try {
      const r = await V().api("story", { op: "next", genre: S.genre, lines: lines() });
      S.lines.push({ ai: true, text: r.text });
      send("story", { t: "ai", text: r.text });
      say(r.text);
    } catch (error) { toast(error.message); send("story", { t: "idle" }); }
    S.busy = false;
    paint();
  }

  async function end() {
    if (S.busy || !S.on) return;
    S.busy = true; paint();
    try {
      const r = await V().api("story", { op: "end", genre: S.genre, lines: lines() });
      S.lines.push({ ai: true, text: r.text, end: true });
      S.title = r.title || S.title; S.ended = true;
      send("story", { t: "end", text: r.text, title: S.title });
      say(r.text);
    } catch (error) { toast(error.message); }
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
      body.innerHTML = `<p class="fw-note">Pick a vibe. Saathi starts the story, then you two take turns. Speak or type your part.</p>
        <div class="sy-genres">${GENRES.map(([k, e, l]) => `<button data-genre="${k}"${S.busy ? " disabled" : ""}><span>${e}</span><b>${l}</b></button>`).join("")}</div>
        ${S.busy ? `<div class="gr-load"><span class="sa-orb live"><i></i></span><small>Writing the opening…</small></div>` : ""}`;
      return;
    }
    const mine = turnName() === me.name;
    const scroller = q(".sy-lines", w.body);
    const atBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
    body.innerHTML = `<div class="sy-top"><b class="sy-title">${esc(S.title || "Our story")}</b>
        <button class="sy-ic${S.aloud ? " on" : ""}" data-sy="aloud" aria-label="Read aloud"><span class="icon">${S.aloud ? "volume_up" : "volume_off"}</span></button></div>
      <div class="sy-lines">${S.lines.map((l) => (l.ai ? `<p class="sy-ai${l.end ? " end" : ""}">${esc(l.text)}</p>` : `<p class="sy-me${l.by === me.name ? " mine" : ""}"><small>${esc(l.by === me.name ? "You" : l.by)}</small>${esc(l.text)}</p>`)).join("")}
        ${S.busy ? `<p class="sy-ai typing"><i></i><i></i><i></i></p>` : ""}</div>
      ${S.ended
        ? `<div class="sy-acts"><button class="btn ghost" data-sy="share"><span class="icon">ios_share</span>Share</button><button class="btn primary" data-sy="new"><span class="icon">add</span>New story</button></div>`
        : `<form class="sy-add${mine && !S.busy ? "" : " wait"}"><textarea class="field" rows="2" maxlength="400" placeholder="${mine ? "What happens next? Speak or type…" : `${esc(turnName())}'s turn…`}"${mine && !S.busy ? "" : " disabled"}></textarea><button class="btn primary" aria-label="Add to the story"${mine && !S.busy ? "" : " disabled"}><span class="icon">send</span></button></form>
           <div class="sy-foot"><small>${S.busy ? "Saathi is writing…" : mine ? "Your turn" : `Waiting for ${esc(turnName())}`}</small><button class="btn ghost" data-sy="end"${S.busy ? " disabled" : ""}><span class="icon">flag</span>End the story</button></div>`}`;
    const form = q(".sy-add", w.body);
    if (form) {
      const ta = q("textarea", form);
      if (mine && !S.busy) form.insertBefore(V().micButton(ta, { onDone: (t) => { if (t) { addLine(t); } } }), q(".btn", form));
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
      if (d.t === "start") { Object.assign(S, { on: true, ended: false, busy: false, genre: String(d.genre || ""), title: String(d.title || "Our story").slice(0, 80), lines: [{ ai: true, text: txt }] }); if (!W().get("story")) { open(); toast(`${peer.name} started a story 📖`); } say(txt); }
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
