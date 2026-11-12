// DU Meet · Date night, for a proper date over a call: a candle-light dinner mood,
// stargazing and "who's more likely". Deep and spicy talk cards live in talk.js.
// Each opens as a small movable window; the shared ones stay in step on both phones.

(() => {
  "use strict";
  const { q, esc } = window.DU.kit;
  const W = () => window.DU.win;
  const other = () => [...peers.values()][0];
  const tray = () => window.DU.kit.toggleTray(false);
  const needPartner = (what) => { if (other()) return true; toast(`${what} needs someone in the call`); return false; };
  let actx = null;
  const ac = () => { actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); return actx; };
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // =================================================================
  // Candle-light dinner: warm light on the call, candles and soft music on both phones
  // =================================================================

  const candle = { on: false, timer: 0, next: 0, step: 0, out: null };
  function setCandle(on, mine) {
    if (candle.on === on) return paintCandle();
    candle.on = on;
    document.body.classList.toggle("candle-on", on);
    let row = q(".candle-row");
    if (on && !row) { row = document.createElement("div"); row.className = "candle-row"; row.innerHTML = `<span>🕯️</span><span>🌹</span><span>🍷</span><span>🕯️</span>`; (q(".main-area") || document.body).append(row); }
    if (!on) row?.remove();
    clearInterval(candle.timer);
    if (candle.out) { const o = candle.out; try { o.gain.setTargetAtTime(.0001, ac().currentTime, .5); } catch { /* closed */ } setTimeout(() => o.disconnect(), 3000); candle.out = null; }
    if (on) startJazz();
    if (mine) send("date", { t: "candle", on });
    paintCandle();
  }
  function startJazz() {
    let c;
    try { c = ac(); } catch { return; }
    candle.out = c.createGain(); candle.out.gain.value = .0001; candle.out.connect(c.destination);
    candle.out.gain.exponentialRampToValueAtTime(.35, c.currentTime + 2);
    // a slow ii–V–I–vi loop in a soft electric-piano tone
    const CH = [[146.8, 174.6, 220, 261.6], [196, 246.9, 293.7, 349.2], [130.8, 164.8, 196, 246.9], [110, 130.8, 164.8, 196]];
    const beat = 1.25;
    candle.next = c.currentTime + .2; candle.step = 0;
    const keys = (f, at, dur, vol) => {
      [1, 2, 3].forEach((m, i) => {
        const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f * m; o.type = i ? "sine" : "triangle";
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol / (i * 3 + 1), at + .02); g.gain.exponentialRampToValueAtTime(.0005, at + dur);
        o.connect(g).connect(candle.out); o.start(at); o.stop(at + dur + .05);
      });
    };
    candle.timer = setInterval(() => {
      while (candle.next < c.currentTime + .5) {
        const bar = Math.floor(candle.step / 4) % 4, chord = CH[bar], b = candle.step % 4;
        if (b === 0) chord.forEach((f, i) => keys(f, candle.next + i * .03, beat * 3.6, .05));
        keys(chord[0] / 2, candle.next, beat * .9, .07);
        if (Math.random() < .55) keys(chord[(b + 1 + Math.floor(Math.random() * 3)) % 4] * 2, candle.next + (Math.random() < .5 ? beat / 2 : 0), beat * 1.4, .035);
        candle.step += 1; candle.next += beat;
      }
    }, 150);
  }
  function openCandle() {
    tray();
    const w = W().open({ id: "candle", title: "Candle-light dinner", icon: "local_fire_department", w: 300, h: 300, tone: "warm",
      html: `<div class="cd"><div class="cd-flame"><span>🕯️</span></div><p class="fw-note center">Warm light, candles and soft music on both phones.</p>
        <button class="btn primary wide cd-go" data-cd></button></div>` });
    w.body.onclick = (e) => { if (e.target.closest("[data-cd]")) setCandle(!candle.on, true); };
    paintCandle();
  }
  function paintCandle() {
    const w = W().get("candle");
    q("[data-tg=candle]")?.classList.toggle("on", candle.on);
    if (w) q(".cd-go", w.body).innerHTML = candle.on ? `<span class="icon">stop</span>End dinner mood` : `<span class="icon">local_fire_department</span>Light the candles`;
  }

  // =================================================================
  // Stargazing
  // =================================================================

  let stars = null;
  function openStars() {
    tray();
    const w = W().open({ id: "stars", title: "Stargazing", icon: "nights_stay", w: 380, h: 420, tone: "night",
      html: `<div class="sg"><canvas class="sg-sky fw-nodrag"></canvas><p class="sg-tip">Tap a shooting star to make a wish ✨</p></div>`,
      onClose: () => { cancelAnimationFrame(stars?.raf); stars?.ro?.disconnect(); stars = null; } });
    const cv = q(".sg-sky", w.body), x = cv.getContext("2d");
    const dpr = Math.min(2, devicePixelRatio || 1);
    stars = { raf: 0, list: [], shoot: null, wished: 0 };
    const size = () => {
      if (!stars) return;
      const r = cv.getBoundingClientRect();
      cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
      stars.list = Array.from({ length: Math.round((r.width * r.height) / 900) }, () => ({ x: Math.random() * cv.width, y: Math.random() * cv.height, r: (Math.random() * 1.2 + .3) * dpr, p: Math.random() * 6, s: Math.random() * 2 + .5 }));
    };
    stars.ro = new ResizeObserver(size);
    stars.ro.observe(q(".sg", w.body));
    size();
    const draw = (t) => {
      if (!stars) return;
      const g = x.createLinearGradient(0, 0, 0, cv.height); g.addColorStop(0, "#050816"); g.addColorStop(1, "#1a1640");
      x.fillStyle = g; x.fillRect(0, 0, cv.width, cv.height);
      // moon
      const mx = cv.width * .8, my = cv.height * .2, mr = Math.min(cv.width, cv.height) * .07;
      const glow = x.createRadialGradient(mx, my, mr * .5, mx, my, mr * 4); glow.addColorStop(0, "rgba(255,250,220,.25)"); glow.addColorStop(1, "rgba(255,250,220,0)");
      x.fillStyle = glow; x.fillRect(0, 0, cv.width, cv.height);
      x.fillStyle = "#fffbe8"; x.beginPath(); x.arc(mx, my, mr, 0, Math.PI * 2); x.fill();
      x.fillStyle = "#0b0d22"; x.beginPath(); x.arc(mx + mr * .45, my - mr * .2, mr * .95, 0, Math.PI * 2); x.fill();
      for (const s of stars.list) { x.globalAlpha = .45 + .55 * Math.abs(Math.sin(t / 900 * s.s + s.p)); x.fillStyle = "#fff"; x.beginPath(); x.arc(s.x, s.y, s.r, 0, Math.PI * 2); x.fill(); }
      x.globalAlpha = 1;
      if (!stars.shoot && Math.random() < .006) stars.shoot = { x: Math.random() * cv.width * .7, y: Math.random() * cv.height * .4, vx: (6 + Math.random() * 4) * dpr, vy: (2.5 + Math.random() * 2) * dpr, life: 1 };
      const sh = stars.shoot;
      if (sh) {
        sh.x += sh.vx; sh.y += sh.vy; sh.life -= .012;
        const tail = x.createLinearGradient(sh.x, sh.y, sh.x - sh.vx * 14, sh.y - sh.vy * 14);
        tail.addColorStop(0, `rgba(255,255,255,${sh.life})`); tail.addColorStop(1, "rgba(255,255,255,0)");
        x.strokeStyle = tail; x.lineWidth = 2.2 * dpr; x.beginPath(); x.moveTo(sh.x, sh.y); x.lineTo(sh.x - sh.vx * 14, sh.y - sh.vy * 14); x.stroke();
        if (sh.life <= 0 || sh.x > cv.width || sh.y > cv.height) stars.shoot = null;
      }
      stars.raf = requestAnimationFrame(draw);
    };
    stars.raf = requestAnimationFrame(draw);
    cv.addEventListener("pointerdown", (e) => {
      const sh = stars?.shoot;
      if (!sh) return;
      const r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
      if (Math.hypot(px - sh.x, py - sh.y) > 70 * dpr) return;
      stars.shoot = null;
      q(".sg-tip", w.body).textContent = "Wish made. Don't tell anyone 🤫";
      try { const c = ac(), t = c.currentTime; [1318, 1568, 2093].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0, t + i * .08); g.gain.linearRampToValueAtTime(.06, t + i * .08 + .01); g.gain.exponentialRampToValueAtTime(.001, t + i * .08 + 1); o.connect(g).connect(c.destination); o.start(t + i * .08); o.stop(t + i * .08 + 1.05); }); } catch { /* no audio */ }
      if (other()) send("date", { t: "wish" });
    });
  }

  // =================================================================
  // Who's more likely to…
  // =================================================================

  const LIKELY = [
    "fall asleep first on a call", "forget an important date", "cry at a movie", "eat the last slice", "get lost with GPS on",
    "say sorry first after a fight", "spend all the money on food", "plan a surprise", "laugh at the wrong moment", "become famous",
    "talk to animals like they're people", "binge a whole series in one night", "get jealous", "be late", "start a dance in public",
    "forget where they kept their phone", "win an argument", "cook something that burns", "send 20 voice notes", "fall in love again every day",
    "wake up grumpy", "give the best hugs", "steal the blanket", "stay up till 3 am", "cry when happy",
    "make the first move", "remember every little detail", "get scared of a horror movie", "spoil the other", "pick the restaurant",
  ];
  LIKELY.push(...(window.DU.bank?.likely || []));   // more from bank.js
  const ml = { order: [], i: 0, mine: null, theirs: null, score: 0, played: 0 };
  function openLikely(seed, by) {
    tray();
    if (!needPartner("Who's more likely")) return;
    if (!seed && !ml.order.length && !window.DU.deck.can("likely", "Who's more likely")) return;
    const w = W().open({ id: "likely", title: "Who's more likely", icon: "group", w: 340, h: 400, tone: "rose", onClose: () => { ml.order = []; } });
    if (seed) startLikely(seed, false, by); else if (!ml.order.length) startLikely(window.DU.deck.order("likely", LIKELY.length), true);
    paintLikely(w);
    w.body.onclick = (e) => {
      const a = e.target.closest("[data-ml]")?.dataset.ml;
      if (!a) return;
      if (a === "next") { if (!window.DU.deck.can("likely", "Who's more likely")) return; send("date", { t: "ml-next" }); nextLikely(); return; }
      if (ml.mine) return;
      ml.mine = a === "me" ? me.name : other()?.name;
      send("date", { t: "ml-pick", who: ml.mine });
      paintLikely();
    };
  }
  function startLikely(order, mine, by) {
    Object.assign(ml, { order, i: 0, mine: null, theirs: null, score: 0, played: 0 });
    seenLikely();
    if (mine) send("date", { t: "ml-start", order });
    else if (by) toast(`${by} started Who's more likely`);
  }
  function nextLikely() { ml.i = (ml.i + 1) % ml.order.length; ml.mine = null; ml.theirs = null; seenLikely(); paintLikely(); }
  // each question shown counts once toward the round, on both phones
  let lastLikely = "";
  function seenLikely() {
    const k = `${ml.order.join(",").slice(0, 40)}:${ml.i}`;
    if (!ml.order.length || k === lastLikely) return;
    lastLikely = k;
    window.DU.deck.mark("likely", ml.order[ml.i]);
    window.DU.deck.count("likely");
  }
  function paintLikely(w = W().get("likely")) {
    if (!w) return;
    const p = other()?.name || "them";
    const qtext = LIKELY[ml.order[ml.i]];
    const both = ml.mine && ml.theirs;
    if (both && !ml.counted) { ml.counted = true; ml.played += 1; if (ml.mine === ml.theirs) ml.score += 1; }
    if (!both) ml.counted = false;
    w.body.innerHTML = `<div class="ml"><small class="ml-score">${ml.played ? `${ml.score} of ${ml.played} matched` : "Let's see"} · ${window.DU.deck.progress("likely").n}/${window.DU.deck.progress("likely").of}</small><p class="ml-q">Who's more likely to <b>${esc(qtext)}?</b></p>
      ${both ? `<div class="ml-rev ${ml.mine === ml.theirs ? "yes" : "no"}"><div><small>You said</small><b>${esc(ml.mine === me.name ? "Me" : p)}</b></div><div><small>${esc(p)} said</small><b>${esc(ml.theirs === me.name ? "You" : p)}</b></div></div>
        <p class="ml-res">${ml.mine === ml.theirs ? "Same answer! 💞" : "Ooh, you disagree 👀"}</p><button class="btn primary wide" data-ml="next">Next question</button>`
      : `<div class="ml-picks"><button data-ml="me" class="${ml.mine === me.name ? "on" : ""}"><span>🙋</span><b>Me</b></button><button data-ml="them" class="${ml.mine && ml.mine !== me.name ? "on" : ""}"><span>👉</span><b>${esc(p)}</b></button></div>
        <p class="fw-note center">${ml.mine ? `Waiting for ${esc(p)}…` : ml.theirs ? `${esc(p)} has answered. Your turn!` : "Answer in secret. It shows when you've both picked."}</p>`}</div>`;
  }

  // ---------- hooks ----------

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const run = { candle: openCandle, stars: openStars, likely: () => openLikely() }[button.dataset.tg];
      if (run) run(); else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "date") return prev.msg?.(message, peer);
      const d = message.data || {};
      if (d.t === "candle") { setCandle(Boolean(d.on), false); if (d.on) toast(`${peer.name} lit the candles 🕯️`); }
      if (d.t === "wish") toast(`${peer.name} made a wish on a shooting star ✨`);
      if (d.t === "ml-start" && Array.isArray(d.order)) { const order = d.order.map(Number).filter((i) => LIKELY[i]); if (W().get("likely")) { startLikely(order, false, peer.name); paintLikely(); } else openLikely(order, peer.name); }
      if (d.t === "ml-pick") { ml.theirs = String(d.who || ""); paintLikely(); }
      if (d.t === "ml-next") nextLikely();
    },
    onCoupleLeave(...args) {
      prev.leave?.(...args);
      setCandle(false, false);
      ["candle", "stars", "likely"].forEach((id) => W().get(id)?.close());
    },
  });
})();
