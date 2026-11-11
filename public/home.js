// DU Meet · home screen: meeting history (who joined when, and for how long).

(() => {
  "use strict";
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ---------- modals (shared with tools.js) ----------

  const openModals = [];
  function openModal(element) {
    element.hidden = false;
    requestAnimationFrame(() => element.classList.add("open"));
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

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-home=history]")) showHistory();
  });

  window.DU = Object.assign(window.DU || {}, {
    openModal, closeModal,
    onHome() { /* nothing to refresh: the home page is static */ },
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  // Scripts load after the page, so show the right screen now.
  if (typeof route === "function" && document.body.dataset.view === "gate") route();
})();
