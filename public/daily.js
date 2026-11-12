// DU Meet · Our diary (runs on Saathi, see saathi.py): one page per day, written by
// Saathi from that day's calls, chat and study time.
// Uses globals from app.js (me, prefs, peers, polling, toast).

(() => {
  "use strict";
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const { openModal, closeModal } = window.DU;

  const myName = () => (polling ? me.name : prefs.name) || prefs.name || "";
  function people() {
    if (polling) return [me.name, ...[...peers.values()].map((p) => p.name)].filter(Boolean);
    const names = [...new Set([...document.querySelectorAll("[data-who]")].map((b) => b.dataset.who))];
    return [myName(), ...names.filter((n) => n && n !== myName())].filter(Boolean).slice(0, 2);
  }
  const api = async (action, body = {}) => {
    const response = await fetch(`/api/ai/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: myName(), names: people(), ...body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || "Something went wrong");
    return data;
  };
  const orb = `<span class="sa-orb mini" aria-hidden="true"><i></i></span>`;

  // ---------- Our diary ----------

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.id = "m-diary";
  modal.hidden = true;
  modal.innerHTML = `<div class="sheet light dy-sheet" role="dialog" aria-modal="true" aria-labelledby="dy-title">
    <header class="sheet-head"><h2 id="dy-title">Our diary</h2>
      <button class="icon-btn" data-modal-close aria-label="Close"><span class="icon" aria-hidden="true">close</span></button></header>
    <div class="sheet-body dy-body"></div></div>`;
  document.body.append(modal);
  const body = q(".dy-body", modal);
  let pages = [];
  let writing = new Set();
  const failed = new Map();

  const dayLabel = (day) => {
    const d = new Date(`${day}T12:00:00`);
    const today = new Date();
    const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  };
  const mins = (secs) => (secs >= 3600 ? `${Math.floor(secs / 3600)} h ${Math.round((secs % 3600) / 60)} min` : `${Math.max(1, Math.round(secs / 60))} min`);

  async function openDiary() {
    window.DU.kit?.toggleTray?.(false);
    modal.querySelector(".sheet").classList.toggle("light", !polling);
    openModal(modal);
    body.innerHTML = `<div class="dy-loading"><span class="sa-orb"><i></i></span></div>`;
    try {
      pages = (await api("diary")).pages;
    } catch (error) {
      body.innerHTML = `<p class="dy-empty">${esc(error.message)}</p>`;
      return;
    }
    paintDiary();
    // Saathi writes (or updates) the newest pages, one at a time
    for (const page of pages.filter((p) => p.stale).slice(0, 3)) {
      if (modal.hidden) break;
      writing.add(page.day);
      paintDiary();
      try {
        const { page: fresh } = await api("diary-write", { day: page.day });
        pages = pages.map((p) => (p.day === fresh.day ? fresh : p));
        failed.delete(page.day);
      } catch (error) {
        failed.set(page.day, error.message);
      }
      writing.delete(page.day);
      paintDiary();
    }
  }

  function pageHtml(p) {
    const e = p.entry;
    const isWriting = writing.has(p.day);
    let html = `<article class="dy-page"><header><time>${esc(dayLabel(p.day))}</time>
      <button class="dy-hide" data-hide="${p.day}" aria-label="Remove this page"><span class="icon" aria-hidden="true">more_horiz</span></button></header>`;
    if (e?.text) {
      html += `<h3>${esc(e.title || "")}</h3><p class="dy-text">${esc(e.text)}</p>`;
      if (e.quote) html += `<blockquote>“${esc(e.quote)}”${e.quoteBy ? `<cite>${esc(e.quoteBy)}</cite>` : ""}</blockquote>`;
      if (isWriting) html += `<p class="dy-writing small">${orb}Adding today's latest…</p>`;
    } else if (isWriting) {
      html += `<p class="dy-writing">${orb}Saathi is writing this page<span class="dots"><i></i><i></i><i></i></span></p>`;
    } else if (failed.has(p.day)) {
      html += `<p class="dy-note">${esc(failed.get(p.day))}</p>`;
    }
    const chips = [];
    if (p.calls) chips.push(`<span><span class="icon" aria-hidden="true">videocam</span>${p.calls} call${p.calls === 1 ? "" : "s"} · ${mins(p.secs)}</span>`);
    for (const [n, st] of Object.entries(p.study || {})) chips.push(`<span><span class="icon" aria-hidden="true">menu_book</span>${esc(n)} studied ${st.mins} min${st.total ? ` · quiz ${st.right}/${st.total}` : ""}</span>`);
    if (chips.length) html += `<div class="dy-chips">${chips.join("")}</div>`;
    const lines = Object.entries(p.lines || {});
    if (lines.length) {
      html += `<div class="dy-lines">${lines.map(([n, l]) => `<p><span class="dy-mood">${esc(l.mood || "💬")}</span><b>${esc(n)}</b>${l.text ? ` ${esc(l.text)}` : ""}</p>`).join("")}</div>`;
    }
    if (p.promises?.length) html += `<ul class="dy-promises">${p.promises.map((x) => `<li><span class="icon" aria-hidden="true">task_alt</span>${esc(x)}</li>`).join("")}</ul>`;
    return `${html}</article>`;
  }

  function paintDiary() {
    if (!pages.length) {
      body.innerHTML = `<div class="dy-empty"><span class="icon" aria-hidden="true">auto_stories</span>
        <b>Your diary is empty for now</b><p>It fills itself: after a call together, Saathi writes the day's page from your call, chat and the line each of you leaves.</p></div>`;
      return;
    }
    body.innerHTML = pages.map(pageHtml).join("");
  }

  modal.addEventListener("click", async (event) => {
    const hide = event.target.closest("[data-hide]");
    if (!hide) return;
    const ok = await window.DU.kit?.confirmBox?.({ title: "Remove this page?", text: "It's removed from the diary for both of you.", ok: "Remove", cancel: "Keep" });
    if (!ok) return;
    try {
      await api("diary-hide", { day: hide.dataset.hide });
      pages = pages.filter((p) => p.day !== hide.dataset.hide);
      paintDiary();
      toast("Page removed");
    } catch (error) { toast(error.message); }
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-diary]")) openDiary();
  });

  // ---------- hooks ----------

  Object.assign(window.DU, { openDiary });
})();
