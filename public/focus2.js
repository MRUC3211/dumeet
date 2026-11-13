// DU Meet · more Productivity.
//   Water reminder  rings on both phones every so often; each of you counts glasses
//   Focus lock-in   study together; if one of you leaves the app, the other is told
//   Flashcards      make cards, study them, or quiz each other (the flip shows on both)
//   Lo-fi music     a soft, endless study beat made in the browser

(() => {
  "use strict";
  const { q, esc, store, getDocs, putDoc, dayKey } = window.DU.kit;
  const W = () => window.DU.win;
  const P = () => window.DU.party;
  const tray = () => window.DU.kit.toggleTray(false);
  const other = () => [...peers.values()][0];
  const partner = () => other()?.name || "your partner";
  const inCall = () => typeof polling !== "undefined" && polling;
  const say = (d) => { if (inCall()) send("focus2", d); };
  const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  // =================================================================
  // Water reminder
  // =================================================================
  const water = { every: store.get("du-water-every", 45), timer: 0, next: 0, tick: 0, glasses: store.get("du-water", { day: "", n: 0 }), theirs: 0 };
  const myGlasses = () => (water.glasses.day === dayKey() ? water.glasses.n : 0);
  function waterRing() {
    [880, 1175, 1568].forEach((f, i) => P()?.tone(f, i * 0.15, 0.4, 0.06, "sine"));
    P()?.particles(["💧", "💦", "🥤"], { mode: "rain", n: 25, ms: 2500, size: [20, 36] });
    toast("💧 Water break! Both of you, drink a glass");
    try { navigator.vibrate?.([80, 60, 80]); } catch { /* none */ }
    waterSchedule();
  }
  function waterSchedule() {
    clearTimeout(water.timer);
    if (!water.every) { water.next = 0; return paintWater(); }
    water.next = Date.now() + water.every * 60000;
    water.timer = setTimeout(waterRing, water.every * 60000);
    paintWater();
  }
  function paintWater() {
    const w = W()?.get("f2-water");
    if (!w) return;
    q(".f2-wn.me b", w.body).textContent = myGlasses();
    q(".f2-wn.them b", w.body).textContent = water.theirs;
    q(".f2-wn.them small", w.body).textContent = partner();
    q(".f2-wnext", w.body).textContent = water.next ? `Next reminder in ${clock(water.next - Date.now())}` : "Reminders are off";
    w.body.querySelectorAll("[data-ev]").forEach((b) => b.classList.toggle("on", Number(b.dataset.ev) === water.every));
    const pct = Math.min(100, (myGlasses() / 8) * 100);
    q(".f2-glass i", w.body).style.height = `${pct}%`;
  }
  function openWater() {
    tray();
    const w = W().open({ id: "f2-water", title: "Water reminder", icon: "water_drop", w: 340, h: 460, onClose: () => clearInterval(water.tick),
      html: `<div class="f2-water"><div class="f2-glass"><i></i><span>💧</span></div>
        <div class="f2-wrow"><div class="f2-wn me"><small>You</small><b>0</b><span>of 8 glasses</span></div><div class="f2-wn them"><small></small><b>0</b><span>glasses today</span></div></div>
        <button class="btn primary" data-wa="drink"><span class="icon">local_drink</span>I drank a glass</button>
        <p class="fw-note center">Remind both of us every</p><div class="pt-chips2">${[0, 30, 45, 60, 90].map((m) => `<button data-ev="${m}">${m ? `${m} min` : "Off"}</button>`).join("")}</div><small class="f2-wnext"></small></div>` });
    if (!w.body.dataset.wired) {
      w.body.dataset.wired = "1";
      w.body.addEventListener("click", (e) => {
        if (e.target.closest("[data-wa=drink]")) {
          water.glasses = { day: dayKey(), n: myGlasses() + 1 };
          store.set("du-water", water.glasses);
          say({ t: "glass", n: water.glasses.n });
          P()?.tone(500, 0, 0.15, 0.08, "sine", 900);
          if (water.glasses.n === 8) { P()?.particles(["💧", "🏆", "✨"], { mode: "burst", n: 30 }); toast("8 glasses! Hydration champion 🏆"); }
          paintWater();
        }
        const ev = e.target.closest("[data-ev]");
        if (ev) { water.every = Number(ev.dataset.ev); store.set("du-water-every", water.every); say({ t: "water-every", m: water.every }); waterSchedule(); toast(water.every ? `Reminding you both every ${water.every} minutes` : "Water reminders off"); }
      });
    }
    clearInterval(water.tick); water.tick = setInterval(paintWater, 1000);
    say({ t: "glass-ask" });
    paintWater();
  }
  if (water.every) setTimeout(waterSchedule, 3000);

  // =================================================================
  // Focus lock-in
  // =================================================================
  const lock = { on: false, end: 0, mins: 25, escapes: { me: 0, them: 0 }, tick: 0 };
  function lockStart(mins, by, remote) {
    lock.on = true; lock.mins = mins; lock.end = Date.now() + mins * 60000; lock.escapes = { me: 0, them: 0 };
    const w = openLock(true);
    clearInterval(lock.tick); lock.tick = setInterval(lockPaint, 1000);
    lockPaint();
    if (remote) toast(`🔒 ${by} started a ${mins}-minute focus lock-in. Stay in the app!`);
    P()?.tone(392, 0, 0.3, 0.06, "triangle"); P()?.tone(523, 0.2, 0.5, 0.06, "triangle");
    return w;
  }
  function lockEnd(done) {
    if (!lock.on) return;
    lock.on = false; clearInterval(lock.tick);
    const w = W()?.get("f2-lock");
    if (done) {
      [523, 659, 784, 1047].forEach((f, i) => P()?.tone(f, i * 0.12, 0.5, 0.06, "triangle"));
      P()?.particles(["🎯", "✨", "📚"], { mode: "burst", n: 30 });
      toast(`Focus done! You left ${lock.escapes.me}×, ${partner()} left ${lock.escapes.them}×`);
    }
    if (w) lockPaint();
  }
  function lockPaint() {
    const w = W()?.get("f2-lock");
    if (!w) return;
    const left = lock.end - Date.now();
    if (lock.on && left <= 0) return lockEnd(true);
    q(".f2-lock-time", w.body).textContent = lock.on ? clock(left) : "Ready";
    q(".f2-lock-ring", w.body).style.setProperty("--p", lock.on ? (1 - left / (lock.mins * 60000)) * 100 : 0);
    q(".f2-lock-esc", w.body).innerHTML = lock.on || lock.escapes.me || lock.escapes.them
      ? `<span>You left the app <b>${lock.escapes.me}</b>×</span><span>${esc(partner())} left <b>${lock.escapes.them}</b>×</span>` : "If one of you leaves the app, the other gets told 👀";
    q(".f2-lock-go", w.body).hidden = lock.on;
    q(".f2-lock-stop", w.body).hidden = !lock.on;
  }
  function openLock(quiet) {
    if (!quiet) tray();
    const w = W().open({ id: "f2-lock", title: "Focus lock-in", icon: "lock_clock", w: 340, h: 480,
      html: `<div class="f2-lock"><div class="f2-lock-ring"><b class="f2-lock-time">Ready</b></div><p class="f2-lock-esc"></p>
        <div class="f2-lock-go"><div class="pt-chips2">${[15, 25, 45, 60].map((m) => `<button data-lm="${m}">${m} min</button>`).join("")}</div></div>
        <button class="btn ghost f2-lock-stop" hidden><span class="icon">stop</span>Give up</button></div>` });
    if (!w.body.dataset.wired) {
      w.body.dataset.wired = "1";
      w.body.addEventListener("click", (e) => {
        const m = Number(e.target.closest("[data-lm]")?.dataset.lm);
        if (m) { lockStart(m, me.name); say({ t: "lock", m }); }
        if (e.target.closest(".f2-lock-stop")) { lockEnd(false); say({ t: "lock-stop" }); toast("Focus lock-in stopped"); }
      });
    }
    lockPaint();
    return w;
  }
  document.addEventListener("visibilitychange", () => {
    if (!lock.on) return;
    if (document.visibilityState === "hidden") { lock.escapes.me += 1; say({ t: "escaped", n: lock.escapes.me }); }
    else lockPaint();
  });

  // =================================================================
  // Flashcards
  // =================================================================
  let deck = store.get("du-cards", { cards: [], u: 0 });
  const fc = { i: 0, flipped: false, mode: "list" };
  function saveDeck() {
    deck.u = Date.now();
    store.set("du-cards", deck);
    say({ t: "cards", deck });
    putDoc("settings", deck, "flashcards").catch(() => {});
  }
  function openCards() {
    tray();
    const w = W().open({ id: "f2-cards", title: "Flashcards", icon: "style", w: 380, h: 540, html: `<div class="f2-fc"></div>` });
    if (!w.body.dataset.wired) {
      w.body.dataset.wired = "1";
      w.body.addEventListener("submit", (e) => {
        e.preventDefault();
        const f = e.target, a = f.elements.a.value.trim(), b = f.elements.b.value.trim();
        if (!a || !b) return;
        deck.cards.unshift({ id: Date.now().toString(36), a: a.slice(0, 200), b: b.slice(0, 300) });
        deck.cards = deck.cards.slice(0, 300);
        saveDeck(); paintCards();
        q("[name=a]", w.body)?.focus();
      });
      w.body.addEventListener("click", (e) => {
        const a = e.target.closest("[data-fc]")?.dataset.fc;
        if (!a) return;
        if (a === "study" || a === "quiz") { if (!deck.cards.length) return toast("Add a card first"); fc.mode = a; fc.i = Math.floor(Math.random() * deck.cards.length); fc.flipped = false; if (a === "quiz") say({ t: "card-show", i: fc.i }); }
        if (a === "list") fc.mode = "list";
        if (a === "flip") { fc.flipped = !fc.flipped; P()?.tone(700, 0, 0.08, 0.04, "triangle"); if (fc.mode === "quiz") say({ t: "card-flip", f: fc.flipped }); }
        if (a === "next") { fc.i = (fc.i + 1 + Math.floor(Math.random() * Math.max(1, deck.cards.length - 1))) % deck.cards.length; fc.flipped = false; if (fc.mode === "quiz") say({ t: "card-show", i: fc.i }); }
        if (a === "del") { const id = e.target.closest("[data-cid]")?.dataset.cid; deck.cards = deck.cards.filter((c) => c.id !== id); saveDeck(); }
        paintCards();
      });
      getDocs("settings").then((docs) => { const d = docs.find((x) => x.id === "flashcards")?.data; if (d?.cards && (d.u || 0) > (deck.u || 0)) { deck = d; store.set("du-cards", deck); paintCards(); } }).catch(() => {});
    }
    paintCards();
  }
  function paintCards() {
    const w = W()?.get("f2-cards");
    if (!w) return;
    const box = q(".f2-fc", w.body);
    if (fc.mode !== "list" && deck.cards[fc.i]) {
      const c = deck.cards[fc.i];
      box.innerHTML = `<div class="f2-card${fc.flipped ? " flip" : ""}" data-fc="flip" role="button" tabindex="0" aria-label="Flip the card"><div class="f2-face front"><small>Question</small><p>${esc(c.a)}</p></div><div class="f2-face back"><small>Answer</small><p>${esc(c.b)}</p></div></div>
        <p class="fw-note center">${fc.mode === "quiz" ? `Quiz mode: ${esc(partner())} sees the same card` : "Tap the card to flip it"}</p>
        <div class="pt-row"><button class="btn ghost" data-fc="list"><span class="icon">arrow_back</span>Cards</button><button class="btn primary" data-fc="next">Next<span class="icon">arrow_forward</span></button></div>`;
      return;
    }
    box.innerHTML = `<form class="f2-fc-new"><input class="field" name="a" maxlength="200" placeholder="Question: Capital of Japan?" aria-label="Question" required><input class="field" name="b" maxlength="300" placeholder="Answer: Tokyo" aria-label="Answer" required><button class="btn primary"><span class="icon">add</span>Add card</button></form>
      <div class="pt-row"><button class="btn ghost" data-fc="study"><span class="icon">school</span>Study</button><button class="btn ghost" data-fc="quiz"><span class="icon">group</span>Quiz each other</button></div>
      <ul class="f2-fc-list">${deck.cards.length ? deck.cards.map((c) => `<li data-cid="${esc(c.id)}"><b>${esc(c.a)}</b><span>${esc(c.b)}</span><button class="icon-btn" data-fc="del" aria-label="Delete card"><span class="icon">delete</span></button></li>`).join("") : `<li class="f2-empty">No cards yet. Add your first one above.</li>`}</ul>`;
  }

  // =================================================================
  // Lo-fi music
  // =================================================================
  const lofi = { on: false, timer: 0, next: 0, step: 0 };
  const LOFI_CHORDS = [[220, 261.6, 329.6, 392], [174.6, 220, 261.6, 329.6], [196, 246.9, 293.7, 349.2], [164.8, 196, 246.9, 293.7]];
  function lofiToggle() {
    tray();
    if (lofi.on) { lofi.on = false; clearInterval(lofi.timer); paintLofi(); return toast("Lo-fi off"); }
    lofi.on = true; lofi.step = 0;
    const c = new (window.AudioContext || window.webkitAudioContext)();
    lofi.ctx?.close?.(); lofi.ctx = c;
    const out = c.createGain(); out.gain.value = 0.5;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1600;
    out.connect(lp).connect(c.destination);
    const t = (f, t0, d, v, type = "sine") => { const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12; const s = c.currentTime + t0; g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(v, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + d); o.connect(g).connect(out); o.start(s); o.stop(s + d + 0.05); };
    const nb = c.createBuffer(1, c.sampleRate * 0.3, c.sampleRate); const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nd.length, 3);
    const hit = (t0, f, v) => { const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain(); s.buffer = nb; fl.type = "bandpass"; fl.frequency.value = f; g.gain.value = v; s.connect(fl).connect(g).connect(out); s.start(c.currentTime + t0); };
    // vinyl crackle
    const crackle = c.createBufferSource(), cb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), cd = cb.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = Math.random() < 0.0015 ? (Math.random() * 2 - 1) * 0.5 : (Math.random() * 2 - 1) * 0.01;
    crackle.buffer = cb; crackle.loop = true; const cg = c.createGain(); cg.gain.value = 0.25; crackle.connect(cg).connect(out); crackle.start();
    const beat = 60 / 72 / 2;
    lofi.next = c.currentTime + 0.1;
    lofi.timer = setInterval(() => {
      if (!lofi.on) return;
      while (lofi.next < c.currentTime + 0.2) {
        const t0 = lofi.next - c.currentTime, i = lofi.step, ch = LOFI_CHORDS[Math.floor(i / 16) % 4];
        if (i % 8 === 0 || i % 16 === 11) t(55 + (ch[0] / 4 - 55), t0, 0.5, 0.25, "sine");
        if (i % 8 === 0) { t(60, t0, 0.25, 0.5, "sine"); }
        if (i % 8 === 4) hit(t0, 1800, 0.35);
        if (i % 2 === 1) hit(t0, 7000, 0.06);
        if (i % 16 === 0) ch.forEach((f, k) => t(f, t0 + k * 0.03, beat * 14, 0.035, "triangle"));
        if (i % 4 === 2 && Math.random() < 0.5) t(ch[Math.floor(Math.random() * 4)] * 2, t0, beat * 3, 0.03, "sine");
        lofi.next += beat; lofi.step += 1;
      }
    }, 60);
    const stop = () => { crackle.stop(); setTimeout(() => c.close(), 500); };
    const watch = setInterval(() => { if (!lofi.on) { clearInterval(watch); stop(); } }, 500);
    paintLofi();
    toast("🎧 Lo-fi on. Tap again to stop");
  }
  function paintLofi() { const s = q("#f2-lofi-sub"); if (s) s.textContent = lofi.on ? "Playing · tap to stop" : "Soft beats to study to"; }

  // =================================================================
  // wiring
  // =================================================================
  const OPEN = { "f2-water": openWater, "f2-lock": () => openLock(), "f2-cards": openCards, "f2-lofi": lofiToggle };
  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple };
  Object.assign(window.DU, {
    onCoupleClick(button) { const f = OPEN[button.dataset.tg]; if (f) return f(); prev.click?.(button); },
    onCouple(message, peer) {
      if (message.type !== "focus2") return prev.msg?.(message, peer);
      const d = message.data || {}, by = peer?.name || partner();
      if (d.t === "glass") { water.theirs = Number(d.n) || 0; paintWater(); }
      if (d.t === "glass-ask") say({ t: "glass", n: myGlasses() });
      if (d.t === "water-every") { water.every = Number(d.m) || 0; store.set("du-water-every", water.every); waterSchedule(); toast(water.every ? `${by} set water reminders every ${water.every} min 💧` : `${by} turned water reminders off`); }
      if (d.t === "lock") lockStart(Number(d.m) || 25, by, true);
      if (d.t === "lock-stop") { lockEnd(false); toast(`${by} stopped the focus lock-in`); }
      if (d.t === "escaped") { lock.escapes.them = Number(d.n) || 0; lockPaint(); if (lock.on) { toast(`👀 ${by} left the app! (${lock.escapes.them}×)`); P()?.sound("sad"); } }
      if (d.t === "cards" && d.deck?.cards && (d.deck.u || 0) >= (deck.u || 0)) { deck = d.deck; store.set("du-cards", deck); paintCards(); }
      if (d.t === "card-show") { if (!W()?.get("f2-cards")) openCards(); fc.mode = "quiz"; fc.i = Number(d.i) || 0; fc.flipped = false; paintCards(); }
      if (d.t === "card-flip") { fc.flipped = Boolean(d.f); paintCards(); }
    },
  });
})();
