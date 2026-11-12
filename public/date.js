// DU Meet · Date night, for a proper date over a call: date ideas, a candle-light dinner
// mood, stargazing, cooking together step by step, "who's more likely" and our bucket list.
// Each opens as a small movable window; the shared ones stay in step on both phones.

(() => {
  "use strict";
  const { q, esc, getDocs, putDoc } = window.DU.kit;
  const W = () => window.DU.win;
  const other = () => [...peers.values()][0];
  const tray = () => window.DU.kit.toggleTray(false);
  const needPartner = (what) => { if (other()) return true; toast(`${what} needs someone in the call`); return false; };
  let actx = null;
  const ac = () => { actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); return actx; };
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // =================================================================
  // Date ideas
  // =================================================================

  const IDEAS = [
    ["🍿", "Movie night", "Pick a movie in Watch, press play together, and keep the call on."],
    ["🍳", "Cook the same dish", "Choose a recipe in Cook together and make it side by side."],
    ["🌌", "Stargazing", "Turn the lights off, open Stargazing and make a wish together."],
    ["🕯️", "Candle-light dinner", "Dress up a little, light the candles and eat together."],
    ["🎨", "Draw each other", "Open Draw and sketch each other's face in 3 minutes. No peeking."],
    ["📸", "Photo booth", "Pull silly faces in 3 rounds and keep the strip."],
    ["🎶", "Song swap", "Each plays 3 songs that remind you of the other in Listen."],
    ["🗺️", "Plan a trip", "Pick a place you'll visit together and plan day one in detail."],
    ["📝", "Letters", "Write each other a short letter, then read them out loud."],
    ["🧩", "Game night", "Best of 5 in Chess or Ludo. Loser plans the next date."],
    ["☕", "Coffee date", "Make chai or coffee and talk about anything but work."],
    ["💭", "Deep questions", "Ask each other three questions you've never asked before."],
    ["🛍️", "Window shopping", "Browse the same store online and pick gifts for each other under a budget."],
    ["📚", "Read together", "Read a short story out loud, one page each."],
    ["🧘", "Calm evening", "Guided calm, then soft rain sounds and a slow talk."],
    ["🏠", "Dream home", "Design your future home room by room."],
    ["😂", "Try not to laugh", "Take turns making each other laugh. First to laugh loses."],
    ["🎤", "Karaoke", "Sing your favourite duet. Shower singer voice is allowed."],
    ["🍕", "Order in", "Order each other's dinner as a surprise."],
    ["🌅", "Sunrise or sunset", "Watch it together, one on each side of the call."],
    ["🎂", "Bake a mug cake", "Five minutes in the microwave. Decorate and show off."],
    ["📅", "Throwback night", "Scroll old photos together and tell the story of each."],
    ["💌", "Compliment battle", "Take turns giving compliments. Whoever repeats one loses."],
    ["🌍", "Learn something", "Learn 10 words of a new language together."],
    ["🎯", "Bucket list", "Add 5 new things to your bucket list."],
    ["🏃", "Walk and talk", "Go for a walk at the same time and keep the call on."],
  ];
  function openIdeas(idea) {
    tray();
    const w = W().open({ id: "ideas", title: "Date ideas", icon: "lightbulb", w: 330, h: 380, tone: "rose",
      html: `<div class="di"><span class="di-e"></span><b class="di-t"></b><p class="di-p"></p>
        <div class="di-acts"><button class="btn ghost" data-di="next"><span class="icon">shuffle</span>Another</button><button class="btn primary" data-di="send"><span class="icon">favorite</span>Let's do this</button></div>
        <button class="di-save" data-di="save"><span class="icon">playlist_add</span>Add to our bucket list</button></div>` });
    let cur = idea || pick(IDEAS);
    const paint = () => { q(".di-e", w.body).textContent = cur[0]; q(".di-t", w.body).textContent = cur[1]; q(".di-p", w.body).textContent = cur[2]; const card = q(".di", w.body); card.classList.remove("in"); void card.offsetWidth; card.classList.add("in"); };
    paint();
    w.body.onclick = async (e) => {
      const a = e.target.closest("[data-di]")?.dataset.di;
      if (a === "next") { let n; do n = pick(IDEAS); while (n === cur); cur = n; paint(); }
      if (a === "send") { if (!needPartner("Sharing an idea")) return; send("date", { t: "idea", i: IDEAS.indexOf(cur) }); toast(`Sent to ${other().name} 💕`); }
      if (a === "save") { await addBucket(`${cur[0]} ${cur[1]}`); }
    };
  }

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
  // Cook together
  // =================================================================

  const RECIPES = [
    { k: "maggi", e: "🍜", name: "Masala Maggi", time: "10 min", steps: [
      ["Chop half an onion, one tomato and a green chilli.", 0], ["Heat a little oil, fry the onion till soft.", 120], ["Add tomato, chilli and a pinch of salt. Cook till mushy.", 90],
      ["Add 1.5 cups of water and the tastemaker. Bring to a boil.", 120], ["Break in the noodles. Cook, stirring now and then.", 120], ["Top with coriander. Eat together!", 0]] },
    { k: "chai", e: "☕", name: "Masala chai", time: "8 min", steps: [
      ["Crush 2 cardamoms and a small piece of ginger.", 0], ["Boil 1 cup water with the ginger and cardamom.", 120], ["Add 2 tsp tea leaves and sugar to taste.", 60],
      ["Add 1 cup milk and bring to a boil twice.", 180], ["Strain into your favourite mug. Cheers!", 0]] },
    { k: "coldcoffee", e: "🧋", name: "Cold coffee", time: "5 min", steps: [
      ["Add 2 tsp coffee, 2 tsp sugar and 2 tbsp warm water to a jar.", 0], ["Shake or whisk till it's frothy and light.", 60], ["Add a glass of cold milk and lots of ice.", 0],
      ["Blend or shake again for a creamy top.", 30], ["Drizzle chocolate on the glass and pour. Done!", 0]] },
    { k: "omelette", e: "🍳", name: "Fluffy omelette", time: "8 min", steps: [
      ["Beat 2 eggs with salt, pepper and a splash of milk.", 0], ["Chop onion, tomato, chilli and coriander. Mix in.", 0], ["Heat butter in a pan on medium.", 60],
      ["Pour in the eggs. Leave them to set.", 120], ["Fold in half and cook a little more.", 45], ["Slide onto a plate with toast.", 0]] },
    { k: "mugcake", e: "🧁", name: "Chocolate mug cake", time: "5 min", steps: [
      ["In a big mug: 4 tbsp flour, 3 tbsp sugar, 2 tbsp cocoa, a pinch of baking powder.", 0], ["Add 3 tbsp milk, 2 tbsp oil and a drop of vanilla. Mix well.", 0],
      ["Drop a few chocolate chips on top.", 0], ["Microwave on high.", 75], ["Let it cool a minute. Add ice cream if you have it!", 60]] },
    { k: "sandwich", e: "🥪", name: "Masala sandwich", time: "12 min", steps: [
      ["Mash 1 boiled potato with salt, chaat masala and chopped onion.", 0], ["Butter 4 slices of bread. Spread green chutney.", 0], ["Fill with the potato, tomato and cucumber slices.", 0],
      ["Toast on a pan, pressing down.", 150], ["Flip and toast the other side.", 120], ["Cut into triangles. Ketchup on the side!", 0]] },
  ];
  const cook = { r: "", step: 0, timerEnd: 0, tick: 0 };
  function openCook() {
    tray();
    const w = W().open({ id: "cook", title: "Cook together", icon: "skillet", w: 350, h: 470, onClose: () => { clearInterval(cook.tick); } });
    paintCook(w);
    w.body.onclick = (e) => {
      const r = e.target.closest("[data-rc]")?.dataset.rc;
      if (r !== undefined) { setCook(r, 0, true); return; }
      const a = e.target.closest("[data-ck]")?.dataset.ck;
      if (a === "next" || a === "prev") setCook(cook.r, cook.step + (a === "next" ? 1 : -1), true);
      if (a === "timer") startCookTimer(true);
      if (a === "back") setCook("", 0, true);
    };
    clearInterval(cook.tick);
    cook.tick = setInterval(() => paintTimerOnly(w), 500);
  }
  function setCook(r, step, mine) {
    const rec = RECIPES.find((x) => x.k === r);
    cook.r = rec ? r : "";
    cook.step = rec ? Math.max(0, Math.min(rec.steps.length - 1, step)) : 0;
    cook.timerEnd = 0;
    if (mine) send("date", { t: "cook", r: cook.r, s: cook.step });
    const w = W().get("cook");
    if (w) paintCook(w);
  }
  function startCookTimer(mine) {
    const rec = RECIPES.find((x) => x.k === cook.r);
    const secs = rec?.steps[cook.step]?.[1];
    if (!secs) return;
    cook.timerEnd = Date.now() + secs * 1000;
    cook.rang = false;
    if (mine) send("date", { t: "cook-timer" });
  }
  function paintTimerOnly(w) {
    const el = w && q(".ck-timer b", w.body);
    if (!el || !cook.timerEnd) return;
    const left = cook.timerEnd - Date.now();
    el.textContent = left > 0 ? `${Math.floor(left / 60000)}:${String(Math.ceil(left / 1000) % 60).padStart(2, "0")}` : "Done!";
    if (left <= 0 && !cook.rang) { cook.rang = true; try { const c = ac(), t = c.currentTime; [0, .3, .6].forEach((a) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 1046; g.gain.setValueAtTime(.12, t + a); g.gain.exponentialRampToValueAtTime(.001, t + a + .25); o.connect(g).connect(c.destination); o.start(t + a); o.stop(t + a + .3); }); } catch { /* no audio */ } navigator.vibrate?.([200, 100, 200]); }
  }
  function paintCook(w) {
    const rec = RECIPES.find((x) => x.k === cook.r);
    if (!rec) {
      w.setTitle("Cook together");
      w.body.innerHTML = `<p class="fw-note">Pick a recipe. You'll both see the same step, with timers.</p><div class="rc-list">${RECIPES.map((r) => `<button data-rc="${r.k}"><span>${r.e}</span><b>${r.name}</b><small>${r.time}</small></button>`).join("")}</div>`;
      return;
    }
    const [text, secs] = rec.steps[cook.step];
    w.setTitle(`${rec.e} ${rec.name}`);
    w.body.innerHTML = `<div class="ck"><div class="gd-dots">${rec.steps.map((_, i) => `<i class="${i <= cook.step ? "on" : ""}"></i>`).join("")}</div>
      <small class="ck-n">Step ${cook.step + 1} of ${rec.steps.length}</small><p class="ck-t">${esc(text)}</p>
      ${secs ? `<button class="ck-timer" data-ck="timer"><span class="icon">timer</span><b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}</b><small>Start timer</small></button>` : ""}
      <div class="gd-acts"><button class="btn ghost" data-ck="prev"${cook.step ? "" : " disabled"}><span class="icon">arrow_back</span>Back</button>${cook.step < rec.steps.length - 1 ? `<button class="btn primary" data-ck="next">Next<span class="icon">arrow_forward</span></button>` : `<button class="btn primary" data-ck="back"><span class="icon">restaurant</span>Done</button>`}</div>
      <button class="di-save" data-ck="back"><span class="icon">menu_book</span>All recipes</button></div>`;
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
  const ml = { order: [], i: 0, mine: null, theirs: null, score: 0, played: 0 };
  function openLikely(seed, by) {
    tray();
    if (!needPartner("Who's more likely")) return;
    const w = W().open({ id: "likely", title: "Who's more likely", icon: "group", w: 340, h: 400, tone: "rose", onClose: () => { ml.order = []; } });
    if (seed) startLikely(seed, false, by); else if (!ml.order.length) startLikely(Array.from({ length: LIKELY.length }, (_, i) => i).sort(() => Math.random() - .5), true);
    paintLikely(w);
    w.body.onclick = (e) => {
      const a = e.target.closest("[data-ml]")?.dataset.ml;
      if (!a) return;
      if (a === "next") { send("date", { t: "ml-next" }); nextLikely(); return; }
      if (ml.mine) return;
      ml.mine = a === "me" ? me.name : other()?.name;
      send("date", { t: "ml-pick", who: ml.mine });
      paintLikely();
    };
  }
  function startLikely(order, mine, by) {
    Object.assign(ml, { order, i: 0, mine: null, theirs: null, score: 0, played: 0 });
    if (mine) send("date", { t: "ml-start", order });
    else if (by) toast(`${by} started Who's more likely`);
  }
  function nextLikely() { ml.i = (ml.i + 1) % ml.order.length; ml.mine = null; ml.theirs = null; paintLikely(); }
  function paintLikely(w = W().get("likely")) {
    if (!w) return;
    const p = other()?.name || "them";
    const qtext = LIKELY[ml.order[ml.i]];
    const both = ml.mine && ml.theirs;
    if (both && !ml.counted) { ml.counted = true; ml.played += 1; if (ml.mine === ml.theirs) ml.score += 1; }
    if (!both) ml.counted = false;
    w.body.innerHTML = `<div class="ml"><small class="ml-score">${ml.played ? `${ml.score} of ${ml.played} matched` : "Round 1"}</small><p class="ml-q">Who's more likely to <b>${esc(qtext)}?</b></p>
      ${both ? `<div class="ml-rev ${ml.mine === ml.theirs ? "yes" : "no"}"><div><small>You said</small><b>${esc(ml.mine === me.name ? "Me" : p)}</b></div><div><small>${esc(p)} said</small><b>${esc(ml.theirs === me.name ? "You" : p)}</b></div></div>
        <p class="ml-res">${ml.mine === ml.theirs ? "Same answer! 💞" : "Ooh, you disagree 👀"}</p><button class="btn primary wide" data-ml="next">Next question</button>`
      : `<div class="ml-picks"><button data-ml="me" class="${ml.mine === me.name ? "on" : ""}"><span>🙋</span><b>Me</b></button><button data-ml="them" class="${ml.mine && ml.mine !== me.name ? "on" : ""}"><span>👉</span><b>${esc(p)}</b></button></div>
        <p class="fw-note center">${ml.mine ? `Waiting for ${esc(p)}…` : ml.theirs ? `${esc(p)} has answered. Your turn!` : "Answer in secret. It shows when you've both picked."}</p>`}</div>`;
  }

  // =================================================================
  // Our bucket list
  // =================================================================

  let bucket = null;
  async function loadBucket() {
    try { bucket = (await getDocs("settings")).find((d) => d.id === "bucket")?.data || { items: [] }; } catch { bucket ||= { items: [] }; }
    if (!Array.isArray(bucket.items)) bucket.items = [];
    return bucket;
  }
  async function saveBucket() {
    try { await putDoc("settings", bucket, "bucket"); send("date", { t: "bucket" }); } catch { toast("Couldn't save. Check the internet."); }
    paintBucket();
  }
  async function addBucket(text) {
    await loadBucket();
    if (bucket.items.some((i) => i.text === text)) return toast("Already on your bucket list");
    bucket.items.unshift({ id: `${Date.now()}`, text: text.slice(0, 120), by: me.name, done: false });
    await saveBucket();
    toast("Added to your bucket list ✨");
  }
  async function openBucket() {
    tray();
    const w = W().open({ id: "bucket", title: "Our bucket list", icon: "checklist", w: 350, h: 480,
      html: `<form class="bl-add"><input class="field" maxlength="120" placeholder="Something to do together…"><button class="btn primary" aria-label="Add"><span class="icon">add</span></button></form><ul class="bl"></ul>` });
    q(".bl-add", w.body).onsubmit = (e) => { e.preventDefault(); const i = q(".bl-add input", w.body); const t = i.value.trim(); if (t) { addBucket(t); i.value = ""; } };
    q(".bl", w.body).onclick = async (e) => {
      const t = e.target.closest("[data-bt]"), d = e.target.closest("[data-bd]");
      if (!t && !d) return;
      await loadBucket();
      if (t) { const it = bucket.items.find((x) => x.id === t.dataset.bt); if (it) { it.done = !it.done; if (it.done) toast("Done together! 🎉"); } }
      if (d) bucket.items = bucket.items.filter((x) => x.id !== d.dataset.bd);
      saveBucket();
    };
    q(".bl", w.body).innerHTML = `<li class="bl-empty">Loading…</li>`;
    await loadBucket();
    paintBucket();
  }
  function paintBucket() {
    const w = W().get("bucket");
    if (!w || !bucket) return;
    const list = q(".bl", w.body);
    const items = [...bucket.items.filter((i) => !i.done), ...bucket.items.filter((i) => i.done)];
    list.innerHTML = items.length ? items.map((i) => `<li class="${i.done ? "done" : ""}"><button data-bt="${esc(i.id)}" aria-label="Mark done"><span class="icon">${i.done ? "check_circle" : "radio_button_unchecked"}</span></button><span>${esc(i.text)}<small>${esc(i.by || "")}</small></span><button class="bl-x" data-bd="${esc(i.id)}" aria-label="Remove"><span class="icon">close</span></button></li>`).join("")
      : `<li class="bl-empty">Nothing yet. Add your first dream together.</li>`;
    const done = bucket.items.filter((i) => i.done).length;
    w.setTitle(bucket.items.length ? `Our bucket list · ${done}/${bucket.items.length}` : "Our bucket list");
  }

  // ---------- hooks ----------

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const run = { ideas: () => openIdeas(), candle: openCandle, stars: openStars, cook: openCook, likely: () => openLikely(), bucket: openBucket }[button.dataset.tg];
      if (run) run(); else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "date") return prev.msg?.(message, peer);
      const d = message.data || {};
      if (d.t === "idea" && IDEAS[d.i]) { openIdeas(IDEAS[d.i]); toast(`${peer.name} wants to: ${IDEAS[d.i][1]} 💕`); }
      if (d.t === "candle") { setCandle(Boolean(d.on), false); if (d.on) toast(`${peer.name} lit the candles 🕯️`); }
      if (d.t === "wish") toast(`${peer.name} made a wish on a shooting star ✨`);
      if (d.t === "cook") { if (!W().get("cook") && d.r) { openCook(); toast(`${peer.name} is cooking with you 🍳`); } setCook(String(d.r || ""), Number(d.s) || 0, false); }
      if (d.t === "cook-timer") startCookTimer(false);
      if (d.t === "ml-start" && Array.isArray(d.order)) { const order = d.order.map(Number).filter((i) => LIKELY[i]); if (W().get("likely")) { startLikely(order, false, peer.name); paintLikely(); } else openLikely(order, peer.name); }
      if (d.t === "ml-pick") { ml.theirs = String(d.who || ""); paintLikely(); }
      if (d.t === "ml-next") nextLikely();
      if (d.t === "bucket") loadBucket().then(paintBucket);
    },
    onCoupleLeave(...args) {
      prev.leave?.(...args);
      setCandle(false, false);
      ["ideas", "candle", "stars", "cook", "likely", "bucket"].forEach((id) => W().get(id)?.close());
    },
  });
})();
