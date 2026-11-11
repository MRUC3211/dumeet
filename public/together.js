// DU Meet · in-call features for two people:
// watch together (YouTube), listen together, sleep call, call moments (photo of both),
// thinking-of-you heart, study-together timer, weak-network audio-only and
// "record only if both say yes". Uses globals from app.js (send, peers, me, toast…).

(() => {
  "use strict";

  const q = (selector, root = document) => root.querySelector(selector);
  const DU = () => window.DU || {};
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pad = (n) => String(n).padStart(2, "0");
  const clock = (secs) => {
    secs = Math.max(0, Math.floor(secs));
    const h = Math.floor(secs / 3600);
    return h ? `${h}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}` : `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
  };
  const otherPeer = () => [...peers.values()][0] ?? null;
  const partnerName = () => otherPeer()?.name || DU().theirName?.() || "them";

  // ---------- UI: controls, tray, overlays ----------

  const center = q(".controls .center");
  center.insertAdjacentHTML("afterbegin", "");
  q("[data-action=more]", center).insertAdjacentHTML("beforebegin", `
    <button class="ctrl heart-ctrl" data-tg="heart" title="Thinking of you" aria-label="Send a heart"><span class="icon" aria-hidden="true">favorite</span></button>
    <button class="ctrl together-ctrl" data-tg="tray" title="Together" aria-label="Together" aria-expanded="false" aria-controls="tg-tray"><span class="icon" aria-hidden="true">auto_awesome</span></button>
    <div id="tg-tray" class="tg-tray" role="menu" hidden>
      <p class="tg-tray-title">Together ✨</p>
      <button role="menuitem" data-tg="watch"><span class="tg-ic watch icon">movie</span><span><b>Watch together</b><small>YouTube, in sync</small></span></button>
      <button role="menuitem" data-tg="listen"><span class="tg-ic listen icon">music_note</span><span><b>Listen together</b><small>Same song, same second</small></span></button>
      <button role="menuitem" data-tg="sleep"><span class="tg-ic sleep icon">bedtime</span><span><b>Sleep call</b><small>Dark screen, voice only</small></span></button>
      <button role="menuitem" data-tg="moment"><span class="tg-ic moment icon">photo_camera</span><span><b>Capture moment</b><small>A photo of both of you</small></span></button>
      <button role="menuitem" data-tg="study"><span class="tg-ic study icon">timer</span><span><b>Study together</b><small>One timer for both</small></span></button>
    </div>`);

  q(".main-area").insertAdjacentHTML("beforeend", `
    <div id="tg-stage" class="tg-stage" hidden>
      <div class="tg-player-wrap"><div id="tg-player"></div><button class="tg-tap" hidden>Tap to play ▶</button></div>
      <div class="tg-bar">
        <span class="tg-bar-icon icon">movie</span>
        <span class="tg-title">Watching together</span>
        <button class="chip-btn" data-tg="change"><span class="icon">swap_horiz</span>Change</button>
        <button class="icon-btn" data-tg="close-media" aria-label="Stop"><span class="icon">close</span></button>
      </div>
    </div>
    <div id="tg-timer" class="tg-timer" hidden>
      <span class="icon">timer</span><b class="tg-timer-time">00:00</b><span class="tg-timer-label">📚 Padhai</span>
      <button class="icon-btn" data-tg="timer-go" aria-label="Start or pause"><span class="icon">play_arrow</span></button>
      <button class="icon-btn" data-tg="timer-stop" aria-label="Finish"><span class="icon">stop</span></button>
    </div>
    <div id="tg-net" class="tg-net" hidden><span class="icon">signal_cellular_alt_1_bar</span><span>Weak network · video paused, voice continues</span></div>`);

  document.body.insertAdjacentHTML("beforeend", `
    <div id="tg-sleep" class="tg-sleep" hidden>
      <div class="sleep-stars" aria-hidden="true"></div>
      <span class="sleep-moon">🌙</span>
      <b class="sleep-clock"></b>
      <p class="sleep-who"></p>
      <p class="sleep-hint">Double-tap anywhere to wake up</p>
      <div class="sleep-actions"><button class="ctrl" data-tg="sleep-mic" aria-label="Microphone"><span class="icon">mic</span></button><button class="ctrl leave" data-action="leave" aria-label="End call"><span class="icon">call_end</span></button></div>
    </div>
    <div id="tg-countdown" class="tg-countdown" hidden></div>
    <dialog id="tg-dialog" class="dialog"><form method="dialog" class="dialog-card tg-dialog-card"></form></dialog>`);

  const tray = q("#tg-tray");
  function toggleTray(open = tray.hidden) {
    tray.hidden = !open;
    q("[data-tg=tray]").setAttribute("aria-expanded", String(open));
  }

  function ask({ title, text, input = false, placeholder = "", ok = "OK", cancel = "Cancel", value = "" }) {
    const dialog = q("#tg-dialog");
    const form = q("form", dialog);
    form.innerHTML = `
      <div class="dialog-head"><h2>${esc(title)}</h2></div>
      ${text ? `<p class="muted">${esc(text)}</p>` : ""}
      ${input ? `<input class="field" name="value" placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off">` : ""}
      <div class="dialog-actions"><button class="btn text" value="cancel">${esc(cancel)}</button><button class="btn primary" value="ok">${esc(ok)}</button></div>`;
    dialog.showModal();
    if (input) setTimeout(() => q("input", form).focus(), 50);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        const value = ok ? (input ? q("input", form).value.trim() : true) : null;
        if (dialog.open) dialog.close();
        resolve(value);
      };
      // Buttons answer directly (the dialog "close" event can arrive late in background tabs).
      form.onsubmit = (event) => { event.preventDefault(); finish(event.submitter?.value !== "cancel"); };
      dialog.oncancel = () => finish(false);
      dialog.onclick = (event) => { if (event.target === dialog) finish(false); };
    });
  }

  // ---------- heart ----------

  function heart() {
    send("tg-heart", {});
    DU().bigHeart?.(`Sent to ${partnerName()} 💗`);
    if (DU().isUsRoom?.()) DU().api?.heart(true).catch(() => {});
  }

  // ---------- watch / listen together (YouTube) ----------

  const media = { mode: null, vid: null, player: null, ready: false, suppressUntil: 0, leader: false, beat: null };
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

  async function chooseMedia(mode) {
    toggleTray(false);
    const link = await ask({
      title: mode === "watch" ? "Watch together 🍿" : "Listen together 🎧",
      text: "Paste a YouTube link. It plays for both of you at the same moment.",
      input: true, placeholder: "https://youtu.be/…", ok: "Play",
    });
    if (link === null) return;
    const vid = videoId(link);
    if (!vid) return toast("That doesn't look like a YouTube link");
    media.leader = true;
    await openMedia(mode, vid, 0, true);
    send("tg-media", { action: "load", mode, vid, t: 0 });
  }

  async function openMedia(mode, vid, startAt = 0, autoplay = false) {
    await loadYouTube();
    const stage = q("#tg-stage");
    media.mode = mode;
    stage.hidden = false;
    stage.dataset.mode = mode;
    q("#room").classList.toggle("watching", mode === "watch");
    q("#room").classList.toggle("listening", mode === "listen");
    q(".tg-bar-icon").textContent = mode === "watch" ? "movie" : "music_note";
    q(".tg-title").textContent = mode === "watch" ? "Watching together" : "Listening together";
    if (media.player && media.vid === vid) return;
    media.vid = vid;
    if (media.player) {
      media.suppressUntil = Date.now() + 1500;
      media.player.loadVideoById({ videoId: vid, startSeconds: startAt });
      return;
    }
    media.ready = false;
    media.suppressUntil = Date.now() + 2000;
    media.player = new YT.Player("tg-player", {
      videoId: vid,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(startAt), autoplay: autoplay ? 1 : 0 },
      events: {
        onReady: () => {
          media.ready = true;
          if (autoplay) media.player.playVideo();
          updateTitle();
        },
        onStateChange: onPlayerState,
      },
    });
    clearInterval(media.beat);
    media.beat = setInterval(heartbeat, 4000);
  }

  function updateTitle() {
    const data = media.player?.getVideoData?.();
    if (data?.title) q(".tg-title").textContent = `${media.mode === "watch" ? "🍿" : "🎧"} ${data.title}`;
  }

  function onPlayerState({ data: state }) {
    updateTitle();
    q(".tg-tap").hidden = true;
    if (Date.now() < media.suppressUntil) return; // this change came from the other person
    const t = media.player.getCurrentTime();
    if (state === YT.PlayerState.PLAYING) { media.leader = true; send("tg-media", { action: "play", t, at: Date.now() }); }
    if (state === YT.PlayerState.PAUSED) { media.leader = true; send("tg-media", { action: "pause", t }); }
  }

  function heartbeat() {
    if (!media.player?.getPlayerState || !media.leader) return;
    if (media.player.getPlayerState() !== YT.PlayerState.PLAYING) return;
    send("tg-media", { action: "sync", mode: media.mode, vid: media.vid, t: media.player.getCurrentTime(), at: Date.now() });
  }

  async function receiveMedia(data, peer) {
    if (data.action === "close") return closeMedia(false);
    if (data.action === "load") {
      media.leader = false;
      await openMedia(data.mode, data.vid, data.t || 0, !data.paused);
      toast(`${peer.name} ${data.paused ? "is" : "started"} ${data.mode === "watch" ? "watching a video 🍿" : "playing a song 🎧"}`);
      if (!data.paused) expectPlaying();
      return;
    }
    if (data.action === "sync" && (!media.player || media.vid !== data.vid)) {
      await openMedia(data.mode, data.vid, data.t, true);
      expectPlaying();
      return;
    }
    if (!media.player || !media.ready) return;
    media.leader = data.action !== "sync" ? false : media.leader;
    const lag = data.at ? Math.min(3, Math.max(0, (Date.now() - data.at) / 1000)) : 0;
    const target = (data.t || 0) + (data.action === "pause" ? 0 : lag);
    const drift = Math.abs(media.player.getCurrentTime() - target);
    media.suppressUntil = Date.now() + 1200;
    if (data.action === "pause") {
      media.player.pauseVideo();
      if (drift > 0.5) media.player.seekTo(target, true);
    } else {
      if (drift > (data.action === "sync" ? 1.5 : 0.6)) media.player.seekTo(target, true);
      if (media.player.getPlayerState() !== YT.PlayerState.PLAYING) { media.player.playVideo(); expectPlaying(); }
    }
  }

  // iPhone blocks autoplay that didn't start with a tap: offer one.
  function expectPlaying() {
    setTimeout(() => {
      if (media.player?.getPlayerState?.() !== YT.PlayerState.PLAYING) q(".tg-tap").hidden = false;
    }, 1800);
  }
  q(".tg-tap").onclick = () => { media.suppressUntil = Date.now() + 1000; media.player?.playVideo(); q(".tg-tap").hidden = true; };

  function closeMedia(tell = true) {
    if (tell) send("tg-media", { action: "close" });
    clearInterval(media.beat);
    media.player?.destroy?.();
    media.player = null;
    media.vid = media.mode = null;
    const wrap = q(".tg-player-wrap");
    q("#tg-player")?.remove();
    wrap.insertAdjacentHTML("afterbegin", `<div id="tg-player"></div>`);
    q("#tg-stage").hidden = true;
    q("#room").classList.remove("watching", "listening");
    if (typeof layoutGrid === "function") layoutGrid();
  }

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
      seedStars();
      send("tg-sleep", { on: true });
    } else {
      overlay.classList.remove("on");
      setTimeout(() => { overlay.hidden = true; }, 500);
      clearInterval(sleepState.timer);
      sleepState.lock?.release?.().catch(() => {});
      sleepState.lock = null;
      if (sleepState.camWas && polling) await setCamera(true);
      send("tg-sleep", { on: false });
    }
  }
  function paintSleepMic() {
    const b = q("[data-tg=sleep-mic]");
    q(".icon", b).textContent = me.mic ? "mic" : "mic_off";
    b.classList.toggle("off", !me.mic);
  }
  function seedStars() {
    const box = q(".sleep-stars");
    if (box.childElementCount) return;
    for (let i = 0; i < 40; i++) {
      const s = document.createElement("i");
      s.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation-delay:-${Math.random() * 4}s;--s:${0.5 + Math.random()}`;
      box.append(s);
    }
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

  // ---------- call moment (photo of both) ----------

  let momentBusy = false;

  async function countdown() {
    const box = q("#tg-countdown");
    box.hidden = false;
    for (const n of ["3", "2", "1", "📸"]) {
      box.innerHTML = `<span>${n}</span>`;
      await new Promise((r) => setTimeout(r, 750));
    }
    box.classList.add("flash");
    setTimeout(() => { box.hidden = true; box.classList.remove("flash"); box.innerHTML = ""; }, 450);
  }

  function frameOf(id) {
    const tile = tileOf(id);
    const video = tile?.querySelector("video");
    if (video && video.videoWidth && !tile.classList.contains("video-off") && video.srcObject) return video;
    return null;
  }

  function drawCover(ctx, video, x, y, w, h, mirror) {
    const vr = video.videoWidth / video.videoHeight;
    const r = w / h;
    let sw = video.videoWidth, sh = video.videoHeight, sx = 0, sy = 0;
    if (vr > r) { sw = sh * r; sx = (video.videoWidth - sw) / 2; } else { sh = sw / r; sy = (video.videoHeight - sh) / 2; }
    ctx.save();
    if (mirror) { ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h); } else ctx.drawImage(video, sx, sy, sw, sh, x, y, w, h);
    ctx.restore();
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

  async function composeMoment() {
    const W = 1080, H = 1350;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#2a1533"); bg.addColorStop(0.55, "#4a1d3f"); bg.addColorStop(1, "#1c1430");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.font = "56px serif";
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 22; i++) ctx.fillText("♥", Math.random() * W, Math.random() * H);
    ctx.globalAlpha = 1;
    const people = [{ id: me.id, name: me.name, mirror: me.facing === "user" }, ...[...peers.values()].slice(0, 1).map((p) => ({ id: p.id, name: p.name, mirror: false }))];
    const pad_ = 60, gap = 36;
    const boxH = (H - 260 - pad_ - gap * (people.length - 1)) / people.length;
    people.forEach((person, i) => {
      const x = pad_, y = pad_ + i * (boxH + gap), w = W - pad_ * 2, h = boxH;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 40;
      roundRect(ctx, x, y, w, h, 36);
      ctx.fillStyle = "#fff3"; ctx.fill();
      ctx.restore();
      ctx.save();
      roundRect(ctx, x, y, w, h, 36);
      ctx.clip();
      const video = frameOf(person.id);
      if (video) drawCover(ctx, video, x, y, w, h, person.mirror);
      else {
        const g = ctx.createLinearGradient(x, y, x + w, y + h);
        g.addColorStop(0, "#f7a8c4"); g.addColorStop(1, "#b7a3f5");
        ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = "#2a1533"; ctx.font = "600 160px 'Wix Madefor Display', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText((person.name[0] || "?").toUpperCase(), x + w / 2, y + h / 2);
      }
      ctx.restore();
      ctx.font = "600 40px 'Wix Madefor Text', sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      const label = person.name;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(20,10,25,.55)";
      roundRect(ctx, x + 28, y + h - 92, tw + 48, 64, 32); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillText(label, x + 52, y + h - 46);
    });
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd9e6";
    ctx.font = "italic 500 64px Fraunces, Georgia, serif";
    ctx.fillText(people.map((p) => p.name).join("  ♥  "), W / 2, H - 150);
    ctx.fillStyle = "#ffffffaa";
    ctx.font = "500 34px 'Wix Madefor Text', sans-serif";
    ctx.fillText(new Date().toLocaleString([], { weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }), W / 2, H - 92);
    ctx.font = "600 26px 'Wix Madefor Text', sans-serif";
    ctx.fillStyle = "#ffffff66";
    ctx.fillText("DU Meet", W / 2, H - 46);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  }

  async function takeMoment(initiator = true) {
    toggleTray(false);
    if (momentBusy) return;
    momentBusy = true;
    if (initiator) send("tg-moment", { phase: "start" });
    await countdown();
    navigator.vibrate?.(30);
    try {
      if (!initiator) return; // the one who pressed the button saves it for both
      const blob = await composeMoment();
      showMoment(URL.createObjectURL(blob), blob);
      if (DU().isUsRoom?.() && DU().who) {
        const uploaded = await DU().api.media(blob);
        await DU().api.put("moments", { who: DU().who, media: [{ id: uploaded.id, url: uploaded.url, type: uploaded.type }], at: Date.now() / 1000 });
        send("tg-moment", { phase: "saved", url: uploaded.url });
        toast("Saved to your memories 📸");
      }
    } catch (error) {
      console.warn(error);
      toast("Couldn't save the moment");
    } finally {
      momentBusy = false;
    }
  }

  function showMoment(url, blob) {
    DU().showGift?.({
      icon: "📸", title: "Our moment", body: "",
      foot: `<img class="moment-img" src="${esc(url)}" alt="Photo of both of you"><button class="btn outline wide" data-moment-dl>Download</button>`,
    });
    const dl = q("[data-moment-dl]");
    if (dl) dl.onclick = async () => download(blob ?? await (await fetch(url)).blob(), `DU moment ${new Date().toLocaleDateString()}.jpg`);
  }

  // ---------- study together timer ----------

  const study = { on: false, running: false, base: 0, elapsed: 0, label: "📚 Padhai", frame: null };
  const studyElapsed = () => study.elapsed + (study.running ? (Date.now() - study.base) / 1000 : 0);

  function paintStudy() {
    const box = q("#tg-timer");
    box.hidden = !study.on;
    if (!study.on) return;
    q(".tg-timer-time").textContent = clock(studyElapsed());
    q(".tg-timer-label").textContent = study.label;
    q("[data-tg=timer-go] .icon").textContent = study.running ? "pause" : "play_arrow";
    box.classList.toggle("running", study.running);
  }
  setInterval(() => { if (study.on) paintStudy(); }, 500);

  function studyShare() {
    send("tg-timer", { on: study.on, running: study.running, elapsed: studyElapsed(), label: study.label });
  }

  async function startStudy() {
    toggleTray(false);
    if (study.on) return toast("The timer is already on");
    const label = await ask({ title: "Study together 📚", text: "One timer for both of you. When you finish, it's saved to Focus for each of you.", input: true, value: study.label, ok: "Start" });
    if (label === null) return;
    Object.assign(study, { on: true, running: true, base: Date.now(), elapsed: 0, label: label || "📚 Padhai" });
    studyShare();
    paintStudy();
  }

  function studyToggle() {
    if (study.running) { study.elapsed = studyElapsed(); study.running = false; } else { study.base = Date.now(); study.running = true; }
    studyShare();
    paintStudy();
  }

  async function studyStop(tell = true) {
    const secs = studyElapsed();
    Object.assign(study, { on: false, running: false, elapsed: 0 });
    if (tell) send("tg-timer", { on: false, secs });
    paintStudy();
    if (secs >= 30) {
      DU().bigHeart?.(`${clock(secs)} of ${study.label}. Proud of us!`);
      if (DU().who) DU().api?.put("study", { who: DU().who, label: study.label, secs: Math.round(secs), at: Date.now() / 1000 }).catch(() => {});
    }
  }

  function receiveStudy(data) {
    if (!data.on) { if (study.on) studyStop(false); return; }
    const wasOn = study.on;
    Object.assign(study, { on: true, running: Boolean(data.running), elapsed: Number(data.elapsed) || 0, base: Date.now(), label: String(data.label || "📚 Padhai").slice(0, 40) });
    if (!wasOn) toast(`${partnerName()} started a study timer 📚`);
    paintStudy();
  }

  // ---------- weak network: audio only ----------

  const net = { bad: 0, good: 0, paused: false, pausedAt: 0 };

  async function checkNetwork() {
    if (!polling || !peers.size || !me.cam || sleepState.on) { net.bad = net.good = 0; return; }
    let worst = Infinity;
    let loss = 0;
    for (const peer of peers.values()) {
      try {
        const stats = await peer.pc.getStats();
        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.nominated && report.state === "succeeded" && report.availableOutgoingBitrate) {
            worst = Math.min(worst, report.availableOutgoingBitrate);
          }
          if (report.type === "remote-inbound-rtp" && report.kind === "video" && typeof report.fractionLost === "number") {
            loss = Math.max(loss, report.fractionLost);
          }
        });
      } catch { /* closed */ }
    }
    if (worst === Infinity) return;
    const bad = worst < 140000 || loss > 0.2;
    const good = worst > 450000 && loss < 0.05;
    net.bad = bad ? net.bad + 1 : 0;
    net.good = good ? net.good + 1 : 0;
    if (!net.paused && net.bad >= 3) {
      net.paused = true;
      net.pausedAt = Date.now();
      setOutgoing(SLOT.camera, null);
      q("#tg-net").hidden = false;
      send("tg-net", { weak: true });
    } else if (net.paused && (net.good >= 3 || Date.now() - net.pausedAt > 45000)) {
      net.paused = false;
      net.bad = 0;
      setOutgoing(SLOT.camera, cameraTrack());
      q("#tg-net").hidden = true;
      send("tg-net", { weak: false });
      toast("Network is better · video is back");
    }
  }
  setInterval(checkNetwork, 3000);

  // ---------- recording needs both to agree ----------

  const recWait = { resolve: null };
  const originalRecord = actions.record;
  actions.record = async () => {
    toggleMenu(false);
    if (me.rec || !peers.size) return originalRecord();
    toast(`Asking ${partnerName()} for permission…`);
    send("rec-ask", {});
    const answer = await new Promise((resolve) => {
      recWait.resolve = resolve;
      setTimeout(() => resolve(null), 30000);
    });
    recWait.resolve = null;
    if (answer === true) originalRecord();
    else toast(answer === false ? `${partnerName()} said no to recording` : "No answer, so not recording");
  };

  async function receiveRecAsk(peer) {
    const yes = await ask({ title: "Record this call?", text: `${peer.name} wants to record this call. It's saved only on their device.`, ok: "Allow", cancel: "No" });
    send("rec-answer", { yes: yes === true }, peer.id);
  }

  // ---------- messages from the other person ----------

  const previous = window.DU?.onMessage;
  window.DU = Object.assign(window.DU || {}, {
    get together() { return { media, study, sleep: sleepState, net }; }, // for debugging
    onMessage(message, peer) {
      if (!peer) return previous?.(message, peer);
      const data = message.data || {};
      switch (message.type) {
        case "tg-heart":
          DU().bigHeart?.(`${peer.name} is thinking of you`);
          break;
        case "tg-media":
          receiveMedia(data, peer);
          break;
        case "tg-sleep":
          tileOf(peer.id)?.classList.toggle("sleeping", Boolean(data.on));
          toast(data.on ? `🌙 ${peer.name} is in sleep mode` : `☀️ ${peer.name} woke up`);
          break;
        case "tg-moment":
          if (data.phase === "start") takeMoment(false);
          if (data.phase === "saved" && data.url) showMoment(data.url);
          break;
        case "tg-timer":
          receiveStudy(data);
          break;
        case "tg-net":
          tileOf(peer.id)?.classList.toggle("weak-net", Boolean(data.weak));
          if (data.weak) toast(`${peer.name}'s network is weak · voice only for now`);
          break;
        case "rec-ask":
          receiveRecAsk(peer);
          break;
        case "rec-answer":
          recWait.resolve?.(Boolean(data.yes));
          break;
        default:
          previous?.(message, peer);
      }
    },
  });

  // Someone joining late gets the running video/song and timer.
  const oldJoinHook = window.DU.onPeerJoined;
  window.DU.onPeerJoined = (peer) => {
    oldJoinHook?.(peer);
    if (media.vid && media.leader) {
      setTimeout(() => {
        const playing = media.player?.getPlayerState?.() === YT.PlayerState.PLAYING;
        send("tg-media", { action: "load", mode: media.mode, vid: media.vid, t: media.player?.getCurrentTime?.() || 0, paused: !playing, at: Date.now() }, peer.id);
      }, 1500);
    }
    if (study.on) setTimeout(studyShare, 1500);
    if (sleepState.on) setTimeout(() => send("tg-sleep", { on: true }), 1500);
  };

  // Leaving the call resets everything.
  const oldLeave = window.DU.onLeave;
  window.DU.onLeave = () => {
    if (study.on && studyElapsed() >= 30) studyStop(false);
    Object.assign(study, { on: false, running: false, elapsed: 0 });
    paintStudy();
    if (media.player || media.mode) closeMedia(false);
    if (sleepState.on) setSleep(false);
    q("#tg-net").hidden = true;
    net.paused = false;
    oldLeave?.();
  };

  // ---------- clicks ----------

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tg]");
    if (!event.target.closest("#tg-tray, [data-tg=tray]")) toggleTray(false);
    if (!button) return;
    const action = button.dataset.tg;
    ({
      tray: () => toggleTray(),
      heart,
      watch: () => chooseMedia("watch"),
      listen: () => chooseMedia("listen"),
      change: () => chooseMedia(media.mode || "watch"),
      "close-media": () => closeMedia(true),
      sleep: () => setSleep(true),
      "sleep-mic": () => { setMic(!me.mic); paintSleepMic(); },
      moment: () => takeMoment(true),
      study: startStudy,
      "timer-go": studyToggle,
      "timer-stop": () => studyStop(true),
    })[action]?.();
  });
})();
