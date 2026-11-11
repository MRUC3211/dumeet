// DU Meet · things to do together during a call:
// thinking-of-you heart, watch/listen together, calendar, timer & stopwatch, photos,
// sleep call, files in chat, weak-network voice-only and "record only if everyone agrees".
// Uses globals from app.js (send, peers, me, toast, polling, setMic, setOutgoing …).

(() => {
  "use strict";

  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pad = (n) => String(n).padStart(2, "0");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const { openModal, closeModal } = window.DU;
  const partnerName = () => [...peers.values()][0]?.name || "them";
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };
  const clock = (secs) => {
    secs = Math.max(0, Math.floor(secs));
    const h = Math.floor(secs / 3600);
    return h ? `${h}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}` : `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
  };
  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
  };
  const json = (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); };
  const getDocs = (collection) => fetch(`/api/data?c=${collection}`).then(json).then((r) => r.docs);
  const putDoc = (collection, data, id) => fetch("/api/data", { method: "POST", body: JSON.stringify({ c: collection, data, id }) }).then(json).then((r) => r.doc);
  const delDoc = (collection, id) => fetch(`/api/data?c=${collection}&id=${encodeURIComponent(id)}`, { method: "DELETE" }).then(json);
  const upload = (blob) => fetch("/api/media", { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob }).then(json);

  /** A small yes/no sheet (used for "may we record?"). */
  function confirmBox({ title, text, ok = "OK", cancel = "Not now" }) {
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `<div class="sheet narrow"><header class="sheet-head"><h2>${esc(title)}</h2></header>
      <div class="sheet-body"><p class="muted">${esc(text)}</p>
      <div class="confirm-actions"><button class="btn outline" data-no>${esc(cancel)}</button><button class="btn primary" data-yes>${esc(ok)}</button></div></div></div>`;
    document.body.append(modal);
    openModal(modal);
    return new Promise((resolve) => {
      const done = (value) => { closeModal(modal); setTimeout(() => modal.remove(), 400); resolve(value); };
      q("[data-yes]", modal).onclick = () => done(true);
      q("[data-no]", modal).onclick = () => done(false);
    });
  }

  // ---------- tray ----------

  const tray = q("#tg-tray");
  function toggleTray(open = tray.hidden) {
    tray.hidden = !open;
    q("[data-tg=tray]").setAttribute("aria-expanded", String(open));
    q("[data-tg=tray]").classList.toggle("active", open);
  }

  // ---------- thinking of you ----------

  const heart = { last: 0, audio: null, timer: null };

  function heartbeatSound() {
    try {
      const ctx = heart.audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      const thump = (at, freq, gain) => {
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, at);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.55, at + 0.18);
        amp.gain.setValueAtTime(0.0001, at);
        amp.gain.exponentialRampToValueAtTime(gain, at + 0.02);
        amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
        osc.connect(amp).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.26);
      };
      const t = ctx.currentTime + 0.02;
      thump(t, 95, 0.45); thump(t + 0.2, 78, 0.3);
      thump(t + 1.05, 95, 0.45); thump(t + 1.25, 78, 0.3);
    } catch { /* no audio: the picture is enough */ }
  }

  function sendHeart(button) {
    if (!polling) return;
    const now = Date.now();
    if (now - heart.last < 1200) return;
    heart.last = now;
    send("heart", {});
    button.classList.remove("beat");
    void button.offsetWidth;
    button.classList.add("beat");
    const rect = button.getBoundingClientRect();
    const floater = document.createElement("span");
    floater.className = "float-heart";
    floater.style.cssText = `left:${rect.left + rect.width / 2}px;top:${rect.top}px`;
    floater.innerHTML = `<svg viewBox="0 0 24 24"><use href="#hg-path"/></svg>`;
    document.body.append(floater);
    setTimeout(() => floater.remove(), 1400);
    navigator.vibrate?.(30);
    toast(`Sent to ${partnerName()}`);
  }

  function showHeart(name) {
    const fx = q("#heart-fx");
    q(".heart-text", fx).textContent = `${name} is thinking of you`;
    fx.hidden = false;
    fx.classList.remove("on");
    void fx.offsetWidth;
    fx.classList.add("on");
    clearTimeout(heart.timer);
    heart.timer = setTimeout(() => { fx.classList.remove("on"); fx.hidden = true; }, 3600);
    navigator.vibrate?.([70, 90, 70, 700, 70, 90, 70]);
    heartbeatSound();
  }

  // ---------- watch & listen together (YouTube) ----------

  const media = { mode: null, vid: null, title: "", channel: "", player: null, ready: false, suppressUntil: 0, leader: false, beat: null, queue: [] };
  let ytLoading = null;

  function loadYouTube() {
    if (window.YT?.Player) return Promise.resolve();
    if (ytLoading) return ytLoading;
    ytLoading = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = resolve;
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.append(script);
    });
    return ytLoading;
  }

  function videoId(text) {
    text = (text || "").trim();
    if (/^[\w-]{11}$/.test(text)) return text;
    try {
      const url = new URL(text);
      if (url.hostname.includes("youtu.be")) return url.pathname.slice(1, 12);
      if (url.searchParams.get("v")) return url.searchParams.get("v").slice(0, 11);
      const match = url.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/);
      if (match) return match[1];
    } catch { /* not a URL */ }
    return null;
  }

  const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

  async function startTrack(track, mode, { fromQueue = false } = {}) {
    media.leader = true;
    await openMedia(mode, track.id, 0, true, track);
    send("media", { action: "load", mode, vid: track.id, title: track.title || "", channel: track.channel || "", t: 0, fromQueue });
  }

  async function openMedia(mode, vid, startAt = 0, autoplay = false, track = null) {
    await loadYouTube();
    const stage = q("#tg-stage");
    media.mode = mode;
    stage.hidden = false;
    stage.dataset.mode = mode;
    q("#room").classList.toggle("watching", mode === "watch");
    q("#room").classList.toggle("listening", mode === "listen");
    if (track?.title) { media.title = track.title; media.channel = track.channel || ""; }
    else if (media.vid !== vid) { media.title = ""; media.channel = ""; }
    if (media.vid !== vid && !track?.title) fetchTitle(vid);
    paintMedia();
    if (media.player && media.vid === vid) return;
    media.vid = vid;
    if (media.player) {
      media.suppressUntil = Date.now() + 1500;
      media.player.loadVideoById({ videoId: vid, startSeconds: startAt });
      paintMedia();
      return;
    }
    media.ready = false;
    media.suppressUntil = Date.now() + 2000;
    media.player = new YT.Player("tg-player", {
      videoId: vid,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(startAt), autoplay: autoplay ? 1 : 0 },
      events: {
        onReady: () => { media.ready = true; if (autoplay) media.player.playVideo(); },
        onStateChange: onPlayerState,
      },
    });
    clearInterval(media.beat);
    media.beat = setInterval(heartbeat, 3000);
  }

  async function fetchTitle(vid) {
    try {
      const info = await fetch(`/api/title?v=${vid}`).then(json);
      if (media.vid === vid && !media.title) { media.title = info.title; media.channel = info.channel; paintMedia(); }
    } catch { /* title stays empty */ }
  }

  function paintMedia() {
    q(".tg-title").textContent = media.title || (media.mode === "watch" ? "Watching together" : "Listening together");
    q(".tg-sub").textContent = media.channel || (media.queue.length ? `${media.queue.length} up next` : "");
    q("[data-tg=media-next]").hidden = media.queue.length === 0;
    const playing = media.player?.getPlayerState?.() === 1;
    q("[data-tg=media-toggle] .icon").textContent = playing ? "pause" : "play_arrow";
  }

  function onPlayerState({ data: state }) {
    if (!media.title) {
      const info = media.player?.getVideoData?.();
      if (info?.title) { media.title = info.title; media.channel = info.author || ""; }
    }
    paintMedia();
    q(".tg-tap").hidden = true;
    if (state === 0 && media.leader) return playNext(); // ended
    if (Date.now() < media.suppressUntil) return;       // this change came from the other person
    const t = media.player.getCurrentTime();
    if (state === 1) { media.leader = true; send("media", { action: "play", t, at: Date.now() }); }
    if (state === 2) { media.leader = true; send("media", { action: "pause", t }); }
  }

  function heartbeat() {
    if (!media.player?.getPlayerState || !media.leader || media.player.getPlayerState() !== 1) return;
    send("media", { action: "sync", mode: media.mode, vid: media.vid, title: media.title, channel: media.channel, t: media.player.getCurrentTime(), at: Date.now() });
  }

  function playNext() {
    const next = media.queue.shift();
    if (!next) { paintMedia(); return; }
    startTrack(next, media.mode, { fromQueue: true });
  }

  async function receiveMedia(data, peer) {
    switch (data.action) {
      case "close": return closeMedia(false);
      case "queue-add": media.queue.push(data.track); paintMedia(); return;
      case "queue-set": media.queue = Array.isArray(data.queue) ? data.queue.slice(0, 200) : []; paintMedia(); return;
      case "load":
        media.leader = false;
        if (data.fromQueue) media.queue.shift();
        await openMedia(data.mode, data.vid, data.t || 0, !data.paused, { id: data.vid, title: data.title, channel: data.channel });
        toast(`${peer.name} ${data.paused ? "is" : "started"} ${data.mode === "watch" ? "watching" : "playing"} ${data.title ? `“${data.title}”` : "something"}`);
        if (!data.paused) expectPlaying();
        return;
      default:
    }
    if (data.action === "sync" && (!media.player || media.vid !== data.vid)) {
      await openMedia(data.mode, data.vid, data.t, true, { id: data.vid, title: data.title, channel: data.channel });
      expectPlaying();
      return;
    }
    if (!media.player || !media.ready) return;
    media.leader = data.action === "sync" ? media.leader : false;
    const lag = data.at ? Math.min(3, Math.max(0, (Date.now() - data.at) / 1000)) : 0;
    const target = (data.t || 0) + (data.action === "pause" ? 0 : lag);
    const drift = Math.abs(media.player.getCurrentTime() - target);
    media.suppressUntil = Date.now() + 1200;
    if (data.action === "pause") {
      media.player.pauseVideo();
      if (drift > 0.5) media.player.seekTo(target, true);
    } else {
      if (drift > (data.action === "sync" ? 1.2 : 0.5)) media.player.seekTo(target, true);
      if (media.player.getPlayerState() !== 1) { media.player.playVideo(); expectPlaying(); }
    }
    paintMedia();
  }

  // iPhones block autoplay that didn't start with a tap: offer one.
  function expectPlaying() {
    setTimeout(() => {
      if (media.player?.getPlayerState?.() !== 1) q(".tg-tap").hidden = false;
    }, 1800);
  }
  q(".tg-tap").onclick = () => { media.suppressUntil = Date.now() + 1000; media.player?.playVideo(); q(".tg-tap").hidden = true; };

  function closeMedia(tell = true) {
    if (tell) send("media", { action: "close" });
    clearInterval(media.beat);
    media.player?.destroy?.();
    media.player = null;
    media.vid = media.mode = null;
    media.queue = [];
    q("#tg-player")?.remove();
    q(".tg-player-wrap").insertAdjacentHTML("afterbegin", `<div id="tg-player"></div>`);
    q("#tg-stage").hidden = true;
    q("#room").classList.remove("watching", "listening");
    if (typeof layoutGrid === "function") layoutGrid();
  }

  // ----- the "Play together" sheet: paste, search, our saved songs -----

  const play = { tab: "listen", saved: [], features: { search: false }, results: [] };

  async function openPlay(mode) {
    toggleTray(false);
    play.tab = mode;
    q("#play-body").innerHTML = `<div class="loading"><span class="spinner"></span></div>`;
    openModal(q("#m-play"));
    const [features, saved] = await Promise.all([
      fetch("/api/features").then(json).catch(() => ({})),
      getDocs("songs").catch(() => []),
    ]);
    play.features = features;
    play.saved = saved.map((d) => d.data);
    play.results = [];
    renderPlay();
  }

  function trackRow(track, { saved }) {
    return `<li class="track" data-id="${esc(track.id)}">
      <img src="${thumb(track.id)}" alt="" loading="lazy">
      <button class="track-main" data-track-play="${esc(track.id)}"><b>${esc(track.title || track.id)}</b><small>${esc(track.channel || "")}</small></button>
      <button class="icon-btn" data-track-queue="${esc(track.id)}" aria-label="Play next" title="Play next"><span class="icon">playlist_add</span></button>
      <button class="icon-btn ${saved ? "on" : ""}" data-track-save="${esc(track.id)}" aria-label="${saved ? "Remove from our songs" : "Save to our songs"}"><span class="icon">${saved ? "bookmark_remove" : "bookmark_add"}</span></button>
    </li>`;
  }

  function renderPlay() {
    const savedIds = new Set(play.saved.map((t) => t.id));
    const known = new Map([...play.saved, ...play.results].map((t) => [t.id, t]));
    q("#play-body").innerHTML = `
      <div class="seg"><button data-ptab="listen" class="${play.tab === "listen" ? "on" : ""}"><span class="icon">music_note</span>Listen</button><button data-ptab="watch" class="${play.tab === "watch" ? "on" : ""}"><span class="icon">movie</span>Watch</button></div>
      <form id="play-form" class="play-input">
        <span class="icon">${play.features.search ? "search" : "link"}</span>
        <input placeholder="${play.features.search ? "Search a song, or paste a YouTube link" : "Paste a YouTube link"}" autocomplete="off" spellcheck="false">
        <button type="button" class="btn ghost small-btn" data-paste><span class="icon">content_paste</span>Paste</button>
        <button class="btn primary small-btn">Play</button>
      </form>
      ${play.features.search ? "" : `<p class="hint">Tip: save songs with the bookmark button. They stay in <b>Our songs</b>, so you never paste the same link twice.</p>`}
      <div id="play-results">${play.results.length ? `<h4 class="list-title">Results</h4><ul class="tracks">${play.results.map((t) => trackRow(t, { saved: savedIds.has(t.id) })).join("")}</ul>` : ""}</div>
      <h4 class="list-title">Our songs</h4>
      ${play.saved.length ? `<ul class="tracks">${play.saved.map((t) => trackRow(t, { saved: true })).join("")}</ul>
        <button class="btn outline wide" data-play-all><span class="icon">shuffle</span>Play all, shuffled</button>`
        : `<p class="empty-note">No saved songs yet. Play something and tap the bookmark to keep it here.</p>`}`;

    const form = q("#play-form");
    const input = q("input", form);
    for (const b of qa("[data-ptab]")) b.onclick = () => { play.tab = b.dataset.ptab; renderPlay(); };
    q("[data-paste]").onclick = async () => {
      try { input.value = await navigator.clipboard.readText(); form.requestSubmit(); } catch { toast("Press and hold in the box to paste"); input.focus(); }
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const id = videoId(text);
      if (id) { closeModal(q("#m-play")); return startTrack(known.get(id) || { id }, play.tab); }
      if (!play.features.search) return toast("That doesn't look like a YouTube link");
      q("button.primary", form).disabled = true;
      try {
        play.results = (await fetch(`/api/search?q=${encodeURIComponent(text)}`).then(json)).items;
      } catch { toast("Search isn't available right now"); }
      renderPlay();
      q("#play-form input").value = text;
    };
    q("#play-body").onclick = async (event) => {
      const pick = (attr) => known.get(event.target.closest(`[${attr}]`)?.getAttribute(attr));
      let track;
      if ((track = pick("data-track-play"))) { closeModal(q("#m-play")); return startTrack(track, play.tab); }
      if ((track = pick("data-track-queue"))) {
        if (!media.player) { closeModal(q("#m-play")); return startTrack(track, play.tab); }
        media.queue.push(track); send("media", { action: "queue-add", track }); paintMedia();
        return toast("Added to up next");
      }
      if ((track = pick("data-track-save"))) {
        if (savedIds.has(track.id)) { await delDoc("songs", track.id); play.saved = play.saved.filter((t) => t.id !== track.id); }
        else { await putDoc("songs", { id: track.id, title: track.title, channel: track.channel || "" }, track.id); play.saved.unshift(track); }
        return renderPlay();
      }
      if (event.target.closest("[data-play-all]")) {
        const list = [...play.saved].sort(() => Math.random() - 0.5);
        closeModal(q("#m-play"));
        media.queue = list.slice(1);
        send("media", { action: "queue-set", queue: media.queue });
        return startTrack(list[0], play.tab);
      }
    };
  }

  async function saveCurrent() {
    if (!media.vid) return;
    const track = { id: media.vid, title: media.title || media.vid, channel: media.channel || "" };
    try { await putDoc("songs", track, track.id); toast("Saved to Our songs"); } catch { toast("Couldn't save right now"); }
  }

  // ---------- calendar ----------

  const NOTE_COLORS = ["blue", "pink", "green", "orange"];
  const cal = { month: new Date(), selected: dayKey(), notes: [] };

  async function openCalendar() {
    toggleTray(false);
    q("#cal-body").innerHTML = `<div class="loading"><span class="spinner"></span></div>`;
    openModal(q("#m-cal"));
    try { cal.notes = await getDocs("calendar"); } catch { q("#cal-body").innerHTML = `<p class="empty">Couldn't load the calendar. Check the internet.</p>`; return; }
    renderCal();
  }

  function renderCal() {
    const byDay = new Map();
    for (const doc of cal.notes) {
      if (!byDay.has(doc.data.date)) byDay.set(doc.data.date, []);
      byDay.get(doc.data.date).push(doc);
    }
    const y = cal.month.getFullYear();
    const m = cal.month.getMonth();
    const first = new Date(y, m, 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const days = new Date(y, m + 1, 0).getDate();
    const today = dayKey();
    let cells = "";
    for (let i = 0; i < lead; i++) cells += `<span class="cal-cell blank"></span>`;
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${pad(m + 1)}-${pad(d)}`;
      const list = byDay.get(key) || [];
      cells += `<button class="cal-cell ${key === today ? "today" : ""} ${key === cal.selected ? "selected" : ""} ${list.length ? `has c-${list[0].data.color}` : ""}" data-day="${key}" aria-label="${key}${list.length ? `, ${list.length} notes` : ""}">
        <span>${d}</span>${list.length ? `<i class="cal-dots">${list.slice(0, 3).map((n) => `<b class="d-${n.data.color}"></b>`).join("")}</i>` : ""}</button>`;
    }
    const selected = (byDay.get(cal.selected) || []).sort((a, b) => (a.data.time || "99").localeCompare(b.data.time || "99"));
    const upcoming = cal.notes.filter((n) => n.data.date >= today).sort((a, b) => (a.data.date + (a.data.time || "")).localeCompare(b.data.date + (b.data.time || ""))).slice(0, 5);
    q("#cal-body").innerHTML = `
      <div class="cal-layout">
        <section class="cal-left">
          <div class="cal-head">
            <button class="icon-btn" data-cal="-1" aria-label="Previous month"><span class="icon">chevron_left</span></button>
            <h3>${first.toLocaleDateString([], { month: "long", year: "numeric" })}</h3>
            <button class="icon-btn" data-cal="1" aria-label="Next month"><span class="icon">chevron_right</span></button>
          </div>
          <div class="cal-week">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<span>${d}</span>`).join("")}</div>
          <div class="cal-grid">${cells}</div>
          <button class="btn ghost small-btn cal-today" data-cal-today>Today</button>
        </section>
        <section class="cal-right">
          <h3>${parseDay(cal.selected).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</h3>
          <ul class="day-notes">${selected.map((n) => `
            <li class="day-note c-${n.data.color}"><div><p>${esc(n.data.text)}</p><small>${n.data.time ? `${esc(n.data.time)} · ` : ""}${esc(n.data.by)}</small></div>
              <button class="icon-btn" data-del-note="${esc(n.id)}" aria-label="Delete note"><span class="icon">delete</span></button></li>`).join("")
            || `<li class="empty-note">Nothing planned. Add a note, a plan or a reminder.</li>`}</ul>
          <form class="note-form">
            <input class="field" maxlength="200" placeholder="Add a note…" required>
            <div class="note-row">
              <input class="field time" type="time" aria-label="Time (optional)">
              <div class="color-pick">${NOTE_COLORS.map((c, i) => `<label><input type="radio" name="color" value="${c}" ${i === 0 ? "checked" : ""}><b class="d-${c}"></b></label>`).join("")}</div>
              <button class="btn primary small-btn">Add</button>
            </div>
          </form>
          ${upcoming.length ? `<h4 class="list-title">Coming up</h4><ul class="upcoming">${upcoming.map((n) => `
            <li><button data-jump="${esc(n.data.date)}"><i class="d-${n.data.color}"></i><span><b>${esc(n.data.text)}</b><small>${parseDay(n.data.date).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}${n.data.time ? ` · ${esc(n.data.time)}` : ""}</small></span></button></li>`).join("")}</ul>` : ""}
        </section>
      </div>`;
    for (const b of qa("[data-cal]")) b.onclick = () => { cal.month = new Date(y, m + Number(b.dataset.cal), 1); renderCal(); };
    q("[data-cal-today]").onclick = () => { cal.month = new Date(); cal.selected = today; renderCal(); };
    for (const b of qa("[data-day]")) b.onclick = () => { cal.selected = b.dataset.day; renderCal(); };
    for (const b of qa("[data-jump]")) b.onclick = () => { cal.selected = b.dataset.jump; cal.month = parseDay(b.dataset.jump); renderCal(); };
    for (const b of qa("[data-del-note]")) {
      b.onclick = async () => {
        try { await delDoc("calendar", b.dataset.delNote); } catch { return toast("Couldn't delete. Try again"); }
        cal.notes = cal.notes.filter((n) => n.id !== b.dataset.delNote);
        send("cal", { date: cal.selected, by: me.name });
        renderCal();
      };
    }
    q(".note-form").onsubmit = async (event) => {
      event.preventDefault();
      const text = q(".note-form input.field").value.trim();
      if (!text) return;
      const data = { date: cal.selected, text, time: q(".note-form .time").value, color: q(".note-form input[name=color]:checked").value, by: me.name || "Guest", at: Date.now() / 1000 };
      try { cal.notes.push(await putDoc("calendar", data)); } catch { return toast("Couldn't save. Try again"); }
      send("cal", { date: cal.selected, by: data.by });
      renderCal();
    };
  }

  async function todaysReminder() {
    try {
      const today = dayKey();
      const notes = (await getDocs("calendar")).filter((n) => n.data.date === today);
      if (notes.length) toast(`Today: ${notes[0].data.text}${notes.length > 1 ? ` (+${notes.length - 1} more)` : ""}`);
    } catch { /* offline */ }
  }

  // ---------- timer & stopwatch ----------

  const timer = { on: false, mode: "stopwatch", label: "Study", running: false, base: 0, elapsed: 0, target: 25 * 60, done: false };
  const elapsed = () => timer.elapsed + (timer.running ? (Date.now() - timer.base) / 1000 : 0);
  const TIMER_LABELS = ["Study", "Talk", "Work", "Workout", "Break"];

  function shareTimer() {
    send("timer", { on: timer.on, mode: timer.mode, label: timer.label, running: timer.running, elapsed: elapsed(), target: timer.target });
  }

  function timerShown() {
    const secs = elapsed();
    return timer.mode === "timer" ? Math.max(0, timer.target - secs) : secs;
  }

  function paintTimerPill() {
    const pill = q("#tg-timer");
    pill.hidden = !timer.on;
    if (!timer.on) return;
    q(".tg-timer-time", pill).textContent = clock(timerShown());
    q(".tg-timer-label", pill).textContent = timer.label;
    q("[data-tg=timer-go] .icon", pill).textContent = timer.running ? "pause" : "play_arrow";
    pill.classList.toggle("running", timer.running);
  }

  function paintTimerSheet() {
    const sheet = q("#timer-body");
    if (!sheet.firstElementChild || q("#m-timer").hidden) return;
    const R = 108, C = 2 * Math.PI * R;
    const secs = elapsed();
    const fraction = timer.mode === "timer" ? Math.min(1, secs / timer.target) : (secs % 60) / 60;
    q(".ring-time", sheet).textContent = clock(timerShown());
    q(".ring-sub", sheet).textContent = timer.running ? timer.label : secs ? "Paused" : timer.label;
    q(".ring-fg", sheet).style.strokeDashoffset = String(C * (1 - fraction));
    q(".ring-wrap", sheet).classList.toggle("running", timer.running);
    q("[data-tm=go] .icon", sheet).textContent = timer.running ? "pause" : "play_arrow";
    q("[data-tm=go] span:last-child", sheet).textContent = timer.running ? "Pause" : secs ? "Resume" : "Start";
  }

  function openTimer() {
    toggleTray(false);
    const R = 108, C = 2 * Math.PI * R;
    q("#timer-body").innerHTML = `
      <div class="seg"><button data-tm-mode="stopwatch" class="${timer.mode === "stopwatch" ? "on" : ""}">Stopwatch</button><button data-tm-mode="timer" class="${timer.mode === "timer" ? "on" : ""}">Timer</button></div>
      <div class="chips center">${TIMER_LABELS.map((l) => `<button class="chip ${l === timer.label ? "on" : ""}" data-tm-label="${l}">${l}</button>`).join("")}</div>
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 240 240"><circle cx="120" cy="120" r="${R}" class="ring-bg"/><circle cx="120" cy="120" r="${R}" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
        <div class="ring-center"><span class="ring-time">00:00</span><small class="ring-sub"></small></div>
      </div>
      <div class="chips center pomo" ${timer.mode === "timer" ? "" : "hidden"}>${[15, 25, 45, 60, 90].map((n) => `<button class="chip ${timer.target === n * 60 ? "on" : ""}" data-tm-min="${n}">${n} min</button>`).join("")}</div>
      <div class="timer-actions">
        <button class="btn outline" data-tm="reset"><span class="icon">restart_alt</span>Reset</button>
        <button class="btn primary big" data-tm="go"><span class="icon">play_arrow</span><span>Start</span></button>
        <button class="btn outline" data-tm="done"><span class="icon">check</span>Done</button>
      </div>
      <p class="hint center">Both of you see the same timer, and either of you can start, pause or stop it.</p>`;
    openModal(q("#m-timer"));
    paintTimerSheet();
  }

  const timerSheet = q("#timer-body");
  timerSheet.addEventListener("click", (event) => {
    const t = event.target;
    const mode = t.closest("[data-tm-mode]");
    const label = t.closest("[data-tm-label]");
    const mins = t.closest("[data-tm-min]");
    const act = t.closest("[data-tm]")?.dataset.tm;
    if (mode) { if (timer.running) return toast("Pause first"); Object.assign(timer, { mode: mode.dataset.tmMode, elapsed: 0, done: false }); timer.on = timer.on && true; openTimer(); shareTimer(); }
    else if (label) { timer.label = label.dataset.tmLabel; qa("[data-tm-label]", timerSheet).forEach((b) => b.classList.toggle("on", b === label)); shareTimer(); paintTimerPill(); }
    else if (mins) { if (timer.running) return toast("Pause first"); timer.target = Number(mins.dataset.tmMin) * 60; timer.done = false; qa("[data-tm-min]", timerSheet).forEach((b) => b.classList.toggle("on", b === mins)); shareTimer(); }
    else if (act === "go") timerToggle();
    else if (act === "reset") { Object.assign(timer, { running: false, elapsed: 0, done: false }); shareTimer(); paintTimerPill(); }
    else if (act === "done") timerStop(true);
  });

  function timerToggle() {
    timer.on = true;
    timer.done = false;
    if (timer.running) { timer.elapsed = elapsed(); timer.running = false; } else { timer.base = Date.now(); timer.running = true; }
    shareTimer();
    paintTimerPill();
  }

  function timerStop(tell) {
    const secs = elapsed();
    Object.assign(timer, { on: false, running: false, elapsed: 0, done: false });
    if (tell) send("timer", { on: false });
    paintTimerPill();
    paintTimerSheet();
    if (secs >= 30) toast(`${timer.label}: ${clock(secs)}`);
  }

  function receiveTimer(data, peer) {
    if (!data.on) { if (timer.on) timerStop(false); return; }
    const was = timer.on;
    Object.assign(timer, { on: true, mode: data.mode === "timer" ? "timer" : "stopwatch", label: String(data.label || "Study").slice(0, 20), running: Boolean(data.running), elapsed: Number(data.elapsed) || 0, base: Date.now(), target: Number(data.target) || 1500, done: false });
    if (!was) toast(`${peer.name} started a timer`);
    paintTimerPill();
    paintTimerSheet();
  }

  setInterval(() => {
    if (!timer.on) return;
    paintTimerPill();
    paintTimerSheet();
    if (timer.mode === "timer" && timer.running && !timer.done && elapsed() >= timer.target) {
      timer.done = true;
      timer.running = false;
      timer.elapsed = timer.target;
      navigator.vibrate?.([300, 150, 300]);
      toast(`${timer.label} timer finished`);
      paintTimerPill();
    }
  }, 500);

  // ---------- sleep call ----------

  const sleepState = { on: false, camWas: false, lock: null, timer: null };

  async function setSleep(on) {
    toggleTray(false);
    if (on === sleepState.on) return;
    sleepState.on = on;
    const overlay = q("#tg-sleep");
    if (on) {
      sleepState.camWas = me.cam;
      if (me.cam) await setCamera(false);
      overlay.hidden = false;
      requestAnimationFrame(() => overlay.classList.add("on"));
      q(".sleep-who").textContent = `On call with ${partnerName()}`;
      paintSleepMic();
      try { sleepState.lock = await navigator.wakeLock?.request("screen"); } catch { /* not allowed */ }
      const tick = () => { q(".sleep-clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
      tick();
      sleepState.timer = setInterval(tick, 15000);
      send("sleep", { on: true });
    } else {
      overlay.classList.remove("on");
      setTimeout(() => { overlay.hidden = true; }, 500);
      clearInterval(sleepState.timer);
      sleepState.lock?.release?.().catch(() => {});
      sleepState.lock = null;
      if (sleepState.camWas && polling) await setCamera(true);
      send("sleep", { on: false });
    }
  }
  function paintSleepMic() {
    const b = q("[data-tg=sleep-mic]");
    q(".icon", b).textContent = me.mic ? "mic" : "mic_off";
    b.classList.toggle("off", !me.mic);
  }
  q("#tg-sleep").addEventListener("dblclick", (event) => { if (!event.target.closest("button")) setSleep(false); });
  let lastTap = 0;
  q("#tg-sleep").addEventListener("touchend", (event) => {
    if (event.target.closest("button")) return;
    const now = Date.now();
    if (now - lastTap < 350) setSleep(false);
    lastTap = now;
  });
  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden && sleepState.on && !sleepState.lock) {
      try { sleepState.lock = await navigator.wakeLock?.request("screen"); } catch { /* ignore */ }
    }
  });

  // ---------- photos ----------

  const photoTimer = () => Number(store.get("du-photo-timer", 0)) || 0;
  let captureBusy = false;

  function openCapture() {
    toggleTray(false);
    const others = [...peers.values()];
    const options = [];
    if (others.length) options.push({ id: "all", icon: "group", title: others.length === 1 ? "Both of us" : "Everyone", sub: "One photo with everyone" });
    options.push({ id: "me", icon: "person", title: "Just me", sub: me.name || "Your camera" });
    for (const person of others) options.push({ id: person.id, icon: "person", title: `Just ${person.name}`, sub: "Their camera" });
    q("#capture-body").innerHTML = `
      <p class="muted center">Who should be in the photo?</p>
      <div class="cap-options">${options.map((o) => `<button class="cap-opt" data-cap="${esc(o.id)}"><span class="cap-ic icon">${o.icon}</span><span><b>${esc(o.title)}</b><small>${esc(o.sub)}</small></span><span class="icon chev">chevron_right</span></button>`).join("")}</div>
      <div class="cap-timer"><span>Timer</span><div class="seg small">${[0, 3, 5].map((n) => `<button data-cap-timer="${n}" class="${photoTimer() === n ? "on" : ""}">${n ? `${n}s` : "Instant"}</button>`).join("")}</div></div>`;
    openModal(q("#m-capture"));
  }

  q("#capture-body").addEventListener("click", (event) => {
    const timerBtn = event.target.closest("[data-cap-timer]");
    if (timerBtn) {
      store.set("du-photo-timer", Number(timerBtn.dataset.capTimer));
      qa("[data-cap-timer]").forEach((b) => b.classList.toggle("on", b === timerBtn));
      q("#photo-timer").value = timerBtn.dataset.capTimer;
      return;
    }
    const option = event.target.closest("[data-cap]");
    if (option) takePhoto(option.dataset.cap);
  });

  async function countdown(secs) {
    const box = q("#tg-countdown");
    box.hidden = false;
    for (let n = secs; n > 0; n--) {
      box.innerHTML = `<span>${n}</span>`;
      await sleep(1000);
    }
    box.classList.add("flash");
    setTimeout(() => { box.hidden = true; box.classList.remove("flash"); box.innerHTML = ""; }, 400);
  }

  function frameOf(id) {
    const tile = tileOf(id);
    const video = tile?.querySelector("video");
    return video && video.videoWidth && video.srcObject && !tile.classList.contains("video-off") ? video : null;
  }
  const nameOfId = (id) => (id === me.id ? me.name || "You" : peers.get(id)?.name || "Guest");

  function drawCover(ctx, video, x, y, w, h) {
    const vr = video.videoWidth / video.videoHeight;
    const r = w / h;
    let sw = video.videoWidth, sh = video.videoHeight, sx = 0, sy = 0;
    if (vr > r) { sw = sh * r; sx = (video.videoWidth - sw) / 2; } else { sh = sw / r; sy = (video.videoHeight - sh) / 2; }
    ctx.drawImage(video, sx, sy, sw, sh, x, y, w, h);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function paintFrame(ctx, id, x, y, w, h, radius) {
    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    const video = frameOf(id);
    if (video) drawCover(ctx, video, x, y, w, h);
    else {
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, "#3a3a44"); g.addColorStop(1, "#1d1d22");
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#ffffffcc"; ctx.font = `600 ${Math.min(w, h) * 0.3}px Inter, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText((nameOfId(id)[0] || "?").toUpperCase(), x + w / 2, y + h / 2);
    }
    ctx.restore();
    const fs = Math.max(22, Math.round(Math.min(w, h) * 0.045));
    ctx.font = `600 ${fs}px Inter, sans-serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const label = nameOfId(id);
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(0,0,0,.45)";
    roundRect(ctx, x + fs * 0.7, y + h - fs * 2.4, tw + fs * 1.4, fs * 1.7, fs * 0.85); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText(label, x + fs * 1.4, y + h - fs * 1.2);
  }

  async function composePhoto(ids) {
    const stamp = new Date().toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ids.length === 1) {
      const video = frameOf(ids[0]);
      const ratio = video ? video.videoWidth / video.videoHeight : 4 / 3;
      const long = 1600;
      canvas.width = ratio >= 1 ? long : Math.round(long * ratio);
      canvas.height = ratio >= 1 ? Math.round(long / ratio) : long;
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      paintFrame(ctx, ids[0], 0, 0, canvas.width, canvas.height, 0);
      ctx.font = `500 ${Math.round(canvas.width * 0.022)}px Inter, sans-serif`;
      ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,.8)";
      ctx.fillText(stamp, canvas.width - 24, canvas.height - 24);
      return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    }
    const portrait = innerWidth < innerHeight;
    const gap = 28, margin = 40, footer = 110;
    const n = ids.length;
    if (portrait) { canvas.width = 1080; canvas.height = margin * 2 + footer + (n * 760) + gap * (n - 1) - 80; }
    else { canvas.width = 1920; canvas.height = 1080; }
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, "#1d1d22"); bg.addColorStop(1, "#0b0b0d");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (portrait) {
      const h = (canvas.height - margin * 2 - footer - gap * (n - 1)) / n;
      ids.forEach((id, i) => paintFrame(ctx, id, margin, margin + i * (h + gap), canvas.width - margin * 2, h, 36));
    } else {
      const w = (canvas.width - margin * 2 - gap * (n - 1)) / n;
      ids.forEach((id, i) => paintFrame(ctx, id, margin + i * (w + gap), margin, w, canvas.height - margin * 2 - footer, 36));
    }
    ctx.textAlign = "center"; ctx.fillStyle = "#f5f5f7";
    ctx.font = "600 44px Inter, sans-serif";
    ctx.fillText(ids.map(nameOfId).join("  ·  "), canvas.width / 2, canvas.height - margin - 38);
    ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.font = "500 28px Inter, sans-serif";
    ctx.fillText(stamp, canvas.width / 2, canvas.height - margin + 4);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  }

  async function takePhoto(choice) {
    if (captureBusy) return;
    captureBusy = true;
    const everyone = [me.id, ...peers.keys()];
    const ids = choice === "all" ? everyone : choice === "me" ? [me.id] : [choice];
    closeModal(q("#m-capture"));
    try {
      const secs = photoTimer();
      if (secs && ids.some((id) => id !== me.id)) send("photo-count", { secs });
      if (secs) await countdown(secs);
      navigator.vibrate?.(25);
      const blob = await composePhoto(ids);
      showPhoto(blob);
    } catch (error) {
      console.warn(error);
      toast("Couldn't take the photo");
    } finally {
      captureBusy = false;
    }
  }

  function showPhoto(blob) {
    const url = URL.createObjectURL(blob);
    q("#k-title").textContent = "Photo";
    q("#capture-body").innerHTML = `
      <img class="photo-result" src="${url}" alt="Photo from the call">
      <div class="photo-actions">
        <button class="btn primary" data-photo="save"><span class="icon">download</span>Save</button>
        <button class="btn outline" data-photo="chat"><span class="icon">chat_bubble</span>Send in chat</button>
        <button class="btn ghost" data-photo="again"><span class="icon">refresh</span>Retake</button>
      </div>`;
    openModal(q("#m-capture"));
    const file = new File([blob], `DU Meet ${dayKey()}.jpg`, { type: "image/jpeg" });
    q("#capture-body").onclick = async (event) => {
      const action = event.target.closest("[data-photo]")?.dataset.photo;
      if (action === "save") {
        try {
          if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
          else download(blob, file.name);
        } catch { /* share sheet dismissed */ }
      } else if (action === "chat") {
        try {
          const uploaded = await upload(blob);
          const item = [{ url: uploaded.url, type: uploaded.type, name: file.name }];
          send("chat", { text: "", media: item });
          addChatMessage(me.name, "", true, item);
          toast("Sent in chat");
          closeModal(q("#m-capture"));
        } catch { toast("Couldn't send the photo"); }
      } else if (action === "again") {
        q("#k-title").textContent = "Take a photo";
        q("#capture-body").onclick = null;
        openCapture();
      }
    };
  }

  // ---------- files in chat ----------

  async function shrinkImage(file, max = 1800) {
    if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size < 1.5e6) return file;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.88));
    } catch { return file; }
  }

  q("#chat-file").addEventListener("change", async (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    if (!polling || !files.length) return;
    toast(files.length > 1 ? `Sending ${files.length} files…` : "Sending…");
    const items = [];
    for (const file of files.slice(0, 6)) {
      if (file.size > 25 * 1024 * 1024) { toast(`${file.name} is over 25 MB`); continue; }
      try {
        const ready = await shrinkImage(file);
        const uploaded = await upload(ready);
        items.push({ url: uploaded.url, type: uploaded.type, name: file.name });
      } catch { toast(`Couldn't send ${file.name}`); }
    }
    if (!items.length) return;
    send("chat", { text: "", media: items });
    addChatMessage(me.name, "", true, items);
  });

  // ---------- weak network: voice only ----------

  const net = { bad: 0, good: 0, paused: false, pausedAt: 0 };
  async function checkNetwork() {
    if (!polling || !peers.size || !me.cam || sleepState.on) { net.bad = net.good = 0; return; }
    let worst = Infinity;
    let loss = 0;
    for (const peer of peers.values()) {
      try {
        const stats = await peer.pc.getStats();
        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.nominated && report.state === "succeeded" && report.availableOutgoingBitrate) worst = Math.min(worst, report.availableOutgoingBitrate);
          if (report.type === "remote-inbound-rtp" && report.kind === "video" && typeof report.fractionLost === "number") loss = Math.max(loss, report.fractionLost);
        });
      } catch { /* closed */ }
    }
    if (worst === Infinity) return;
    net.bad = worst < 140000 || loss > 0.2 ? net.bad + 1 : 0;
    net.good = worst > 450000 && loss < 0.05 ? net.good + 1 : 0;
    if (!net.paused && net.bad >= 3) {
      net.paused = true; net.pausedAt = Date.now();
      setOutgoing(SLOT.camera, null);
      q("#tg-net").hidden = false;
      send("net", { weak: true });
    } else if (net.paused && (net.good >= 3 || Date.now() - net.pausedAt > 45000)) {
      net.paused = false; net.bad = 0;
      setOutgoing(SLOT.camera, cameraTrack());
      q("#tg-net").hidden = true;
      send("net", { weak: false });
      toast("Network is better · video is back");
    }
  }
  setInterval(checkNetwork, 3000);

  // ---------- recording only if everyone agrees ----------

  const recWait = { resolve: null };
  const originalRecord = actions.record;
  actions.record = async () => {
    toggleMenu(false);
    if (me.rec || !peers.size) return originalRecord();
    toast("Asking for permission…");
    send("rec-ask", {});
    const answer = await new Promise((resolve) => { recWait.resolve = resolve; setTimeout(() => resolve(null), 30000); });
    recWait.resolve = null;
    if (answer === true) originalRecord();
    else toast(answer === false ? "Recording was declined" : "No answer, so not recording");
  };

  // ---------- messages from the other side ----------

  window.DU = Object.assign(window.DU || {}, {
    lightbox(src) { q("#lightbox-img").src = src; openModal(q("#m-lightbox")); },
    onMessage(message, peer) {
      if (!peer) return;
      const data = message.data || {};
      switch (message.type) {
        case "heart": showHeart(peer.name); break;
        case "media": receiveMedia(data, peer); break;
        case "sleep":
          tileOf(peer.id)?.classList.toggle("sleeping", Boolean(data.on));
          toast(data.on ? `${peer.name} is in sleep mode` : `${peer.name} is back`);
          break;
        case "photo-count": if (Number(data.secs) > 0 && Number(data.secs) <= 10) countdown(Number(data.secs)); break;
        case "timer": receiveTimer(data, peer); break;
        case "cal":
          if (!q("#m-cal").hidden) getDocs("calendar").then((docs) => { cal.notes = docs; renderCal(); }).catch(() => {});
          toast(`${peer.name} updated the calendar`);
          break;
        case "net":
          tileOf(peer.id)?.classList.toggle("weak-net", Boolean(data.weak));
          if (data.weak) toast(`${peer.name}'s network is weak · voice only for now`);
          break;
        case "rec-ask":
          confirmBox({ title: "Record this call?", text: `${peer.name} wants to record this call. The recording is saved only on their device.`, ok: "Allow", cancel: "Decline" })
            .then((yes) => send("rec-answer", { yes }, peer.id));
          break;
        case "rec-answer": recWait.resolve?.(Boolean(data.yes)); break;
        default:
      }
    },
    onJoin() { setTimeout(todaysReminder, 2500); },
    onPeerJoined() {
      // someone joining late gets what is already running
      if (media.vid && media.leader) {
        setTimeout(() => {
          const playing = media.player?.getPlayerState?.() === 1;
          send("media", { action: "load", mode: media.mode, vid: media.vid, title: media.title, channel: media.channel, t: media.player?.getCurrentTime?.() || 0, paused: !playing, at: Date.now() });
          if (media.queue.length) media.queue.forEach((track) => send("media", { action: "queue-add", track }));
        }, 1500);
      }
      if (timer.on) setTimeout(shareTimer, 1500);
      if (sleepState.on) setTimeout(() => send("sleep", { on: true }), 1500);
    },
    onLeave() {
      Object.assign(timer, { on: false, running: false, elapsed: 0, done: false });
      paintTimerPill();
      if (media.player || media.mode) closeMedia(false);
      if (sleepState.on) setSleep(false);
      for (const modal of qa(".modal")) if (!modal.hidden && modal.id !== "m-history") closeModal(modal);
      q("#tg-net").hidden = true;
      net.paused = false;
      const secs = joinedAt ? (Date.now() - joinedAt) / 1000 : 0;
      q("#left-sub").textContent = secs > 20 ? `You were in the meeting for ${clock(secs)}.` : "";
    },
  });

  // ---------- clicks ----------

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#tg-tray, [data-tg=tray]")) toggleTray(false);
    const button = event.target.closest("[data-tg]");
    if (!button) return;
    ({
      tray: () => toggleTray(),
      heart: () => sendHeart(button),
      watch: () => openPlay("watch"),
      listen: () => openPlay("listen"),
      calendar: openCalendar,
      "timer-open": openTimer,
      "timer-go": timerToggle,
      "timer-stop": () => timerStop(true),
      capture: openCapture,
      sleep: () => setSleep(true),
      "sleep-mic": () => { setMic(!me.mic); paintSleepMic(); },
      "media-toggle": () => {
        if (!media.player) return;
        media.leader = true;
        if (media.player.getPlayerState() === 1) media.player.pauseVideo(); else media.player.playVideo();
      },
      "media-next": playNext,
      "media-save": saveCurrent,
      "media-open": () => openPlay(media.mode || "listen"),
      "media-close": () => closeMedia(true),
    })[button.dataset.tg]?.();
  });

  // settings: photo timer
  const select = q("#photo-timer");
  select.value = String(photoTimer());
  select.addEventListener("change", () => store.set("du-photo-timer", Number(select.value)));

  // the heart shape reused by the floating hearts
  document.body.insertAdjacentHTML("beforeend", `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="hg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a9c"/><stop offset="1" stop-color="#ff2d55"/></linearGradient><symbol id="hg-path" viewBox="0 0 24 24"><path fill="url(#hg2)" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></symbol></defs></svg>`);
})();
