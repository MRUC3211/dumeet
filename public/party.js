// DU Meet · Party, Pranks, and more Fun: loud, silly things that happen on BOTH screens.
//   Party   Disco party (pick a beat, runs till you stop), Light show, Dance-off, Hype meter, Make it rain
//   Pranks  Cracked screen, Bug on the screen (squash it!), Earthquake, Flip, Boo
//   Fun     Soundboard, Shout (giant text), Magic 8-ball, Tickle
//   More    Coin & dice, Random picker, Scoreboard, Rate it
// Every sound is made in the browser (Web Audio), so nothing is downloaded.
// Messages: send("party", { t, ... }). Uses globals from app.js (send, peers, me, toast).

(() => {
  "use strict";
  const { q, esc, store, getDocs, putDoc } = window.DU.kit;
  const W = () => window.DU.win;
  const tray = () => window.DU.kit.toggleTray(false);
  const other = () => [...peers.values()][0];
  const inCall = () => typeof polling !== "undefined" && polling;
  const say = (d) => { if (inCall()) send("party", d); };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const needPartner = (what) => { if (other()) return true; toast(`${what} needs ${partner()} in the call`); return false; };
  const partner = () => other()?.name || "your partner";

  // =================================================================
  // sound: a tiny synth
  // =================================================================
  let actx = null;
  const ac = () => { actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); return actx; };
  let master = null;
  const out = () => { const c = ac(); if (!master) { master = c.createGain(); master.gain.value = 0.8; master.connect(c.destination); } return master; };
  function tone(f, t0, dur, vol = 0.1, type = "sine", f2) {
    try {
      const c = ac(), t = c.currentTime + t0, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out()); o.start(t); o.stop(t + dur + 0.02);
    } catch { /* no audio */ }
  }
  let noiseBuf = null;
  function noise(t0, dur, vol = 0.2, freq = 2000, type = "bandpass", q = 1) {
    try {
      const c = ac();
      if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      const t = c.currentTime + t0, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = noiseBuf; s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(g).connect(out()); s.start(t); s.stop(t + dur + 0.02);
    } catch { /* no audio */ }
  }
  const kick = (t) => { tone(150, t, 0.18, 0.5, "sine", 40); };
  const snare = (t) => { noise(t, 0.16, 0.25, 1800, "bandpass", 0.8); tone(190, t, 0.08, 0.08, "triangle"); };
  const hat = (t, v = 0.07) => noise(t, 0.04, v, 9000, "highpass", 0.5);
  const clap = (t) => { for (let i = 0; i < 3; i++) noise(t + i * 0.012, 0.09, 0.18, 1400, "bandpass", 1.2); };
  const dhol = (t, low) => { tone(low ? 90 : 220, t, low ? 0.3 : 0.12, low ? 0.45 : 0.25, "sine", low ? 55 : 160); noise(t, 0.05, 0.1, low ? 400 : 2500); };

  const SOUNDS = {
    horn: { e: "📯", label: "Air horn", play: () => { [0, 0.18, 0.36].forEach((d, i) => [466, 587, 698].forEach((f) => tone(f, d, i === 2 ? 0.7 : 0.15, 0.06, "sawtooth"))); } },
    drum: { e: "🥁", label: "Drum roll", play: () => { for (let i = 0; i < 34; i++) snare(i * 0.055); setTimeout(() => { tone(150, 0, 0.4, 0.5, "sine", 40); noise(0, 0.9, 0.25, 6000, "highpass"); }, 1900); } },
    rimshot: { e: "😆", label: "Ba-dum-tss", play: () => { tone(200, 0, 0.15, 0.3, "sine", 120); tone(140, 0.18, 0.18, 0.3, "sine", 90); noise(0.42, 0.7, 0.2, 7000, "highpass"); } },
    applause: { e: "👏", label: "Applause", play: () => { for (let i = 0; i < 90; i++) clap(rnd(0, 2.6)); } },
    crickets: { e: "🦗", label: "Crickets", play: () => { for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) tone(4200, i * 0.5 + j * 0.06, 0.04, 0.05, "sine"); } },
    sad: { e: "🎺", label: "Sad trombone", play: () => { [392, 370, 349].forEach((f, i) => tone(f, i * 0.45, 0.42, 0.08, "sawtooth", f * 0.97)); tone(330, 1.35, 1.1, 0.08, "sawtooth", 300); } },
    boing: { e: "🤸", label: "Boing", play: () => { tone(180, 0, 0.5, 0.25, "sine", 700); tone(700, 0.25, 0.4, 0.15, "sine", 260); } },
    wow: { e: "😮", label: "Wow", play: () => { tone(220, 0, 0.7, 0.12, "sawtooth", 520); tone(440, 0, 0.7, 0.05, "square", 1040); } },
    tada: { e: "🎉", label: "Ta-da!", play: () => { [523, 659, 784].forEach((f) => tone(f, 0, 0.15, 0.08, "triangle")); [523, 659, 784, 1047].forEach((f) => tone(f, 0.18, 0.9, 0.08, "triangle")); } },
    kiss: { e: "💋", label: "Mwah", play: () => { noise(0, 0.05, 0.4, 3000, "bandpass", 3); tone(900, 0.02, 0.15, 0.06, "sine", 1600); } },
    whistle: { e: "😙", label: "Whistle", play: () => { tone(1200, 0, 0.35, 0.08, "sine", 2400); tone(1500, 0.42, 0.5, 0.08, "sine", 900); } },
    laser: { e: "🔫", label: "Pew pew", play: () => { for (let i = 0; i < 3; i++) tone(1800, i * 0.18, 0.15, 0.08, "square", 200); } },
  };

  // =================================================================
  // particles: emoji rain, rising, bursts
  // =================================================================
  const emojiCache = new Map();
  function emojiImg(ch) {
    if (emojiCache.has(ch)) return emojiCache.get(ch);
    const c = document.createElement("canvas"); c.width = c.height = 72;
    const x = c.getContext("2d");
    x.font = `56px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(ch, 36, 40);
    emojiCache.set(ch, c); return c;
  }
  /** mode: "rain" | "rise" | "burst" (from x,y in 0..1) */
  function particles(set, { mode = "rain", n = 60, ms = 4200, x0 = 0.5, y0 = 0.5, size = [26, 54] } = {}) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) n = Math.min(n, 12);
    const cv = document.createElement("canvas");
    cv.className = "pt-canvas";
    document.body.append(cv);
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    const x = cv.getContext("2d"), Wd = cv.width, Hd = cv.height;
    const parts = [];
    const make = () => {
      const s = rnd(size[0], size[1]) * dpr, em = pick(set);
      if (mode === "burst") { const a = rnd(0, Math.PI * 2), v = rnd(4, 14) * dpr; return { em, s, x: x0 * Wd, y: y0 * Hd, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6 * dpr, g: 0.35 * dpr, r: 0, vr: rnd(-0.2, 0.2) }; }
      if (mode === "rise") return { em, s, x: rnd(0, Wd), y: Hd + s, vx: rnd(-0.6, 0.6) * dpr, vy: -rnd(2.5, 5.5) * dpr, g: 0, r: rnd(-0.3, 0.3), vr: rnd(-0.02, 0.02), ph: rnd(0, 6) };
      return { em, s, x: rnd(0, Wd), y: -s, vx: rnd(-0.8, 0.8) * dpr, vy: rnd(2.5, 6) * dpr, g: 0.04 * dpr, r: rnd(-0.5, 0.5), vr: rnd(-0.05, 0.05), ph: rnd(0, 6) };
    };
    if (mode === "burst") for (let i = 0; i < n; i++) parts.push(make());
    const start = performance.now();
    let last = start, acc = 0;
    const every = ms / n;
    function frame(t) {
      const dt = Math.min(50, t - last); last = t;
      if (mode !== "burst" && t - start < ms - 1200) { acc += dt; while (acc > every) { acc -= every; parts.push(make()); } }
      x.clearRect(0, 0, Wd, Hd);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.vy += p.g; p.x += p.vx + (p.ph !== undefined ? Math.sin((t / 500) + p.ph) * 0.6 * dpr : 0); p.y += p.vy; p.r += p.vr;
        if (p.y > Hd + 80 * dpr || p.y < -120 * dpr) { parts.splice(i, 1); continue; }
        x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.drawImage(emojiImg(p.em), -p.s / 2, -p.s / 2, p.s, p.s); x.restore();
      }
      if (t - start < ms + 3000 && (parts.length || t - start < ms)) requestAnimationFrame(frame); else cv.remove();
    }
    requestAnimationFrame(frame);
  }

  // a small full-screen layer that removes itself
  function layer(cls, html, ms, { click = true } = {}) {
    const el = document.createElement("div");
    el.className = `pt-layer ${cls}`;
    el.innerHTML = html;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add("in"));
    const close = () => { if (!el.isConnected) return; el.classList.remove("in"); el.classList.add("out"); setTimeout(() => el.remove(), 400); };
    if (click) el.addEventListener("click", close);
    if (ms) setTimeout(close, ms);
    return { el, close };
  }
  const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* none */ } };

  // a picker window made of big emoji buttons
  function pickerWin(id, title, icon, note, items, onPick, extra = "") {
    tray();
    const w = W().open({ id, title, icon, w: 360, h: 420,
      html: `<p class="fw-note">${note}</p><div class="fx-grid pt-grid">${items.map((x) => `<button data-pk="${x.k}"><span class="fx-emoji">${x.e}</span><small>${esc(x.label)}</small></button>`).join("")}</div>${extra}` });
    if (!w.body.dataset.wired) {
      w.body.dataset.wired = "1";
      w.body.addEventListener("click", (e) => { const b = e.target.closest("[data-pk]"); if (b) { b.classList.remove("hit"); void b.offsetWidth; b.classList.add("hit"); onPick(b.dataset.pk, w); } });
    }
    return w;
  }

  // =================================================================
  // PARTY
  // =================================================================

  // ---------- Disco party: a beat that keeps going till someone stops it ----------
  const BEATS = {
    disco: { e: "🪩", label: "Disco", bpm: 120, bass: [110, 110, 146.8, 130.8], step: (i, t) => { if (i % 4 === 0) kick(t); if (i % 4 === 2) hat(t, 0.1); if (i % 8 === 4) clap(t); } },
    edm: { e: "⚡", label: "EDM", bpm: 128, bass: [87.3, 87.3, 103.8, 116.5], step: (i, t) => { if (i % 4 === 0) kick(t); if (i % 2 === 1) hat(t, 0.06); if (i % 8 === 4) { snare(t); clap(t); } } },
    bhangra: { e: "🥁", label: "Bhangra", bpm: 110, bass: [98, 98, 130.8, 116.5], step: (i, t) => { if ([0, 3, 6].includes(i % 8)) dhol(t, true); if ([2, 4, 7].includes(i % 8)) dhol(t, false); if (i % 4 === 2) hat(t, 0.05); } },
    funk: { e: "🕺", label: "Funk", bpm: 104, bass: [82.4, 98, 110, 98], step: (i, t) => { if ([0, 3, 10].includes(i % 16)) kick(t); if (i % 8 === 4) snare(t); hat(t, i % 2 ? 0.03 : 0.07); } },
  };
  const party = { on: false, beat: "", timer: 0, step: 0, next: 0, el: null, by: "" };
  function partyStart(beat, by, remote) {
    const B = BEATS[beat] || BEATS.disco;
    partyStop(true);
    party.on = true; party.beat = beat; party.step = 0; party.by = by;
    const c = ac();
    party.next = c.currentTime + 0.08;
    const stepDur = 60 / B.bpm / 2; // eighth notes
    party.timer = setInterval(() => {
      while (party.next < c.currentTime + 0.15) {
        const t0 = party.next - c.currentTime, i = party.step;
        B.step(i, t0);
        if (i % 2 === 0) { const f = B.bass[Math.floor(i / 8) % 4]; tone(f, t0, stepDur * 0.9, 0.09, "sawtooth"); tone(f * 2, t0, stepDur * 0.5, 0.025, "square"); }
        if (i % 4 === 0) setTimeout(() => { party.el?.classList.toggle("beat"); document.body.classList.toggle("pt-bounce"); }, Math.max(0, t0 * 1000));
        party.next += stepDur; party.step += 1;
      }
    }, 40);
    party.el = document.createElement("div");
    party.el.className = `pt-disco pt-${beat}`;
    party.el.innerHTML = `<i class="pt-spot a"></i><i class="pt-spot b"></i><i class="pt-spot c"></i><span class="pt-ball">🪩</span>
      <div class="pt-dance" aria-hidden="true">${["💃", "🕺", "💃", "🕺"].map((d, i) => `<span style="--i:${i}">${d}</span>`).join("")}</div>
      <button class="pt-stop" type="button"><span class="icon" aria-hidden="true">stop_circle</span>Stop the party · ${esc(B.label)}</button>`;
    document.body.append(party.el);
    q(".pt-stop", party.el).onclick = () => { partyStop(); say({ t: "party-stop" }); };
    if (remote) toast(`🪩 ${by} started a ${B.label} party!`);
    // a party never runs forever by accident
    clearTimeout(party.auto); party.auto = setTimeout(() => { if (party.on) partyStop(); }, 10 * 60000);
  }
  function partyStop(silent) {
    if (!party.on) return;
    party.on = false;
    clearInterval(party.timer); clearTimeout(party.auto);
    document.body.classList.remove("pt-bounce");
    const el = party.el; party.el = null;
    if (el) { el.classList.add("out"); setTimeout(() => el.remove(), 500); }
    if (!silent) tone(523, 0, 0.3, 0.05, "triangle", 262);
  }
  function openParty() {
    pickerWin("pt-party", "Disco party", "nightlife", "Pick a beat. It plays on both screens until someone stops it.",
      Object.entries(BEATS).map(([k, b]) => ({ k, e: b.e, label: b.label })),
      (k) => { partyStart(k, me.name); say({ t: "party", beat: k }); });
  }

  // ---------- Light show ----------
  const LIGHTS = [
    { k: "rainbow", e: "🌈", label: "Rainbow" }, { k: "strobe", e: "⚡", label: "Strobe" }, { k: "lava", e: "🌋", label: "Lava lamp" },
    { k: "police", e: "🚨", label: "Siren" }, { k: "aurora", e: "🌌", label: "Aurora" }, { k: "love", e: "💗", label: "Pink glow" },
  ];
  let lightEl = null;
  function lights(k, by, remote) {
    lightEl?.remove(); lightEl = null;
    if (k === "off") return;
    lightEl = document.createElement("div");
    lightEl.className = `pt-lights pt-l-${k}`;
    lightEl.innerHTML = `<button class="pt-stop" type="button"><span class="icon" aria-hidden="true">lightbulb</span>Lights off</button>`;
    document.body.append(lightEl);
    q(".pt-stop", lightEl).onclick = () => { lights("off"); say({ t: "lights", k: "off" }); };
    if (remote) toast(`${by} turned on the ${LIGHTS.find((l) => l.k === k)?.label.toLowerCase()} lights`);
    const mine = lightEl;
    setTimeout(() => { if (lightEl === mine) lights("off"); }, 5 * 60000);
  }
  function openLights() {
    pickerWin("pt-lights", "Light show", "lightbulb", "Colours wash over both screens. Great with the Disco party.", LIGHTS,
      (k) => { lights(k, me.name); say({ t: "lights", k }); });
  }

  // ---------- Dance-off ----------
  const MOVES = ["The robot 🤖", "Hands in the air 🙌", "Bhangra shoulders 🥁", "The moonwalk 🌙", "Twerk… or try 🍑", "Disco point ☝️", "Slow-mo dance 🐢", "Air guitar 🎸",
    "The chicken dance 🐔", "Naagin dance 🐍", "Spin around 🌀", "Lungi dance 🕺", "Shoulder shimmy ✨", "Thumka 💃", "Dab! 😎", "Freeze like a statue 🗽", "Floss 🦷", "Heart hands & sway 🫶"];
  let dance = null;
  function danceStart(moves, by, remote) {
    danceStop();
    partyStart("disco", by, false);
    const el = document.createElement("div");
    el.className = "pt-danceoff";
    el.innerHTML = `<small>Dance-off · move <b class="n">1</b> of ${moves.length}</small><h2 class="mv"></h2><div class="pt-dbar"><i></i></div>`;
    document.body.append(el);
    dance = { el, moves, i: -1, timer: 0 };
    if (remote) toast(`${by} started a Dance-off! Cameras on 💃`);
    const step = () => {
      dance.i += 1;
      if (dance.i >= moves.length) return danceEnd();
      q(".n", el).textContent = dance.i + 1;
      const mv = q(".mv", el); mv.textContent = moves[dance.i]; mv.classList.remove("in"); void mv.offsetWidth; mv.classList.add("in");
      const bar = q(".pt-dbar i", el); bar.style.transition = "none"; bar.style.width = "100%"; void bar.offsetWidth; bar.style.transition = "width 8s linear"; bar.style.width = "0";
      SOUNDS.whistle.play();
      dance.timer = setTimeout(step, 8000);
    };
    step();
  }
  function danceEnd() {
    if (!dance) return;
    const el = dance.el;
    el.innerHTML = `<small>Dance-off is over!</small><h2>Who danced better?</h2><div class="pt-vote"><button data-v="${esc(me.name)}">${esc(me.name)}</button><button data-v="${esc(partner())}">${esc(partner())}</button></div>`;
    el.onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; say({ t: "dance-vote", v: b.dataset.v, by: me.name }); voted(b.dataset.v, me.name); };
    clearTimeout(dance.timer);
    dance.timer = setTimeout(danceStop, 30000);
  }
  function voted(v, by) {
    if (!dance) return;
    dance.votes ||= {};
    dance.votes[by] = v;
    const all = Object.values(dance.votes);
    if (all.length < 2) { if (by === me.name) q("h2", dance.el).textContent = "Vote sent! Waiting…"; return; }
    const win = all[0] === all[1] ? all[0] : "";
    q("h2", dance.el).innerHTML = win ? `👑 ${esc(win)} wins the Dance-off!` : "Split vote. You're both stars ⭐";
    q(".pt-vote", dance.el)?.remove();
    particles(["👑", "✨", "🎉", "💃", "🕺"], { mode: "burst", n: 50 });
    SOUNDS.tada.play();
    clearTimeout(dance.timer); dance.timer = setTimeout(danceStop, 5000);
  }
  function danceStop() { if (!dance) return; clearTimeout(dance.timer); dance.el.remove(); dance = null; partyStop(true); }
  function openDance() {
    tray();
    if (!needPartner("Dance-off")) return;
    const moves = [...MOVES].sort(() => Math.random() - 0.5).slice(0, 6);
    danceStart(moves, me.name); say({ t: "dance", moves });
  }

  // ---------- Hype meter: tap together to fill it ----------
  let hype = null;
  function hypeOpen(by, remote) {
    if (hype) return;
    const el = document.createElement("div");
    el.className = "pt-hype";
    el.innerHTML = `<div class="pt-hype-card"><b>HYPE METER</b><small>Tap like crazy, together! Fill it to 100%</small>
      <div class="pt-meter"><i></i><span>0%</span></div><button class="pt-tap" type="button">TAP! 🔥</button><button class="pt-x icon-btn" aria-label="Close"><span class="icon">close</span></button></div>`;
    document.body.append(el);
    hype = { el, v: 0, mine: 0, sent: 0, done: false };
    const tap = (e) => {
      e.preventDefault();
      if (hype.done) return;
      hype.mine += 1; add(1.4);
      const b = q(".pt-tap", el); b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
      tone(300 + hype.v * 6, 0, 0.06, 0.05, "square");
    };
    q(".pt-tap", el).addEventListener("pointerdown", tap);
    q(".pt-x", el).onclick = () => { hypeClose(); say({ t: "hype-x" }); };
    hype.flush = setInterval(() => { if (hype && hype.mine > hype.sent) { say({ t: "hype-tap", n: hype.mine - hype.sent }); hype.sent = hype.mine; } }, 150);
    hype.decay = setInterval(() => { if (hype && !hype.done) add(-0.6); }, 200);
    if (remote) toast(`${by} opened the Hype meter. Tap!`);
  }
  function add(d) {
    if (!hype || hype.done) return;
    hype.v = Math.max(0, Math.min(100, hype.v + d));
    q(".pt-meter i", hype.el).style.width = `${hype.v}%`;
    q(".pt-meter span", hype.el).textContent = `${Math.round(hype.v)}%`;
    hype.el.style.setProperty("--h", hype.v);
    if (hype.v >= 100) {
      hype.done = true;
      q(".pt-hype-card b", hype.el).textContent = "MAXIMUM HYPE! 🔥";
      SOUNDS.horn.play(); setTimeout(() => SOUNDS.applause.play(), 500);
      particles(["🔥", "🎉", "💥", "⚡", "🤩"], { mode: "burst", n: 80, y0: 0.6 });
      layer("pt-flash", "", 600, { click: false });
      buzz([100, 50, 100, 50, 300]);
      setTimeout(hypeClose, 3500);
    }
  }
  function hypeClose() { if (!hype) return; clearInterval(hype.flush); clearInterval(hype.decay); hype.el.remove(); hype = null; }
  function openHype() { tray(); if (!needPartner("The Hype meter")) return; hypeOpen(me.name); say({ t: "hype" }); }

  // ---------- Make it rain ----------
  const RAINS = [
    { k: "money", e: "💸", set: ["💸", "💵", "💰", "🪙"], label: "Money" }, { k: "pizza", e: "🍕", set: ["🍕", "🍕", "🧀"], label: "Pizza" },
    { k: "roses", e: "🌹", set: ["🌹", "🥀", "🌷"], label: "Roses" }, { k: "choco", e: "🍫", set: ["🍫", "🍬", "🍭"], label: "Sweets" },
    { k: "hearts", e: "💖", set: ["💖", "💗", "💕", "❤️"], label: "Hearts" }, { k: "food", e: "🍔", set: ["🍔", "🍟", "🌮", "🥟", "🍩"], label: "Junk food" },
    { k: "cats", e: "🐱", set: ["🐱", "😺", "😻", "🐈"], label: "Cats" }, { k: "pups", e: "🐶", set: ["🐶", "🐕", "🦴"], label: "Puppies" },
    { k: "gold", e: "🏆", set: ["🏆", "🥇", "⭐"], label: "Trophies" }, { k: "kiss", e: "💋", set: ["💋", "😘"], label: "Kisses" },
    { k: "poop", e: "💩", set: ["💩"], label: "Poop 😅" }, { k: "chai", e: "☕", set: ["☕", "🍪", "🥐"], label: "Chai time" },
  ];
  function rain(k, by, remote, custom) {
    const r = RAINS.find((x) => x.k === k);
    const set = custom ? [custom] : r?.set;
    if (!set) return;
    particles(set, { mode: "rain", n: 90, ms: 5000 });
    tone(880, 0, 0.12, 0.05, "triangle"); tone(1320, 0.1, 0.25, 0.05, "triangle");
    if (remote) toast(`${by} made it rain ${set[0]}`);
  }
  function openRain() {
    const w = pickerWin("pt-rain", "Make it rain", "water_drop", "Pick what falls from the sky on both screens.", RAINS,
      (k) => { rain(k, me.name); say({ t: "rain", k }); },
      `<form class="pt-own"><input class="field" maxlength="4" placeholder="Or any emoji" aria-label="Your own emoji"><button class="btn primary">Rain it</button></form>`);
    const f = q(".pt-own", w.body);
    if (f && !f.dataset.wired) {
      f.dataset.wired = "1";
      f.addEventListener("submit", (e) => {
        e.preventDefault();
        const v = [...new Intl.Segmenter().segment(f.elements[0].value.trim())][0]?.segment;
        if (!v) return;
        rain("", me.name, false, v); say({ t: "rain", custom: v });
      });
    }
  }

  // =================================================================
  // PRANKS
  // =================================================================
  const PRANKS = {
    crack: { e: "💥", label: "Cracked screen" }, bug: { e: "🪳", label: "Bug on screen" }, quake: { e: "🌋", label: "Earthquake" },
    flip: { e: "🙃", label: "Flip it" }, boo: { e: "👻", label: "Boo!" },
  };
  function crack() {
    const x = rnd(25, 75), y = rnd(25, 70);
    const lines = Array.from({ length: 14 }, () => {
      let px = x, py = y, d = `M${x} ${y}`;
      const a = rnd(0, Math.PI * 2), len = rnd(18, 60);
      for (let s = 0; s < 5; s++) { px += Math.cos(a + rnd(-0.5, 0.5)) * len / 5; py += Math.sin(a + rnd(-0.5, 0.5)) * len / 5; d += ` L${px.toFixed(1)} ${py.toFixed(1)}`; }
      return `<path d="${d}"/>`;
    }).join("");
    const rings = [6, 11].map((r) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("");
    layer("pt-crack", `<svg viewBox="0 0 100 100" preserveAspectRatio="none">${lines}${rings}</svg><small>Tap to fix your screen 😜</small>`, 7000);
    noise(0, 0.5, 0.6, 3500, "highpass"); for (let i = 0; i < 8; i++) tone(rnd(2000, 5000), rnd(0.05, 0.4), 0.08, 0.05, "triangle");
    buzz([60, 30, 120]);
  }
  function bug(by) {
    const el = layer("pt-bug", `<button type="button" aria-label="Squash the bug">🪳</button><small>Quick, squash it!</small>`, 15000, { click: false });
    const b = q("button", el.el);
    let x = rnd(10, 80), y = rnd(15, 75), a = rnd(0, 6.28), alive = true;
    const t0 = Date.now();
    const move = () => {
      if (!alive || !b.isConnected) return;
      a += rnd(-0.5, 0.5);
      x += Math.cos(a) * 1.2; y += Math.sin(a) * 1.2;
      if (x < 4 || x > 92) a = Math.PI - a; if (y < 8 || y > 88) a = -a;
      x = Math.max(3, Math.min(93, x)); y = Math.max(6, Math.min(90, y));
      b.style.left = `${x}%`; b.style.top = `${y}%`; b.style.transform = `rotate(${a + Math.PI / 2}rad)`;
      requestAnimationFrame(move);
    };
    move();
    const scuttle = setInterval(() => { if (alive) noise(0, 0.03, 0.05, 6000, "highpass"); }, 120);
    b.addEventListener("pointerdown", () => {
      alive = false; clearInterval(scuttle);
      b.textContent = "💥"; b.classList.add("dead");
      tone(120, 0, 0.2, 0.4, "sine", 50); noise(0, 0.15, 0.3, 800);
      const s = ((Date.now() - t0) / 1000).toFixed(1);
      q("small", el.el).textContent = `Squashed in ${s}s! 💪`;
      say({ t: "bug-dead", s });
      setTimeout(el.close, 1500);
    });
    setTimeout(() => { clearInterval(scuttle); if (alive) say({ t: "bug-dead", s: "" }); }, 15000);
  }
  function quake() {
    document.body.classList.add("pt-quake");
    for (let i = 0; i < 12; i++) tone(rnd(35, 60), i * 0.2, 0.3, 0.35, "sawtooth");
    noise(0, 2.4, 0.3, 120, "lowpass");
    buzz([200, 50, 200, 50, 400]);
    setTimeout(() => document.body.classList.remove("pt-quake"), 2600);
  }
  function flip() {
    const st = q(".stage");
    if (!st) return;
    st.classList.add("pt-flip");
    tone(400, 0, 0.4, 0.06, "sine", 1200);
    setTimeout(() => { st.classList.remove("pt-flip"); tone(1200, 0, 0.4, 0.06, "sine", 400); }, 6000);
  }
  function boo() {
    layer("pt-boo", `<span>👻</span><b>BOO!</b>`, 2200);
    noise(0, 0.6, 0.4, 500, "lowpass"); tone(90, 0, 0.8, 0.25, "sawtooth", 60); tone(880, 0.05, 0.5, 0.06, "square", 300);
    buzz([300]);
  }
  function prank(k, by) {
    ({ crack, bug: () => bug(by), quake, flip, boo })[k]?.();
    if (k !== "crack" && k !== "boo") toast(`😈 ${by} pranked you!`);
  }
  function openPranks(k) {
    tray();
    if (!needPartner("Pranks")) return;
    say({ t: "prank", k });
    toast(`${PRANKS[k].e} Prank sent to ${partner()} 😈`);
    tone(660, 0, 0.1, 0.05, "triangle"); tone(990, 0.08, 0.15, 0.05, "triangle");
  }

  // =================================================================
  // FUN
  // =================================================================
  function sound(k, by, remote) {
    const s = SOUNDS[k];
    if (!s) return;
    s.play();
    const pop = document.createElement("div");
    pop.className = "pt-sndpop";
    pop.innerHTML = `<span>${s.e}</span>${remote ? `<small>${esc(by)}</small>` : ""}`;
    document.body.append(pop);
    setTimeout(() => pop.remove(), 1600);
  }
  function openSoundboard() {
    pickerWin("pt-sounds", "Soundboard", "graphic_eq", "Both of you hear it. Perfect timing is everything.",
      Object.entries(SOUNDS).map(([k, s]) => ({ k, e: s.e, label: s.label })),
      (k) => { sound(k, me.name); say({ t: "sound", k }); });
  }

  // ---------- Shout: giant text across both screens ----------
  const STYLES = [{ k: "neon", label: "Neon" }, { k: "love", label: "Love" }, { k: "party", label: "Party" }, { k: "angry", label: "Angry" }, { k: "royal", label: "Royal" }];
  function shout(text, style, by, remote) {
    const t = String(text || "").slice(0, 60);
    if (!t) return;
    layer(`pt-shout pt-s-${STYLES.some((s) => s.k === style) ? style : "neon"}`, `<b>${esc(t)}</b>${remote ? `<small>— ${esc(by)}</small>` : ""}`, 4200);
    if (style === "angry") { quakeSoft(); tone(110, 0, 0.5, 0.2, "sawtooth", 70); }
    else if (style === "love") particles(["💗", "💖", "💕"], { mode: "rise", n: 30, ms: 3500 });
    else if (style === "party") particles(["🎉", "🎊", "✨"], { mode: "burst", n: 40, y0: 0.45 });
    else if (style === "royal") SOUNDS.tada.play();
    else tone(660, 0, 0.3, 0.05, "square", 990);
  }
  function quakeSoft() { document.body.classList.add("pt-quake"); setTimeout(() => document.body.classList.remove("pt-quake"), 900); }
  function openShout() {
    tray();
    const w = W().open({ id: "pt-shout", title: "Shout", icon: "campaign", w: 360, h: 300, autoH: true,
      html: `<form class="pt-shout-form"><input class="field" name="t" maxlength="60" placeholder="I LOVE YOU!!!" aria-label="What to shout" required>
        <div class="pt-chips" role="radiogroup" aria-label="Style">${STYLES.map((s, i) => `<label><input type="radio" name="s" value="${s.k}" ${i ? "" : "checked"}><span class="pt-s-${s.k}">${s.label}</span></label>`).join("")}</div>
        <button class="btn primary"><span class="icon">campaign</span>Shout it</button>
        <div class="pt-quick">${["I love you!", "Miss you 🥺", "You're the best", "SORRY 🙏", "Good night 🌙", "Hehehe 😂"].map((x) => `<button type="button" data-q="${esc(x)}">${esc(x)}</button>`).join("")}</div></form>` });
    const f = q("form", w.body);
    if (f.dataset.wired) return;
    f.dataset.wired = "1";
    f.addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) { f.elements.t.value = b.dataset.q; f.requestSubmit(); } });
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const t = f.elements.t.value.trim(), s = f.elements.s.value;
      if (!t) return;
      shout(t, s, me.name); say({ t: "shout", text: t, s });
      f.elements.t.value = "";
    });
  }

  // ---------- Magic 8-ball ----------
  const ANSWERS = ["Yes, definitely 💯", "Without a doubt", "Ask again after a kiss 😘", "Absolutely not 🙅", "My sources say no", "Signs point to yes ✨", "Hmm… maybe 🤔", "100%! Do it", "Better not tell you now 🤐",
    "Only if you say please 🥺", "The stars say yes 🌟", "Very doubtful", "Yes, but bring snacks 🍕", "Ask Diya", "Ask Uday", "It's a secret 🤫", "Obviously yes 🙄", "Not today, maybe tomorrow"];
  function eight(qText, ans, by, remote) {
    const w = W().get("pt-8ball") || open8(true);
    const ball = q(".pt-8", w.body), a = q(".pt-8a", w.body), qq = q(".pt-8q", w.body);
    qq.textContent = qText ? `${remote ? `${by} asked: ` : ""}“${qText}”` : "";
    ball.classList.remove("shake"); void ball.offsetWidth; ball.classList.add("shake");
    a.textContent = "…";
    for (let i = 0; i < 6; i++) noise(i * 0.1, 0.08, 0.12, 500, "lowpass");
    setTimeout(() => { a.textContent = ans; tone(880, 0, 0.4, 0.05, "sine"); }, 1100);
  }
  function open8(quiet) {
    if (!quiet) tray();
    const w = W().open({ id: "pt-8ball", title: "Magic 8-ball", icon: "help", w: 340, h: 470,
      html: `<div class="pt-8wrap"><div class="pt-8"><div class="pt-8w"><span class="pt-8a">Ask me anything</span></div></div><p class="pt-8q"></p>
        <form class="pt-inline pt-8f"><input class="field" name="q" maxlength="80" placeholder="Will we go on a date this week?" aria-label="Your question"><button class="btn primary">Shake</button></form></div>` });
    const f = q(".pt-8f", w.body);
    if (!f.dataset.wired) {
      f.dataset.wired = "1";
      f.addEventListener("submit", (e) => {
        e.preventDefault();
        const qt = f.elements.q.value.trim(), ans = pick(ANSWERS);
        eight(qt, ans, me.name); say({ t: "8ball", q: qt, a: ans });
        f.elements.q.value = "";
      });
    }
    return w;
  }

  // ---------- Tickle ----------
  function tickled(by) {
    document.body.classList.add("pt-tickle");
    const lol = layer("pt-tick", `<span>😂</span><b>${esc(by)} is tickling you!</b><button class="btn primary" type="button">Tickle back 🤭</button>`, 4000, { click: false });
    q("button", lol.el).onclick = () => { lol.close(); say({ t: "tickle" }); toast(`Tickled ${by} back 😂`); };
    for (let i = 0; i < 10; i++) tone(rnd(500, 900), i * 0.13, 0.1, 0.06, "triangle", rnd(700, 1200));
    buzz([40, 40, 40, 40, 40, 40, 40]);
    setTimeout(() => document.body.classList.remove("pt-tickle"), 1800);
  }

  // =================================================================
  // MORE: Coin & dice, Random picker, Scoreboard, Rate it
  // =================================================================
  function toss(kind, result, by, remote) {
    const w = W().get("pt-toss") || openToss(true);
    const stage = q(".pt-toss-stage", w.body);
    if (kind === "coin") {
      stage.innerHTML = `<div class="pt-coin ${result === "Heads" ? "h" : "t"}"><i class="f">👑</i><i class="b">🦁</i></div><b class="pt-res"></b>`;
      for (let i = 0; i < 8; i++) tone(2400, i * 0.12, 0.03, 0.04, "triangle");
    } else {
      stage.innerHTML = `<div class="pt-dice">${result.map((n) => `<span class="pt-die" data-n="${n}">${"⚀⚁⚂⚃⚄⚅"[n - 1]}</span>`).join("")}</div><b class="pt-res"></b>`;
      for (let i = 0; i < 6; i++) noise(i * 0.09, 0.05, 0.2, 1200);
    }
    setTimeout(() => { const r = q(".pt-res", stage); if (r) r.textContent = kind === "coin" ? `${result}!` : `${result.join(" + ")}${result.length > 1 ? ` = ${result.reduce((a, b) => a + b, 0)}` : ""}`; tone(784, 0, 0.3, 0.06, "triangle"); }, 1200);
    q(".pt-who", w.body).textContent = remote ? `${by} tossed` : "";
  }
  function openToss(quiet) {
    if (!quiet) tray();
    const w = W().open({ id: "pt-toss", title: "Coin & dice", icon: "casino", w: 340, h: 400,
      html: `<div class="pt-toss"><div class="pt-toss-stage"><span class="pt-hint">Flip a coin or roll the dice.<br>You both see the same result.</span></div><small class="pt-who"></small>
        <div class="pt-row"><button class="btn primary" data-tz="coin"><span class="icon">toll</span>Flip coin</button><button class="btn ghost" data-tz="d1">🎲 1 die</button><button class="btn ghost" data-tz="d2">🎲🎲 2 dice</button></div></div>` });
    if (!w.body.dataset.wired) {
      w.body.dataset.wired = "1";
      w.body.addEventListener("click", (e) => {
        const k = e.target.closest("[data-tz]")?.dataset.tz;
        if (!k) return;
        const kind = k === "coin" ? "coin" : "dice";
        const result = k === "coin" ? pick(["Heads", "Tails"]) : Array.from({ length: k === "d2" ? 2 : 1 }, () => 1 + Math.floor(Math.random() * 6));
        toss(kind, result, me.name); say({ t: "toss", kind, result });
      });
    }
    return w;
  }

  // Random picker: a slot machine over a list
  const PICK_PRESETS = {
    who: { label: "Who…", items: () => ["Uday", "Diya"] },
    food: { label: "What to eat", items: () => ["Pizza 🍕", "Biryani 🍛", "Momos 🥟", "Burger 🍔", "Dosa", "Chinese 🥡", "Maggi 🍜", "Paneer 🧀", "Rolls 🌯", "Salad 🥗"] },
    movie: { label: "Movie genre", items: () => ["Romance 💕", "Comedy 😂", "Horror 👻", "Thriller 🔪", "Action 💥", "Animated 🧸", "Bollywood 💃", "K-drama 🇰🇷"] },
    date: { label: "Date idea", items: () => ["Cook the same dish on call 🍳", "Watch a movie together 🎬", "Play 3 games 🎮", "Stargazing 🌌", "Deep talks 💬", "Draw each other 🎨", "Karaoke night 🎤", "Plan a dream trip ✈️"] },
  };
  function picked(items, i, label, by, remote) {
    const w = W().get("pt-pick") || openPicker(true);
    const reel = q(".pt-reel", w.body);
    const seq = [...Array(18)].map((_, k) => items[(i + k + 1) % items.length]).concat(items[i]);
    reel.innerHTML = `<div class="pt-reel-in">${seq.map((t) => `<span>${esc(t)}</span>`).join("")}</div>`;
    const inner = q(".pt-reel-in", reel);
    requestAnimationFrame(() => { inner.style.transform = `translateY(-${(seq.length - 1) * 56}px)`; });
    for (let k = 0; k < 14; k++) tone(1200, k * (0.05 + k * 0.012), 0.03, 0.04, "square");
    setTimeout(() => { reel.classList.add("won"); SOUNDS.tada.play(); }, 2300);
    reel.classList.remove("won");
    q(".pt-who", w.body).textContent = `${label}${remote ? ` · picked by ${by}` : ""}`;
  }
  function openPicker(quiet) {
    if (!quiet) tray();
    const w = W().open({ id: "pt-pick", title: "Random picker", icon: "shuffle", w: 360, h: 470,
      html: `<div class="pt-picker"><div class="pt-reel"><div class="pt-reel-in"><span>Let fate decide 🎰</span></div></div><small class="pt-who"></small>
        <div class="pt-chips2">${Object.entries(PICK_PRESETS).map(([k, p]) => `<button data-pp="${k}">${p.label}</button>`).join("")}</div>
        <form class="pt-pick-own"><input class="field" name="l" maxlength="200" placeholder="Your own: tea, coffee, juice" aria-label="Your own list, comma separated"><button class="btn primary">Pick</button></form></div>` });
    if (!w.body.dataset.wired) {
      w.body.dataset.wired = "1";
      const go = (items, label) => {
        items = items.map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
        if (items.length < 2) return toast("Give at least two choices, separated by commas");
        const i = Math.floor(Math.random() * items.length);
        picked(items, i, label, me.name); say({ t: "pick", items, i, label });
      };
      w.body.addEventListener("click", (e) => { const k = e.target.closest("[data-pp]")?.dataset.pp; if (k) go(PICK_PRESETS[k].items(), PICK_PRESETS[k].label); });
      q(".pt-pick-own", w.body).addEventListener("submit", (e) => { e.preventDefault(); go(e.target.elements.l.value.split(","), "Your list"); });
    }
    return w;
  }

  // Scoreboard: a running tally for anything (who wins arguments, who said sorry first…)
  let board = store.get("du-score", { items: [{ id: "main", label: "Who won today", s: { Uday: 0, Diya: 0 } }], u: 0 });
  function saveBoard(sync = true) {
    board.u = Date.now();
    store.set("du-score", board);
    if (sync) { say({ t: "score", board }); putDoc("settings", board, "scoreboard").catch(() => {}); }
    paintBoard();
  }
  function paintBoard() {
    const w = W()?.get("pt-score");
    if (!w) return;
    q(".pt-sb-list", w.body).innerHTML = board.items.map((it) => {
      const [a, b] = ["Uday", "Diya"].map((n) => it.s[n] || 0);
      return `<li data-sid="${esc(it.id)}"><div class="pt-sb-head"><b>${esc(it.label)}</b>${it.id === "main" ? "" : `<button class="icon-btn" data-sb="del" aria-label="Delete"><span class="icon">delete</span></button>`}</div>
        <div class="pt-sb-row">${["Uday", "Diya"].map((n, i) => `<div class="pt-sb-p ${i ? "d" : "u"}${(i ? b > a : a > b) ? " lead" : ""}"><small>${n}${(i ? b > a : a > b) ? " 👑" : ""}</small><b>${i ? b : a}</b>
          <span><button class="icon-btn" data-sb="-" data-n="${n}" aria-label="${n} minus one"><span class="icon">remove</span></button><button class="icon-btn" data-sb="+" data-n="${n}" aria-label="${n} plus one"><span class="icon">add</span></button></span></div>`).join("")}</div></li>`;
    }).join("");
  }
  function openScore() {
    tray();
    const w = W().open({ id: "pt-score", title: "Scoreboard", icon: "scoreboard", w: 360, h: 520,
      html: `<p class="fw-note">Keep score of anything: who won the argument, who said sorry first, who fell asleep on call…</p><ul class="pt-sb-list"></ul>
        <form class="pt-pick-own pt-sb-new"><input class="field" name="l" maxlength="40" placeholder="New: Who fell asleep first 😴" aria-label="New scoreboard"><button class="btn primary">Add</button></form>` });
    if (!w.body.dataset.wired) {
      w.body.dataset.wired = "1";
      w.body.addEventListener("click", (e) => {
        const b = e.target.closest("[data-sb]");
        if (!b) return;
        const it = board.items.find((x) => x.id === b.closest("[data-sid]").dataset.sid);
        if (!it) return;
        if (b.dataset.sb === "del") board.items = board.items.filter((x) => x !== it);
        else { const n = b.dataset.n; it.s[n] = Math.max(0, (it.s[n] || 0) + (b.dataset.sb === "+" ? 1 : -1)); if (b.dataset.sb === "+") { tone(880, 0, 0.12, 0.06, "triangle"); tone(1320, 0.08, 0.15, 0.05, "triangle"); } }
        saveBoard();
      });
      q(".pt-sb-new", w.body).addEventListener("submit", (e) => {
        e.preventDefault();
        const l = e.target.elements.l.value.trim();
        if (!l) return;
        board.items.push({ id: Date.now().toString(36), label: l.slice(0, 40), s: { Uday: 0, Diya: 0 } });
        e.target.elements.l.value = "";
        saveBoard();
      });
      getDocs("settings").then((docs) => { const d = docs.find((x) => x.id === "scoreboard")?.data; if (d?.items && (d.u || 0) > (board.u || 0)) { board = d; store.set("du-score", board); paintBoard(); } }).catch(() => {});
    }
    paintBoard();
  }

  // Rate it: both give a secret 1–10, then reveal
  let rate = null;
  function rateOpen(topic, by, remote) {
    tray();
    const w = W().get("pt-rate") || W().open({ id: "pt-rate", title: "Rate it", icon: "star_rate", w: 360, h: 470, onClose: () => { rate = null; },
      html: `<div class="pt-rate"><p class="pt-rate-t"></p><div class="pt-nums">${[...Array(10)].map((_, i) => `<button data-r="${i + 1}">${i + 1}</button>`).join("")}</div><p class="pt-rate-msg" aria-live="polite"></p><div class="pt-rate-res"></div>
        <form class="pt-pick-own pt-rate-new"><input class="field" name="t" maxlength="60" placeholder="Rate my outfit 👗" aria-label="What to rate"><button class="btn primary">Ask</button></form>
        <div class="pt-chips2">${["My outfit today 👗", "My cooking 🍳", "Today's call 📞", "My singing 🎤", "My hairstyle 💇", "Your mood today"].map((x) => `<button data-rt="${esc(x)}">${esc(x)}</button>`).join("")}</div></div>` });
    rate = { topic, mine: 0, theirs: 0 };
    q(".pt-rate-t", w.body).textContent = topic ? `${remote ? `${by} asks: ` : ""}Rate “${topic}”` : "What should you both rate?";
    q(".pt-nums", w.body).hidden = !topic;
    q(".pt-rate-msg", w.body).textContent = topic ? "Pick in secret, 1 to 10" : "";
    q(".pt-rate-res", w.body).innerHTML = "";
    w.body.querySelectorAll("[data-r]").forEach((b) => { b.classList.remove("on"); b.disabled = false; });
    if (!w.body.dataset.wired) {
      w.body.dataset.wired = "1";
      w.body.addEventListener("click", (e) => {
        const t = e.target.closest("[data-rt]")?.dataset.rt;
        if (t) { rateOpen(t, me.name); say({ t: "rate", topic: t }); return; }
        const r = Number(e.target.closest("[data-r]")?.dataset.r);
        if (!r || !rate || rate.mine) return;
        rate.mine = r;
        e.target.closest("[data-r]").classList.add("on");
        w.body.querySelectorAll("[data-r]").forEach((b) => { b.disabled = true; });
        say({ t: "rate-pick", r });
        rateCheck();
      });
      q(".pt-rate-new", w.body).addEventListener("submit", (e) => { e.preventDefault(); const t = e.target.elements.t.value.trim(); if (!t) return; e.target.elements.t.value = ""; rateOpen(t, me.name); say({ t: "rate", topic: t }); });
    }
    return w;
  }
  function rateCheck() {
    const w = W()?.get("pt-rate");
    if (!w || !rate) return;
    const msg = q(".pt-rate-msg", w.body);
    if (!rate.mine || !rate.theirs) { msg.textContent = rate.mine ? `Locked in. Waiting for ${partner()}…` : `${partner()} has rated. Your turn!`; return; }
    msg.textContent = "";
    const diff = Math.abs(rate.mine - rate.theirs);
    q(".pt-rate-res", w.body).innerHTML = `<div class="pt-rate-cards"><div><small>You</small><b>${rate.mine}</b></div><div><small>${esc(partner())}</small><b>${rate.theirs}</b></div></div>
      <p>${diff === 0 ? "Same score! Great minds 🤝" : diff <= 2 ? "Pretty close 😄" : "Whoa, that's a debate 😂"}</p>`;
    if (diff === 0) particles(["⭐", "✨", "🤝"], { mode: "burst", n: 30 });
    SOUNDS.tada.play();
  }

  // =================================================================
  // messages and tray buttons
  // =================================================================
  const OPEN = {
    "pt-party": openParty, "pt-lights": openLights, "pt-dance": openDance, "pt-hype": openHype, "pt-rain": openRain,
    "pt-sounds": openSoundboard, "pt-shout": openShout, "pt-8ball": () => open8(), "pt-tickle": () => { tray(); if (needPartner("Tickle")) { say({ t: "tickle" }); toast(`Tickling ${partner()} 🤭`); } },
    "pt-toss": () => openToss(), "pt-pick": () => openPicker(), "pt-score": openScore, "pt-rate": () => rateOpen("", me.name),
  };
  for (const k of Object.keys(PRANKS)) OPEN[`pk-${k}`] = () => openPranks(k);

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const f = OPEN[button.dataset.tg];
      if (f) return f();
      prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "party") return prev.msg?.(message, peer);
      const d = message.data || {}, by = peer?.name || partner();
      switch (d.t) {
        case "party": return partyStart(String(d.beat), by, true);
        case "party-stop": return partyStop();
        case "lights": return lights(String(d.k), by, true);
        case "dance": return Array.isArray(d.moves) && danceStart(d.moves.map(String).slice(0, 10), by, true);
        case "dance-vote": return voted(String(d.v), String(d.by || by));
        case "hype": return hypeOpen(by, true);
        case "hype-tap": return add(Math.min(40, Number(d.n) || 0) * 1.4);
        case "hype-x": return hypeClose();
        case "rain": return rain(String(d.k || ""), by, true, d.custom ? String(d.custom).slice(0, 8) : "");
        case "prank": return PRANKS[d.k] && prank(d.k, by);
        case "bug-dead": return toast(d.s ? `${by} squashed your bug in ${d.s}s 🪳💥` : `${by} couldn't catch the bug 😂`);
        case "sound": return sound(String(d.k), by, true);
        case "shout": return shout(d.text, String(d.s), by, true);
        case "8ball": return eight(String(d.q || "").slice(0, 80), String(d.a || "").slice(0, 60), by, true);
        case "tickle": return tickled(by);
        case "toss": return toss(d.kind === "coin" ? "coin" : "dice", d.kind === "coin" ? String(d.result) : (d.result || []).map(Number).slice(0, 2), by, true);
        case "pick": return Array.isArray(d.items) && picked(d.items.map(String).slice(0, 20), Number(d.i) || 0, String(d.label || ""), by, true);
        case "score": if (d.board?.items && (d.board.u || 0) >= (board.u || 0)) { board = d.board; store.set("du-score", board); paintBoard(); } return;
        case "rate": return rateOpen(String(d.topic || "").slice(0, 60), by, true);
        case "rate-pick": if (rate) { rate.theirs = Number(d.r) || 0; rateCheck(); } return;
      }
    },
    onCoupleLeave(...a) { prev.leave?.(...a); partyStop(true); lights("off"); hypeClose(); danceStop(); },
  });

  // Hey Lord can start these
  window.DU.saathiTools?.push({
    name: "party_fun",
    description: "Fun effects on both screens: start or stop a disco party (beat: disco, edm, bhangra, funk), light show (rainbow, strobe, lava, police, aurora, love), make it rain (money, pizza, roses, choco, hearts, food, cats, pups, gold, kiss, poop, chai), play a sound (horn, drum, rimshot, applause, crickets, sad, boing, wow, tada, kiss, whistle, laser), shout big text, flip a coin, roll dice, or prank the partner (crack, bug, quake, flip, boo).",
    parameters: { type: "OBJECT", properties: {
      action: { type: "STRING", enum: ["party", "stop_party", "lights", "rain", "sound", "shout", "coin", "dice", "prank"] },
      kind: { type: "STRING", description: "The beat / light / rain / sound / prank name" },
      text: { type: "STRING", description: "For shout" },
    }, required: ["action"] },
    run: (a) => {
      const k = String(a.kind || "");
      if (a.action === "party") { const b = BEATS[k] ? k : "disco"; partyStart(b, me.name); say({ t: "party", beat: b }); return { started: b }; }
      if (a.action === "stop_party") { partyStop(); say({ t: "party-stop" }); lights("off"); say({ t: "lights", k: "off" }); return { stopped: true }; }
      if (a.action === "lights") { const l = LIGHTS.some((x) => x.k === k) ? k : "rainbow"; lights(l, me.name); say({ t: "lights", k: l }); return { lights: l }; }
      if (a.action === "rain") { const r = RAINS.some((x) => x.k === k) ? k : "hearts"; rain(r, me.name); say({ t: "rain", k: r }); return { rained: r }; }
      if (a.action === "sound") { if (!SOUNDS[k]) return { error: "Unknown sound" }; sound(k, me.name); say({ t: "sound", k }); return { played: k }; }
      if (a.action === "shout") { shout(a.text, "neon", me.name); say({ t: "shout", text: String(a.text || ""), s: "neon" }); return { shouted: a.text }; }
      if (a.action === "coin") { const r = pick(["Heads", "Tails"]); toss("coin", r, me.name); say({ t: "toss", kind: "coin", result: r }); return { result: r }; }
      if (a.action === "dice") { const r = [1 + Math.floor(Math.random() * 6)]; toss("dice", r, me.name); say({ t: "toss", kind: "dice", result: r }); return { result: r[0] }; }
      if (a.action === "prank") { if (!PRANKS[k]) return { error: "crack, bug, quake, flip or boo" }; if (!other()) return { error: "The partner isn't in the call" }; say({ t: "prank", k }); return { pranked: k }; }
      return { error: "Unknown action" };
    },
  });

  // a lone tile in the tray's last row (3 columns) stretches across, so no category looks unfinished
  for (const view of document.querySelectorAll("#tg-tray .tray-view")) {
    const tiles = [...view.children].filter((b) => b.matches("button[role=menuitem]:not(.span-all)"));
    if (tiles.length % 3 === 1) tiles.at(-1).classList.add("span-all", "pt-wide");
  }

  window.DU.party = { particles, tone, noise, sound: (k) => SOUNDS[k]?.play(), layer, burst: (set, n = 18) => particles(set, { mode: "burst", n, y0: 0.55 }), partyStart, partyStop };
})();
