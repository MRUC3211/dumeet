// DU Meet · small things during a call: mood on your tile, reminders that ring for both,
// a warm night light, and a data saver for weak mobile networks.
// Uses globals from app.js (send, peers, me, toast, tileOf, polling) and window.DU hooks.

(() => {
  "use strict";
  const { q, esc, store } = window.DU.kit;
  const { openModal, closeModal } = window.DU;

  function sheet(title, html) {
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `<div class="sheet narrow"><header class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-modal-close aria-label="Close"><span class="icon">close</span></button></header><div class="sheet-body">${html}</div></div>`;
    document.body.append(modal);
    openModal(modal);
    const close = () => { closeModal(modal); setTimeout(() => modal.remove(), 400); };
    modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest("[data-modal-close]")) setTimeout(() => modal.remove(), 400); });
    return { modal, close };
  }

  // ---------- mood ----------

  const MOODS = [
    ["happy", "😊", "Happy"], ["loved", "🥰", "Loved"], ["missing", "🥺", "Missing you"], ["sleepy", "😴", "Sleepy"],
    ["busy", "📚", "Busy"], ["excited", "🥳", "Excited"], ["tired", "😮‍💨", "Tired"], ["upset", "😔", "Upset"],
    ["unwell", "🤒", "Not well"], ["angry", "😤", "Annoyed"],
  ];
  const moods = new Map(); // peer id -> mood key
  let myMood = store.get("du-mood", "");

  function paintMoods() {
    const all = new Map(moods);
    if (myMood && me.id) all.set(me.id, myMood);
    for (const tile of document.querySelectorAll("#grid .tile")) {
      const key = all.get(tile.dataset.id);
      const mood = MOODS.find((m) => m[0] === key);
      let badge = tile.querySelector(".mood-badge");
      if (!mood) { badge?.remove(); continue; }
      if (!badge) { badge = document.createElement("div"); badge.className = "mood-badge"; tile.append(badge); }
      if (badge.dataset.key !== key) { badge.dataset.key = key; badge.innerHTML = `<span>${mood[1]}</span><small>${mood[2]}</small>`; }
    }
    const tray = q("#tray-mood");
    const mine = MOODS.find((m) => m[0] === myMood);
    if (tray) tray.textContent = mine ? `${mine[1]} ${mine[2]}` : "How you feel";
  }
  setInterval(() => { if (polling) paintMoods(); }, 1500);

  function openMood() {
    window.DU.kit.toggleTray(false);
    const { modal, close } = sheet("How are you feeling?", `<div class="mood-grid">${MOODS.map(([k, e, l]) => `<button data-mood="${k}" class="${k === myMood ? "on" : ""}"><span>${e}</span><small>${l}</small></button>`).join("")}</div>
      ${myMood ? `<button class="btn ghost wide" data-mood="">Clear my mood</button>` : ""}`);
    modal.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mood]");
      if (!b) return;
      myMood = b.dataset.mood;
      store.set("du-mood", myMood);
      send("mood", { m: myMood });
      paintMoods();
      close();
    });
  }

  // ---------- reminders (ring on both phones) ----------

  let reminders = store.get("du-reminders", []).filter((r) => r.at > Date.now() - 60000);
  const saveReminders = () => store.set("du-reminders", reminders);

  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, .35, .7].forEach((t, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = [880, 1046, 1318][i];
        g.gain.setValueAtTime(0, ctx.currentTime + t);
        g.gain.linearRampToValueAtTime(.25, ctx.currentTime + t + .02);
        g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + t + .6);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .7);
      });
    } catch { /* no audio */ }
  }

  function ring(r) {
    chime();
    navigator.vibrate?.([200, 100, 200, 100, 300]);
    const { modal, close } = sheet("Reminder", `<div class="remind-ring"><span class="icon">alarm</span><b>${esc(r.label)}</b><small>Set by ${esc(r.by)}</small></div><button class="btn primary wide" data-ok>OK</button>`);
    q("[data-ok]", modal).addEventListener("click", close);
  }
  setInterval(() => {
    const due = reminders.filter((r) => r.at <= Date.now());
    if (!due.length) return;
    reminders = reminders.filter((r) => r.at > Date.now());
    saveReminders();
    due.forEach(ring);
  }, 5000);

  const timeText = (at) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  function openRemind() {
    window.DU.kit.toggleTray(false);
    const soon = new Date(Date.now() + 30 * 60000);
    const value = `${String(soon.getHours()).padStart(2, "0")}:${String(soon.getMinutes()).padStart(2, "0")}`;
    const { modal } = sheet("Reminder for both", `
      <form class="remind-form"><input class="field" name="label" maxlength="60" placeholder="What for? e.g. Sleep, study, call mom" required>
        <div class="remind-row"><input class="field" type="time" name="time" value="${value}" required><button class="btn primary">Set</button></div>
        <div class="remind-quick"><button type="button" data-in="15">in 15 min</button><button type="button" data-in="30">in 30 min</button><button type="button" data-in="60">in 1 hour</button></div></form>
      <ul class="remind-list"></ul>`);
    const list = () => {
      q(".remind-list", modal).innerHTML = reminders.length ? reminders.sort((a, b) => a.at - b.at).map((r) => `<li><span class="icon">alarm</span><div><b>${esc(r.label)}</b><small>${timeText(r.at)} · by ${esc(r.by)}</small></div><button class="icon-btn" data-del="${r.id}" aria-label="Remove"><span class="icon">close</span></button></li>`).join("") : `<li class="muted small">No reminders yet. Both phones ring at the time you set.</li>`;
    };
    list();
    const add = (at) => {
      const label = q("[name=label]", modal).value.trim() || "Reminder";
      reminders.push({ id: `${Date.now()}`, at, label, by: me.name });
      saveReminders();
      send("remind", { list: reminders });
      toast(`Reminder set for ${timeText(at)}`);
      q("[name=label]", modal).value = "";
      list();
    };
    q("form", modal).addEventListener("submit", (e) => {
      e.preventDefault();
      const [h, m] = q("[name=time]", modal).value.split(":").map(Number);
      const at = new Date(); at.setHours(h, m, 0, 0);
      if (at < Date.now()) at.setDate(at.getDate() + 1);
      add(at.getTime());
    });
    modal.addEventListener("click", (e) => {
      const quick = e.target.closest("[data-in]");
      if (quick) return add(Date.now() + Number(quick.dataset.in) * 60000);
      const del = e.target.closest("[data-del]");
      if (del) { reminders = reminders.filter((r) => r.id !== del.dataset.del); saveReminders(); send("remind", { list: reminders }); list(); }
    });
  }

  // ---------- night light ----------

  function paintNight() {
    const on = store.get("du-night", false);
    document.body.classList.toggle("night-light", on);
    const label = q("#tray-night");
    if (label) label.textContent = on ? "On · tap to turn off" : "Warm, dim screen";
    q("[data-tg=night]")?.classList.toggle("on", on);
  }
  paintNight();

  // ---------- data saver: lower video quality we send ----------

  let saver = store.get("du-saver", false);
  async function applySaver() {
    for (const peer of peers.values()) {
      for (const sender of peer.pc?.getSenders?.() || []) {
        if (sender.track?.kind !== "video") continue;
        const params = sender.getParameters();
        if (!params.encodings?.length) continue;
        const enc = params.encodings[0];
        const want = saver ? 180000 : undefined;
        if (enc.maxBitrate === want) continue;
        if (saver) { enc.maxBitrate = want; enc.scaleResolutionDownBy = 2; } else { delete enc.maxBitrate; delete enc.scaleResolutionDownBy; }
        try { await sender.setParameters(params); } catch { /* not supported */ }
      }
    }
  }
  function paintSaver() { const l = q("#saver-label"); if (l) l.textContent = `Data saver: ${saver ? "on" : "off"}`; }
  paintSaver();
  setInterval(() => { if (polling && saver) applySaver(); }, 4000);

  // ---------- hooks ----------

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, peer: window.DU.onCouplePeer, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const run = {
        mood: openMood,
        remind: openRemind,
        night: () => { store.set("du-night", !store.get("du-night", false)); paintNight(); },
        saver: () => { saver = !saver; store.set("du-saver", saver); paintSaver(); applySaver(); toast(saver ? "Data saver on · lower video quality" : "Data saver off"); },
      }[button.dataset.tg];
      if (run) run(); else prev.click?.(button);
    },
    onCouple(message, peer) {
      const data = message.data || {};
      if (message.type === "mood") {
        const before = moods.get(peer.id);
        if (data.m) moods.set(peer.id, String(data.m)); else moods.delete(peer.id);
        const mood = MOODS.find((m) => m[0] === data.m);
        if (mood && before !== data.m) toast(`${peer.name} is feeling ${mood[2].toLowerCase()} ${mood[1]}`);
        return paintMoods();
      }
      if (message.type === "remind") {
        if (!Array.isArray(data.list)) return;
        const known = new Set(reminders.map((r) => r.id));
        const fresh = data.list.filter((r) => r && typeof r.at === "number" && typeof r.label === "string").map((r) => ({ id: String(r.id), at: r.at, label: r.label.slice(0, 60), by: String(r.by || peer.name).slice(0, 40) }));
        fresh.filter((r) => !known.has(r.id) && r.at > Date.now()).forEach((r) => toast(`${r.by} set a reminder for ${timeText(r.at)}: ${r.label}`));
        reminders = fresh.filter((r) => r.at > Date.now() - 60000);
        return saveReminders();
      }
      prev.msg?.(message, peer);
    },
    onCouplePeer(...args) {
      prev.peer?.(...args);
      setTimeout(() => {
        if (myMood) send("mood", { m: myMood });
        if (reminders.length) send("remind", { list: reminders });
      }, 1800);
    },
    onCoupleLeave(...args) {
      prev.leave?.(...args);
      moods.clear();
    },
  });
})();
