// DU Meet · home screen: one-tap join to our room, other meetings, and stats (meeting history).

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

  // ---------- history ----------

  const pad = (n) => String(n).padStart(2, "0");
  const hm = (seconds) => new Date(seconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = (seconds) => new Date(seconds * 1000).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  function span(secs) {
    secs = Math.max(0, Math.round(secs));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h) return `${h} h ${m} min`;
    if (m) return `${m} min`;
    return `${secs} sec`;
  }

  async function showHistory() {
    const body = q("#history-body");
    body.innerHTML = `<div class="loading"><span class="spinner"></span></div>`;
    openModal(q("#m-history"));
    let docs = [];
    try {
      docs = (await (await fetch("/api/data?c=meetings")).json()).docs;
    } catch {
      body.innerHTML = `<p class="empty">Couldn't load the history. Check the internet.</p>`;
      return;
    }
    const features = await fetch("/api/features").then((r) => r.json()).catch(() => ({}));
    const total = docs.reduce((t, d) => t + d.data.secs, 0);
    const people = new Set(docs.flatMap((d) => d.data.people.map((p) => p.name)));
    const note = features.persistent === false
      ? `<p class="notice"><span class="icon">info</span>History is stored temporarily right now and may reset when the server restarts.</p>` : "";
    body.innerHTML = `
      ${note}
      <div class="h-summary">
        <div><b>${docs.length}</b><span>Meetings</span></div>
        <div><b>${span(total)}</b><span>Total time</span></div>
        <div><b>${people.size}</b><span>People</span></div>
      </div>
      ${docs.length ? `<ul class="h-list">${docs.map((d) => {
        const m = d.data;
        return `<li class="h-item">
          <div class="h-top">
            <div><b>${day(m.start)}</b><small>${hm(m.start)} – ${hm(m.end)}</small></div>
            <span class="h-dur">${span(m.secs)}</span>
          </div>
          <ul class="h-people">${m.people.map((p) => `
            <li><span class="h-av">${esc((p.name || "?")[0].toUpperCase())}</span><span class="h-name">${esc(p.name)}</span>
              <span class="h-times">${hm(p.joined)} → ${hm(p.left)}</span><span class="h-time">${span(p.secs)}</span></li>`).join("")}</ul>
          <div class="h-foot"><span class="code">${esc(m.room)}</span><button class="btn ghost small-btn" data-rejoin="${esc(m.room)}"><span class="icon">login</span>Rejoin</button></div>
        </li>`;
      }).join("")}</ul>` : `<div class="empty-art"><span class="icon">history</span><p>No meetings yet. Once a meeting ends, it shows up here with who joined and for how long.</p></div>`}`;
    for (const button of body.querySelectorAll("[data-rejoin]")) {
      button.onclick = () => { closeModal(q("#m-history")); goToMeeting(button.dataset.rejoin); };
    }
  }

  // ---------- one-tap join to our room ----------

  const OUR_ROOM = "our-room";
  const joinButton = q("[data-home=join]");

  function paintAs() {
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
        history: showHistory,
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
    openModal, closeModal, span,
    onHome() { paintAs(); refreshPresence(); },
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  // Scripts load after the page, so show the right screen now.
  if (document.body.dataset.view === "home") window.DU.onHome();
  else if (typeof route === "function" && document.body.dataset.view === "gate") route();
})();
