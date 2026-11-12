// DU Meet · small things during a call: reminders that ring for both,
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


  // ---------- signal bars: how good the line to the other person is ----------

  const lineStats = new Map(); // peer id -> { lost, recv, q, rtt, loss }
  async function measure() {
    if (!polling) return;
    for (const peer of peers.values()) {
      let rtt = null, lost = 0, recv = 0;
      try {
        (await peer.pc.getStats()).forEach((r) => {
          if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded" && typeof r.currentRoundTripTime === "number") rtt = r.currentRoundTripTime;
          if (r.type === "inbound-rtp" && !r.isRemote) { lost += r.packetsLost || 0; recv += r.packetsReceived || 0; }
        });
      } catch { continue; }
      const prev = lineStats.get(peer.id) || { lost, recv };
      const dl = Math.max(0, lost - prev.lost), dr = Math.max(0, recv - prev.recv);
      const loss = dl + dr ? dl / (dl + dr) : 0;
      const qual = rtt === null ? 0 : rtt > .6 || loss > .08 ? 1 : rtt > .25 || loss > .02 ? 2 : 3;
      lineStats.set(peer.id, { lost, recv, q: qual, rtt, loss });
      const tile = tileOf(peer.id);
      const label = tile?.querySelector(".tile-name");
      if (!label) continue;
      let sig = label.querySelector(".sig");
      if (!sig) { sig = document.createElement("button"); sig.className = "sig"; sig.type = "button"; sig.innerHTML = "<i></i><i></i><i></i>"; label.append(sig); }
      sig.dataset.q = qual;
      sig.dataset.peer = peer.id;
      sig.setAttribute("aria-label", `Connection: ${["checking", "weak", "okay", "good"][qual]}`);
    }
  }
  setInterval(measure, 3000);
  document.addEventListener("click", (e) => {
    const sig = e.target.closest(".sig");
    if (!sig) return;
    const st = lineStats.get(sig.dataset.peer);
    const peer = peers.get(sig.dataset.peer);
    if (!st || !peer) return;
    toast(`Line to ${peer.name}: ${["checking…", "weak", "okay", "good"][st.q]}${st.rtt !== null ? ` · delay ${Math.round(st.rtt * 1000)} ms` : ""} · loss ${Math.round(st.loss * 100)}%`);
  });

  // ---------- "you're muted" when you talk with the mic off ----------

  const hush = { clone: null, ctx: null, an: null, loud: 0, warnedAt: 0 };
  function stopHush() { hush.clone?.stop(); hush.ctx?.close().catch(() => {}); Object.assign(hush, { clone: null, ctx: null, an: null, loud: 0 }); }
  setInterval(() => {
    const track = typeof micTrack === "function" ? micTrack() : null;
    if (!polling || me.mic || !track || track.readyState !== "live") { if (hush.clone) stopHush(); return; }
    if (!hush.clone) {
      try {
        hush.clone = track.clone(); hush.clone.enabled = true;
        hush.ctx = new (window.AudioContext || window.webkitAudioContext)();
        hush.an = hush.ctx.createAnalyser(); hush.an.fftSize = 512;
        hush.ctx.createMediaStreamSource(new MediaStream([hush.clone])).connect(hush.an);
      } catch { stopHush(); return; }
    }
    const buf = new Uint8Array(hush.an.fftSize);
    hush.an.getByteTimeDomainData(buf);
    let sum = 0; for (const v of buf) sum += (v - 128) ** 2;
    const level = Math.sqrt(sum / buf.length);
    hush.loud = level > 9 ? hush.loud + 1 : Math.max(0, hush.loud - 1);
    if (hush.loud >= 6 && Date.now() - hush.warnedAt > 25000) {
      hush.warnedAt = Date.now(); hush.loud = 0;
      toast("You're muted. Tap the mic to talk.");
      document.querySelector('[data-action="mic"]')?.classList.add("nudge");
      setTimeout(() => document.querySelector('[data-action="mic"]')?.classList.remove("nudge"), 1600);
    }
  }, 250);

  // ---------- battery: tell the other one when your phone is about to die ----------

  const batteries = new Map(); // peer id -> { l, c }
  let battery = null;
  const shareBattery = () => { if (battery && polling) send("batt", { l: Math.round(battery.level * 100), c: battery.charging }); };
  navigator.getBattery?.().then((b) => {
    battery = b;
    b.addEventListener("levelchange", shareBattery);
    b.addEventListener("chargingchange", shareBattery);
  }).catch(() => {});
  function paintBattery() {
    for (const [id, b] of batteries) {
      const label = tileOf(id)?.querySelector(".tile-name");
      if (!label) continue;
      let el = label.querySelector(".batt");
      const low = b.l <= 20 && !b.c;
      if (!low) { el?.remove(); continue; }
      if (!el) { el = document.createElement("span"); el.className = "batt"; label.append(el); }
      el.innerHTML = `<span class="icon">battery_alert</span>${b.l}%`;
    }
  }
  setInterval(() => { if (polling) paintBattery(); }, 2000);

  // ---------- our list: plans, things to buy, to-dos, kept for both ----------

  let list = store.get("du-list", []);
  let listModal = null;
  window.DU.kit.getDocs("settings").then((docs) => { const d = docs.find((x) => x.id === "our-list"); if (d?.data?.items) { list = d.data.items; store.set("du-list", list); paintList(); } }).catch(() => {});
  function saveList() {
    store.set("du-list", list);
    send("list", { items: list });
    window.DU.kit.putDoc("settings", { items: list }, "our-list").catch(() => toast("Couldn't save the list. Check the internet."));
    paintList();
  }
  function paintList() {
    const open = list.filter((i) => !i.done).length;
    const tray = q("#tray-list");
    if (tray) tray.textContent = open ? `${open} to do` : "Plans, buys, to-dos";
    if (!listModal?.isConnected) return;
    const ul = q(".olist", listModal);
    const sorted = [...list].sort((a, b) => (a.done - b.done) || (b.at - a.at));
    ul.innerHTML = sorted.length ? sorted.map((i) => `<li class="${i.done ? "done" : ""}"><button class="ocheck" data-ltoggle="${i.id}" aria-label="${i.done ? "Mark not done" : "Mark done"}"><span class="icon">${i.done ? "check_circle" : "radio_button_unchecked"}</span></button><div><span>${esc(i.text)}</span><small>${esc(i.by)}${i.done && i.doneBy ? ` · done by ${esc(i.doneBy)}` : ""}</small></div><button class="icon-btn" data-ldel="${i.id}" aria-label="Remove"><span class="icon">close</span></button></li>`).join("") : `<li class="muted small oempty">Nothing yet. Add plans, things to buy, movies to watch…</li>`;
    const doneCount = list.filter((i) => i.done).length;
    q("[data-lclear]", listModal).hidden = !doneCount;
  }
  function openList() {
    window.DU.kit.toggleTray(false);
    const { modal } = sheet("Our list", `<form class="olist-form"><input class="field" name="t" maxlength="120" placeholder="Add something…" autocomplete="off" required><button class="btn primary" aria-label="Add"><span class="icon">add</span></button></form><ul class="olist"></ul><button class="btn ghost wide" data-lclear hidden>Clear done</button>`);
    listModal = modal;
    paintList();
    q("form", modal).addEventListener("submit", (e) => {
      e.preventDefault();
      const input = q("[name=t]", modal);
      const text = input.value.trim();
      if (!text) return;
      list.push({ id: `${Date.now()}${Math.random().toString(36).slice(2, 5)}`, text, by: me.name, at: Date.now(), done: false });
      input.value = "";
      saveList();
    });
    modal.addEventListener("click", (e) => {
      const t = e.target.closest("[data-ltoggle]");
      if (t) { const i = list.find((x) => x.id === t.dataset.ltoggle); if (i) { i.done = !i.done; i.doneBy = i.done ? me.name : ""; saveList(); } return; }
      const d = e.target.closest("[data-ldel]");
      if (d) { list = list.filter((x) => x.id !== d.dataset.ldel); saveList(); return; }
      if (e.target.closest("[data-lclear]")) { list = list.filter((x) => !x.done); saveList(); }
    });
  }
  paintList();

  // ---------- hooks ----------

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, peer: window.DU.onCouplePeer, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const run = {
        list: openList,
        remind: openRemind,
        night: () => { store.set("du-night", !store.get("du-night", false)); paintNight(); },
        saver: () => { saver = !saver; store.set("du-saver", saver); paintSaver(); applySaver(); toast(saver ? "Data saver on · lower video quality" : "Data saver off"); },
      }[button.dataset.tg];
      if (run) run(); else prev.click?.(button);
    },
    onCouple(message, peer) {
      const data = message.data || {};
      if (message.type === "batt") {
        const before = batteries.get(peer.id);
        const l = Math.max(0, Math.min(100, Number(data.l) || 0)), c = Boolean(data.c);
        batteries.set(peer.id, { l, c });
        if (!c && l <= 20 && (!before || before.l > 20 || (l <= 10 && before.l > 10))) toast(`${peer.name}'s phone is at ${l}%`);
        return paintBattery();
      }
      if (message.type === "list") {
        if (!Array.isArray(data.items)) return;
        list = data.items.filter((i) => i && typeof i.text === "string").slice(0, 300).map((i) => ({ id: String(i.id), text: i.text.slice(0, 120), by: String(i.by || "").slice(0, 40), at: Number(i.at) || 0, done: Boolean(i.done), doneBy: String(i.doneBy || "").slice(0, 40) }));
        store.set("du-list", list);
        return paintList();
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
        if (reminders.length) send("remind", { list: reminders });
        shareBattery();
      }, 1800);
    },
    onCoupleLeave(...args) {
      prev.leave?.(...args);
      batteries.clear();
      lineStats.clear();
      stopHush();
    },
  });
})();
