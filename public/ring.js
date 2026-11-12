// DU Meet · reaching each other outside the call:
//  - Ring: rings the other one's phone (a notification), even when the app is closed.
//  - Wrapped: the month in numbers, as full-screen story cards.
//  - Time & weather: share your local time and weather on your tile (only when you turn it on).
// Uses globals from app.js (prefs, me, peers, send, toast, polling, tileOf) and window.DU.

(() => {
  "use strict";
  const { q, esc, store } = window.DU.kit;
  const { openModal, closeModal } = window.DU;
  const PEOPLE = ["Uday", "Diya"];
  const partner = () => PEOPLE.find((p) => p.toLowerCase() !== String(prefs.name || "").toLowerCase()) || "them";

  // ---------- ring ----------

  const pushOk = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIos = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const b64ToBytes = (s) => { const pad = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };

  async function subscribe(ask) {
    if (!pushOk() || !prefs.name) return false;
    if (Notification.permission === "denied") return false;
    if (Notification.permission !== "granted") {
      if (!ask) return false;
      if ((await Notification.requestPermission()) !== "granted") return false;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const { key } = await (await fetch("/api/push/key")).json();
      let sub = await reg.pushManager.getSubscription();
      const current = sub?.options?.applicationServerKey;
      if (sub && current && btoa(String.fromCharCode(...new Uint8Array(current))).replace(/=+$/, "") !== btoa(String.fromCharCode(...b64ToBytes(key))).replace(/=+$/, "")) {
        await sub.unsubscribe(); sub = null;
      }
      sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      const res = await fetch("/api/push/subscribe", { method: "POST", body: JSON.stringify({ name: prefs.name, endpoint: sub.endpoint }) });
      return res.ok;
    } catch (error) {
      console.warn("DU Meet: push subscribe failed", error);
      return false;
    }
  }

  function paintAlerts(on) {
    const line = q("#alerts-line");
    if (!line) return;
    const name = partner();
    if (!prefs.name) { line.hidden = true; return; }
    if (on) { line.hidden = true; return; }
    line.hidden = false;
    if (isIos && !standalone) line.innerHTML = `<span class="icon">notifications</span><span>To get rings from ${esc(name)} on iPhone, add DU Meet to your Home Screen first</span>`;
    else if (!pushOk()) line.innerHTML = `<span class="icon">notifications_off</span><span>This browser can't receive rings</span>`;
    else if (Notification.permission === "denied") line.innerHTML = `<span class="icon">notifications_off</span><span>Rings are blocked. Allow notifications for DU Meet in your settings.</span>`;
    else line.innerHTML = `<span class="icon">notifications_active</span><span>Get a ring when ${esc(name)} calls</span><b>Turn on</b>`;
    line.classList.toggle("can", pushOk() && Notification.permission === "default" && !(isIos && !standalone));
  }

  async function refreshAlerts() {
    const on = pushOk() && Notification.permission === "granted" && (await subscribe(false));
    paintAlerts(on);
    const ringBtn = q("[data-home=ring] .ring-label");
    if (ringBtn) ringBtn.textContent = `Ring ${partner()}`;
  }

  async function ring({ thenJoin }) {
    if (!prefs.name) return q("[data-home=who]")?.click();
    await subscribe(true); // so they can ring back
    const name = partner();
    let result;
    try { result = await (await fetch("/api/push/ring", { method: "POST", body: JSON.stringify({ from: prefs.name }) })).json(); }
    catch { return toast("Couldn't ring. Check the internet."); }
    if (result.wait) return toast(`Already ringing ${name}…`);
    if (!result.sent) {
      return infoSheet(`${name} can't get rings yet`, `<p class="muted">Ask ${esc(name)} to open DU Meet on their phone and tap <b>Turn on</b> under the Join button once. On iPhone, add DU Meet to the Home Screen first.</p>`);
    }
    toast(`Ringing ${name}…`);
    navigator.vibrate?.(40);
    if (thenJoin && document.body.dataset.view === "home") q("[data-home=join]")?.click();
  }

  // the ring notification was tapped while the app was already open
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "ring-open" && document.body.dataset.view === "home") q("[data-home=join]")?.click();
  });

  function infoSheet(title, html) {
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `<div class="sheet narrow"><header class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-modal-close aria-label="Close"><span class="icon">close</span></button></header><div class="sheet-body">${html}<button class="btn primary wide" data-modal-close style="margin-top:16px">OK</button></div></div>`;
    document.body.append(modal);
    openModal(modal);
    modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest("[data-modal-close]")) { closeModal(modal); setTimeout(() => modal.remove(), 400); } });
  }

  // ---------- wrapped: the month as story cards ----------

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const span = (s) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };
  const hourText = (h) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
  const wr = { el: null, i: 0, slides: [], timer: 0, start: 0, paused: false, y: 0, m: 0 };

  async function openWrapped(y, m) {
    const now = new Date();
    wr.y = y ?? now.getFullYear(); wr.m = m ?? now.getMonth();
    const key = `${wr.y}-${String(wr.m + 1).padStart(2, "0")}`;
    let data;
    try { data = await (await fetch(`/api/wrapped?m=${key}&tz=${new Date().getTimezoneOffset()}`)).json(); }
    catch { return toast("Couldn't load your month. Check the internet."); }
    buildWrapped(data);
  }

  function buildWrapped(d) {
    closeWrapped();
    const month = MONTHS[wr.m];
    const faces = PEOPLE.map((n) => { const u = window.DU.faceFor?.(n); return `<span class="wr-face">${u ? `<img src="${esc(u)}" alt="">` : esc(n[0])}</span>`; }).join("");
    const inMonth = new Date(wr.y, wr.m + 1, 0).getDate();
    const firstDow = (new Date(wr.y, wr.m, 1).getDay() + 6) % 7;
    const cal = `<div class="wr-cal">${["M", "T", "W", "T", "F", "S", "S"].map((x) => `<i class="h">${x}</i>`).join("")}${"<i></i>".repeat(firstDow)}${Array.from({ length: inMonth }, (_, k) => `<i class="${d.days.includes(k + 1) ? "on" : ""}">${k + 1}</i>`).join("")}</div>`;
    const people = Object.entries(d.people || {}).sort((a, b) => b[1] - a[1]);
    const maxP = Math.max(1, ...people.map((p) => p[1]));
    const empty = !d.calls;
    wr.slides = empty ? [
      { tone: "a", html: `<div class="wr-faces">${faces}</div><small>Your ${month}</small><h2>No calls yet this month</h2><p>Your recap fills up as you talk. Come back after a few calls.</p>` },
    ] : [
      { tone: "a", html: `<div class="wr-faces">${faces}</div><small>DU Meet Wrapped</small><h2>Your ${month},<br>together</h2><p>Tap to see how it went</p>` },
      { tone: "b", html: `<small>Time together</small><h1>${span(d.secs)}</h1><p>across <b>${d.calls}</b> call${d.calls === 1 ? "" : "s"}</p>` },
      { tone: "c", html: `<small>You talked on</small><h1>${d.days.length} <span>day${d.days.length === 1 ? "" : "s"}</span></h1>${cal}<p>Longest streak: <b>${d.streak} day${d.streak === 1 ? "" : "s"}</b> in a row</p>` },
      { tone: "d", html: `<small>Your favourite time</small><h1>${d.topHour === null ? "–" : hourText(d.topHour)}</h1><p>${d.topWeekday === null ? "" : `<b>${DAYS[d.topWeekday]}</b> was your day`}</p>` },
      { tone: "e", html: `<small>Longest call</small><h1>${span(d.longest)}</h1><div class="wr-mini"><div><b>${d.chats}</b><span>messages</span></div><div><b>${d.photos}</b><span>photos</span></div></div>` },
      { tone: "f", html: `<small>Who stayed longer</small><div class="wr-bars">${people.map(([n, s]) => `<div><span>${esc(n)}</span><i style="--w:${Math.round((s / maxP) * 100)}%"></i><b>${span(s)}</b></div>`).join("")}</div><h2 class="wr-end">See you next month 💕</h2>` },
    ];
    const el = document.createElement("div");
    el.className = "wr";
    el.innerHTML = `
      <div class="wr-bars-top">${wr.slides.map(() => "<i><b></b></i>").join("")}</div>
      <header class="wr-head"><button class="wr-nav" data-wr="prev-month" aria-label="Previous month"><span class="icon">chevron_left</span></button><span>${month} ${wr.y}</span><button class="wr-nav" data-wr="next-month" aria-label="Next month" ${wr.y === new Date().getFullYear() && wr.m === new Date().getMonth() ? "disabled" : ""}><span class="icon">chevron_right</span></button><button class="wr-nav" data-wr="close" aria-label="Close"><span class="icon">close</span></button></header>
      <div class="wr-stage">${wr.slides.map((s, k) => `<section class="wr-slide t-${s.tone}" data-k="${k}">${s.html}</section>`).join("")}</div>`;
    document.body.append(el);
    wr.el = el;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-wr]");
      if (b) {
        const act = b.dataset.wr;
        if (act === "close") return closeWrapped();
        const m = wr.m + (act === "prev-month" ? -1 : 1);
        return openWrapped(wr.y + Math.floor(m / 12), (m + 12) % 12);
      }
      const x = e.clientX / window.innerWidth;
      go(x < .3 ? wr.i - 1 : wr.i + 1);
    });
    el.addEventListener("pointerdown", () => { wr.paused = true; });
    el.addEventListener("pointerup", () => { wr.paused = false; });
    document.addEventListener("keydown", wrKeys);
    go(0);
    tick();
  }

  function wrKeys(e) {
    if (!wr.el) return;
    if (e.key === "Escape") closeWrapped();
    if (e.key === "ArrowRight") go(wr.i + 1);
    if (e.key === "ArrowLeft") go(wr.i - 1);
  }

  function go(i) {
    if (!wr.el) return;
    if (i >= wr.slides.length) return closeWrapped();
    wr.i = Math.max(0, i);
    wr.start = performance.now();
    wr.el.querySelectorAll(".wr-slide").forEach((s, k) => s.classList.toggle("on", k === wr.i));
    wr.el.querySelectorAll(".wr-bars-top b").forEach((b, k) => { b.style.width = k < wr.i ? "100%" : "0%"; });
  }

  function tick() {
    if (!wr.el) return;
    wr.timer = requestAnimationFrame(tick);
    if (wr.paused) { wr.start += 16; return; }
    const p = Math.min(1, (performance.now() - wr.start) / 5500);
    const bar = wr.el.querySelectorAll(".wr-bars-top b")[wr.i];
    if (bar) bar.style.width = `${p * 100}%`;
    if (p >= 1 && wr.i < wr.slides.length - 1) go(wr.i + 1);
  }

  function closeWrapped() {
    cancelAnimationFrame(wr.timer);
    document.removeEventListener("keydown", wrKeys);
    wr.el?.remove();
    wr.el = null;
  }

  // ---------- time & weather on your tile (only when you turn it on) ----------

  const WX = [[0, "☀️", "🌙"], [1, "🌤️", "🌙"], [2, "⛅", "☁️"], [3, "☁️", "☁️"], [45, "🌫️", "🌫️"], [51, "🌦️", "🌧️"], [61, "🌧️", "🌧️"], [71, "🌨️", "🌨️"], [80, "🌦️", "🌧️"], [95, "⛈️", "⛈️"]];
  const wxIcon = (code, day) => { let pick = WX[0]; for (const w of WX) if (code >= w[0]) pick = w; return day ? pick[1] : pick[2]; };
  let whereOn = store.get("du-where", false);
  let mine = null;               // what we share
  const theirs = new Map();      // peer id -> what they share

  async function readWhere() {
    const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { maximumAge: 30 * 60000, timeout: 12000 }));
    const lat = pos.coords.latitude.toFixed(2), lon = pos.coords.longitude.toFixed(2);
    const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day`)).json();
    mine = { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, t: Math.round(w.current.temperature_2m), c: w.current.weather_code, d: w.current.is_day };
  }
  async function shareWhere(force) {
    if (!whereOn || !polling) return;
    if (!mine || force) { try { await readWhere(); } catch { toast("Couldn't read your weather. Allow location for DU Meet."); return; } }
    send("where", mine);
  }
  function paintWhereLabel() { const l = q("#where-label"); if (l) l.textContent = `Time & weather: ${whereOn ? "on" : "off"}`; }
  async function toggleWhere() {
    whereOn = !whereOn;
    store.set("du-where", whereOn);
    paintWhereLabel();
    if (whereOn) { await shareWhere(true); if (mine) toast("Sharing your time and weather"); }
    else { mine = null; send("where", { off: true }); toast("Stopped sharing time and weather"); }
  }
  function paintWhere() {
    for (const [id, w] of theirs) {
      const tile = tileOf(id);
      if (!tile) continue;
      let chip = tile.querySelector(".where-chip");
      if (!chip) { chip = document.createElement("div"); chip.className = "where-chip"; tile.append(chip); }
      let time = "";
      try { time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: w.tz }); } catch { /* bad zone */ }
      chip.textContent = `${wxIcon(w.c, w.d)} ${w.t}° · ${time}`;
    }
    for (const chip of document.querySelectorAll("#grid .where-chip")) if (!theirs.has(chip.closest(".tile")?.dataset.id)) chip.remove();
  }
  setInterval(() => { if (polling && theirs.size) paintWhere(); }, 15000);
  setInterval(() => shareWhere(true), 10 * 60000);
  paintWhereLabel();

  // ---------- hooks ----------

  document.addEventListener("click", (event) => {
    const b = event.target.closest("[data-home=ring], [data-home=alerts], [data-home=wrapped]");
    if (!b) return;
    if (b.dataset.home === "ring") ring({ thenJoin: true });
    else if (b.dataset.home === "wrapped") openWrapped();
    else subscribe(true).then((ok) => { paintAlerts(ok); if (ok) toast(`You'll get a ring when ${partner()} calls`); else if (Notification?.permission === "denied") toast("Notifications are blocked for DU Meet"); });
  });

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, peer: window.DU.onCouplePeer, leave: window.DU.onCoupleLeave, home: window.DU.onHome };
  Object.assign(window.DU, {
    onHome(...args) { prev.home?.(...args); refreshAlerts(); },
    onCoupleClick(button) {
      const tg = button.dataset.tg;
      if (tg === "ring-now") { window.DU.kit.toggleTray(false); ring({ thenJoin: false }); }
      else if (tg === "where") toggleWhere();
      else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "where") return prev.msg?.(message, peer);
      const d = message.data || {};
      if (d.off) theirs.delete(peer.id);
      else if (typeof d.tz === "string" && Number.isFinite(d.t)) theirs.set(peer.id, { tz: d.tz.slice(0, 60), t: Math.round(d.t), c: Number(d.c) || 0, d: d.d ? 1 : 0 });
      paintWhere();
    },
    onCouplePeer(...args) { prev.peer?.(...args); setTimeout(() => shareWhere(false), 2000); },
    onCoupleLeave(...args) { prev.leave?.(...args); theirs.clear(); paintWhere(); },
  });
  refreshAlerts();
})();
