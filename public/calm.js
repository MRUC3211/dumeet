// DU Meet · Relax extras: Power nap, Guided calm, Stretch break and Eye rest. Sounds, Breathe, Night light and Sleep call live elsewhere (fun.js, couple.js,
// extras.js, tools.js). Everything opens as a small movable window; the shared ones run on
// both phones.

(() => {
  "use strict";
  const { q, store } = window.DU.kit;
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
  // Power nap: a short nap for both, then a gentle alarm wakes you up
  // =================================================================

  const nap = { end: 0, tick: 0, ring: 0, mins: 0 };
  function openNap() {
    tray();
    const w = W().open({
      id: "nap", title: "Power nap", icon: "bedtime", w: 320, h: 400, tone: "calm",
      html: `<div class="st2"><span class="st2-moon" aria-hidden="true">😴</span><b class="st2-left">Ready</b><small class="st2-sub">Close your eyes. A gentle alarm wakes you both up.</small>
        <div class="chips">${[10, 15, 20, 25, 30, 45].map((m) => `<button data-min="${m}">${m} min</button>`).join("")}</div>
        <label class="switch-row"><input type="checkbox" class="st2-rain"${store.get("du-nap-rain", true) ? " checked" : ""}><span>Soft rain while we nap</span></label>
        <button class="btn ghost wide" data-min="0">Cancel nap</button></div>`,
    });
    w.body.onclick = (e) => {
      const b = e.target.closest("[data-min]");
      if (!b) return;
      const rain = q(".st2-rain", w.body).checked;
      store.set("du-nap-rain", rain);
      setNap(Number(b.dataset.min), rain, true);
    };
    paintNap();
  }
  function setNap(mins, rain, mine) {
    stopAlarm();
    nap.mins = mins;
    nap.end = mins ? Date.now() + mins * 60000 : 0;
    clearInterval(nap.tick);
    if (mins) nap.tick = setInterval(tickNap, 1000);
    if (mine) {
      send("calm", { t: "nap", mins, rain });
      if (mins && rain) window.DU.sounds?.play("rain");
      if (!mins && window.DU.sounds?.current === "rain") window.DU.sounds.play("");
      if (mins) toast(`Power nap: ${mins} min for both of you. Sweet dreams 😴`);
    }
    paintNap();
  }
  function tickNap() {
    paintNap();
    if (nap.end - Date.now() > 0) return;
    clearInterval(nap.tick);
    nap.end = 0;
    window.DU.sounds?.fadeOut(4);
    wake();
    paintNap();
  }
  function wake() {
    const w = W().open({ id: "wake", title: "Wakey wakey", icon: "wb_sunny", w: 300, h: 300, tone: "warm",
      html: `<div class="gd"><span class="gd-e">☀️</span><b class="gd-t">Time to wake up!</b><p class="gd-p">${nap.mins} minutes of rest done. Stretch, drink some water, and smile.</p><button class="btn primary wide" data-wake>I'm up</button></div>`,
      onClose: stopAlarm });
    w.body.onclick = (e) => { if (e.target.closest("[data-wake]")) w.close(); };
    let n = 0;
    const ring = () => { softBell([523, 659, 784][n % 3], Math.min(.2, .06 + n * .012), 2.4); n += 1; if (n > 45) stopAlarm(); };
    ring();
    nap.ring = setInterval(ring, 1300);
    try { navigator.vibrate?.([300, 200, 300]); } catch { /* no vibration */ }
  }
  function stopAlarm() { clearInterval(nap.ring); nap.ring = 0; }
  function paintNap() {
    const w = W().get("nap");
    const label = nap.end ? `${mmss(nap.end - Date.now())}` : "Ready";
    const tl = q("#tray-nap");
    if (tl) tl.textContent = nap.end ? `${label} left` : "10–45 min, then a gentle alarm";
    if (!w) return;
    q(".st2-left", w.body).textContent = label;
    q(".st2-sub", w.body).textContent = nap.end ? "Napping… we'll wake you both up." : "Close your eyes. A gentle alarm wakes you both up.";
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

  // ---------- hooks ----------

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave, peer: window.DU.onCouplePeer };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const run = { nap: openNap, guided: () => openGuided("calm"), stretch: () => openGuided("stretch"), eyes: toggleEyes }[button.dataset.tg];
      if (run) run(); else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "calm") return prev.msg?.(message, peer);
      const d = message.data || {};
      if (d.t === "nap") { if (d.mins && !W().get("nap")) openNap(); setNap(Math.max(0, Math.min(90, Number(d.mins) || 0)), d.rain, false); toast(d.mins ? `${peer.name} started a ${d.mins}-min power nap 😴` : `${peer.name} cancelled the nap`); }
      if (d.t === "calm" || d.t === "stretch") openGuided(d.t, Date.now(), peer.name);
      if (d.t === "calm-go" || d.t === "stretch-go") jumpGuided(d.t.split("-")[0], Number(d.i) || 0);
    },
    onCoupleLeave(...args) {
      prev.leave?.(...args);
      setNap(0, false, false);
      ["nap", "wake", "guided", "stretch", "eyebreak"].forEach((id) => W().get(id)?.close());
    },
  });
  window.DU.nap = (mins) => setNap(mins, store.get("du-nap-rain", true), true);
  paintEyes();
})();
