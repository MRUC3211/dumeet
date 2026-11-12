// DU Meet · playful and calm things in a call:
//  throw something at their screen, nudge (shake) their phone, hold hands (heartbeat when
//  both hold), ambient sounds that play for both, and voice messages in chat.
// Uses globals from app.js (send, peers, me, toast, tileOf, polling, micTrack, addChatMessage).

(() => {
  "use strict";
  const { q, esc, store, upload } = window.DU.kit;
  const tray = (open) => window.DU.kit.toggleTray(open);
  const other = () => [...peers.values()][0];
  const ctx = () => (fun.audio ||= new (window.AudioContext || window.webkitAudioContext)());
  const fun = { audio: null };

  // ---------- throw ----------

  const THINGS = [
    { k: "tomato", e: "🍅", splat: "#e63323", label: "Tomato" },
    { k: "kiss", e: "💋", splat: "#ff2d6f", label: "Kiss" },
    { k: "rose", e: "🌹", splat: "#ff375f", label: "Rose" },
    { k: "pie", e: "🥧", splat: "#fff3d6", label: "Pie" },
    { k: "water", e: "💦", splat: "#64d2ff", label: "Water" },
    { k: "teddy", e: "🧸", splat: "#c28a52", label: "Teddy" },
  ];
  let throwBar = null;
  function openThrow() {
    tray(false);
    if (!peers.size) return toast("Throwing needs someone in the call");
    if (throwBar) return;
    throwBar = document.createElement("div");
    throwBar.className = "throw-bar";
    throwBar.innerHTML = `${THINGS.map((t) => `<button data-throw="${t.k}" aria-label="Throw ${t.label}">${t.e}</button>`).join("")}<button class="throw-x" aria-label="Close"><span class="icon">close</span></button>`;
    q(".main-area").append(throwBar);
    throwBar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-throw]");
      if (b) { const p = other(); if (!p) return; send("throw", { k: b.dataset.throw }); hit(p.id, b.dataset.throw, false); b.animate([{ transform: "scale(.8)" }, { transform: "scale(1)" }], { duration: 200 }); }
      else if (e.target.closest(".throw-x")) closeThrow();
    });
  }
  function closeThrow() { throwBar?.remove(); throwBar = null; }

  /** Fly a thing onto a tile and splat it there. */
  function hit(tileId, kind, onMe) {
    const t = THINGS.find((x) => x.k === kind);
    const tile = tileOf(tileId);
    if (!t || !tile) return;
    const fly = document.createElement("div");
    fly.className = `thrown ${onMe ? "in" : "out"}`;
    fly.textContent = t.e;
    const x = 30 + Math.random() * 40, y = 25 + Math.random() * 40;
    fly.style.setProperty("--x", `${x}%`);
    fly.style.setProperty("--y", `${y}%`);
    fly.style.setProperty("--r", `${Math.round(Math.random() * 60 - 30)}deg`);
    tile.append(fly);
    setTimeout(() => {
      const splat = document.createElement("div");
      splat.className = `splat ${t.k}`;
      splat.style.setProperty("--x", `${x}%`);
      splat.style.setProperty("--y", `${y}%`);
      splat.style.setProperty("--c", t.splat);
      splat.innerHTML = t.k === "kiss" || t.k === "teddy" || t.k === "rose" ? `<span>${t.e}</span>` : "<i></i><i></i><i></i><i></i><i></i><i></i>";
      tile.append(splat);
      if (onMe) navigator.vibrate?.(t.k === "kiss" || t.k === "rose" ? [30, 40, 30] : 90);
      setTimeout(() => splat.classList.add("gone"), 2200);
      setTimeout(() => splat.remove(), 2900);
    }, 520);
    setTimeout(() => fly.remove(), 700);
  }

  // ---------- nudge ----------

  let lastNudge = 0;
  function nudge() {
    tray(false);
    const p = other();
    if (!p) return toast("Nudging needs someone in the call");
    if (Date.now() - lastNudge < 2500) return;
    lastNudge = Date.now();
    send("nudge", {});
    toast(`Nudged ${p.name} 👋`);
    shake(tileOf(p.id));
  }
  function shake(el) { if (!el) return; el.classList.remove("shake-hard"); void el.offsetWidth; el.classList.add("shake-hard"); setTimeout(() => el.classList.remove("shake-hard"), 800); }

  // ---------- hold hands ----------

  const hold = { el: null, me: false, them: false, since: 0, beat: 0, clock: 0 };
  function openHold(fromThem) {
    tray(false);
    const p = other();
    if (!p) return toast("Holding hands needs someone in the call");
    if (hold.el) return;
    const face = (n) => { const u = window.DU.faceFor?.(n); return u ? `<img src="${esc(u)}" alt="">` : esc((n || "?")[0]); };
    hold.el = document.createElement("div");
    hold.el.className = "holdov";
    hold.el.innerHTML = `
      <button class="hold-x" aria-label="Close"><span class="icon">close</span></button>
      <div class="hold-faces"><span>${face(me.name)}</span><i class="icon">favorite</i><span>${face(p.name)}</span></div>
      <button class="hold-pad" aria-label="Hold here"><span class="hold-ring"></span><span class="hold-ring r2"></span><span class="icon">back_hand</span></button>
      <p class="hold-text"></p><small class="hold-time"></small>`;
    document.body.append(hold.el);
    const pad = q(".hold-pad", hold.el);
    const down = (e) => { e.preventDefault(); try { pad.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ } setHold(true); };
    const up = () => setHold(false);
    pad.addEventListener("pointerdown", down);
    pad.addEventListener("pointerup", up);
    pad.addEventListener("pointercancel", up);
    pad.addEventListener("contextmenu", (e) => e.preventDefault());
    q(".hold-x", hold.el).addEventListener("click", closeHold);
    if (!fromThem) send("hold", { open: true });
    paintHold();
  }
  function setHold(on) {
    if (hold.me === on) return;
    hold.me = on;
    send("hold", { on });
    paintHold();
  }
  function closeHold() {
    if (!hold.el) return;
    if (hold.me) send("hold", { on: false });
    hold.el.remove();
    Object.assign(hold, { el: null, me: false, them: false });
    clearInterval(hold.beat); clearInterval(hold.clock);
  }
  function thump() {
    try {
      const c = ctx(); if (c.state === "suspended") c.resume();
      [0, .22].forEach((t, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.value = i ? 48 : 58;
        g.gain.setValueAtTime(0, c.currentTime + t);
        g.gain.linearRampToValueAtTime(i ? .25 : .4, c.currentTime + t + .02);
        g.gain.exponentialRampToValueAtTime(.001, c.currentTime + t + .25);
        o.connect(g).connect(c.destination);
        o.start(c.currentTime + t); o.stop(c.currentTime + t + .3);
      });
    } catch { /* no audio */ }
  }
  function paintHold() {
    if (!hold.el) return;
    const p = other();
    const both = hold.me && hold.them;
    hold.el.classList.toggle("mine", hold.me);
    hold.el.classList.toggle("theirs", hold.them);
    hold.el.classList.toggle("both", both);
    q(".hold-text", hold.el).textContent = both ? `Holding hands with ${p?.name || ""}` : hold.me ? `Waiting for ${p?.name || "them"} to hold…` : hold.them ? `${p?.name || "They"} is holding your hand. Hold too.` : "Press and hold the circle";
    clearInterval(hold.beat); clearInterval(hold.clock);
    if (both) {
      hold.since = Date.now();
      const beat = () => { navigator.vibrate?.([60, 120, 40]); thump(); };
      beat();
      hold.beat = setInterval(beat, 1000);
      const t = q(".hold-time", hold.el);
      hold.clock = setInterval(() => { const s = Math.floor((Date.now() - hold.since) / 1000); t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }, 500);
    } else q(".hold-time", hold.el).textContent = "";
  }

  // ---------- ambient sounds (made live with Web Audio, so nothing to download) ----------

  const SOUNDS = [
    { k: "rain", icon: "rainy", label: "Rain" },
    { k: "waves", icon: "waves", label: "Waves" },
    { k: "fire", icon: "local_fire_department", label: "Fireplace" },
    { k: "night", icon: "nights_stay", label: "Night" },
    { k: "brown", icon: "graphic_eq", label: "Deep focus" },
  ];
  const amb = { k: "", vol: store.get("du-amb-vol", .5), nodes: [], master: null, timers: [] };
  function noiseBuffer(c, color) {
    const len = c.sampleRate * 4, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === "brown") { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
      else { b0 = .99765 * b0 + w * .099046; b1 = .963 * b1 + w * .2965164; b2 = .57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * .1848) * .18; }
    }
    return buf;
  }
  function loopNoise(c, color, out, filter) {
    const src = c.createBufferSource(); src.buffer = noiseBuffer(c, color); src.loop = true;
    let node = src;
    if (filter) { const f = c.createBiquadFilter(); Object.assign(f, { type: filter.type }); f.frequency.value = filter.f; if (filter.q) f.Q.value = filter.q; src.connect(f); node = f; }
    node.connect(out); src.start(); amb.nodes.push(src);
    return node;
  }
  function stopSound() {
    amb.nodes.forEach((n) => { try { n.stop(); } catch { /* done */ } });
    amb.timers.forEach(clearInterval);
    amb.master?.disconnect();
    Object.assign(amb, { nodes: [], timers: [], master: null, k: "" });
  }
  function playSound(k) {
    stopSound();
    if (!k) return paintSounds();
    const c = ctx(); if (c.state === "suspended") c.resume();
    amb.k = k;
    amb.master = c.createGain(); amb.master.gain.value = 0; amb.master.connect(c.destination);
    amb.master.gain.linearRampToValueAtTime(amb.vol, c.currentTime + 1.5);
    const g = (v) => { const n = c.createGain(); n.gain.value = v; n.connect(amb.master); return n; };
    if (k === "rain") {
      loopNoise(c, "pink", g(.9), { type: "lowpass", f: 5200 });
      loopNoise(c, "pink", g(.35), { type: "highpass", f: 2500 });
      const drops = g(.25);
      amb.timers.push(setInterval(() => { // single drops on a roof
        const o = c.createOscillator(), e = c.createGain(); o.frequency.value = 1800 + Math.random() * 2600;
        e.gain.setValueAtTime(.12, c.currentTime); e.gain.exponentialRampToValueAtTime(.001, c.currentTime + .05);
        o.connect(e).connect(drops); o.start(); o.stop(c.currentTime + .06);
      }, 70));
    } else if (k === "waves") {
      const swell = g(0);
      loopNoise(c, "pink", swell, { type: "lowpass", f: 900 });
      const lfo = c.createOscillator(), depth = c.createGain(); lfo.frequency.value = .09; depth.gain.value = .55;
      lfo.connect(depth).connect(swell.gain); swell.gain.value = .6; lfo.start(); amb.nodes.push(lfo);
    } else if (k === "fire") {
      loopNoise(c, "brown", g(.8), { type: "lowpass", f: 600 });
      const crack = g(.5);
      amb.timers.push(setInterval(() => {
        if (Math.random() > .55) return;
        const src = c.createBufferSource(), b = c.createBuffer(1, 400, c.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < 400; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 50);
        src.buffer = b; const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1500;
        src.connect(f).connect(crack); src.start();
      }, 90));
    } else if (k === "night") {
      loopNoise(c, "brown", g(.35), { type: "lowpass", f: 400 });
      const chirps = g(.06);
      amb.timers.push(setInterval(() => { // crickets
        const base = 4200 + Math.random() * 400;
        for (let i = 0; i < 3; i++) {
          const o = c.createOscillator(), e = c.createGain(), t = c.currentTime + i * .07;
          o.frequency.value = base; e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(1, t + .01); e.gain.linearRampToValueAtTime(0, t + .05);
          o.connect(e).connect(chirps); o.start(t); o.stop(t + .06);
        }
      }, 700));
    } else if (k === "brown") {
      loopNoise(c, "brown", g(1), { type: "lowpass", f: 1000 });
    }
    paintSounds();
  }
  function setVolume(v) {
    amb.vol = v; store.set("du-amb-vol", v);
    if (amb.master) amb.master.gain.setTargetAtTime(v, ctx().currentTime, .1);
  }
  let soundSheet = null;
  function paintSounds() {
    const l = q("#tray-sound");
    if (l) l.textContent = amb.k ? `${SOUNDS.find((s) => s.k === amb.k).label} · playing` : "Rain, waves, fire";
    q("[data-tg=sounds]")?.classList.toggle("on", Boolean(amb.k));
    if (!soundSheet?.isConnected) return;
    soundSheet.querySelectorAll("[data-snd]").forEach((b) => b.classList.toggle("on", b.dataset.snd === amb.k));
  }
  function openSounds() {
    tray(false);
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `<div class="sheet narrow"><header class="sheet-head"><h2>Sounds</h2><button class="icon-btn" data-modal-close aria-label="Close"><span class="icon">close</span></button></header>
      <div class="sheet-body"><p class="muted small">Plays softly on both phones, under your voices.</p>
      <div class="snd-grid">${SOUNDS.map((s) => `<button data-snd="${s.k}" class="t-${s.k}"><span class="icon">${s.icon}</span><b>${s.label}</b><i class="snd-eq"><b></b><b></b><b></b></i></button>`).join("")}</div>
      <label class="snd-vol"><span class="icon">volume_down</span><input type="range" min="0" max="1" step="0.05" value="${amb.vol}"><span class="icon">volume_up</span></label>
      <button class="btn ghost wide" data-snd="">Stop</button></div></div>`;
    document.body.append(modal);
    window.DU.openModal(modal);
    soundSheet = modal;
    paintSounds();
    modal.addEventListener("click", (e) => {
      if (e.target === modal || e.target.closest("[data-modal-close]")) { window.DU.closeModal(modal); setTimeout(() => modal.remove(), 400); return; }
      const b = e.target.closest("[data-snd]");
      if (!b) return;
      const k = b.dataset.snd === amb.k ? "" : b.dataset.snd;
      playSound(k);
      send("ambient", { k, vol: amb.vol });
    });
    q("input[type=range]", modal).addEventListener("input", (e) => setVolume(Number(e.target.value)));
  }

  // ---------- voice messages in chat ----------

  const rec = { mr: null, chunks: [], start: 0, timer: 0, stream: null, cancel: false };
  function setupVoice() {
    const form = q("#chat-form");
    if (!form || q(".voice-btn", form)) return;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "icon-btn voice-btn"; btn.title = "Voice message"; btn.setAttribute("aria-label", "Record a voice message");
    btn.innerHTML = `<span class="icon">mic</span>`;
    q(".send", form).before(btn);
    const bar = document.createElement("div");
    bar.className = "voice-rec"; bar.hidden = true;
    bar.innerHTML = `<button type="button" class="icon-btn" data-vr="cancel" aria-label="Delete recording"><span class="icon">delete</span></button><span class="vr-dot"></span><span class="vr-time">0:00</span><span class="vr-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><button type="button" class="vr-send" data-vr="send" aria-label="Send voice message"><span class="icon">arrow_upward</span></button>`;
    form.append(bar);
    btn.addEventListener("click", startRec);
    bar.addEventListener("click", (e) => { const a = e.target.closest("[data-vr]")?.dataset.vr; if (a) stopRec(a === "cancel"); });
  }
  async function startRec() {
    const track = typeof micTrack === "function" ? micTrack() : null;
    if (!track) return toast("No microphone");
    if (!window.MediaRecorder) return toast("Voice messages aren't supported here");
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
    const clone = track.clone(); clone.enabled = true;
    rec.stream = new MediaStream([clone]);
    rec.chunks = []; rec.cancel = false;
    rec.mr = new MediaRecorder(rec.stream, type ? { mimeType: type } : {});
    rec.mr.ondataavailable = (e) => { if (e.data.size) rec.chunks.push(e.data); };
    rec.mr.onstop = finishRec;
    rec.mr.start(250);
    rec.start = Date.now();
    q("#chat-form").classList.add("recording");
    q(".voice-rec").hidden = false;
    const t = q(".vr-time");
    rec.timer = setInterval(() => {
      const s = Math.floor((Date.now() - rec.start) / 1000);
      t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (s >= 120) stopRec(false);
    }, 250);
    navigator.vibrate?.(20);
  }
  function stopRec(cancel) {
    if (!rec.mr) return;
    rec.cancel = cancel;
    clearInterval(rec.timer);
    rec.mr.stop();
    rec.stream.getTracks().forEach((tr) => tr.stop());
    q("#chat-form").classList.remove("recording");
    q(".voice-rec").hidden = true;
    q(".vr-time").textContent = "0:00";
  }
  async function finishRec() {
    const secs = Math.round((Date.now() - rec.start) / 1000);
    const blob = new Blob(rec.chunks, { type: rec.mr.mimeType || "audio/webm" });
    rec.mr = null;
    if (rec.cancel || secs < 1 || !blob.size) return;
    try {
      const up = await upload(blob);
      const item = [{ url: up.url, type: (up.type || blob.type).split(";")[0], name: "Voice message", voice: true, secs }];
      send("chat", { text: "", media: item });
      addChatMessage(me.name, "", true, item);
    } catch { toast("Couldn't send the voice message"); }
  }

  // ---------- hooks ----------

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave, join: window.DU.onCoupleJoin };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const run = { throw: openThrow, nudge, hold: () => openHold(false), sounds: openSounds }[button.dataset.tg];
      if (run) run(); else prev.click?.(button);
    },
    onCouple(message, peer) {
      const d = message.data || {};
      switch (message.type) {
        case "throw": hit(me.id, String(d.k), true); break;
        case "nudge":
          navigator.vibrate?.([120, 60, 120, 60, 240]);
          shake(q(".main-area"));
          toast(`${peer.name} nudged you 👋`);
          break;
        case "hold":
          if (d.open && !hold.el) openHold(true);
          if (typeof d.on === "boolean") { hold.them = d.on; paintHold(); }
          break;
        case "ambient":
          if (typeof d.vol === "number") setVolume(Math.max(0, Math.min(1, d.vol)));
          playSound(SOUNDS.some((s) => s.k === d.k) ? d.k : "");
          if (d.k) toast(`${peer.name} turned on ${SOUNDS.find((s) => s.k === d.k)?.label.toLowerCase()} sounds`);
          break;
        default: prev.msg?.(message, peer);
      }
    },
    onCoupleJoin(...args) { prev.join?.(...args); setupVoice(); },
    onCoupleLeave(...args) { prev.leave?.(...args); closeThrow(); closeHold(); stopSound(); if (rec.mr) stopRec(true); },
  });
  setupVoice();
})();
