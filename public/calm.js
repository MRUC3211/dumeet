// DU Meet · Relax extras: Sleep timer, Lullaby, Guided calm, Stretch break, Eye rest and
// Gratitude. Sounds, Breathe, Night light and Sleep call live elsewhere (fun.js, couple.js,
// extras.js, tools.js). Everything opens as a small movable window; the shared ones run on
// both phones.

(() => {
  "use strict";
  const { q, esc, store, getDocs, putDoc } = window.DU.kit;
  const W = () => window.DU.win;
  const other = () => [...peers.values()][0];
  const tray = () => window.DU.kit.toggleTray(false);
  let actx = null;
  const ac = () => { actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); return actx; };
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  function softBell(f = 528, vol = .12, dur = 3) {
    try {
      const c = ac(), t = c.currentTime;
      [1, 2.01, 3.9].forEach((m, i) => {
        const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f * m;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol / (i + 1.5), t + .02); g.gain.exponentialRampToValueAtTime(.0005, t + dur / (i + 1));
        o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur);
      });
    } catch { /* no audio */ }
  }

  // =================================================================
  // Sleep timer: sounds fade out (and the call can end) after a while
  // =================================================================

  const timer = { end: 0, hangUp: false, tick: 0 };
  function openSleepTimer() {
    tray();
    const w = W().open({
      id: "sleeptimer", title: "Sleep timer", icon: "bedtime", w: 320, h: 360,
      html: `<div class="st2"><b class="st2-left">Off</b><small class="st2-sub">Sounds and the lullaby fade out softly.</small>
        <div class="chips">${[10, 15, 30, 45, 60, 90].map((m) => `<button data-min="${m}">${m} min</button>`).join("")}</div>
        <label class="switch-row"><input type="checkbox" class="st2-hang"${timer.hangUp ? " checked" : ""}><span>End the call too</span></label>
        <button class="btn ghost wide" data-min="0">Turn off</button></div>`,
    });
    w.body.onclick = (e) => {
      const b = e.target.closest("[data-min]");
      if (!b) return;
      setTimer(Number(b.dataset.min), q(".st2-hang", w.body).checked, true);
    };
    paintTimer();
  }
  function setTimer(mins, hangUp, mine) {
    timer.end = mins ? Date.now() + mins * 60000 : 0;
    timer.hangUp = Boolean(hangUp);
    clearInterval(timer.tick);
    if (mins) timer.tick = setInterval(tickTimer, 1000);
    if (mine) send("calm", { t: "timer", mins, hangUp: timer.hangUp });
    if (mine && mins) toast(`Sleep timer: ${mins} min for both of you`);
    paintTimer();
  }
  function tickTimer() {
    const left = timer.end - Date.now();
    paintTimer();
    if (left > 0) return;
    clearInterval(timer.tick);
    timer.end = 0;
    window.DU.sounds?.fadeOut(20);
    stopLullaby(false);
    toast("Sleep timer done. Good night 🌙");
    if (timer.hangUp) setTimeout(() => document.querySelector('#call [data-action="leave"], .controls [data-action="leave"], [data-action="leave"]')?.click(), 21000);
    paintTimer();
  }
  function paintTimer() {
    const w = W().get("sleeptimer");
    const label = timer.end ? `${mmss(timer.end - Date.now())} left` : "Off";
    const tl = q("#tray-timer2");
    if (tl) tl.textContent = timer.end ? label : "Fade out, then sleep";
    if (!w) return;
    q(".st2-left", w.body).textContent = label;
  }

  // =================================================================
  // Lullaby: a soft music box that plays on both phones
  // =================================================================

  const TUNES = [
    { k: "moon", label: "Moonlight", root: 523.25, scale: [0, 2, 4, 7, 9, 12, 14, 16], tempo: .62, seed: 3 },
    { k: "stars", label: "Little stars", root: 587.33, scale: [0, 2, 4, 5, 7, 9, 12, 14], tempo: .55, seed: 11 },
    { k: "drift", label: "Drift away", root: 440, scale: [0, 3, 5, 7, 10, 12, 15], tempo: .7, seed: 7 },
    { k: "rainy", label: "Rainy window", root: 493.88, scale: [0, 2, 3, 7, 8, 12, 14], tempo: .66, seed: 5 },
  ];
  const lull = { k: "", timer: 0, step: 0, next: 0, out: null, melody: [] };
  function makeMelody(t) {
    let s = t.seed;
    const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const phrase = [];
    let i = 2;
    for (let n = 0; n < 16; n++) { i = Math.max(0, Math.min(t.scale.length - 1, i + Math.floor(r() * 5) - 2)); phrase.push(r() < .15 ? -1 : t.scale[i]); }
    return [...phrase, ...phrase.slice(0, 12), t.scale[2], t.scale[1], t.scale[0], -1];
  }
  function playLullaby(k, mine) {
    stopLullaby(false);
    const t = TUNES.find((x) => x.k === k);
    if (!t) return paintLull();
    const c = ac();
    lull.k = k; lull.step = 0; lull.melody = makeMelody(t); lull.next = c.currentTime + .1;
    lull.out = c.createGain(); lull.out.gain.value = .0001; lull.out.connect(c.destination);
    lull.out.gain.exponentialRampToValueAtTime(.5, c.currentTime + 1.5);
    const note = (f, at, vol, dur) => {
      [1, 3, 4.2].forEach((m, i) => {
        const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f * m;
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol / (i * 2.5 + 1), at + .005); g.gain.exponentialRampToValueAtTime(.0003, at + dur / (i + 1));
        o.connect(g).connect(lull.out); o.start(at); o.stop(at + dur);
      });
    };
    lull.timer = setInterval(() => {
      while (lull.next < c.currentTime + .4) {
        const semi = lull.melody[lull.step % lull.melody.length];
        if (semi >= 0) note(t.root * Math.pow(2, semi / 12), lull.next, .16, 2.2);
        if (lull.step % 4 === 0) note(t.root / 2 * Math.pow(2, t.scale[(lull.step / 4) % 3 === 2 ? 3 : 0] / 12), lull.next, .07, 3);
        lull.step += 1;
        lull.next += t.tempo;
      }
    }, 120);
    if (mine) send("calm", { t: "lull", k });
    paintLull();
  }
  function stopLullaby(mine) {
    clearInterval(lull.timer);
    if (lull.out) { const o = lull.out; try { o.gain.setTargetAtTime(.0001, ac().currentTime, .4); } catch { /* closed */ } setTimeout(() => o.disconnect(), 2500); }
    const was = lull.k;
    Object.assign(lull, { k: "", timer: 0, out: null });
    if (mine && was) send("calm", { t: "lull", k: "" });
    paintLull();
  }
  function openLullaby() {
    tray();
    const w = W().open({
      id: "lullaby", title: "Lullaby", icon: "music_note", w: 320, h: 360,
      html: `<p class="fw-note">A soft music box on both phones. Pairs well with the sleep timer.</p>
        <div class="lb-list">${TUNES.map((t) => `<button data-lb="${t.k}"><span class="icon">music_note</span><b>${t.label}</b><i class="snd-eq"><b></b><b></b><b></b></i></button>`).join("")}</div>
        <button class="btn ghost wide" data-lb="">Stop</button>`,
    });
    w.body.onclick = (e) => {
      const b = e.target.closest("[data-lb]");
      if (!b) return;
      if (!b.dataset.lb || b.dataset.lb === lull.k) stopLullaby(true); else playLullaby(b.dataset.lb, true);
    };
    paintLull();
  }
  function paintLull() {
    const t = q("#tray-lull");
    if (t) t.textContent = lull.k ? `${TUNES.find((x) => x.k === lull.k).label} · playing` : "Soft music box";
    W().get("lullaby")?.el.querySelectorAll("[data-lb]").forEach((b) => b.classList.toggle("on", Boolean(lull.k) && b.dataset.lb === lull.k));
  }

  // =================================================================
  // Guided calm and Stretch break: step by step, together
  // =================================================================

  const CALM = [
    ["🪑", "Get comfortable", "Sit or lie down. Let your shoulders drop. Close your eyes if you like."],
    ["🌬️", "Three slow breaths", "Breathe in through your nose… and let it out slowly through your mouth."],
    ["🦶", "Feet and legs", "Notice your feet. Let them get heavy and warm. Let your legs relax."],
    ["🫁", "Belly and chest", "Feel your belly rise and fall. No need to change anything."],
    ["🤲", "Hands and arms", "Unclench your hands. Let your arms rest, loose and heavy."],
    ["😌", "Face and jaw", "Soften your forehead. Unclench your jaw. Let your tongue rest."],
    ["🧠", "Busy thoughts", "If a thought comes, notice it and let it float past, like a cloud."],
    ["💗", "Think of each other", "Picture the other one smiling. Send them a little warmth."],
    ["🌊", "Just breathe", "Stay here a moment. Slow, easy breaths."],
    ["🌅", "Come back", "Wiggle your fingers. Take a big breath. Open your eyes when you're ready."],
  ];
  const STRETCH = [
    ["🙆", "Reach up", "Interlace your fingers and push your palms to the ceiling. Grow tall."],
    ["🔄", "Neck rolls", "Slowly roll your head in a circle. Switch direction halfway."],
    ["🤷", "Shoulder shrugs", "Lift your shoulders to your ears, hold, and drop them. Repeat."],
    ["↔️", "Side bend", "One arm over your head, lean to the other side. Switch halfway."],
    ["🌀", "Seated twist", "Sit tall and turn to look behind you. Switch sides halfway."],
    ["✋", "Wrist stretch", "Arm out, palm up, gently pull your fingers back. Switch hands."],
    ["🧍", "Forward fold", "Stand, bend forward and let your arms hang. Bend your knees a bit."],
    ["👀", "Eye break", "Look at something far away. Blink slowly a few times."],
  ];
  const guided = {};
  function openGuided(kind, at, by) {
    tray();
    const list = kind === "calm" ? CALM : STRETCH;
    const per = kind === "calm" ? 28000 : 30000;
    const id = kind === "calm" ? "guided" : "stretch";
    W().get(id)?.close();
    const w = W().open({
      id, title: kind === "calm" ? "Guided calm" : "Stretch break", icon: kind === "calm" ? "self_improvement" : "accessibility_new", w: 340, h: 400, tone: kind === "calm" ? "calm" : "",
      html: `<div class="gd"><div class="gd-dots">${list.map(() => "<i></i>").join("")}</div><span class="gd-e"></span><b class="gd-t"></b><p class="gd-p"></p>
        <div class="gd-bar"><i></i></div><small class="gd-time"></small>
        <div class="gd-acts"><button class="btn ghost" data-gd="prev"><span class="icon">skip_previous</span></button><button class="btn ghost" data-gd="next"><span class="icon">skip_next</span></button></div></div>`,
      onClose: () => { clearInterval(guided[id]?.tick); delete guided[id]; },
    });
    const g = guided[id] = { start: at || Date.now(), tick: 0, last: -1 };
    if (!at) send("calm", { t: kind });
    else if (by) toast(`${by} started ${kind === "calm" ? "a guided calm" : "a stretch break"}`);
    const paint = () => {
      const el = Date.now() - g.start, i = Math.floor(el / per);
      if (i >= list.length) { clearInterval(g.tick); q(".gd-t", w.body).textContent = kind === "calm" ? "Well done 💙" : "All done 💪"; q(".gd-p", w.body).textContent = kind === "calm" ? "Carry this calm with you." : "Your body says thanks."; q(".gd-e", w.body).textContent = "✨"; q(".gd-bar i", w.body).style.width = "100%"; q(".gd-time", w.body).textContent = ""; if (g.last !== i) softBell(660); g.last = i; return; }
      if (i !== g.last) {
        g.last = i;
        const [e, t, p] = list[i];
        q(".gd-e", w.body).textContent = e; q(".gd-t", w.body).textContent = t; q(".gd-p", w.body).textContent = p;
        w.body.querySelectorAll(".gd-dots i").forEach((d, k) => d.classList.toggle("on", k <= i));
        softBell(kind === "calm" ? 432 : 528, .1);
        navigator.vibrate?.(30);
      }
      q(".gd-bar i", w.body).style.width = `${((el % per) / per) * 100}%`;
      q(".gd-time", w.body).textContent = `${i + 1} of ${list.length} · ${mmss(per - (el % per))}`;
    };
    g.tick = setInterval(paint, 250);
    paint();
    w.body.onclick = (e) => {
      const a = e.target.closest("[data-gd]")?.dataset.gd;
      if (!a) return;
      const i = Math.floor((Date.now() - g.start) / per);
      const to = Math.max(0, Math.min(list.length - 1, i + (a === "next" ? 1 : -1)));
      g.start = Date.now() - to * per;
      g.last = -1;
      send("calm", { t: `${kind}-go`, i: to });
      paint();
    };
  }
  function jumpGuided(kind, i) {
    const id = kind === "calm" ? "guided" : "stretch";
    const g = guided[id];
    if (!g) return;
    g.start = Date.now() - i * (kind === "calm" ? 28000 : 30000);
    g.last = -1;
  }

  // =================================================================
  // Eye rest: every 20 minutes, look far away for 20 seconds
  // =================================================================

  let eyes = store.get("du-eyes", false), eyesSince = Date.now();
  function toggleEyes() {
    tray();
    eyes = !eyes;
    store.set("du-eyes", eyes);
    eyesSince = Date.now();
    paintEyes();
    toast(eyes ? "Eye rest on · a 20-second break every 20 minutes" : "Eye rest off");
  }
  function paintEyes() {
    const t = q("#tray-eyes");
    if (t) t.textContent = eyes ? "On · every 20 min" : "20-20-20 for your eyes";
    q("[data-tg=eyes]")?.classList.toggle("on", eyes);
  }
  setInterval(() => {
    if (!eyes || !polling || Date.now() - eyesSince < 20 * 60000) return;
    eyesSince = Date.now();
    const end = Date.now() + 20000;
    const w = W().open({ id: "eyebreak", title: "Eye rest", icon: "visibility", w: 300, h: 260, tone: "calm",
      html: `<div class="gd"><span class="gd-e">👀</span><b class="gd-t">Look far away</b><p class="gd-p">Something about 6 metres away, for 20 seconds. Blink slowly.</p><b class="eb-n">20</b></div>` });
    softBell(528, .08);
    const t = setInterval(() => {
      const left = end - Date.now();
      if (!W().get("eyebreak")) return clearInterval(t);
      q(".eb-n", w.body).textContent = Math.max(0, Math.ceil(left / 1000));
      if (left <= 0) { clearInterval(t); softBell(660, .08); setTimeout(() => w.close(), 1200); }
    }, 250);
  }, 15000);

  // =================================================================
  // Gratitude: three good things each, saved by day
  // =================================================================

  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  let grat = null;
  async function loadGrat() {
    try { grat = (await getDocs("settings")).find((d) => d.id === "gratitude")?.data || {}; } catch { grat = grat || {}; }
    return grat;
  }
  async function openGrat() {
    tray();
    const w = W().open({ id: "grat", title: "Three good things", icon: "volunteer_activism", w: 360, h: 470,
      html: `<div class="gr"><p class="fw-note">Three small things from today you're thankful for. You both see each other's.</p><div class="gr-body"><div class="gr-load"><span class="sa-orb"><i></i></span></div></div></div>` });
    await loadGrat();
    paintGrat(w);
  }
  function paintGrat(w = W().get("grat")) {
    if (!w || !grat) return;
    const day = (grat.days || {})[today()] || {};
    const mine = day[me.name] || [];
    const theirs = Object.entries(day).filter(([n]) => n !== me.name);
    q(".gr-body", w.body).innerHTML = `<form class="gr-form">${[0, 1, 2].map((i) => `<label><span>${i + 1}</span><input class="field" maxlength="120" value="${esc(mine[i] || "")}" placeholder="${["Something that made you smile", "Someone you're glad for", "A small win"][i]}"></label>`).join("")}
        <button class="btn primary wide">Save for today</button></form>
      ${theirs.length ? theirs.map(([n, l]) => `<div class="gr-them"><b>${esc(n)}'s three</b><ol>${l.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>`).join("") : `<p class="gr-wait">${esc(other()?.name || "Your partner")} hasn't added theirs yet.</p>`}`;
    q(".gr-form", w.body).onsubmit = async (e) => {
      e.preventDefault();
      const items = [...w.body.querySelectorAll(".gr-form input")].map((i) => i.value.trim()).filter(Boolean);
      if (!items.length) return toast("Write at least one");
      await loadGrat();
      const days = { ...(grat.days || {}) };
      days[today()] = { ...(days[today()] || {}), [me.name]: items };
      // keep the last 120 days
      const keep = Object.keys(days).sort().slice(-120);
      grat = { days: Object.fromEntries(keep.map((k) => [k, days[k]])) };
      try { await putDoc("settings", grat, "gratitude"); send("calm", { t: "grat" }); toast("Saved 💛"); } catch { toast("Couldn't save. Check the internet."); }
      paintGrat(w);
    };
  }

  // ---------- hooks ----------

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave, peer: window.DU.onCouplePeer };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const run = { sleeptimer: openSleepTimer, lullaby: openLullaby, guided: () => openGuided("calm"), stretch: () => openGuided("stretch"), eyes: toggleEyes, grat: openGrat }[button.dataset.tg];
      if (run) run(); else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "calm") return prev.msg?.(message, peer);
      const d = message.data || {};
      if (d.t === "timer") { setTimer(Math.max(0, Math.min(180, Number(d.mins) || 0)), d.hangUp, false); if (d.mins) toast(`${peer.name} set a ${d.mins}-min sleep timer`); }
      if (d.t === "lull") { if (d.k) { playLullaby(String(d.k), false); toast(`${peer.name} put on a lullaby 🎶`); } else stopLullaby(false); }
      if (d.t === "calm" || d.t === "stretch") openGuided(d.t, Date.now(), peer.name);
      if (d.t === "calm-go" || d.t === "stretch-go") jumpGuided(d.t.split("-")[0], Number(d.i) || 0);
      if (d.t === "grat") loadGrat().then(() => paintGrat());
    },
    onCoupleLeave(...args) {
      prev.leave?.(...args);
      stopLullaby(false); setTimer(0, false, false);
      ["sleeptimer", "lullaby", "guided", "stretch", "grat", "eyebreak"].forEach((id) => W().get(id)?.close());
    },
  });
  paintEyes();
})();
