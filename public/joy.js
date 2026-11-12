// DU Meet · more fun in a call: Celebrate (effects on both screens), Photo booth and
// Secret note (a scratch card). Each opens as a small movable window.
// Uses globals from app.js (send, peers, me, toast, tileOf) and window.DU.win.

(() => {
  "use strict";
  const { q, esc } = window.DU.kit;
  const W = () => window.DU.win;
  const other = () => [...peers.values()][0];
  const tray = () => window.DU.kit.toggleTray(false);
  const needPartner = (what) => { if (other()) return true; toast(`${what} needs someone in the call`); return false; };
  let actx = null;
  const ac = () => { actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); return actx; };

  // =================================================================
  // Celebrate: full-screen effects that play on both phones
  // =================================================================

  const EFFECTS = [
    { k: "fireworks", e: "🎆", label: "Fireworks" },
    { k: "confetti", e: "🎊", label: "Confetti" },
    { k: "hearts", e: "💖", label: "Hearts" },
    { k: "balloons", e: "🎈", label: "Balloons" },
    { k: "love", e: "💌", label: "I love you" },
    { k: "petals", e: "🌸", label: "Petals" },
    { k: "snow", e: "❄️", label: "Snow" },
    { k: "stars", e: "✨", label: "Stars" },
    { k: "disco", e: "🪩", label: "Disco" },
    { k: "kisses", e: "😘", label: "Kisses" },
    { k: "party", e: "🥳", label: "Party" },
    { k: "sorry", e: "🥺", label: "Sorry" },
  ];
  function openCelebrate() {
    tray();
    const w = W().open({
      id: "celebrate", title: "Celebrate", icon: "celebration", w: 340, h: 360,
      html: `<p class="fw-note">Plays on both screens.</p><div class="fx-grid">${EFFECTS.map((x) => `<button data-eff="${x.k}"><span class="fx-emoji">${x.e}</span><small>${x.label}</small></button>`).join("")}</div>`,
    });
    w.body.onclick = (e) => {
      const b = e.target.closest("[data-eff]");
      if (!b) return;
      send("joy", { t: "fx", k: b.dataset.eff });
      play(b.dataset.eff);
    };
  }

  const emojiCache = new Map();
  function emojiImg(ch, size) {
    const key = `${ch}${size}`;
    if (emojiCache.has(key)) return emojiCache.get(key);
    const c = document.createElement("canvas");
    c.width = c.height = size * 1.3;
    const x = c.getContext("2d");
    x.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(ch, c.width / 2, c.height / 2 + size * .05);
    emojiCache.set(key, c);
    return c;
  }

  let fxRun = null;
  function play(kind) {
    if (kind === "disco") return disco();
    if (kind === "love" || kind === "sorry") banner(kind);
    fxRun?.stop();
    const cv = document.createElement("canvas");
    cv.className = "joy-fx";
    document.body.append(cv);
    const dpr = Math.min(2, devicePixelRatio || 1);
    const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
    size();
    const x = cv.getContext("2d");
    const Wd = () => cv.width, Hd = () => cv.height;
    const parts = [];
    const cols = ["#ff375f", "#ffd60a", "#30d158", "#0a84ff", "#bf5af2", "#ff9f0a", "#64d2ff"];
    const rnd = (a, b) => a + Math.random() * (b - a);
    const start = performance.now();
    const DUR = kind === "fireworks" ? 5200 : 4600;
    const emo = { hearts: ["❤️", "💖", "💕", "💗"], balloons: ["🎈", "🎈", "🎈", "💝"], petals: ["🌸", "🌺", "🌷"], stars: ["✨", "⭐", "🌟"], kisses: ["😘", "💋", "💋"], party: ["🥳", "🎉", "🎊", "🍾"], love: ["❤️", "💕", "💌"], sorry: ["🥺", "💐", "🙏"] }[kind];
    let spawnAcc = 0;
    function spawn(dt) {
      spawnAcc += dt;
      const rate = { confetti: 4, snow: 10, fireworks: 650, stars: 90 }[kind] || 110;
      while (spawnAcc > rate) {
        spawnAcc -= rate;
        if (kind === "confetti") parts.push({ x: rnd(0, Wd()), y: -20, vx: rnd(-1, 1) * dpr, vy: rnd(2, 5) * dpr, r: rnd(0, 6), vr: rnd(-.2, .2), c: cols[Math.floor(rnd(0, cols.length))], w: rnd(6, 12) * dpr, h: rnd(4, 8) * dpr });
        else if (kind === "snow") parts.push({ x: rnd(0, Wd()), y: -10, vx: rnd(-.4, .4) * dpr, vy: rnd(1, 2.6) * dpr, s: rnd(2, 5) * dpr, ph: rnd(0, 6) });
        else if (kind === "fireworks") {
          const cx = rnd(.15, .85) * Wd(), cy = rnd(.15, .5) * Hd(), c = cols[Math.floor(rnd(0, cols.length))];
          for (let i = 0; i < 70; i++) { const a = rnd(0, Math.PI * 2), v = rnd(1, 6) * dpr; parts.push({ fw: 1, x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c }); }
          boom();
        } else if (kind === "stars") parts.push({ em: emo[Math.floor(rnd(0, emo.length))], x: rnd(0, Wd()), y: rnd(0, Hd()), vx: 0, vy: 0, s: rnd(22, 46) * dpr, tw: 1, life: 1 });
        else {
          const rising = kind === "balloons" || kind === "hearts" || kind === "love";
          parts.push({ em: emo[Math.floor(rnd(0, emo.length))], x: rnd(0, Wd()), y: rising ? Hd() + 40 * dpr : -40 * dpr, vx: rnd(-.5, .5) * dpr, vy: (rising ? -rnd(2, 4.5) : rnd(1.5, 3.5)) * dpr, s: rnd(26, 54) * dpr, ph: rnd(0, 6), r: rnd(-.4, .4) });
        }
      }
    }
    let last = start, raf = 0, stopped = false;
    function frame(t) {
      if (stopped) return;
      const dt = Math.min(50, t - last); last = t;
      const age = t - start;
      if (age < DUR - 900) spawn(dt);
      x.clearRect(0, 0, Wd(), Hd());
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.fw) {
          p.vy += .06 * dpr; p.vx *= .985; p.vy *= .985; p.x += p.vx; p.y += p.vy; p.life -= .012;
          if (p.life <= 0) { parts.splice(i, 1); continue; }
          x.globalAlpha = Math.max(0, p.life); x.fillStyle = p.c;
          x.beginPath(); x.arc(p.x, p.y, 2.2 * dpr, 0, Math.PI * 2); x.fill();
          continue;
        }
        if (p.tw) {
          p.life -= .012;
          if (p.life <= 0) { parts.splice(i, 1); continue; }
          x.globalAlpha = Math.sin(p.life * Math.PI);
          const img = emojiImg(p.em, 48);
          x.drawImage(img, p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
          continue;
        }
        p.x += p.vx + (p.ph != null ? Math.sin(t / 500 + p.ph) * .6 * dpr : 0);
        p.y += p.vy;
        if (p.y > Hd() + 80 * dpr || p.y < -120 * dpr) { parts.splice(i, 1); continue; }
        x.globalAlpha = 1;
        if (p.em) {
          const img = emojiImg(p.em, 64);
          x.save(); x.translate(p.x, p.y); x.rotate((p.r || 0) + Math.sin(t / 700 + (p.ph || 0)) * .15);
          x.drawImage(img, -p.s / 2, -p.s / 2, p.s, p.s); x.restore();
        } else if (kind === "snow") {
          x.fillStyle = "rgba(255,255,255,.9)"; x.beginPath(); x.arc(p.x, p.y, p.s, 0, Math.PI * 2); x.fill();
        } else {
          p.r += p.vr; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(t / 200 + p.r))); x.restore();
        }
      }
      x.globalAlpha = 1;
      if (age > DUR) cv.style.opacity = "0";
      if (age > DUR + 600) return stop();
      raf = requestAnimationFrame(frame);
    }
    function stop() { stopped = true; cancelAnimationFrame(raf); cv.remove(); removeEventListener("resize", size); if (fxRun?.cv === cv) fxRun = null; }
    addEventListener("resize", size);
    raf = requestAnimationFrame(frame);
    fxRun = { stop, cv };
    chime(kind);
  }
  function banner(kind) {
    const el = document.createElement("div");
    el.className = `joy-banner ${kind}`;
    el.innerHTML = kind === "love" ? `<b>I love you</b><span>💗</span>` : `<b>I'm sorry</b><span>🥺💐</span>`;
    document.body.append(el);
    setTimeout(() => el.classList.add("out"), 3600);
    setTimeout(() => el.remove(), 4300);
  }
  let discoEl = null;
  function disco() {
    if (discoEl) return;
    discoEl = document.createElement("div");
    discoEl.className = "joy-disco";
    discoEl.innerHTML = `<span class="ball">🪩</span>`;
    document.body.append(discoEl);
    try {
      const c = ac(), t0 = c.currentTime + .05;
      for (let i = 0; i < 16; i++) {
        const t = t0 + i * .5;
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + .15);
        g.gain.setValueAtTime(.5, t); g.gain.exponentialRampToValueAtTime(.001, t + .2);
        o.connect(g).connect(c.destination); o.start(t); o.stop(t + .22);
        const bass = [110, 110, 146.8, 130.8][Math.floor(i / 4) % 4];
        const b = c.createOscillator(), bg = c.createGain(); b.type = "sawtooth"; b.frequency.value = bass;
        const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500;
        bg.gain.setValueAtTime(.06, t + .25); bg.gain.exponentialRampToValueAtTime(.001, t + .48);
        b.connect(lp).connect(bg).connect(c.destination); b.start(t + .25); b.stop(t + .5);
      }
    } catch { /* no audio */ }
    setTimeout(() => { discoEl?.classList.add("out"); }, 7600);
    setTimeout(() => { discoEl?.remove(); discoEl = null; }, 8200);
  }
  function boom() {
    try {
      const c = ac(), len = Math.floor(c.sampleRate * .6), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = b; f.type = "lowpass"; f.frequency.value = 900; g.gain.value = .35;
      s.connect(f).connect(g).connect(c.destination); s.start();
    } catch { /* no audio */ }
  }
  function chime(kind) {
    if (kind === "fireworks") return;
    try {
      const c = ac(), t = c.currentTime;
      const notes = kind === "sorry" ? [523, 466, 392] : [523, 659, 784, 1047];
      notes.forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain(); o.type = "triangle"; o.frequency.value = f;
        g.gain.setValueAtTime(0, t + i * .1); g.gain.linearRampToValueAtTime(.08, t + i * .1 + .01); g.gain.exponentialRampToValueAtTime(.001, t + i * .1 + .5);
        o.connect(g).connect(c.destination); o.start(t + i * .1); o.stop(t + i * .1 + .55);
      });
    } catch { /* no audio */ }
  }

  // =================================================================
  // Sound effects (used by the photo booth; a partner's "sfx" message still plays)
  // =================================================================

  const SFX = [
    { k: "drum", e: "🥁", label: "Drumroll" },
    { k: "rimshot", e: "😂", label: "Ba dum tss" },
    { k: "applause", e: "👏", label: "Applause" },
    { k: "airhorn", e: "📯", label: "Air horn" },
    { k: "sad", e: "😢", label: "Sad trombone" },
    { k: "crickets", e: "🦗", label: "Crickets" },
    { k: "wow", e: "😮", label: "Wow" },
    { k: "boing", e: "🤸", label: "Boing" },
    { k: "kiss", e: "😘", label: "Kiss" },
    { k: "buzzer", e: "❌", label: "Wrong" },
    { k: "ding", e: "✅", label: "Correct" },
    { k: "tada", e: "🎉", label: "Ta-da" },
    { k: "whistle", e: "😏", label: "Whistle" },
    { k: "slide", e: "🛝", label: "Slide" },
    { k: "suspense", e: "😱", label: "Suspense" },
    { k: "bell", e: "🔔", label: "Ding dong" },
  ];
  function sfx(k) {
    let c;
    try { c = ac(); } catch { return; }
    const t = c.currentTime;
    const out = c.createGain(); out.gain.value = .6; out.connect(c.destination);
    const tone = (f, at, dur, vol, type = "sine", f2) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t + at);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + at + dur);
      g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(vol, t + at + .01); g.gain.exponentialRampToValueAtTime(.001, t + at + dur);
      o.connect(g).connect(out); o.start(t + at); o.stop(t + at + dur + .05);
      return o;
    };
    const noise = (at, dur, vol, f, type = "bandpass", q = 1) => {
      const len = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
      s.buffer = b; fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.value = vol;
      s.connect(fl).connect(g).connect(out); s.start(t + at);
    };
    switch (k) {
      case "drum": for (let i = 0; i < 40; i++) noise(i * .045, .06, .35 + i * .01, 1800, "bandpass", .8); noise(1.85, .5, 1, 2500, "highpass"); tone(90, 1.85, .4, .5, "sine", 50); break;
      case "rimshot": noise(0, .12, .8, 900); tone(160, 0, .15, .4, "sine", 60); noise(.22, .12, .8, 1000); tone(160, .22, .15, .4, "sine", 60); noise(.5, .9, .5, 7000, "highpass"); break;
      case "applause": for (let i = 0; i < 90; i++) noise(Math.random() * 2.2, .03, .25 + Math.random() * .3, 1500 + Math.random() * 2500, "bandpass", 1.5); break;
      case "airhorn": [0, .32, .64].forEach((a, i) => { const d = i === 2 ? .9 : .25; tone(415, a, d, .18, "sawtooth"); tone(523, a, d, .14, "sawtooth"); tone(622, a, d, .1, "sawtooth"); }); break;
      case "sad": [[392, 0], [370, .45], [349, .9]].forEach(([f, a]) => tone(f, a, .45, .15, "sawtooth")); { const o = tone(330, 1.35, 1.4, .15, "sawtooth"); const v = c.createOscillator(), vg = c.createGain(); v.frequency.value = 6; vg.gain.value = 8; v.connect(vg).connect(o.frequency); v.start(t + 1.35); v.stop(t + 2.8); } break;
      case "crickets": for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) tone(4300, r * .6 + i * .06, .04, .05); break;
      case "wow": tone(300, 0, .9, .15, "triangle", 900); tone(310, 0, .9, .1, "sine", 920); break;
      case "boing": { const o = tone(120, 0, .7, .3, "sine", 420); const v = c.createOscillator(), vg = c.createGain(); v.frequency.value = 18; vg.gain.value = 60; v.connect(vg).connect(o.frequency); v.start(t); v.stop(t + .7); } break;
      case "kiss": noise(0, .07, .9, 2500, "bandpass", 4); tone(1800, .02, .08, .08, "sine", 3000); break;
      case "buzzer": tone(110, 0, .7, .2, "square"); tone(116, 0, .7, .15, "square"); break;
      case "ding": tone(1318, 0, .5, .15); tone(1760, .12, .8, .15); break;
      case "tada": [523, 659, 784].forEach((f, i) => tone(f, i * .08, .25, .12, "triangle")); [523, 659, 784, 1047].forEach((f) => tone(f, .32, 1.1, .09, "triangle")); break;
      case "whistle": tone(1200, 0, .25, .12, "sine", 2400); tone(2400, .35, .6, .12, "sine", 900); break;
      case "slide": tone(400, 0, .8, .15, "sine", 1600); tone(1600, .85, .6, .15, "sine", 300); break;
      case "suspense": [0, .3, .6, .9].forEach((a, i) => tone([196, 207.7, 196, 207.7][i], a, .28, .14, "sawtooth")); tone(98, 0, 2, .12, "sawtooth"); break;
      case "bell": tone(659, 0, 1, .2); tone(523, .5, 1.3, .2); break;
    }
    setTimeout(() => out.disconnect(), 4000);
  }

  // =================================================================
  // Photo booth: 3 photos of both of you, made into a strip
  // =================================================================

  let booth = null;
  function startBooth(fromThem) {
    tray();
    if (!needPartner("Photo booth")) return;
    if (booth) return;
    if (!fromThem) send("joy", { t: "booth" });
    booth = { shots: [] };
    const host = q(".main-area") || document.body;
    const cd = document.createElement("div");
    cd.className = "pb-count";
    host.append(cd);
    let shot = 0;
    const next = () => {
      if (shot >= 3) { cd.remove(); return finishBooth(); }
      let n = 3;
      const tick = () => {
        cd.innerHTML = `<b>${n}</b><small>Photo ${shot + 1} of 3 · smile!</small>`;
        cd.classList.remove("pop"); void cd.offsetWidth; cd.classList.add("pop");
        sfx("ding");
        if (--n >= 0 && n > -1) return setTimeout(n === 0 ? snap : tick, 900);
      };
      const snap = () => {
        cd.innerHTML = "";
        const flash = document.createElement("div"); flash.className = "pb-flash"; document.body.append(flash); setTimeout(() => flash.remove(), 500);
        shutter();
        booth.shots.push(grab());
        shot += 1;
        setTimeout(next, 900);
      };
      tick();
    };
    setTimeout(next, 400);
  }
  function shutter() { try { const c = ac(), len = 2400, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 300); const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(); } catch { /* no audio */ } }
  function grab() {
    const p = other();
    const srcOf = (id) => { const tile = tileOf(id); return tile?.querySelector("canvas.fx-preview") || tile?.querySelector("video"); };
    return [me.id, p?.id].map((id, i) => {
      const src = id && srcOf(id);
      const c = document.createElement("canvas"); c.width = 360; c.height = 360;
      const x = c.getContext("2d");
      x.fillStyle = "#2c2c2e"; x.fillRect(0, 0, 360, 360);
      const vw = src?.videoWidth || src?.width || 0, vh = src?.videoHeight || src?.height || 0;
      if (src && vw && vh && (src.tagName !== "VIDEO" || src.readyState >= 2)) {
        const s = Math.min(vw, vh), sx = (vw - s) / 2, sy = (vh - s) / 2;
        x.save();
        if (i === 0 && src.tagName === "VIDEO") { x.translate(360, 0); x.scale(-1, 1); } // our own view is mirrored
        try { x.drawImage(src, sx, sy, s, s, 0, 0, 360, 360); } catch { /* not ready */ }
        x.restore();
      } else {
        const name = i === 0 ? me.name : p?.name || "?";
        x.fillStyle = "#636366"; x.beginPath(); x.arc(180, 180, 80, 0, Math.PI * 2); x.fill();
        x.fillStyle = "#fff"; x.font = "700 72px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText((name[0] || "?").toUpperCase(), 180, 186);
      }
      return c;
    });
  }
  function finishBooth() {
    const pad = 24, cell = 360, gap = 14, foot = 84;
    const strip = document.createElement("canvas");
    strip.width = pad * 2 + cell * 2 + gap;
    strip.height = pad * 2 + cell * 3 + gap * 2 + foot;
    const x = strip.getContext("2d");
    const g = x.createLinearGradient(0, 0, strip.width, strip.height); g.addColorStop(0, "#fff5f8"); g.addColorStop(1, "#f0f4ff");
    x.fillStyle = g; x.fillRect(0, 0, strip.width, strip.height);
    booth.shots.forEach((pair, r) => pair.forEach((c, i) => {
      const px = pad + i * (cell + gap), py = pad + r * (cell + gap);
      x.save(); x.beginPath(); x.roundRect?.(px, py, cell, cell, 18) ?? x.rect(px, py, cell, cell); x.clip(); x.drawImage(c, px, py); x.restore();
    }));
    x.fillStyle = "#1d1d1f"; x.textAlign = "center";
    x.font = "700 30px system-ui, -apple-system, sans-serif";
    x.fillText(`${me.name} & ${other()?.name || ""} 💞`, strip.width / 2, strip.height - foot + 38);
    x.fillStyle = "#6e6e73"; x.font = "500 20px system-ui, -apple-system, sans-serif";
    x.fillText(new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }), strip.width / 2, strip.height - foot + 68);
    booth = null;
    strip.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const w = W().open({
        id: "booth", title: "Photo booth", icon: "photo_camera", w: 320, h: 560,
        html: `<img class="pb-img" src="${url}" alt="Your photo strip"><div class="pb-acts"><button class="btn ghost" data-pb="again"><span class="icon">replay</span>Again</button><button class="btn primary" data-pb="save"><span class="icon">download</span>Save</button></div>`,
        onClose: () => setTimeout(() => URL.revokeObjectURL(url), 1000),
      });
      w.body.onclick = async (e) => {
        const a = e.target.closest("[data-pb]")?.dataset.pb;
        if (a === "again") { w.close(); startBooth(false); }
        if (a === "save") {
          const file = new File([blob], `du-photo-booth-${Date.now()}.png`, { type: "image/png" });
          if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: "Our photo booth" }); return; } catch { /* cancelled */ } }
          const link = Object.assign(document.createElement("a"), { href: url, download: file.name });
          document.body.append(link); link.click(); link.remove();
        }
      };
    }, "image/png");
  }

  // =================================================================
  // Secret note: they scratch to read it
  // =================================================================

  function openSecret() {
    tray();
    if (!needPartner("Secret note")) return;
    const w = W().open({
      id: "secret", title: "Secret note", icon: "mail_lock", w: 320, h: 330,
      html: `<p class="fw-note">They get a scratch card and have to scratch it to read your note.</p>
        <textarea class="field sn-in" maxlength="200" rows="4" placeholder="Write something sweet…"></textarea>
        <button class="btn primary wide" data-sn><span class="icon">send</span>Send scratch card</button>`,
    });
    w.body.onclick = (e) => {
      if (!e.target.closest("[data-sn]")) return;
      const text = q(".sn-in", w.body).value.trim();
      if (!text) return toast("Write your note first");
      send("joy", { t: "secret", text });
      toast("Scratch card sent 💌");
      w.close();
    };
  }
  function gotSecret(text, peer) {
    const w = W().open({
      id: `scratch-${Date.now()}`, title: `Note from ${peer.name}`, icon: "redeem", w: 320, h: 300, tone: "rose",
      html: `<div class="sc"><p class="sc-text">${esc(text)}</p><canvas class="sc-cover fw-nodrag"></canvas></div><p class="fw-note center">Scratch with your finger</p>`,
    });
    const box = q(".sc", w.body), cv = q(".sc-cover", w.body);
    navigator.vibrate?.([30, 60, 30]);
    requestAnimationFrame(() => {
      const r = box.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = r.width * dpr; cv.height = r.height * dpr;
      const x = cv.getContext("2d");
      const g = x.createLinearGradient(0, 0, cv.width, cv.height); g.addColorStop(0, "#c7c7cc"); g.addColorStop(.5, "#f2f2f7"); g.addColorStop(1, "#aeaeb2");
      x.fillStyle = g; x.fillRect(0, 0, cv.width, cv.height);
      x.fillStyle = "#8e8e93"; x.font = `600 ${15 * dpr}px system-ui, sans-serif`; x.textAlign = "center";
      x.fillText("💌 Scratch here", cv.width / 2, cv.height / 2 + 5 * dpr);
      x.globalCompositeOperation = "destination-out";
      let down = false, done = false, n = 0;
      const scratch = (e) => {
        if (!down || done) return;
        const b = cv.getBoundingClientRect();
        x.beginPath(); x.arc((e.clientX - b.left) * dpr, (e.clientY - b.top) * dpr, 22 * dpr, 0, Math.PI * 2); x.fill();
        if (++n % 8) return;
        const data = x.getImageData(0, 0, cv.width, cv.height).data;
        let clear = 0; for (let i = 3; i < data.length; i += 64) if (data[i] === 0) clear++;
        if (clear / (data.length / 64) > .5) { done = true; cv.style.opacity = "0"; play("hearts"); send("joy", { t: "read" }); }
      };
      cv.addEventListener("pointerdown", (e) => { down = true; try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic */ } scratch(e); });
      cv.addEventListener("pointermove", scratch);
      cv.addEventListener("pointerup", () => { down = false; });
      cv.style.touchAction = "none";
    });
  }

  // ---------- hooks ----------

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const run = { celebrate: openCelebrate, booth: () => startBooth(false), secret: openSecret }[button.dataset.tg];
      if (run) run(); else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "joy") return prev.msg?.(message, peer);
      const d = message.data || {};
      if (d.t === "fx" && EFFECTS.some((x) => x.k === d.k)) play(d.k);
      if (d.t === "sfx" && SFX.some((x) => x.k === d.k)) sfx(d.k);
      if (d.t === "booth") { toast(`${peer.name} started the photo booth 📸`); startBooth(true); }
      if (d.t === "secret" && typeof d.text === "string") gotSecret(d.text.slice(0, 200), peer);
      if (d.t === "read") toast(`${peer.name} read your secret note 💌`);
    },
    onCoupleLeave(...args) { prev.leave?.(...args); ["celebrate", "secret", "booth"].forEach((id) => W().get(id)?.close()); },
  });
})();
