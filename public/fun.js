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

  // type: splat (liquid), stamp (lands and stays a moment), stick (stuck in the glass), burst (pieces fly out)
  const THINGS = [
    { k: "tomato", e: "🍅", type: "splat", c: "#e63323", label: "Tomato" },
    { k: "egg", e: "🥚", type: "splat", c: "#ffd60a", label: "Egg" },
    { k: "pie", e: "🥧", type: "splat", c: "#fff3d6", label: "Pie" },
    { k: "water", e: "💦", type: "splat", c: "#64d2ff", label: "Water balloon" },
    { k: "snow", e: "❄️", type: "splat", c: "#f2f7ff", label: "Snowball" },
    { k: "paint", e: "🎨", type: "splat", c: "rainbow", label: "Paint" },
    { k: "knife", e: "🔪", type: "stick", label: "Knife" },
    { k: "dagger", e: "🗡️", type: "stick", label: "Sword" },
    { k: "cupid", e: "💘", type: "stick", label: "Cupid's arrow" },
    { k: "chappal", e: "🩴", type: "stamp", label: "Chappal" },
    { k: "shoe", e: "👟", type: "stamp", label: "Shoe" },
    { k: "banana", e: "🍌", type: "stamp", label: "Banana" },
    { k: "kiss", e: "💋", type: "stamp", label: "Kiss", soft: true },
    { k: "rose", e: "🌹", type: "stamp", label: "Rose", soft: true },
    { k: "teddy", e: "🧸", type: "stamp", label: "Teddy", soft: true },
    { k: "bomb", e: "💣", type: "burst", parts: ["💥", "💨", "🔥"], label: "Bomb" },
    { k: "confetti", e: "🎉", type: "burst", parts: ["🎊", "✨", "🎉"], label: "Confetti", soft: true },
    { k: "money", e: "💸", type: "burst", parts: ["💵", "💸", "🪙"], label: "Money", soft: true },
  ];
  function openThrow() {
    tray(false);
    if (!peers.size) return toast("Throwing needs someone in the call");
    const w = window.DU.win.open({
      id: "throw", title: "Throw", icon: "sports_handball", w: 340, h: 380,
      html: `<p class="fw-note">Tap to throw at their screen. Tap again and again!</p>
        <div class="th-grid">${THINGS.map((t) => `<button data-throw="${t.k}" aria-label="Throw ${t.label}" title="${t.label}"><span>${t.e}</span><small>${t.label}</small></button>`).join("")}</div>`,
    });
    w.body.onclick = (e) => {
      const b = e.target.closest("[data-throw]");
      if (!b) return;
      const p = other();
      if (!p) return toast("They left the call");
      send("throw", { k: b.dataset.throw });
      hit(p.id, b.dataset.throw, false);
      b.animate([{ transform: "scale(.82)" }, { transform: "scale(1)" }], { duration: 220, easing: "cubic-bezier(.3,1.6,.5,1)" });
    };
  }
  function closeThrow() { window.DU.win.get("throw")?.close(); }

  /** Fly a thing onto a tile and land it there. */
  function hit(tileId, kind, onMe) {
    const t = THINGS.find((x) => x.k === kind);
    const tile = tileOf(tileId);
    if (!t || !tile) return;
    const fly = document.createElement("div");
    fly.className = `thrown ${onMe ? "in" : "out"}${t.type === "stick" ? " spin" : ""}`;
    fly.textContent = t.e;
    const x = 22 + Math.random() * 56, y = 20 + Math.random() * 50;
    const r = Math.round(Math.random() * 60 - 30);
    for (const el of [fly]) { el.style.setProperty("--x", `${x}%`); el.style.setProperty("--y", `${y}%`); el.style.setProperty("--r", `${r}deg`); }
    tile.append(fly);
    setTimeout(() => {
      const land = document.createElement("div");
      land.className = `splat ${t.k} t-${t.type}`;
      land.style.setProperty("--x", `${x}%`);
      land.style.setProperty("--y", `${y}%`);
      land.style.setProperty("--r", `${r}deg`);
      if (t.type === "splat") {
        const cols = t.c === "rainbow" ? ["#ff375f", "#ffd60a", "#30d158", "#0a84ff", "#bf5af2", "#ff9f0a"] : [t.c];
        land.innerHTML = [0, 1, 2, 3, 4, 5].map((i) => `<i style="--c:${cols[i % cols.length]}"></i>`).join("");
        if (t.k === "egg") land.innerHTML += `<i class="yolk"></i>`;
      } else if (t.type === "stick") {
        land.innerHTML = `<b class="crack"></b><span>${t.e}</span>`;
      } else if (t.type === "burst") {
        land.innerHTML = `<span class="boom">${t.parts[0]}</span>${Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2 + Math.random() * .4, d = 70 + Math.random() * 90;
          return `<em style="--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--d:${Math.random() * .15}s">${t.parts[i % t.parts.length]}</em>`;
        }).join("")}`;
        if (t.k === "bomb") { tile.classList.add("flash"); setTimeout(() => tile.classList.remove("flash"), 400); shake(tile); }
      } else {
        land.innerHTML = `<span>${t.e}</span>`;
      }
      tile.append(land);
      if (onMe) navigator.vibrate?.(t.soft ? [30, 40, 30] : t.k === "bomb" ? [200, 50, 120] : 90);
      sfx(t);
      setTimeout(() => land.classList.add("gone"), t.type === "stick" ? 3200 : 2300);
      setTimeout(() => land.remove(), t.type === "stick" ? 3900 : 3000);
    }, 520);
    setTimeout(() => fly.remove(), 700);
  }
  function sfx(t) {
    try {
      const c = ctx(); if (c.state === "suspended") c.resume();
      const now = c.currentTime;
      const noise = (dur, f, vol, type = "lowpass") => {
        const len = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
        s.buffer = b; fl.type = type; fl.frequency.value = f; g.gain.value = vol;
        s.connect(fl).connect(g).connect(c.destination); s.start();
      };
      const tone = (f1, f2, dur, vol, wave = "sine") => {
        const o = c.createOscillator(), g = c.createGain(); o.type = wave;
        o.frequency.setValueAtTime(f1, now); o.frequency.exponentialRampToValueAtTime(f2, now + dur);
        g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(.001, now + dur);
        o.connect(g).connect(c.destination); o.start(); o.stop(now + dur + .02);
      };
      if (t.type === "splat") noise(.25, 900, .5);
      else if (t.type === "stick") { tone(2400, 900, .12, .15, "triangle"); noise(.08, 3000, .3, "highpass"); }
      else if (t.k === "bomb") { noise(1.1, 220, 1); tone(120, 35, .8, .3, "sawtooth"); }
      else if (t.type === "burst") tone(700, 1500, .25, .08, "triangle");
      else if (t.soft) tone(900, 1300, .2, .06);
      else noise(.12, 500, .6);
    } catch { /* no audio */ }
  }

  // ---------- nudge: tap as many times as you like ----------

  const NUDGES = [
    { k: "nudge", e: "👋", label: "Nudge", vib: [120, 60, 120], fx: "shake" },
    { k: "knock", e: "✊", label: "Knock knock", vib: [60, 120, 60, 120, 60], fx: "knock" },
    { k: "tickle", e: "🪶", label: "Tickle", vib: [20, 30, 20, 30, 20, 30, 20, 30, 20], fx: "wiggle" },
    { k: "poke", e: "👉", label: "Poke", vib: [40], fx: "poke" },
    { k: "hug", e: "🤗", label: "Squeeze", vib: [300], fx: "squeeze" },
    { k: "boop", e: "👃", label: "Boop", vib: [25, 50, 25], fx: "boop" },
  ];
  const nudgeState = { k: "nudge", count: 0, last: 0 };
  function openNudge() {
    tray(false);
    const p = other();
    if (!p) return toast("Nudging needs someone in the call");
    const w = window.DU.win.open({
      id: "nudge", title: "Nudge", icon: "vibration", w: 320, h: 400,
      html: `<div class="nd-kinds">${NUDGES.map((n) => `<button data-nk="${n.k}" class="${n.k === nudgeState.k ? "on" : ""}"><span>${n.e}</span><small>${n.label}</small></button>`).join("")}</div>
        <button class="nd-pad" aria-label="Send"><span class="nd-e">${NUDGES.find((n) => n.k === nudgeState.k).e}</span><b class="nd-n"></b></button>
        <p class="fw-note center">Tap fast for a bigger nudge. Their phone buzzes every time.</p>`,
    });
    const pad = q(".nd-pad", w.body);
    w.body.onclick = (e) => {
      const kind = e.target.closest("[data-nk]");
      if (kind) {
        nudgeState.k = kind.dataset.nk;
        w.body.querySelectorAll("[data-nk]").forEach((b) => b.classList.toggle("on", b === kind));
        q(".nd-e", pad).textContent = NUDGES.find((n) => n.k === nudgeState.k).e;
        return;
      }
      if (!e.target.closest(".nd-pad")) return;
      const now = Date.now();
      if (now - nudgeState.last < 180) return;
      nudgeState.count = now - nudgeState.last < 1500 ? nudgeState.count + 1 : 1;
      nudgeState.last = now;
      const them = other();
      if (!them) return toast("They left the call");
      send("nudge", { k: nudgeState.k, n: nudgeState.count });
      q(".nd-n", pad).textContent = nudgeState.count > 1 ? `×${nudgeState.count}` : "";
      pad.animate([{ transform: "scale(.9)" }, { transform: "scale(1)" }], { duration: 240, easing: "cubic-bezier(.3,1.6,.5,1)" });
      nudgeFx(tileOf(them.id), nudgeState.k);
    };
  }
  function nudgeFx(el, k) {
    if (!el) return;
    const n = NUDGES.find((x) => x.k === k) || NUDGES[0];
    const cls = `nd-${n.fx}`;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 800);
    const pop = document.createElement("div");
    pop.className = "nd-pop";
    pop.textContent = n.e;
    pop.style.left = `${25 + Math.random() * 50}%`;
    pop.style.top = `${30 + Math.random() * 40}%`;
    el.append(pop);
    setTimeout(() => pop.remove(), 900);
  }
  let nudgeToast = 0, nudgeTally = 0;
  function gotNudge(peer, d) {
    const n = NUDGES.find((x) => x.k === d.k) || NUDGES[0];
    navigator.vibrate?.(n.vib);
    nudgeFx(q(".main-area"), n.k);
    nudgeTally += 1;
    clearTimeout(nudgeToast);
    nudgeToast = setTimeout(() => { toast(`${peer.name}: ${n.label.toLowerCase()} ${n.e}${nudgeTally > 1 ? ` ×${nudgeTally}` : ""}`); nudgeTally = 0; }, 700);
  }
  function shake(el) { if (!el) return; el.classList.remove("shake-hard"); void el.offsetWidth; el.classList.add("shake-hard"); setTimeout(() => el.classList.remove("shake-hard"), 800); }

  // ---------- hold hands ----------

  const hold = { win: null, el: null, me: false, them: false, since: 0, beat: 0, clock: 0 };
  function openHold(fromThem) {
    tray(false);
    const p = other();
    if (!p) return toast("Holding hands needs someone in the call");
    if (hold.win) return;
    const face = (n) => { const u = window.DU.faceFor?.(n); return u ? `<img src="${esc(u)}" alt="">` : esc((n || "?")[0]); };
    hold.win = window.DU.win.open({
      id: "hold", title: "Hold hands", icon: "back_hand", w: 320, h: 430, tone: "rose",
      html: `<div class="hold-wrap">
        <div class="hold-faces"><span>${face(me.name)}</span><i class="icon">favorite</i><span>${face(p.name)}</span></div>
        <button class="hold-pad" aria-label="Hold here"><span class="hold-ring"></span><span class="hold-ring r2"></span><span class="icon">back_hand</span></button>
        <p class="hold-text"></p><small class="hold-time"></small></div>`,
      onClose: () => closeHold(true),
    });
    hold.el = q(".hold-wrap", hold.win.body);
    const pad = q(".hold-pad", hold.el);
    const down = (e) => { e.preventDefault(); try { pad.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ } setHold(true); };
    const up = () => setHold(false);
    pad.addEventListener("pointerdown", down);
    pad.addEventListener("pointerup", up);
    pad.addEventListener("pointercancel", up);
    pad.addEventListener("contextmenu", (e) => e.preventDefault());
    if (!fromThem) send("hold", { open: true });
    paintHold();
  }
  function setHold(on) {
    if (hold.me === on) return;
    hold.me = on;
    send("hold", { on });
    paintHold();
  }
  function closeHold(fromWindow) {
    if (!hold.win) return;
    if (hold.me) send("hold", { on: false });
    const w = hold.win;
    Object.assign(hold, { win: null, el: null, me: false, them: false });
    clearInterval(hold.beat); clearInterval(hold.clock);
    if (!fromWindow) w.close();
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
    for (const el of [hold.el, hold.win.el]) {
      el.classList.toggle("mine", hold.me);
      el.classList.toggle("theirs", hold.them);
      el.classList.toggle("both", both);
    }
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
    { k: "thunder", icon: "thunderstorm", label: "Thunderstorm" },
    { k: "waves", icon: "waves", label: "Ocean waves" },
    { k: "stream", icon: "water", label: "River stream" },
    { k: "forest", icon: "forest", label: "Forest birds" },
    { k: "wind", icon: "air", label: "Soft wind" },
    { k: "fire", icon: "local_fire_department", label: "Fireplace" },
    { k: "night", icon: "nights_stay", label: "Night crickets" },
    { k: "cafe", icon: "local_cafe", label: "Café" },
    { k: "train", icon: "train", label: "Night train" },
    { k: "fan", icon: "mode_fan", label: "Fan" },
    { k: "chimes", icon: "notifications", label: "Wind chimes" },
    { k: "bowl", icon: "self_improvement", label: "Singing bowl" },
    { k: "heart", icon: "favorite", label: "Heartbeat" },
    { k: "white", icon: "blur_on", label: "White noise" },
    { k: "brown", icon: "graphic_eq", label: "Deep focus" },
  ];
  const amb = { k: "", vol: store.get("du-amb-vol", .5), nodes: [], master: null, timers: [] };
  function noiseBuffer(c, color) {
    const len = c.sampleRate * 4, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === "brown") { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
      else if (color === "white") d[i] = w * .3;
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
    amb.timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
    amb.master?.disconnect();
    Object.assign(amb, { nodes: [], timers: [], master: null, k: "" });
  }
  function every(ms, fn, jitter = 0) {
    const run = () => { fn(); amb.timers.push(setTimeout(run, ms + Math.random() * jitter)); };
    amb.timers.push(setTimeout(run, Math.random() * ms));
  }
  function bell(c, out, f, dur, vol) {
    const t = c.currentTime;
    [1, 2.76, 5.4].forEach((m, i) => {
      const o = c.createOscillator(), e = c.createGain(); o.frequency.value = f * m * (1 + (Math.random() - .5) * .002);
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(vol / (i + 1), t + .01); e.gain.exponentialRampToValueAtTime(.0005, t + dur / (i * .7 + 1));
      o.connect(e).connect(out); o.start(t); o.stop(t + dur);
    });
  }
  function playSound(k) {
    stopSound();
    if (!k) return paintSounds();
    const c = ctx(); if (c.state === "suspended") c.resume();
    amb.k = k;
    amb.master = c.createGain(); amb.master.gain.value = 0; amb.master.connect(c.destination);
    amb.master.gain.linearRampToValueAtTime(amb.vol, c.currentTime + 1.5);
    const g = (v) => { const n = c.createGain(); n.gain.value = v; n.connect(amb.master); return n; };
    const lfoTo = (param, rate, depth) => { const o = c.createOscillator(), d = c.createGain(); o.frequency.value = rate; d.gain.value = depth; o.connect(d).connect(param); o.start(); amb.nodes.push(o); };
    const rain = () => {
      loopNoise(c, "pink", g(.9), { type: "lowpass", f: 5200 });
      loopNoise(c, "pink", g(.35), { type: "highpass", f: 2500 });
      const drops = g(.25);
      amb.timers.push(setInterval(() => {
        const o = c.createOscillator(), e = c.createGain(); o.frequency.value = 1800 + Math.random() * 2600;
        e.gain.setValueAtTime(.12, c.currentTime); e.gain.exponentialRampToValueAtTime(.001, c.currentTime + .05);
        o.connect(e).connect(drops); o.start(); o.stop(c.currentTime + .06);
      }, 70));
    };
    if (k === "rain") rain();
    else if (k === "thunder") {
      rain();
      const rumble = g(0);
      loopNoise(c, "brown", rumble, { type: "lowpass", f: 180 });
      every(14000, () => {
        const t = c.currentTime, peak = .9 + Math.random() * .8;
        rumble.gain.cancelScheduledValues(t); rumble.gain.setValueAtTime(0, t);
        rumble.gain.linearRampToValueAtTime(peak, t + .15 + Math.random() * .4);
        rumble.gain.exponentialRampToValueAtTime(.001, t + 3 + Math.random() * 3);
      }, 10000);
    } else if (k === "waves") {
      const swell = g(0);
      loopNoise(c, "pink", swell, { type: "lowpass", f: 900 });
      swell.gain.value = .6; lfoTo(swell.gain, .09, .55);
    } else if (k === "stream") {
      const a = g(.5), b = g(.4);
      const f1 = loopNoise(c, "pink", a, { type: "bandpass", f: 1200, q: 1.5 }), f2 = loopNoise(c, "pink", b, { type: "bandpass", f: 2600, q: 2 });
      lfoTo(f1.frequency, 3.3, 500); lfoTo(f2.frequency, 5.1, 900);
      loopNoise(c, "pink", g(.35), { type: "highpass", f: 700 });
    } else if (k === "forest") {
      const wind = g(.25); const f = loopNoise(c, "pink", wind, { type: "bandpass", f: 500, q: .6 }); lfoTo(f.frequency, .07, 250);
      const birds = g(.08);
      every(1600, () => {
        const base = 2200 + Math.random() * 2400, n = 2 + Math.floor(Math.random() * 5);
        for (let i = 0; i < n; i++) {
          const o = c.createOscillator(), e = c.createGain(), t = c.currentTime + i * (.09 + Math.random() * .05);
          o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * .5), t + .07);
          e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(1, t + .01); e.gain.exponentialRampToValueAtTime(.001, t + .09);
          o.connect(e).connect(birds); o.start(t); o.stop(t + .1);
        }
      }, 2600);
    } else if (k === "wind") {
      const w1 = g(.55); const f = loopNoise(c, "pink", w1, { type: "bandpass", f: 420, q: .9 });
      lfoTo(f.frequency, .05, 260); lfoTo(w1.gain, .11, .35);
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
      amb.timers.push(setInterval(() => {
        const base = 4200 + Math.random() * 400;
        for (let i = 0; i < 3; i++) {
          const o = c.createOscillator(), e = c.createGain(), t = c.currentTime + i * .07;
          o.frequency.value = base; e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(1, t + .01); e.gain.linearRampToValueAtTime(0, t + .05);
          o.connect(e).connect(chirps); o.start(t); o.stop(t + .06);
        }
      }, 700));
    } else if (k === "cafe") {
      const murmur = g(.5); const f = loopNoise(c, "pink", murmur, { type: "bandpass", f: 700, q: .8 }); lfoTo(murmur.gain, .3, .15); lfoTo(f.frequency, .2, 200);
      loopNoise(c, "brown", g(.3), { type: "lowpass", f: 300 });
      const clinks = g(.05);
      every(2500, () => bell(c, clinks, 2200 + Math.random() * 1800, .5, .6), 3000);
    } else if (k === "train") {
      loopNoise(c, "brown", g(.9), { type: "lowpass", f: 160 });
      loopNoise(c, "pink", g(.12), { type: "bandpass", f: 900, q: .5 });
      const clack = g(.5);
      const knock = (at) => {
        const src = c.createBufferSource(), b = c.createBuffer(1, 1600, c.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < 1600; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 260);
        src.buffer = b; const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 700; src.connect(f).connect(clack); src.start(c.currentTime + at);
      };
      amb.timers.push(setInterval(() => { knock(0); knock(.14); knock(.62); knock(.76); }, 1300));
    } else if (k === "fan") {
      loopNoise(c, "pink", g(.8), { type: "lowpass", f: 750 });
      const hum = c.createOscillator(), hg = g(.02); hum.frequency.value = 118; hum.connect(hg); hum.start(); amb.nodes.push(hum);
    } else if (k === "chimes") {
      const air = g(.12); loopNoise(c, "pink", air, { type: "bandpass", f: 500, q: .7 });
      const out = g(.12), notes = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093];
      every(900, () => bell(c, out, notes[Math.floor(Math.random() * notes.length)], 4, .5), 1600);
    } else if (k === "bowl") {
      const out = g(.35);
      every(9000, () => { bell(c, out, 196, 9, .7); bell(c, out, 197.4, 9, .4); }, 2000);
    } else if (k === "heart") {
      const out = g(.9);
      amb.timers.push(setInterval(() => {
        [0, .24].forEach((t, i) => {
          const o = c.createOscillator(), e = c.createGain(), at = c.currentTime + t;
          o.frequency.value = i ? 46 : 56;
          e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(i ? .5 : .8, at + .02); e.gain.exponentialRampToValueAtTime(.001, at + .25);
          o.connect(e).connect(out); o.start(at); o.stop(at + .3);
        });
      }, 1000));
    } else if (k === "white") {
      loopNoise(c, "white", g(.8), { type: "lowpass", f: 9000 });
    } else if (k === "brown") {
      loopNoise(c, "brown", g(1), { type: "lowpass", f: 1000 });
    }
    paintSounds();
  }
  function setVolume(v) {
    amb.vol = v; store.set("du-amb-vol", v);
    if (amb.master) amb.master.gain.setTargetAtTime(v, ctx().currentTime, .1);
    const r = window.DU.win.get("sounds")?.el.querySelector("input[type=range]");
    if (r && Number(r.value) !== v) r.value = v;
  }
  function paintSounds() {
    const l = q("#tray-sound");
    if (l) l.textContent = amb.k ? `${SOUNDS.find((s) => s.k === amb.k).label} · playing` : "16 calm sounds";
    q("[data-tg=sounds]")?.classList.toggle("on", Boolean(amb.k));
    window.DU.win.get("sounds")?.el.querySelectorAll("[data-snd]").forEach((b) => b.classList.toggle("on", b.dataset.snd === amb.k && Boolean(amb.k)));
  }
  function openSounds() {
    tray(false);
    const w = window.DU.win.open({
      id: "sounds", title: "Sounds", icon: "water_drop", w: 380, h: 500,
      html: `<p class="fw-note">Plays softly on both phones, under your voices.</p>
      <div class="snd-grid">${SOUNDS.map((s) => `<button data-snd="${s.k}" class="t-${s.k}"><span class="icon">${s.icon}</span><b>${s.label}</b><i class="snd-eq"><b></b><b></b><b></b></i></button>`).join("")}</div>
      <div class="snd-foot"><label class="snd-vol"><span class="icon">volume_down</span><input type="range" min="0" max="1" step="0.05" value="${amb.vol}" aria-label="Volume"><span class="icon">volume_up</span></label>
      <button class="btn ghost" data-snd="">Stop</button></div>`,
    });
    paintSounds();
    w.body.onclick = (e) => {
      const b = e.target.closest("[data-snd]");
      if (!b) return;
      const k = b.dataset.snd === amb.k ? "" : b.dataset.snd;
      playSound(k);
      send("ambient", { k, vol: amb.vol });
    };
    q("input[type=range]", w.body).addEventListener("input", (e) => setVolume(Number(e.target.value)));
  }
  window.DU.sounds = { play: (k) => { playSound(k); send("ambient", { k, vol: amb.vol }); }, stop: () => { playSound(""); }, fadeOut(secs = 20) { if (!amb.master) return; amb.master.gain.setTargetAtTime(0, ctx().currentTime, secs / 4); setTimeout(() => playSound(""), secs * 1000); }, get current() { return amb.k; } };

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
      const run = { throw: openThrow, nudge: openNudge, hold: () => openHold(false), sounds: openSounds }[button.dataset.tg];
      if (run) run(); else prev.click?.(button);
    },
    onCouple(message, peer) {
      const d = message.data || {};
      switch (message.type) {
        case "throw": hit(me.id, String(d.k), true); break;
        case "nudge": gotNudge(peer, d); break;
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
    onCoupleLeave(...args) { prev.leave?.(...args); closeThrow(); window.DU.win.get("nudge")?.close(); closeHold(); stopSound(); window.DU.win.get("sounds")?.close(); if (rec.mr) stopRec(true); },
  });
  setupVoice();
})();
