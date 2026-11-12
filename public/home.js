// DU Meet · home screen: one-tap join to our room, other meetings, install as an app,
// and the admin console (sessions with chat, stats and photos; needs the admin password).

(() => {
  "use strict";
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ---------- modals (shared with tools.js) ----------

  const openModals = [];
  function openModal(element) {
    element.hidden = false;
    requestAnimationFrame(() => { if (openModals.includes(element)) element.classList.add("open"); });
    if (!openModals.includes(element)) openModals.push(element);
  }
  function closeModal(element) {
    element.classList.remove("open");
    const index = openModals.indexOf(element);
    if (index >= 0) openModals.splice(index, 1);
    setTimeout(() => { if (!element.classList.contains("open")) element.hidden = true; }, 260);
  }
  document.addEventListener("click", (event) => {
    const closer = event.target.closest("[data-modal-close]");
    if (closer) return closeModal(closer.closest(".modal"));
    if (event.target.classList?.contains("modal")) closeModal(event.target); // click on the dim background
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openModals.length) closeModal(openModals[openModals.length - 1]);
  });

  // ---------- admin console (needs the admin password) ----------

  const pad = (n) => String(n).padStart(2, "0");
  const hm = (seconds) => new Date(seconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = (seconds) => new Date(seconds * 1000).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function span(secs) {
    secs = Math.max(0, Math.round(secs));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h) return `${h} h ${m} min`;
    if (m) return `${m} min`;
    return `${secs} sec`;
  }

  // The admin token, like the site token, lives only in this page's memory.
  const admin = { token: "", tab: "overview", meetings: [], snaps: [], live: [], logins: [], locked: [], open: new Set() };
  const adminBody = () => q("#admin-body");
  const adminFetch = (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers || {}), "X-Admin": admin.token } });
  const adminUrl = (url) => { const u = window.authUrl(url); return `${u}${u.includes("?") ? "&" : "?"}a=${admin.token}`; };

  function openAdmin() {
    openModal(q("#m-admin"));
    if (admin.token) loadAdmin(); else adminLogin();
  }

  function adminLogin(error = "") {
    adminBody().innerHTML = `
      <form class="admin-lock" id="admin-form">
        <span class="admin-lock-ic icon" aria-hidden="true">admin_panel_settings</span>
        <h3>Admin access</h3>
        <input class="field" type="password" id="admin-pass" autocomplete="current-password" placeholder="Admin password" required>
        <p class="admin-error" ${error ? "" : "hidden"}>${esc(error)}</p>
        <button class="btn primary wide big">Unlock</button>
      </form>`;
    setTimeout(() => q("#admin-pass")?.focus(), 300);
    // unlocks as soon as the last character is typed
    q("#admin-pass").oninput = (event) => {
      if (window.DU_adminLen && event.target.value.length === window.DU_adminLen) q("#admin-form").requestSubmit();
    };
    q("#admin-form").onsubmit = async (event) => {
      event.preventDefault();
      const button = q("#admin-form button");
      if (button.disabled) return;
      button.disabled = true;
      try {
        const response = await fetch("/api/admin/login", { method: "POST", body: JSON.stringify({ password: q("#admin-pass").value }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Wrong password");
        admin.token = result.token;
        loadAdmin();
      } catch (e) {
        adminLogin(e.message === "Failed to fetch" ? "Can't reach the server" : e.message);
      }
    };
  }

  async function loadAdmin() {
    adminBody().innerHTML = `<div class="loading"><span class="spinner"></span></div>`;
    try {
      const [m, sn, live, logins] = await Promise.all(["/api/data?c=meetings", "/api/data?c=snaps", "/api/admin/live", "/api/data?c=logins"].map((u) => adminFetch(u)));
      if ([m, sn, live].some((r) => r.status === 403)) { admin.token = ""; return adminLogin("Please unlock again."); }
      admin.meetings = (await m.json()).docs;
      admin.snaps = (await sn.json()).docs;
      const liveData = await live.json();
      admin.live = liveData.live.filter((x) => x.people.some((p) => !p.left));
      admin.locked = liveData.locked || [];
      admin.logins = logins.ok ? (await logins.json()).docs.sort((a, b) => b.data.at - a.data.at) : [];
    } catch {
      adminBody().innerHTML = `<p class="empty">Couldn't load. Check the internet.</p>`;
      return;
    }
    renderAdmin();
  }

  const snapsIn = (m) => admin.snaps.filter((s) => s.data.at >= m.start * 1000 - 60000 && s.data.at <= m.end * 1000 + 60000);

  function overviewHtml() {
    const docs = admin.meetings.map((d) => d.data);
    const together = docs.filter((m) => m.people.length > 1);
    const total = together.reduce((t, m) => t + m.secs, 0);
    const days = new Set(together.map((m) => dayKey(new Date(m.start * 1000))));
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (days.has(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      week.push({ label: d.toLocaleDateString([], { weekday: "short" }), secs: docs.filter((m) => dayKey(new Date(m.start * 1000)) === dayKey(d)).reduce((t, m) => t + m.secs, 0) });
    }
    const max = Math.max(...week.map((w) => w.secs), 1);
    const perPerson = new Map();
    for (const m of docs) for (const p of m.people) perPerson.set(p.name, (perPerson.get(p.name) || 0) + p.secs);
    const live = admin.live.map((m) => `
      <div class="a-live"><span class="live-dot"></span><div><b>Live now · ${esc(m.room)}</b>
        <small>${m.people.filter((p) => !p.left).map((p) => esc(p.name)).join(", ")} · started ${hm(m.start)} · ${m.chat} message${m.chat === 1 ? "" : "s"}</small></div>
        <button class="btn danger small-btn" data-a-end="${esc(m.room)}">End call</button></div>`).join("");
    return `${live}
      <div class="a-streak"><span class="icon">local_fire_department</span><div><b>${streak} day${streak === 1 ? "" : "s"}</b><span>${streak ? "calling streak" : "No streak right now"}</span></div></div>
      <div class="a-stats">
        <div><b>${docs.length}</b><span>Sessions</span></div>
        <div><b>${span(total)}</b><span>Time together</span></div>
        <div><b>${span(Math.max(0, ...docs.map((m) => m.secs)))}</b><span>Longest session</span></div>
        <div><b>${together.length ? span(total / together.length) : "–"}</b><span>Average</span></div>
      </div>
      <p class="a-label">Last 7 days · ${span(week.reduce((t, w) => t + w.secs, 0))}</p>
      <div class="a-bars">${week.map((w) => `<div><i style="height:${Math.max(3, Math.round((w.secs / max) * 100))}%" title="${esc(span(w.secs))}"></i><span>${w.label}</span></div>`).join("")}</div>
      ${perPerson.size ? `<p class="a-label">Time in calls</p><ul class="a-people">${[...perPerson].sort((a, b) => b[1] - a[1]).map(([n, t]) => `<li><span class="h-av">${esc((n || "?")[0].toUpperCase())}</span><span>${esc(n)}</span><b>${span(t)}</b></li>`).join("")}</ul>` : ""}
      ${admin.meetings.length ? "" : `<p class="muted small">Sessions are saved when everyone has left a call.</p>`}`;
  }

  function chatHtml(chat) {
    if (!chat?.length) return `<p class="muted small">No messages in this session.</p>`;
    return `<ul class="a-chat">${chat.map((c) => `<li><div><b>${esc(c.name)}</b><small>${hm(c.at)}</small></div>
      ${c.text ? `<p>${esc(c.text)}</p>` : ""}${(c.media || []).map((f) => f.type?.startsWith("image/") ? `<img src="${esc(window.authUrl(f.url))}" alt="" data-zoom="${esc(window.authUrl(f.url))}" loading="lazy">` : `<a href="${esc(window.authUrl(f.url))}" target="_blank" rel="noopener">${esc(f.name || "File")}</a>`).join("")}</li>`).join("")}</ul>`;
  }

  function sessionsHtml() {
    if (!admin.meetings.length) return `<div class="empty-art"><span class="icon">history</span><p>No sessions yet. A session ends when everyone has left the call.</p></div>`;
    return `<ul class="h-list">${admin.meetings.map((d) => {
      const m = d.data;
      const shots = snapsIn(m);
      const open = admin.open.has(d.id);
      return `<li class="h-item">
        <div class="h-top"><div><b>${day(m.start)}</b><small>${hm(m.start)} – ${hm(m.end)} · ${esc(m.room)}</small></div><span class="h-dur">${span(m.secs)}</span></div>
        <ul class="h-people">${m.people.map((p) => `<li><span class="h-av">${esc((p.name || "?")[0].toUpperCase())}</span><span class="h-name">${esc(p.name)}</span><span class="h-times">${hm(p.joined)} → ${hm(p.left)}</span><span class="h-time">${span(p.secs)}</span></li>`).join("")}</ul>
        <div class="h-foot">
          <button class="btn ghost small-btn" data-a-open="${esc(d.id)}"><span class="icon">${open ? "expand_less" : "chat"}</span>Chat (${(m.chat || []).length})${shots.length ? ` · ${shots.length} photo${shots.length > 1 ? "s" : ""}` : ""}</button>
          <span class="h-actions"><button class="icon-btn" data-a-txt="${esc(d.id)}" title="Download chat" aria-label="Download chat"><span class="icon">download</span></button><button class="icon-btn" data-a-del="meetings:${esc(d.id)}" title="Delete session" aria-label="Delete session"><span class="icon">delete</span></button></span>
        </div>
        ${open ? `<div class="a-session">${chatHtml(m.chat)}${shots.length ? `<div class="a-grid">${shots.map(snapHtml).join("")}</div>` : ""}</div>` : ""}
      </li>`;
    }).join("")}</ul>`;
  }

  const snapHtml = (s) => `<figure class="a-snap"><img loading="lazy" src="${esc(adminUrl(s.data.url))}" data-zoom="${esc(adminUrl(s.data.url))}" alt="Photo by ${esc(s.data.by)}"><figcaption>${esc(s.data.by)} · ${new Date(s.data.at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</figcaption><button class="a-snap-del" data-a-del="snaps:${esc(s.id)}" aria-label="Delete photo"><span class="icon">delete</span></button></figure>`;
  const photosHtml = () => admin.snaps.length ? `<div class="a-grid">${admin.snaps.map(snapHtml).join("")}</div>`
    : `<div class="empty-art"><span class="icon">photo_camera</span><p>Photos taken with the camera button in a call show up here. Only you can see them.</p></div>`;

  function securityHtml() {
    const fails = admin.logins.filter((l) => !l.data.ok && Date.now() / 1000 - l.data.at < 86400).length;
    const locked = admin.locked.length
      ? `<div class="a-alert"><span class="icon">lock_clock</span><div><b>${admin.locked.length} device${admin.locked.length > 1 ? "s" : ""} locked out</b><small>Too many wrong passwords. Locked for up to 30 minutes.</small></div><button class="btn primary small-btn" data-a-unlock>Let in now</button></div>` : "";
    const rows = admin.logins.slice(0, 120).map(({ data: l }) => `<li class="${l.ok ? "" : "bad"}"><span class="icon">${l.ok ? (l.kind === "admin" ? "admin_panel_settings" : "lock_open") : "block"}</span>
      <div><b>${l.ok ? (l.kind === "admin" ? "Admin unlocked" : "Opened the app") : (l.kind === "admin" ? "Wrong admin password" : "Wrong password")}</b><small>${esc(l.device)} · ${esc(l.address)}</small></div>
      <time>${new Date(l.at * 1000).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time></li>`).join("");
    return `${locked}
      <div class="a-stats two"><div><b>${admin.logins.filter((l) => l.data.ok && l.data.kind === "site").length}</b><span>Opens</span></div><div><b class="${fails ? "warn" : ""}">${fails}</b><span>Wrong tries today</span></div></div>
      <div class="a-row"><p class="a-label">Every password attempt</p>${admin.logins.length ? `<button class="btn ghost small-btn" data-a-clear="logins"><span class="icon">delete_sweep</span>Clear</button>` : ""}</div>
      ${rows ? `<ul class="a-log">${rows}</ul>` : `<p class="muted small">Nothing yet. Each time someone types the password it shows here.</p>`}`;
  }

  function settingsHtml() {
    const photo = (name) => `<div class="a-face"><label class="a-face-pic">${avatars[name] ? `<img src="${esc(window.authUrl(avatars[name]))}" alt="">` : `<span>${name[0]}</span>`}<input type="file" accept="image/*" data-a-face="${name}" hidden><i class="icon">photo_camera</i></label><b>${name}</b><small>${avatars[name] ? "Tap to change" : "Add a photo"}</small></div>`;
    return `<p class="a-label">Profile photos</p>
      <p class="muted small">Shown on the home screen and when choosing who's joining.</p>
      <div class="a-faces">${photo("Diya")}${photo("Uday")}</div>
      <p class="a-label">Your data</p>
      <div class="a-actions">
        <button class="btn outline" data-a-export><span class="icon">download</span>Export everything</button>
        <button class="btn outline danger-text" data-a-clear="snaps"><span class="icon">hide_image</span>Delete all photos</button>
        <button class="btn outline danger-text" data-a-clear="meetings"><span class="icon">delete_history</span>Delete all sessions</button>
      </div>`;
  }

  function renderAdmin() {
    const tabs = [["overview", "Overview"], ["sessions", "Sessions"], ["photos", `Photos${admin.snaps.length ? ` (${admin.snaps.length})` : ""}`], ["security", "Security"], ["settings", "Settings"]];
    adminBody().innerHTML = `
      <div class="a-top"><div class="seg">${tabs.map(([id, label]) => `<button data-a-tab="${id}" class="${admin.tab === id ? "on" : ""}">${label}</button>`).join("")}</div>
        <span><button class="icon-btn" data-a-refresh title="Refresh" aria-label="Refresh"><span class="icon">refresh</span></button><button class="icon-btn" data-a-lock title="Lock" aria-label="Lock admin"><span class="icon">lock</span></button></span></div>
      <div class="a-view">${{ overview: overviewHtml, sessions: sessionsHtml, photos: photosHtml, security: securityHtml, settings: settingsHtml }[admin.tab]()}</div>`;
  }

  function downloadText(name, text) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  }

  q("#admin-body").addEventListener("click", async (event) => {
    const t = event.target;
    const tab = t.closest("[data-a-tab]");
    if (tab) { admin.tab = tab.dataset.aTab; return renderAdmin(); }
    if (t.closest("[data-a-refresh]")) return loadAdmin();
    if (t.closest("[data-a-lock]")) { admin.token = ""; return adminLogin(); }
    const zoom = t.closest("[data-zoom]");
    if (zoom) return window.DU.lightbox?.(zoom.dataset.zoom);
    const open = t.closest("[data-a-open]");
    if (open) { const id = open.dataset.aOpen; admin.open.has(id) ? admin.open.delete(id) : admin.open.add(id); return renderAdmin(); }
    const txt = t.closest("[data-a-txt]");
    if (txt) {
      const m = admin.meetings.find((d) => d.id === txt.dataset.aTxt)?.data;
      if (!m) return;
      const lines = [`DU Meet session · ${day(m.start)} · ${hm(m.start)} – ${hm(m.end)} (${span(m.secs)})`, "",
        ...m.people.map((p) => `${p.name}: joined ${hm(p.joined)}, left ${hm(p.left)} (${span(p.secs)})`), "", "Chat:",
        ...(m.chat || []).map((c) => `[${hm(c.at)}] ${c.name}: ${c.text}${(c.media || []).map((f) => ` [${f.name || "file"}]`).join("")}`)];
      return downloadText(`DU Meet ${dayKey(new Date(m.start * 1000))}.txt`, lines.join("\n"));
    }
    const end = t.closest("[data-a-end]");
    if (end) {
      if (!(await ask("End this call?", "Everyone in it is taken out of the call.", "End call"))) return;
      await adminFetch("/api/admin/end", { method: "POST", body: JSON.stringify({ room: end.dataset.aEnd }) });
      toast("Call ended");
      return setTimeout(loadAdmin, 1200);
    }
    if (t.closest("[data-a-unlock]")) {
      await adminFetch("/api/admin/unlock", { method: "POST", body: "{}" });
      toast("Locked devices can try again");
      return loadAdmin();
    }
    const clear = t.closest("[data-a-clear]");
    if (clear) {
      const c = clear.dataset.aClear;
      const what = { snaps: ["Delete all photos?", "Every photo is deleted for good."], meetings: ["Delete all sessions?", "All sessions and their chats are deleted for good."], logins: ["Clear the log?", "The list of password attempts is emptied."] }[c];
      if (!(await ask(what[0], what[1], "Delete"))) return;
      const r = await adminFetch("/api/admin/clear", { method: "POST", body: JSON.stringify({ c }) });
      toast(r.ok ? "Deleted" : "Couldn't delete");
      return loadAdmin();
    }
    if (t.closest("[data-a-export]")) {
      const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), sessions: admin.meetings, photos: admin.snaps, logins: admin.logins }, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `DU Meet export ${dayKey(new Date())}.json`;
      link.click();
      return setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    }
    const del = t.closest("[data-a-del]");
    if (del) {
      const [c, id] = del.dataset.aDel.split(":");
      if (!(await ask(c === "snaps" ? "Delete this photo?" : "Delete this session?", c === "snaps" ? "It is deleted for good." : "The session and its chat are deleted for good.", "Delete"))) return;
      const r = await adminFetch(`/api/data?c=${c}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) return toast("Couldn't delete");
      if (c === "snaps") admin.snaps = admin.snaps.filter((d) => d.id !== id);
      else admin.meetings = admin.meetings.filter((d) => d.id !== id);
      renderAdmin();
    }
  });

  const ask = (title, text, ok) => window.DU.kit?.confirmBox({ title, text, ok, cancel: "Cancel" }) ?? Promise.resolve(confirm(title));

  // profile photos for the two of us
  q("#admin-body").addEventListener("change", async (event) => {
    const input = event.target.closest("[data-a-face]");
    if (!input?.files[0]) return;
    const { upload, shrinkImage, putDoc } = window.DU.kit;
    input.closest(".a-face").classList.add("busy");
    try {
      const { url } = await upload(await shrinkImage(input.files[0], 600));
      avatars = { ...avatars, [input.dataset.aFace]: url };
      await putDoc("settings", avatars, "avatars");
      paintAvatars();
      toast("Photo saved");
    } catch {
      toast("Couldn't save the photo");
    }
    renderAdmin();
  });

  // ---------- install as an app ----------

  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function paintInstall() { q("[data-home=install]").hidden = standalone(); }

  async function installApp() {
    const prompt = window.DU_installPrompt;
    if (prompt) {
      prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      window.DU_installPrompt = null;
      if (choice?.outcome === "accepted") toast("Installing DU Meet…");
      return;
    }
    const ua = navigator.userAgent;
    const android = /android/i.test(ua);
    const ios = !android && (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    const steps = ios
      ? [["ios_share", "Tap the <b>Share</b> button in Safari"], ["add_box", "Choose <b>Add to Home Screen</b>"], ["check_circle", "Tap <b>Add</b>. DU Meet opens like an app"]]
      : android
        ? [["more_vert", "Tap the <b>⋮</b> menu in Chrome"], ["install_mobile", "Choose <b>Install app</b> or <b>Add to Home screen</b>"], ["check_circle", "Tap <b>Install</b>. DU Meet opens like an app"]]
        : [["install_desktop", "Click the <b>install</b> icon at the right end of the address bar"], ["check_circle", "Click <b>Install</b>. DU Meet opens in its own window"]];
    q("#install-body").innerHTML = `
      <div class="install-hero"><img src="/icons/icon-192.png?v=5" alt="" width="72" height="72"><p>Full screen, no address bar, and it opens from your home screen.</p></div>
      <ol class="install-steps">${steps.map(([icon, text]) => `<li><span class="icon">${icon}</span><span>${text}</span></li>`).join("")}</ol>
      ${ios ? `<p class="muted small center">On iPhone this works in Safari.</p>` : ""}`;
    openModal(q("#m-install"));
  }

  // ---------- one-tap join to our room ----------

  const OUR_ROOM = "our-room";
  const joinButton = q("[data-home=join]");

  // The photo links are remembered on this device, so the photos show at once after a
  // reload (the images themselves come from the browser's cache); the server is still
  // asked in the background in case they changed.
  const AV_KEY = "du-avatars";
  let avatars = {};
  try { avatars = JSON.parse(localStorage.getItem(AV_KEY)) || {}; } catch { /* private mode */ }
  async function loadAvatars() {
    paintAvatars();
    try {
      const fresh = (await (await fetch("/api/data?c=settings")).json()).docs.find((d) => d.id === "avatars")?.data || {};
      if (JSON.stringify(fresh) === JSON.stringify(avatars)) return;
      avatars = fresh;
      paintAvatars();
      if (typeof renderAll === "function" && document.body.dataset.view === "room") renderAll();
    } catch { /* offline: keep what we have */ }
  }
  function paintAvatars() {
    try { localStorage.setItem(AV_KEY, JSON.stringify(avatars)); } catch { /* private mode */ }
    for (const el of document.querySelectorAll("[data-face]")) {
      const url = avatars[el.dataset.face] ? window.authUrl(avatars[el.dataset.face]) : "";
      if (el.dataset.src === url) continue;
      el.dataset.src = url;
      el.classList.toggle("has-photo", Boolean(url));
      if (!url) { el.textContent = el.dataset.face[0]; continue; }
      const img = new Image();
      img.alt = "";
      img.src = url;
      if (img.complete) el.replaceChildren(img);
      else img.decode().then(() => el.replaceChildren(img), () => {});
    }
  }

  function paintAs() {
    for (const tile of document.querySelectorAll(".sc-tile")) tile.classList.toggle("speaking", tile.dataset.name === (prefs.name || "Diya"));
    const line = q("#home-as");
    line.hidden = !prefs.name;
    line.innerHTML = prefs.name ? `Joining as <b>${esc(prefs.name)}</b> · <button type="button" data-home="who">Change</button>` : "";
  }

  let joinAfterWho = false;
  function askWho(thenJoin = false) {
    joinAfterWho = thenJoin === true;
    q("#who-name").value = "";
    openModal(q("#m-who"));
  }
  function setWho(name) {
    name = name.trim().slice(0, 40);
    if (!name) return;
    prefs.name = name;
    savePrefs();
    paintAs();
    closeModal(q("#m-who"));
    refreshPresence();
    if (joinAfterWho) quickJoin();
  }

  let joining = false;
  async function quickJoin() {
    if (!prefs.name) return askWho(true);
    if (joining) return;
    joining = true;
    joinButton.classList.add("busy");
    try {
      room = OUR_ROOM;
      history.pushState(null, "", `/?room=${OUR_ROOM}`);
      q("#name-input").value = prefs.name;
      if (!me.stream) await startMedia();
      refreshLocal();
      await joinMeeting();
    } finally {
      joining = false;
      joinButton.classList.remove("busy");
    }
  }

  // who is already in our room, shown on the home screen
  let presenceTimer = 0;
  async function refreshPresence() {
    clearTimeout(presenceTimer);
    if (document.body.dataset.view !== "home") return;
    const pill = q("#home-status");
    try {
      const { names } = await (await fetch(`/api/room?room=${OUR_ROOM}`)).json();
      const others = names.filter((n) => n !== prefs.name);
      pill.classList.toggle("waiting", others.length > 0);
      q("span:last-child", pill).textContent = others.length ? `${others.join(" & ")} ${others.length > 1 ? "are" : "is"} waiting for you` : "Your private room";
      joinButton.classList.toggle("pulse", others.length > 0);
    } catch { /* offline: leave as is */ }
    presenceTimer = setTimeout(refreshPresence, 8000);
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-home]");
    if (button) {
      ({
        admin: openAdmin,
        install: installApp,
        join: quickJoin,
        who: () => askWho(false),
        other: () => openModal(q("#m-other")),
      })[button.dataset.home]?.();
    }
    const who = event.target.closest("[data-who]");
    if (who) setWho(who.dataset.who);
    if (event.target.closest("#m-other [data-action=new-meeting]")) closeModal(q("#m-other"));
  });
  q("#who-form").addEventListener("submit", (event) => { event.preventDefault(); setWho(q("#who-name").value); });
  q("#join-form").addEventListener("submit", () => closeModal(q("#m-other")));

  window.DU = Object.assign(window.DU || {}, {
    openModal, closeModal,
    onHome() { paintAs(); refreshPresence(); paintInstall(); loadAvatars(); },
    faceFor(name) {
      const key = Object.keys(avatars).find((k) => k.toLowerCase() === String(name || "").trim().toLowerCase());
      return key && avatars[key] ? window.authUrl(avatars[key]) : "";
    },
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  // Scripts load after the page, so show the right screen now.
  loadAvatars();
  if (document.body.dataset.view === "home") window.DU.onHome();
  else if (typeof route === "function" && document.body.dataset.view === "gate") route();
})();
