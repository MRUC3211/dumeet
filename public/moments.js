// DU Meet · more Date night and Relax.
//   Date night  Kiss cam, Slow dance, Send a rose, Sky lantern (a wish that floats up)
//   Relax       Rainy window, Aquarium (tap to feed), Fireplace, Bubble wrap
// Date night things play on both screens; Relax things are your own (with an option to share).

(() => {
  "use strict";
  const { q, esc } = window.DU.kit;
  const W = () => window.DU.win;
  const P = () => window.DU.party;
  const tray = () => window.DU.kit.toggleTray(false);
  const other = () => [...peers.values()][0];
  const partner = () => other()?.name || "your partner";
  const inCall = () => typeof polling !== "undefined" && polling;
  const say = (d) => { if (inCall()) send("moment", d); };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let actx = null;
  const ac = () => { actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); return actx; };

  // =================================================================
  // Kiss cam
  // =================================================================
  let kissEl = null;
  function kissCam(by, remote) {
    kissEl?.remove();
    const el = document.createElement("div");
    el.className = "mo-kiss";
    el.innerHTML = `<div class="mo-kiss-frame"></div><div class="mo-kiss-top"><span>💋</span><b>KISS CAM</b><span>💋</span></div><small>${remote ? `${esc(by)} turned on the Kiss cam!` : `Kiss cam is on ${esc(partner())}'s screen too`} Blow a kiss to the camera 😘</small>`;
    document.body.append(el);
    kissEl = el;
    // the stadium organ
    const notes = [392, 392, 440, 392, 523, 494, 392, 392, 440, 392, 587, 523];
    notes.forEach((f, i) => { P()?.tone(f, i * 0.22, 0.2, 0.06, "square"); P()?.tone(f / 2, i * 0.22, 0.2, 0.04, "sawtooth"); });
    P()?.particles(["💋", "😘", "💗"], { mode: "rise", n: 40, ms: 7000 });
    el.addEventListener("click", () => el.remove());
    setTimeout(() => { if (kissEl === el) { el.classList.add("out"); setTimeout(() => el.remove(), 500); } }, 10000);
  }

  // =================================================================
  // Slow dance: a soft waltz, pink light, the tiles sway
  // =================================================================
  const slow = { on: false, timer: 0, next: 0, step: 0, el: null };
  const CHORDS = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
  const MELODY = [659, 587, 523, 587, 659, 659, 659, 0, 587, 587, 587, 0, 659, 784, 784, 0, 659, 587, 523, 587, 659, 659, 659, 659, 587, 587, 659, 587, 523, 0, 0, 0];
  function slowStart(by, remote) {
    slowStop(true);
    slow.on = true; slow.step = 0;
    const c = ac(), beat = 0.5;
    slow.next = c.currentTime + 0.1;
    slow.timer = setInterval(() => {
      while (slow.next < c.currentTime + 0.2) {
        const t0 = slow.next - c.currentTime, i = slow.step, ch = CHORDS[Math.floor(i / 3) % 4];
        // waltz: bass on 1, chord on 2 and 3
        if (i % 3 === 0) P()?.tone(ch[0] / 2, t0, beat * 2.6, 0.08, "sine");
        else ch.forEach((f) => P()?.tone(f, t0, beat * 0.9, 0.025, "triangle"));
        const m = MELODY[i % MELODY.length];
        if (m) P()?.tone(m, t0, beat * 1.4, 0.04, "sine");
        slow.next += beat; slow.step += 1;
      }
    }, 50);
    const el = document.createElement("div");
    el.className = "mo-slow";
    el.innerHTML = `<div class="mo-slow-glow"></div><div class="mo-sparks" aria-hidden="true">${Array.from({ length: 24 }, () => `<i style="--x:${rnd(0, 100).toFixed(1)}%;--y:${rnd(0, 100).toFixed(1)}%;--d:${rnd(2, 6).toFixed(1)}s"></i>`).join("")}</div>
      <button class="pt-stop" type="button"><span class="icon" aria-hidden="true">music_off</span>End the slow dance</button>`;
    document.body.append(el);
    document.body.classList.add("mo-sway");
    slow.el = el;
    q(".pt-stop", el).onclick = () => { slowStop(); say({ t: "slow-stop" }); };
    if (remote) toast(`💞 ${by} asked you for a slow dance`);
    clearTimeout(slow.auto); slow.auto = setTimeout(slowStop, 8 * 60000);
  }
  function slowStop() {
    if (!slow.on) return;
    slow.on = false;
    clearInterval(slow.timer); clearTimeout(slow.auto);
    document.body.classList.remove("mo-sway");
    const el = slow.el; slow.el = null;
    if (el) { el.classList.add("out"); setTimeout(() => el.remove(), 800); }
  }

  // =================================================================
  // Send a rose
  // =================================================================
  const FLOWERS = [{ k: "rose", e: "🌹", label: "Red rose", c: "#e11d48" }, { k: "pink", e: "🌸", label: "Pink rose", c: "#f472b6" }, { k: "sun", e: "🌻", label: "Sunflower", c: "#facc15" }, { k: "tulip", e: "🌷", label: "Tulip", c: "#fb7185" }, { k: "lily", e: "🪷", label: "Lotus", c: "#e879f9" }, { k: "bouquet", e: "💐", label: "Bouquet", c: "#f97316" }];
  function bloom(k, note, by, remote) {
    const f = FLOWERS.find((x) => x.k === k) || FLOWERS[0];
    const petals = Array.from({ length: 12 }, (_, i) => `<i style="--a:${i * 30}deg;--d:${(i % 3) * 0.12}s"></i>`).join("");
    const el = document.createElement("div");
    el.className = "mo-rose";
    el.style.setProperty("--c", f.c);
    el.innerHTML = `<div class="mo-rose-card"><div class="mo-flower"><div class="mo-petals">${petals}</div><span class="mo-fe">${f.e}</span><i class="mo-stem"></i></div>
      <b>${remote ? `${esc(by)} sent you a ${esc(f.label.toLowerCase())}` : `A ${esc(f.label.toLowerCase())} for ${esc(partner())}`}</b>${note ? `<p>“${esc(note)}”</p>` : ""}<small>Tap to close</small></div>`;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add("in"));
    [523, 659, 784, 1047, 1319].forEach((fq, i) => P()?.tone(fq, 0.3 + i * 0.12, 0.8, 0.04, "sine"));
    P()?.particles([f.e, "✨"], { mode: "rise", n: 18, ms: 4000, size: [18, 34] });
    const close = () => { el.classList.remove("in"); setTimeout(() => el.remove(), 500); };
    el.addEventListener("click", close);
    setTimeout(close, remote ? 9000 : 4000);
  }
  function openRose() {
    tray();
    const w = W().open({ id: "mo-rose", title: "Send a flower", icon: "local_florist", w: 360, h: 430,
      html: `<p class="fw-note">It blooms on ${esc(partner())}'s screen.</p><div class="fx-grid pt-grid">${FLOWERS.map((x) => `<button data-fl="${x.k}"><span class="fx-emoji">${x.e}</span><small>${x.label}</small></button>`).join("")}</div>
        <input class="field mo-note" maxlength="80" placeholder="Add a sweet line (optional)" aria-label="A note with the flower">` });
    if (w.body.dataset.wired) return;
    w.body.dataset.wired = "1";
    w.body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fl]");
      if (!b) return;
      if (!other()) return toast(`${partner()} needs to be in the call`);
      const note = q(".mo-note", w.body).value.trim().slice(0, 80);
      say({ t: "rose", k: b.dataset.fl, note });
      bloom(b.dataset.fl, note, me.name, false);
      q(".mo-note", w.body).value = "";
    });
  }

  // =================================================================
  // Sky lantern: write a wish, it floats up on both screens
  // =================================================================
  function lantern(wish, by, remote) {
    const el = document.createElement("div");
    el.className = "mo-lantern";
    el.style.setProperty("--x", `${rnd(20, 70).toFixed(0)}%`);
    el.innerHTML = `<div class="mo-lan"><i></i><span>${esc(wish)}</span></div><small>${remote ? `${esc(by)}'s wish` : "Your wish"}</small>`;
    document.body.append(el);
    [784, 988, 1175].forEach((f, i) => P()?.tone(f, i * 0.25, 1.2, 0.03, "sine"));
    setTimeout(() => el.remove(), 12500);
  }
  function openLantern() {
    tray();
    const w = W().open({ id: "mo-lantern", title: "Sky lantern", icon: "emoji_objects", w: 360, h: 300, autoH: true,
      html: `<p class="fw-note">Write a wish for the two of you. A glowing lantern carries it up on both screens.</p>
        <form class="mo-lan-form"><textarea class="field" name="w" rows="2" maxlength="90" placeholder="That we meet very soon…" required aria-label="Your wish"></textarea><button class="btn primary"><span class="icon">rocket_launch</span>Let it fly</button></form>` });
    const f = q("form", w.body);
    if (f.dataset.wired) return;
    f.dataset.wired = "1";
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const wish = f.elements.w.value.trim().slice(0, 90);
      if (!wish) return;
      lantern(wish, me.name, false); say({ t: "lantern", wish });
      f.elements.w.value = "";
    });
  }

  // =================================================================
  // RELAX: Rainy window, Aquarium, Fireplace, Bubble wrap
  // =================================================================
  // looping noise for rain and fire
  function loopNoise(kind) {
    try {
      const c = ac(), len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === "fire") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 + (Math.random() < 0.0004 ? (Math.random() * 2 - 1) * 0.9 : 0); }
        else d[i] = w * 0.5;
      }
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = buf; s.loop = true;
      f.type = kind === "fire" ? "lowpass" : "bandpass"; f.frequency.value = kind === "fire" ? 900 : 1400; f.Q.value = 0.4;
      g.gain.value = 0; g.gain.linearRampToValueAtTime(kind === "fire" ? 0.5 : 0.18, c.currentTime + 1.5);
      s.connect(f).connect(g).connect(c.destination); s.start();
      return () => { try { g.gain.linearRampToValueAtTime(0, c.currentTime + 0.8); setTimeout(() => s.stop(), 900); } catch { /* closed */ } };
    } catch { return () => {}; }
  }

  // ---------- Rainy window: a full-screen layer you can share ----------
  let rainy = null;
  function rainyStart(by, remote) {
    if (rainy) return;
    const cv = document.createElement("canvas");
    cv.className = "mo-rain";
    document.body.append(cv);
    const btn = document.createElement("button");
    btn.className = "pt-stop mo-rain-stop"; btn.type = "button";
    btn.innerHTML = `<span class="icon" aria-hidden="true">umbrella</span>Stop the rain`;
    document.body.append(btn);
    const dpr = Math.min(2, devicePixelRatio || 1);
    const x = cv.getContext("2d");
    let Wd = 0, Hd = 0;
    const fit = () => { Wd = cv.width = innerWidth * dpr; Hd = cv.height = innerHeight * dpr; };
    fit(); addEventListener("resize", fit);
    const drops = Array.from({ length: reduce() ? 40 : 160 }, () => ({ x: rnd(0, 1), y: rnd(0, 1), l: rnd(10, 26), v: rnd(0.008, 0.016) }));
    const beads = Array.from({ length: 50 }, () => ({ x: rnd(0, 1), y: rnd(0, 1), r: rnd(2, 6), v: rnd(0, 0.0015) }));
    let raf = 0;
    const draw = () => {
      x.clearRect(0, 0, Wd, Hd);
      x.strokeStyle = "rgba(200,220,255,.35)"; x.lineWidth = 1.2 * dpr;
      for (const d of drops) { d.y += d.v; if (d.y > 1.05) { d.y = -0.05; d.x = rnd(0, 1); } x.beginPath(); x.moveTo(d.x * Wd, d.y * Hd); x.lineTo(d.x * Wd - 2 * dpr, d.y * Hd + d.l * dpr); x.stroke(); }
      for (const b of beads) {
        b.y += b.v; if (b.y > 1.05) { b.y = -0.02; b.x = rnd(0, 1); b.v = rnd(0, 0.0015); }
        const g = x.createRadialGradient(b.x * Wd - b.r * 0.3 * dpr, b.y * Hd - b.r * 0.3 * dpr, 0, b.x * Wd, b.y * Hd, b.r * dpr);
        g.addColorStop(0, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(180,200,230,.08)");
        x.fillStyle = g; x.beginPath(); x.arc(b.x * Wd, b.y * Hd, b.r * dpr, 0, Math.PI * 2); x.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    const stopSound = loopNoise("rain");
    const thunder = setInterval(() => {
      if (Math.random() < 0.35) { cv.classList.add("flash"); setTimeout(() => cv.classList.remove("flash"), 180); P()?.noise(0.4, 2.5, 0.35, 140, "lowpass"); }
    }, 14000);
    rainy = { stop() { cancelAnimationFrame(raf); clearInterval(thunder); stopSound(); removeEventListener("resize", fit); cv.classList.add("out"); btn.remove(); setTimeout(() => cv.remove(), 800); } };
    btn.onclick = () => { const shared = rainy?.shared; rainyStop(); if (shared) say({ t: "rainy-stop" }); };
    if (remote) { toast(`🌧️ ${by} brought the rain`); rainy.shared = true; }
  }
  function rainyStop() { rainy?.stop(); rainy = null; }
  function openRainy() {
    tray();
    if (rainy) return rainyStop();
    rainyStart(me.name);
    if (other()) { say({ t: "rainy" }); rainy.shared = true; }
  }

  // ---------- small windows with a canvas ----------
  function canvasWin(id, title, icon, { w = 380, h = 360, html = "", onClose } = {}) {
    tray();
    const win = W().get(id);
    if (win) return { win, fresh: false };
    let stop = () => {};
    const o = W().open({ id, title, icon, w, h, onClose: () => { stop(); onClose?.(); },
      html: `<div class="mo-cv-wrap"><canvas class="mo-cv"></canvas>${html}</div>` });
    return { win: o, fresh: true, setStop: (f) => { stop = f; } };
  }
  function sized(cv, cb) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const ro = new ResizeObserver(() => { const r = cv.getBoundingClientRect(); cv.width = r.width * dpr; cv.height = r.height * dpr; cb?.(); });
    ro.observe(cv);
    return { dpr, ro };
  }

  // ---------- Aquarium ----------
  function openAquarium() {
    const o = canvasWin("mo-aqua", "Aquarium", "set_meal", { html: `<small class="mo-cv-tip">Tap the water to feed the fish</small>` });
    if (!o.fresh) return;
    const cv = q(".mo-cv", o.win.body), x = cv.getContext("2d");
    const { dpr, ro } = sized(cv);
    const KINDS = ["🐠", "🐟", "🐡", "🐠", "🐟", "🦈", "🐙", "🦀"];
    const fish = KINDS.map((e, i) => ({ e, x: rnd(0.1, 0.9), y: i === 7 ? 0.92 : rnd(0.15, 0.8), vx: (Math.random() < 0.5 ? -1 : 1) * rnd(0.0008, 0.002), ph: rnd(0, 6), s: e === "🦈" ? 46 : e === "🦀" ? 26 : rnd(26, 36), crab: i === 7 }));
    const food = [], bubbles = [];
    const weeds = Array.from({ length: 7 }, (_, i) => ({ x: (i + 0.5) / 7 + rnd(-0.04, 0.04), h: rnd(0.15, 0.32) }));
    cv.addEventListener("pointerdown", (e) => {
      const r = cv.getBoundingClientRect();
      for (let i = 0; i < 5; i++) food.push({ x: (e.clientX - r.left) / r.width + rnd(-0.02, 0.02), y: 0.05 + rnd(0, 0.03) });
      P()?.tone(1400, 0, 0.05, 0.03, "sine", 900);
    });
    let raf = 0, t = 0;
    const draw = () => {
      t += 1;
      const Wd = cv.width, Hd = cv.height;
      const g = x.createLinearGradient(0, 0, 0, Hd); g.addColorStop(0, "#0b4f6c"); g.addColorStop(1, "#04253a");
      x.fillStyle = g; x.fillRect(0, 0, Wd, Hd);
      // light rays
      x.fillStyle = "rgba(255,255,255,.04)";
      for (let i = 0; i < 4; i++) { const px = ((i * 0.3 + t * 0.0004) % 1.2) * Wd; x.beginPath(); x.moveTo(px, 0); x.lineTo(px + 40 * dpr, 0); x.lineTo(px - 60 * dpr, Hd); x.lineTo(px - 120 * dpr, Hd); x.fill(); }
      // sand + weeds
      x.fillStyle = "#c2a36b"; x.beginPath(); x.moveTo(0, Hd * 0.93); x.quadraticCurveTo(Wd * 0.5, Hd * 0.88, Wd, Hd * 0.94); x.lineTo(Wd, Hd); x.lineTo(0, Hd); x.fill();
      x.strokeStyle = "#2f9e44"; x.lineWidth = 5 * dpr; x.lineCap = "round";
      for (const w of weeds) { x.beginPath(); x.moveTo(w.x * Wd, Hd * 0.95); for (let k = 1; k <= 6; k++) x.lineTo(w.x * Wd + Math.sin(t / 40 + k + w.x * 9) * 8 * dpr * k / 6, Hd * (0.95 - w.h * k / 6)); x.stroke(); }
      // bubbles
      if (t % 18 === 0) bubbles.push({ x: rnd(0.05, 0.95), y: 1, r: rnd(2, 5) });
      x.strokeStyle = "rgba(255,255,255,.5)"; x.lineWidth = 1 * dpr;
      for (let i = bubbles.length - 1; i >= 0; i--) { const b = bubbles[i]; b.y -= 0.004; b.x += Math.sin(t / 15 + i) * 0.0008; if (b.y < -0.02) { bubbles.splice(i, 1); continue; } x.beginPath(); x.arc(b.x * Wd, b.y * Hd, b.r * dpr, 0, Math.PI * 2); x.stroke(); }
      // food
      x.fillStyle = "#e8a33d";
      for (let i = food.length - 1; i >= 0; i--) { const f = food[i]; f.y += 0.0018; if (f.y > 0.92) { food.splice(i, 1); continue; } x.beginPath(); x.arc(f.x * Wd, f.y * Hd, 2.5 * dpr, 0, Math.PI * 2); x.fill(); }
      // fish
      x.font = `${30 * dpr}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
      for (const f of fish) {
        const near = !f.crab && food.length ? food.reduce((a, b) => (Math.hypot(b.x - f.x, b.y - f.y) < Math.hypot(a.x - f.x, a.y - f.y) ? b : a)) : null;
        if (near) {
          f.vx += Math.sign(near.x - f.x) * 0.00012; f.y += (near.y - f.y) * 0.02;
          if (Math.hypot(near.x - f.x, near.y - f.y) < 0.03) { food.splice(food.indexOf(near), 1); P()?.tone(600, 0, 0.05, 0.03, "sine", 900); }
        }
        f.vx = Math.max(-0.004, Math.min(0.004, f.vx));
        f.x += f.vx; if (!f.crab) f.y += Math.sin(t / 30 + f.ph) * 0.0006;
        if (f.x < 0.05 || f.x > 0.95) f.vx = -f.vx;
        if (!near && Math.abs(f.vx) < 0.0008) f.vx = Math.sign(f.vx || 1) * 0.001;
        x.save(); x.translate(f.x * Wd, f.y * Hd);
        if (f.vx > 0 && !f.crab) x.scale(-1, 1);
        x.font = `${f.s * dpr}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`; x.fillText(f.e, 0, 0); x.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    const bub = setInterval(() => P()?.tone(rnd(300, 600), 0, 0.08, 0.015, "sine", rnd(800, 1200)), 2200);
    o.setStop(() => { cancelAnimationFrame(raf); ro.disconnect(); clearInterval(bub); });
  }

  // ---------- Fireplace ----------
  function openFire() {
    const o = canvasWin("mo-fire", "Fireplace", "fireplace", { h: 340, html: `<small class="mo-cv-tip">Tap to add a log</small>` });
    if (!o.fresh) return;
    const cv = q(".mo-cv", o.win.body), x = cv.getContext("2d");
    const { dpr, ro } = sized(cv);
    const parts = [];
    let power = 1, raf = 0;
    cv.addEventListener("pointerdown", () => { power = Math.min(2.2, power + 0.5); P()?.noise(0, 0.3, 0.3, 300, "lowpass"); });
    const draw = () => {
      const Wd = cv.width, Hd = cv.height;
      x.globalCompositeOperation = "source-over";
      x.fillStyle = "rgba(20,8,4,.35)"; x.fillRect(0, 0, Wd, Hd);
      // bricks and logs
      x.fillStyle = "#3a1d12"; x.fillRect(0, Hd * 0.86, Wd, Hd * 0.14);
      x.fillStyle = "#5b3220";
      x.save(); x.translate(Wd / 2, Hd * 0.84); x.rotate(0.12); x.fillRect(-Wd * 0.22, -8 * dpr, Wd * 0.44, 16 * dpr); x.rotate(-0.24); x.fillRect(-Wd * 0.22, -8 * dpr, Wd * 0.44, 16 * dpr); x.restore();
      const n = Math.round(6 * power);
      for (let i = 0; i < n; i++) parts.push({ x: Wd / 2 + rnd(-Wd * 0.18, Wd * 0.18), y: Hd * 0.82, vx: rnd(-0.4, 0.4) * dpr, vy: -rnd(1.5, 3.5) * dpr * power, life: 1, r: rnd(10, 26) * dpr });
      x.globalCompositeOperation = "lighter";
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.x += p.vx + (Wd / 2 - p.x) * 0.012; p.y += p.vy; p.life -= 0.022; p.r *= 0.985;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        const g = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, `rgba(255,${Math.round(200 * p.life)},80,${0.5 * p.life})`); g.addColorStop(1, "rgba(255,60,0,0)");
        x.fillStyle = g; x.beginPath(); x.arc(p.x, p.y, p.r, 0, Math.PI * 2); x.fill();
      }
      if (Math.random() < 0.08) { x.fillStyle = "#ffd27a"; x.fillRect(Wd / 2 + rnd(-40, 40) * dpr, Hd * rnd(0.3, 0.6), 2 * dpr, 2 * dpr); }
      power += (1 - power) * 0.004;
      raf = requestAnimationFrame(draw);
    };
    draw();
    const stopSound = loopNoise("fire");
    o.setStop(() => { cancelAnimationFrame(raf); ro.disconnect(); stopSound(); });
  }

  // ---------- Bubble wrap ----------
  function openBubbles() {
    tray();
    const w = W().open({ id: "mo-bubbles", title: "Bubble wrap", icon: "bubble_chart", w: 360, h: 470,
      html: `<div class="mo-bw"><div class="mo-bw-grid"></div><div class="mo-bw-foot"><small class="mo-bw-n"></small><button class="btn ghost" data-bw="new"><span class="icon">refresh</span>New sheet</button></div></div>` });
    const grid = q(".mo-bw-grid", w.body);
    const fresh = () => { grid.innerHTML = Array.from({ length: 48 }, () => `<button aria-label="Bubble"></button>`).join(""); count(); };
    const count = () => { const left = grid.querySelectorAll("button:not(.pop)").length; q(".mo-bw-n", w.body).textContent = left ? `${left} bubbles left` : "All popped! So satisfying 😌"; };
    if (!w.body.dataset.wired) {
      w.body.dataset.wired = "1";
      grid.addEventListener("pointerdown", (e) => {
        const b = e.target.closest("button:not(.pop)");
        if (!b) return;
        b.classList.add("pop");
        P()?.noise(0, 0.06, 0.5, rnd(1500, 3000), "bandpass", 2); P()?.tone(rnd(150, 260), 0, 0.05, 0.15, "sine", 60);
        try { navigator.vibrate?.(15); } catch { /* none */ }
        count();
      });
      q("[data-bw=new]", w.body).onclick = fresh;
      fresh();
    }
  }

  // =================================================================
  // wiring
  // =================================================================
  const OPEN = {
    "mo-kiss": () => { tray(); if (!other()) return toast(`${partner()} needs to be in the call`); kissCam(me.name, false); say({ t: "kiss" }); },
    "mo-slow": () => { tray(); if (slow.on) { slowStop(); say({ t: "slow-stop" }); return; } slowStart(me.name, false); say({ t: "slow" }); },
    "mo-rose": openRose, "mo-lantern": openLantern,
    "mo-rainy": openRainy, "mo-aqua": openAquarium, "mo-fire": openFire, "mo-bubbles": openBubbles,
  };
  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) { const f = OPEN[button.dataset.tg]; if (f) return f(); prev.click?.(button); },
    onCouple(message, peer) {
      if (message.type !== "moment") return prev.msg?.(message, peer);
      const d = message.data || {}, by = peer?.name || partner();
      if (d.t === "kiss") kissCam(by, true);
      if (d.t === "slow") slowStart(by, true);
      if (d.t === "slow-stop") slowStop();
      if (d.t === "rose") bloom(String(d.k), String(d.note || "").slice(0, 80), by, true);
      if (d.t === "lantern") lantern(String(d.wish || "").slice(0, 90), by, true);
      if (d.t === "rainy") rainyStart(by, true);
      if (d.t === "rainy-stop") rainyStop();
    },
    onCoupleLeave(...a) { prev.leave?.(...a); slowStop(); },
  });
})();
