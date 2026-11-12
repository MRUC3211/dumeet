// DU Meet · the admin console's control room. Adds sections to the console in home.js:
//   Live control · Switches · Features · Hey Lord & AI · Usage · Activity · Chat search ·
//   Server · Logs · Data · Devices
// Everything goes through the admin's own token (window.DU.admin.fetch).

(() => {
  "use strict";
  const A = () => window.DU.admin;
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const D = { peers: null, config: null, status: null, stats: null, logs: null, push: null, data: {}, coll: "calendar", logFilter: "", chatQ: "", logKind: "all", open: new Set() };
  const get = async (url) => { const r = await A().fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); };
  const post = async (url, body = {}) => {
    const r = await A().fetch(url, { method: "POST", body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Didn't work");
    return data;
  };
  const when = (t) => new Date(t * 1000).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const ago = (secs) => (secs < 60 ? `${Math.round(secs)}s` : secs < 3600 ? `${Math.round(secs / 60)}m` : secs < 86400 ? `${Math.round(secs / 3600)}h` : `${Math.round(secs / 86400)}d`);
  const loading = `<div class="loading"><span class="spinner"></span></div>`;
  const sw = (key, on, label, sub) => `<label class="a-sw"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ""}</span><input type="checkbox" role="switch" data-cfg="${key}"${on ? " checked" : ""}><i aria-hidden="true"></i></label>`;
  const card = (title, body, extra = "") => `<div class="a-card${extra}"><p class="a-card-t">${title}</p>${body}</div>`;
  const bar = (n, max) => `<span class="a-meter"><i style="width:${Math.max(2, Math.round((n / Math.max(1, max)) * 100))}%"></i></span>`;

  async function saveConfig(changes, msg = "Saved") {
    try { D.config = (await post("/api/admin/config", { changes })).config; toast(msg); } catch (e) { toast(e.message); }
    A().render();
  }

  // ---------- names for the app's features (from the tools menu itself) ----------
  function features() {
    const seen = new Map();
    document.querySelectorAll("#tg-tray [data-tg]").forEach((b) => {
      const k = b.dataset.tg;
      if (/^(view-|tray|wake$)/.test(k) || seen.has(k)) return;
      const name = b.querySelector("b")?.textContent?.trim() || b.querySelector(".label")?.textContent?.trim() || k;
      const view = b.closest(".tray-view")?.className.match(/tray-(\w+)$/)?.[1] || "main";
      seen.set(k, { k, name, view });
    });
    return [...seen.values()];
  }
  const featureName = (k) => features().find((f) => f.k === k)?.name || k;

  // =================================================================
  const tabs = [
    // ---------------- Live control ----------------
    {
      id: "live", label: "Live control", icon: "settings_remote", group: "Control",
      badge: () => (D.peers?.rooms || []).reduce((n, r) => n + r.people.length, 0) || "",
      load: async () => { D.peers = await get("/api/admin/peers"); },
      html() {
        if (!D.peers) return loading;
        const rooms = D.peers.rooms;
        const chip = (on, icon, off) => `<span class="a-chip${on ? " on" : ""}" title="${off}"><span class="icon">${icon}</span></span>`;
        const people = rooms.map((r) => `<div class="a-card"><div class="a-room"><span class="live-dot"></span><b>${esc(r.room)}</b><small>${r.people.length} in the call</small>
            <button class="btn danger small-btn" data-x="end" data-room="${esc(r.room)}">End call</button></div>
          <ul class="a-peers">${r.people.map((p) => `<li>
            <span class="h-av">${esc((p.name || "?")[0].toUpperCase())}</span>
            <div class="a-pinfo"><b>${esc(p.name)}</b><small>${p.idle < 25 ? "Connected" : `No signal for ${ago(p.idle)}`}${p.rec ? " · recording" : ""}${p.cc ? " · captions" : ""}</small>
              <span class="a-chips">${chip(p.mic, p.mic ? "mic" : "mic_off", "Mic")}${chip(p.cam, p.cam ? "videocam" : "videocam_off", "Camera")}${chip(p.screen, "present_to_all", "Sharing screen")}${chip(p.hand, "back_hand", "Hand raised")}</span></div>
            <div class="a-pacts">
              <button class="btn ghost small-btn" data-x="cmd" data-do="mute" data-room="${esc(r.room)}" data-id="${esc(p.id)}"${p.mic ? "" : " disabled"}><span class="icon">mic_off</span>Mute</button>
              <button class="btn ghost small-btn" data-x="cmd" data-do="camoff" data-room="${esc(r.room)}" data-id="${esc(p.id)}"${p.cam ? "" : " disabled"}><span class="icon">videocam_off</span>Camera off</button>
              <button class="btn ghost small-btn" data-x="say" data-room="${esc(r.room)}" data-id="${esc(p.id)}" data-name="${esc(p.name)}"><span class="icon">chat_bubble</span>Message</button>
              <button class="btn ghost small-btn" data-x="cmd" data-do="reload" data-room="${esc(r.room)}" data-id="${esc(p.id)}"><span class="icon">refresh</span>Reload app</button>
              <button class="btn ghost small-btn danger-text" data-x="kick" data-room="${esc(r.room)}" data-id="${esc(p.id)}" data-name="${esc(p.name)}"><span class="icon">person_remove</span>Take out</button>
            </div></li>`).join("")}</ul></div>`).join("");
        return `${people || `<div class="empty-art"><span class="icon">videocam_off</span><p>Nobody is in a call right now.</p></div>`}
          ${card("Message everyone in a call", `<form class="a-inline" data-form="announce"><input class="field" name="t" maxlength="300" placeholder="Shows on their screen right away" required><button class="btn primary">Send</button></form>`)}
          ${card("Ring a phone", `<p class="muted small">Rings their phone like an incoming call, even when the app is closed (needs notifications on).</p>
            <div class="a-row-btns">${(D.config?.couple || ["Uday", "Diya"]).map((n) => `<button class="btn outline" data-x="ring" data-name="${esc(n)}"><span class="icon">ring_volume</span>Ring ${esc(n)}</button>`).join("")}</div>`)}
          ${card("Everyone's app", `<div class="a-row-btns"><button class="btn outline" data-x="all" data-do="reload"><span class="icon">system_update</span>Reload everyone's app</button><button class="btn outline" data-x="all" data-do="mute"><span class="icon">mic_off</span>Mute everyone</button></div>`)}`;
      },
      async onClick(e) {
        const b = e.target.closest("[data-x]");
        if (!b) return false;
        const x = b.dataset.x, room = b.dataset.room, id = b.dataset.id;
        try {
          if (x === "end") { if (!(await A().ask("End this call?", "Everyone in it is taken out.", "End call"))) return true; await post("/api/admin/end", { room }); toast("Call ended"); }
          if (x === "kick") { if (!(await A().ask(`Take ${b.dataset.name} out?`, "They leave the call. They can join again.", "Take out"))) return true; await post("/api/admin/kick", { room, id }); toast(`${b.dataset.name} was taken out`); }
          if (x === "cmd") { await post("/api/admin/cmd", { room, id, do: b.dataset.do }); toast("Done"); }
          if (x === "all") { await post("/api/admin/cmd", { do: b.dataset.do }); toast("Sent to everyone"); }
          if (x === "ring") { const r = await post("/api/admin/ring", { name: b.dataset.name }); toast(r.sent ? `Ringing ${b.dataset.name} (${r.sent} device${r.sent > 1 ? "s" : ""})` : `${b.dataset.name} has no phone set up for ringing`); }
          if (x === "say") {
            const text = prompt(`Message for ${b.dataset.name}`);
            if (text?.trim()) { await post("/api/admin/cmd", { room, id, do: "toast", text }); toast("Sent"); }
          }
        } catch (err) { toast(err.message); }
        setTimeout(() => this.load().then(() => A().render()), 900);
        return true;
      },
    },

    // ---------------- Switches ----------------
    {
      id: "switches", label: "Switches", icon: "toggle_on", group: "Control",
      load: async () => { D.config = (await get("/api/admin/config")).config; },
      html() {
        const c = D.config;
        if (!c) return loading;
        const bannerOn = c.banner && (!c.bannerUntil || c.bannerUntil > Date.now() / 1000);
        return `${card("Access", `${sw("maintenance", c.maintenance, "Maintenance mode", "Nobody can join a call; the app shows your message")}
            <form class="a-inline" data-form="cfg-text" data-key="maintenanceText"><input class="field" name="t" maxlength="300" value="${esc(c.maintenanceText)}" aria-label="Maintenance message"><button class="btn outline">Save</button></form>
            ${sw("coupleOnly", c.coupleOnly, "Only the two of us", "Anyone with another name can't join a call")}
            <form class="a-inline" data-form="couple"><input class="field" name="t" value="${esc(c.couple.join(", "))}" aria-label="Allowed names"><button class="btn outline">Save names</button></form>`)}
          ${card("Hey Lord", `${sw("saathiOn", c.saathiOn, "Hey Lord is on", "Off = no AI anywhere: voice, cards, stories, plans")}
            <div class="a-two"><label class="a-num"><span>Voice calls per hour</span><input class="field" type="number" min="0" max="500" data-num="liveHourly" value="${c.liveHourly}"></label>
            <label class="a-num"><span>Text AI per hour</span><input class="field" type="number" min="0" max="2000" data-num="textHourly" value="${c.textHourly}"></label></div>
            <p class="muted small">Limits keep the Gemini bill in check. 0 = paused.</p>`)}
          ${card("Spicy cards", `<p class="muted small">The hottest level the Date night cards may go to.</p>
            <div class="seg a-seg">${[[1, "Sweet"], [2, "Flirty"], [3, "Hot"]].map(([v, l]) => `<button data-heat="${v}" class="${c.maxHeat === v ? "on" : ""}">${l}</button>`).join("")}</div>`)}
          ${card("Question rounds", `<p class="muted small">Question games (Truth or dare, Would you rather, Quiz, Date night cards…) give this many questions, then pause so they stay fresh. Questions never repeat until a whole deck is used.</p>
            <div class="a-two"><label class="a-num"><span>Questions per round</span><input class="field" type="number" min="3" max="50" data-num="roundSize" value="${c.roundSize ?? 10}"></label>
            <label class="a-num"><span>Break between rounds (minutes, 0 = none)</span><input class="field" type="number" min="0" max="240" data-num="roundBreak" value="${c.roundBreak ?? 10}"></label></div>
            <button class="btn ghost small-btn" data-x="rounds"><span class="icon">restart_alt</span>Open a new round now for everyone</button>`)}
          ${card("Banner for everyone", `<p class="muted small">${bannerOn ? `Showing now${c.bannerUntil ? ` until ${when(c.bannerUntil)}` : ""}: <b>${esc(c.banner)}</b>` : "A message pinned at the top of the app for both of you."}</p>
            <form class="a-inline" data-form="banner"><input class="field" name="t" maxlength="200" placeholder="e.g. Happy anniversary! 💞" value="${bannerOn ? esc(c.banner) : ""}">
              <select class="field" name="h" aria-label="For how long"><option value="1">1 hour</option><option value="24" selected>1 day</option><option value="168">1 week</option><option value="0">Until removed</option></select><button class="btn primary">Show</button></form>
            ${bannerOn ? `<button class="btn ghost small-btn" data-x="unbanner">Remove banner</button>` : ""}`)}
          ${card("Sign-in", `<p class="muted small">Signs out every phone and laptop, you included. Everyone types the password again.</p>
            <button class="btn outline danger-text" data-x="signout"><span class="icon">logout</span>Sign out everyone</button>`, " a-danger")}`;
      },
      onChange(e) {
        const s = e.target.closest("[data-cfg]");
        if (s) return saveConfig({ [s.dataset.cfg]: s.checked }, s.checked ? "Turned on" : "Turned off");
        const n = e.target.closest("[data-num]");
        if (n) return saveConfig({ [n.dataset.num]: Number(n.value) || 0 }, "Limit saved");
      },
      async onClick(e) {
        const h = e.target.closest("[data-heat]");
        if (h) { saveConfig({ maxHeat: Number(h.dataset.heat) }); return true; }
        const x = e.target.closest("[data-x]")?.dataset.x;
        if (x === "rounds") { try { await post("/api/admin/cmd", { do: "rounds" }); toast("New round opened on every phone in a call"); } catch (err) { toast(err.message); } return true; }
        if (x === "unbanner") { saveConfig({ banner: "", bannerUntil: 0 }, "Banner removed"); return true; }
        if (x === "signout") {
          if (!(await A().ask("Sign out everyone?", "Every device, yours too, needs the password again.", "Sign out all"))) return true;
          try { await post("/api/admin/signout"); toast("Everyone was signed out"); } catch (err) { toast(err.message); }
          return true;
        }
        return false;
      },
    },

    // ---------------- Features ----------------
    {
      id: "features", label: "Features", icon: "widgets", group: "Control",
      load: async () => { D.config = (await get("/api/admin/config")).config; },
      html() {
        if (!D.config) return loading;
        const hidden = new Set(D.config.hidden || []);
        const groups = { main: "Main", games: "Games", fun: "Fun", relax: "Relax", date: "Date night", focus: "Productivity", more: "More" };
        const list = features();
        const by = Object.entries(groups).map(([v, title]) => {
          const items = list.filter((f) => f.view === v);
          return items.length ? card(`${title} <small>${items.filter((f) => !hidden.has(f.k)).length}/${items.length} on</small>`, `<div class="a-feats">${items.map((f) => `<label class="a-feat${hidden.has(f.k) ? " off" : ""}"><input type="checkbox" data-feat="${esc(f.k)}"${hidden.has(f.k) ? "" : " checked"}><span>${esc(f.name)}</span></label>`).join("")}</div>`) : "";
        }).join("");
        return `<p class="muted small">Switch off anything you don't want in the app. It disappears from the tools menu on both phones within a minute.</p>
          <div class="a-row-btns"><button class="btn ghost small-btn" data-x="all-on">Turn all on</button></div>${by}`;
      },
      onChange(e) {
        const f = e.target.closest("[data-feat]");
        if (!f) return;
        const hidden = new Set(D.config.hidden || []);
        if (f.checked) hidden.delete(f.dataset.feat); else hidden.add(f.dataset.feat);
        saveConfig({ hidden: [...hidden] }, f.checked ? `${featureName(f.dataset.feat)} is on` : `${featureName(f.dataset.feat)} is hidden`);
      },
      onClick(e) { if (e.target.closest("[data-x=all-on]")) { saveConfig({ hidden: [] }, "Everything is on"); return true; } return false; },
    },

    // ---------------- Hey Lord & AI ----------------
    {
      id: "ai", label: "Hey Lord & AI", icon: "auto_awesome", group: "Insights",
      load: async () => { [D.stats, D.status] = await Promise.all([get("/api/admin/stats"), get("/api/admin/status")]); },
      html() {
        if (!D.stats || !D.status) return loading;
        const a = D.stats.ai, st = D.status;
        const ok = st.gemini === "ready";
        const tot = {}, fail = {};
        for (const d of D.stats.usage) { for (const [k, n] of Object.entries(d.ai || {})) tot[k] = (tot[k] || 0) + n; for (const [k, n] of Object.entries(d.aiFail || {})) fail[k] = (fail[k] || 0) + n; }
        const NAMES = { token: "Voice calls with Hey Lord", cards: "Date night cards", story: "Story time", plan: "Plan my day", quiz: "Study quiz", soften: "Say it softly", verdict: "Faisla verdicts", remember: "Memories saved", "diary-write": "Diary pages", state: "Hey Lord screen opened" };
        const rows = Object.keys({ ...tot, ...fail }).sort((x, y) => (tot[y] || 0) - (tot[x] || 0));
        const max = Math.max(1, ...rows.map((k) => tot[k] || 0));
        return `<div class="a-stats">
            <div><b class="${ok ? "good" : "warn"}">${ok ? "Ready" : esc(st.gemini)}</b><span>Gemini</span></div>
            <div><b>${a.liveUsed}/${a.liveLimit}</b><span>Voice this hour</span></div>
            <div><b>${a.textUsed}/${a.textLimit}</b><span>Text AI this hour</span></div>
            <div><b>${Object.values(tot).reduce((x, y) => x + y, 0)}</b><span>AI calls · 14 days</span></div></div>
          ${card("Models", `<ul class="a-kv"><li><span>Voice (Live)</span><b>${esc(st.liveModel)}</b></li><li><span>Text</span><b>${esc(st.textModel)}</b></li></ul>`)}
          ${card("What Hey Lord did · last 14 days", rows.length ? `<ul class="a-usage">${rows.map((k) => `<li><span>${esc(NAMES[k] || k)}</span>${bar(tot[k] || 0, max)}<b>${tot[k] || 0}</b>${fail[k] ? `<em class="warn">${fail[k]} failed</em>` : ""}</li>`).join("")}</ul>` : `<p class="muted small">Nothing yet.</p>`)}
          ${card("Memory", `<p class="muted small">Hey Lord remembers your story, promises, Faislas and diary. Wiping deletes it for good.</p><button class="btn outline danger-text" data-a-forget-ai><span class="icon">psychology_alt</span>Wipe Hey Lord's memory</button>`)}`;
      },
    },

    // ---------------- Usage ----------------
    {
      id: "usage", label: "Usage", icon: "insights", group: "Insights",
      load: async () => { D.stats = await get("/api/admin/stats"); },
      html() {
        if (!D.stats) return loading;
        const feats = {}, people = {};
        const days = [...D.stats.usage].reverse();
        for (const d of days) { for (const [k, n] of Object.entries(d.features || {})) feats[k] = (feats[k] || 0) + n; for (const [k, n] of Object.entries(d.people || {})) people[k] = (people[k] || 0) + n; }
        const top = Object.entries(feats).sort((x, y) => y[1] - x[1]);
        const max = Math.max(1, ...top.map((x) => x[1]));
        const perDay = days.map((d) => ({ day: d.day, n: Object.values(d.features || {}).reduce((x, y) => x + y, 0) }));
        const dmax = Math.max(1, ...perDay.map((d) => d.n));
        const unused = features().filter((f) => !feats[f.k]).map((f) => f.name);
        return `<div class="a-stats two"><div><b>${top.reduce((x, y) => x + y[1], 0)}</b><span>Things opened · 14 days</span></div><div><b>${top.length}</b><span>Different features used</span></div></div>
          ${perDay.length ? card("Each day", `<div class="a-bars">${perDay.slice(-14).map((d) => `<div><i style="height:${Math.max(3, Math.round((d.n / dmax) * 100))}%" title="${d.n}"></i><span>${d.day.slice(8)}</span></div>`).join("")}</div>`) : ""}
          ${card("Most used", top.length ? `<ul class="a-usage">${top.slice(0, 20).map(([k, n]) => `<li><span>${esc(featureName(k))}</span>${bar(n, max)}<b>${n}</b></li>`).join("")}</ul>` : `<p class="muted small">Counts start now: each time someone opens a feature it's counted.</p>`)}
          ${Object.keys(people).length ? card("Who opened things", `<ul class="a-usage">${Object.entries(people).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<li><span>${esc(k)}</span>${bar(n, Math.max(...Object.values(people)))}<b>${n}</b></li>`).join("")}</ul>`) : ""}
          ${unused.length && top.length ? card("Not used in 14 days", `<p class="muted small">${unused.map(esc).join(" · ")}</p><p class="muted small">You could hide these in Features.</p>`) : ""}`;
      },
    },

    // ---------------- Activity ----------------
    {
      id: "activity", label: "Activity", icon: "timeline", group: "Insights",
      load: async () => { D.logs = await get("/api/admin/logs"); },
      html() {
        if (!D.logs) return loading;
        const kinds = { all: "All", call: "Calls", security: "Security", admin: "Admin" };
        const icon = { call: "call", security: "shield", admin: "admin_panel_settings" };
        const items = [...D.logs.audit].reverse().filter((x) => D.logKind === "all" || x.kind === D.logKind);
        return `<div class="seg a-seg">${Object.entries(kinds).map(([k, l]) => `<button data-kind="${k}" class="${D.logKind === k ? "on" : ""}">${l}</button>`).join("")}</div>
          ${items.length ? `<ul class="a-log">${items.slice(0, 200).map((x) => `<li><span class="icon">${icon[x.kind] || "info"}</span><div><b>${esc(x.text)}</b></div><time>${when(x.at)}</time></li>`).join("")}</ul>` : `<p class="muted small">Nothing since the server started. Joins, leaves, sign-ins and your admin actions show here.</p>`}`;
      },
      onClick(e) { const k = e.target.closest("[data-kind]"); if (k) { D.logKind = k.dataset.kind; A().render(); return true; } return false; },
    },

    // ---------------- Chat search ----------------
    {
      id: "chats", label: "Chat search", icon: "manage_search", group: "Insights",
      html() {
        const meetings = A().state.meetings || [];
        const qv = D.chatQ.trim().toLowerCase();
        const all = meetings.flatMap((d) => (d.data.chat || []).map((c) => ({ ...c, start: d.data.start })));
        const hits = qv ? all.filter((c) => `${c.name} ${c.text}`.toLowerCase().includes(qv)) : [];
        const mark = (t) => esc(t).replace(new RegExp(`(${qv.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"), "<mark>$1</mark>");
        return `<input class="field a-search" type="search" data-chatq placeholder="Search ${all.length} messages from every call" value="${esc(D.chatQ)}" autocomplete="off">
          ${qv ? (hits.length ? `<p class="a-label">${hits.length} found</p><ul class="a-chat">${hits.slice(0, 150).map((c) => `<li><div><b>${esc(c.name)}</b><small>${when(c.at)}</small></div><p>${mark(c.text || "")}</p></li>`).join("")}</ul>` : `<p class="muted small">No message has “${esc(D.chatQ)}”.</p>`) : `<p class="muted small">Type a word, a name or a link.</p>`}`;
      },
      onInput(e) {
        if (!e.target.matches("[data-chatq]")) return;
        D.chatQ = e.target.value;
        const pos = e.target.selectionStart;
        A().render();
        const i = document.querySelector("[data-chatq]");
        i?.focus(); i?.setSelectionRange(pos, pos);
      },
    },

    // ---------------- Server ----------------
    {
      id: "server", label: "Server", icon: "dns", group: "System",
      load: async () => { [D.status, D.stats] = await Promise.all([get("/api/admin/status"), get("/api/admin/stats")]); },
      html() {
        const st = D.status, rq = D.stats?.requests;
        if (!st || !rq) return loading;
        const dot = (ok) => `<i class="a-dot ${ok ? "ok" : "bad"}"></i>`;
        const hmax = Math.max(1, ...rq.hours.map((h) => h.n));
        const NAMES = { meetings: "Sessions", snaps: "Photos", logins: "Sign-in log", calendar: "Calendar notes", songs: "Saved songs", settings: "Settings & lists", ai: "Hey Lord memory", push: "Ring devices", admin: "Admin data" };
        return `<div class="a-stats">
            <div><b>${ago(st.uptime)}</b><span>Up since restart</span></div>
            <div><b>${st.peers}</b><span>People online</span></div>
            <div><b>${rq.total}</b><span>Requests · 48h</span></div>
            <div><b class="${rq.errors ? "warn" : ""}">${rq.errors}</b><span>Errors · 48h</span></div></div>
          ${card("Health", `<ul class="a-kv">
            <li><span>${dot(st.gemini === "ready")}Hey Lord (Gemini)</span><b>${esc(st.gemini)}</b></li>
            <li><span>${dot(st.persistent)}Storage</span><b>${esc(st.storage)}${st.persistent ? "" : " · resets on restart"}</b></li>
            <li><span>${dot(st.turn !== "off")}Calls across networks (TURN)</span><b>${esc(st.turn)}</b></li>
            <li><span>${dot(st.password)}Password lock</span><b>${st.password ? "On" : "Off"}</b></li>
            <li><span>${dot(st.youtube)}Song search (YouTube)</span><b>${st.youtube ? "On" : "Off"}</b></li>
            <li><span>${dot(st.pushDevices > 0)}Phones that can ring</span><b>${st.pushDevices}</b></li></ul>`)}
          ${card("Requests · last 24 hours", `<div class="a-bars a-bars24">${rq.hours.map((h) => `<div title="${esc(h.hour)}:00 · ${h.n} requests${h.err ? `, ${h.err} errors` : ""}"><i class="${h.err ? "err" : ""}" style="height:${Math.max(3, Math.round((h.n / hmax) * 100))}%"></i><span>${h.hour.slice(11)}</span></div>`).join("")}</div>
            <ul class="a-usage">${Object.entries(rq.areas).slice(0, 8).map(([k, n]) => `<li><span>${esc(k)}</span>${bar(n, Object.values(rq.areas)[0])}<b>${n}</b></li>`).join("")}</ul>`)}
          ${card("Stored data", `<ul class="a-kv">${Object.entries(st.counts).map(([k, n]) => `<li><span>${esc(NAMES[k] || k)}</span><b>${n ?? "?"}</b></li>`).join("")}</ul>`)}
          ${card("Machine", `<ul class="a-kv"><li><span>Version</span><b>${esc(st.commit || "local")}</b></li><li><span>Python</span><b>${esc(st.python)}</b></li><li><span>Memory</span><b>${st.memoryMb ?? "?"} MB</b></li><li><span>Threads</span><b>${st.threads}</b></li><li><span>Restarted</span><b>${when(st.started)}</b></li><li><span>Call ends after everyone leaves for</span><b>${st.meetingGrace}s</b></li></ul>`)}`;
      },
    },

    // ---------------- Logs ----------------
    {
      id: "logs", label: "Server log", icon: "terminal", group: "System",
      load: async () => { D.logs = await get("/api/admin/logs"); },
      html() {
        if (!D.logs) return loading;
        const f = D.logFilter.toLowerCase();
        const lines = [...D.logs.logs].reverse().filter((l) => !f || (f === "errors" ? /error|fail|traceback|exception|warn/i.test(l.text) : l.text.toLowerCase().includes(f)));
        return `<div class="a-inline"><input class="field" type="search" data-logq placeholder="Filter the log" value="${esc(D.logFilter === "errors" ? "" : D.logFilter)}"><button class="btn ${D.logFilter === "errors" ? "primary" : "outline"}" data-x="errors">Errors only</button></div>
          ${lines.length ? `<pre class="a-pre">${lines.slice(0, 300).map((l) => `<span class="${/error|fail|traceback|exception/i.test(l.text) ? "e" : ""}"><time>${new Date(l.at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time> ${esc(l.text)}</span>`).join("\n")}</pre>` : `<p class="muted small">${f ? "Nothing matches." : "The server hasn't printed anything since it started."}</p>`}`;
      },
      onClick(e) { if (e.target.closest("[data-x=errors]")) { D.logFilter = D.logFilter === "errors" ? "" : "errors"; A().render(); return true; } return false; },
      onInput(e) {
        if (!e.target.matches("[data-logq]")) return;
        D.logFilter = e.target.value;
        const pos = e.target.selectionStart;
        A().render();
        const i = document.querySelector("[data-logq]"); i?.focus(); i?.setSelectionRange(pos, pos);
      },
    },

    // ---------------- Data browser ----------------
    {
      id: "data", label: "All data", icon: "database", group: "Data",
      load: async () => { D.data[D.coll] = (await get(`/api/admin/data?c=${D.coll}`)).docs; },
      html() {
        const NAMES = { calendar: "Calendar", settings: "Settings & lists", songs: "Songs", meetings: "Sessions", snaps: "Photos", logins: "Sign-ins", ai: "Hey Lord memory", push: "Ring devices", admin: "Admin" };
        const docs = D.data[D.coll];
        const preview = (d) => { const t = JSON.stringify(d.data); return esc(t.length > 140 ? `${t.slice(0, 140)}…` : t); };
        return `<div class="a-inline"><select class="field" data-coll aria-label="Collection">${Object.entries(NAMES).map(([k, l]) => `<option value="${k}"${k === D.coll ? " selected" : ""}>${l}</option>`).join("")}</select>
            <button class="btn outline" data-x="export"><span class="icon">download</span>Export everything</button></div>
          ${!docs ? loading : docs.length ? `<p class="a-label">${docs.length} item${docs.length === 1 ? "" : "s"}</p><ul class="a-docs">${docs.map((d) => `<li>
            <button class="a-doc" data-doc="${esc(d.id)}"><b>${esc(d.id)}</b><small>${preview(d)}</small></button>
            ${D.coll === "admin" && d.id === "config" ? "" : `<button class="icon-btn" data-del-doc="${esc(d.id)}" aria-label="Delete ${esc(d.id)}"><span class="icon">delete</span></button>`}
            ${D.open.has(d.id) ? `<pre class="a-pre small">${esc(JSON.stringify(d.data, null, 2))}</pre>` : ""}</li>`).join("")}</ul>` : `<p class="muted small">Empty.</p>`}`;
      },
      onChange(e) {
        if (!e.target.matches("[data-coll]")) return;
        D.coll = e.target.value; A().render();
        this.load().then(() => A().render()).catch(() => toast("Couldn't load"));
      },
      async onClick(e) {
        const doc = e.target.closest("[data-doc]");
        if (doc) { const id = doc.dataset.doc; D.open.has(id) ? D.open.delete(id) : D.open.add(id); A().render(); return true; }
        const del = e.target.closest("[data-del-doc]");
        if (del) {
          if (!(await A().ask("Delete this item?", `${del.dataset.delDoc} is deleted for good.`, "Delete"))) return true;
          try { await post("/api/admin/del", { c: D.coll, id: del.dataset.delDoc }); D.data[D.coll] = D.data[D.coll].filter((d) => d.id !== del.dataset.delDoc); toast("Deleted"); } catch (err) { toast(err.message); }
          A().render(); return true;
        }
        if (e.target.closest("[data-x=export]")) {
          try {
            const all = await get("/api/admin/export");
            const link = document.createElement("a");
            link.href = URL.createObjectURL(new Blob([JSON.stringify(all, null, 2)], { type: "application/json" }));
            link.download = `DU Meet full export ${A().dayKey(new Date())}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 3000);
          } catch { toast("Couldn't export"); }
          return true;
        }
        return false;
      },
    },

    // ---------------- Devices ----------------
    {
      id: "devices", label: "Devices", icon: "devices", group: "Control",
      load: async () => { D.push = (await get("/api/admin/push")).devices; },
      html() {
        if (!D.push) return loading;
        const logins = (A().state.logins || []).filter((l) => l.data.ok);
        const seen = new Map();
        for (const l of logins) { const k = `${l.data.device} · ${l.data.address}`; if (!seen.has(k)) seen.set(k, l.data); }
        return `${card("Phones that ring for calls", D.push.length ? `<ul class="a-log">${D.push.map((d) => `<li><span class="icon">smartphone</span><div><b>${esc(d.name)}</b><small>${esc(d.service)} · added ${d.at ? when(d.at) : "?"}</small></div><button class="icon-btn" data-del-push="${esc(d.id)}" aria-label="Remove this device"><span class="icon">delete</span></button></li>`).join("")}</ul>` : `<p class="muted small">No phone has turned on call ringing yet.</p>`)}
          ${card("Devices that opened the app", seen.size ? `<ul class="a-log">${[...seen.entries()].slice(0, 40).map(([k, l]) => `<li><span class="icon">${/iPhone|Android/.test(l.device) ? "smartphone" : "computer"}</span><div><b>${esc(l.device)}</b><small>${esc(l.address)}</small></div><time>${when(l.at)}</time></li>`).join("")}</ul>` : `<p class="muted small">Nothing yet.</p>`)}`;
      },
      async onClick(e) {
        const del = e.target.closest("[data-del-push]");
        if (!del) return false;
        if (!(await A().ask("Remove this device?", "It stops ringing for calls until ringing is turned on again on it.", "Remove"))) return true;
        try { await post("/api/admin/del", { c: "push", id: del.dataset.delPush }); D.push = D.push.filter((d) => d.id !== del.dataset.delPush); toast("Removed"); } catch (err) { toast(err.message); }
        A().render();
        return true;
      },
    },
  ];
  window.DU.adminTabs = tabs;

  // every little form in the console (Enter or the button): never reload the page
  document.querySelector("#admin-body")?.addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    const t = form.t?.value.trim() ?? "";
    const kind = form.dataset.form;
    if (kind === "cfg-text") saveConfig({ [form.dataset.key]: t });
    if (kind === "couple") saveConfig({ couple: t.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) }, "Names saved");
    if (kind === "banner") {
      const hours = Number(form.h.value);
      saveConfig({ banner: t, bannerUntil: t && hours ? Math.round(Date.now() / 1000 + hours * 3600) : 0 }, t ? "Banner is showing" : "Banner removed");
    }
    if (kind === "announce" && t) {
      try { await post("/api/admin/cmd", { do: "toast", text: t }); toast("Sent to everyone in a call"); form.reset(); } catch (err) { toast(err.message); }
    }
  });

  // keep Live control fresh while it's open
  setInterval(() => {
    const ad = A();
    if (!ad?.state.token || ad.state.tab !== "live" || document.querySelector("#m-admin")?.hidden) return;
    tabs[0].load().then(() => { if (ad.state.tab === "live" && !document.activeElement?.matches("#admin-body input")) ad.render(); }).catch(() => {});
  }, 5000);
})();
