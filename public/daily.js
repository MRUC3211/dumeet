// DU Meet · Today's question and Our diary (both run on Saathi, see saathi.py).
//
// Today's question: one question a day on the home screen. You see your partner's answer
// only after you answer too; answering on the same day keeps the streak going.
// Our diary: one page per day, written by Saathi from that day's calls, chat, answers,
// study time and the one line each of you leaves after a call.
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
  const partnerName = () => people().find((n) => n !== myName()) || "your partner";
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

  // ---------- Today's question (home screen) ----------

  const card = document.createElement("section");
  card.className = "dq rise";
  card.style.setProperty("--i", "4");
  card.setAttribute("aria-label", "Today's question");
  q("#home .cta")?.after(card);

  let daily = null;
  let busy = false;

  async function loadDaily() {
    if (!daily) card.innerHTML = `<div class="dq-skel"><i></i><i></i><i></i></div>`;
    try {
      daily = await api("daily");
    } catch {
      card.hidden = !daily;
      return;
    }
    card.hidden = false;
    paintDaily();
  }

  function paintDaily() {
    const t = daily.today;
    const other = partnerName();
    const theyAnswered = t.answered.some((n) => n !== myName());
    const head = `<header class="dq-head"><span class="dq-label">${orb}Today's question</span>
      ${daily.streak ? `<span class="dq-streak" title="Days in a row you both answered"><span class="icon" aria-hidden="true">local_fire_department</span>${daily.streak} day${daily.streak === 1 ? "" : "s"}</span>` : ""}</header>
      <p class="dq-q">${esc(t.question)}</p>`;
    let html = head;
    if (!myName()) {
      html += `<button class="btn primary dq-who" data-home="who">Pick who you are to answer</button>`;
    } else if (!t.mine) {
      html += `<form class="dq-form"><textarea class="dq-in" rows="1" maxlength="600" placeholder="Your answer…" aria-label="Your answer"></textarea>
        <button class="dq-send" aria-label="Send answer" ${busy ? "disabled" : ""}><span class="icon" aria-hidden="true">arrow_upward</span></button></form>
        <p class="dq-hint"><span class="icon" aria-hidden="true">${theyAnswered ? "lock" : "visibility_off"}</span>${theyAnswered ? `${esc(other)} has answered. Answer to see it.` : `${esc(other)} sees your answer only after answering too.`}</p>`;
    } else {
      html += `<div class="dq-answers">${[myName(), ...t.answered.filter((n) => n !== myName())].map((n) => `
        <div class="dq-a"><span class="dq-av">${esc(n[0] || "?")}</span><div><b>${n === myName() ? "You" : esc(n)}</b><p>${esc(t.answers[n] || "")}</p></div></div>`).join("")}
        ${theyAnswered ? "" : `<div class="dq-a wait"><span class="dq-av"><span class="icon" aria-hidden="true">hourglass_top</span></span><div><b>${esc(other)}</b><p>Hasn't answered yet. You'll see it here.</p></div></div>`}</div>
        ${t.react ? `<p class="dq-react">${orb}<span>${esc(t.react)}</span></p>` : ""}`;
    }
    html += `<button class="dq-diary" data-diary><span class="icon" aria-hidden="true">auto_stories</span>Our diary<span class="icon" aria-hidden="true">chevron_right</span></button>`;
    card.innerHTML = html;
    const input = q(".dq-in", card);
    if (input) {
      const fit = () => { input.style.height = "auto"; input.style.height = `${Math.min(140, input.scrollHeight)}px`; };
      input.addEventListener("input", fit);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); q(".dq-form", card).requestSubmit(); }
      });
    }
  }

  card.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = q(".dq-in", card)?.value.trim();
    if (!text || busy) return;
    busy = true;
    q(".dq-send", card).disabled = true;
    q(".dq-send", card).classList.add("busy");
    try {
      daily = await api("answer", { text });
      toast(daily.today.answered.length > 1 ? "Answers unlocked 🔓" : "Saved. Waiting for the other answer");
    } catch (error) {
      toast(error.message);
    }
    busy = false;
    paintDaily();
  });

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
    const dq = p.question;
    if (dq) {
      html += `<div class="dy-q"><small>Question of the day</small><b>${esc(dq.question)}</b>
        ${dq.mine ? Object.entries(dq.answers).map(([n, a]) => `<p><i>${esc(n)}</i>${esc(a)}</p>`).join("") : `<p class="dy-lock"><span class="icon" aria-hidden="true">lock</span>Answer it to see what ${esc(dq.answered.join(" and "))} wrote</p>`}</div>`;
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

  // ---------- one line for the diary after a call ----------

  let together = 0;
  setInterval(() => { if (polling && peers.size) together += 5; }, 5000);

  const MOODS = ["😍", "😊", "😌", "😴", "😢", "😤"];
  function showLine() {
    const host = q("#left .left-card");
    q(".dl", host)?.remove();
    if (together < 120 || !myName()) return;
    const box = document.createElement("form");
    box.className = "dl";
    box.innerHTML = `<b>How was today's call?</b>
      <div class="dl-moods" role="radiogroup" aria-label="Mood">${MOODS.map((m) => `<button type="button" role="radio" aria-checked="false" data-mood="${m}">${m}</button>`).join("")}</div>
      <input class="field" maxlength="300" placeholder="One line for our diary (optional)" aria-label="One line for our diary">
      <button class="btn primary">Save to our diary</button>`;
    let mood = "";
    box.addEventListener("click", (event) => {
      const pick = event.target.closest("[data-mood]");
      if (!pick) return;
      mood = pick.dataset.mood;
      for (const b of box.querySelectorAll("[data-mood]")) b.setAttribute("aria-checked", String(b === pick));
    });
    box.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = q("input", box).value.trim();
      if (!mood && !text) return toast("Pick a mood or write a line");
      q(".btn", box).disabled = true;
      try {
        await api("diary-line", { mood, text });
        box.innerHTML = `<p class="dl-done"><span class="icon" aria-hidden="true">check_circle</span>Saved. Saathi will add it to today's page.</p>
          <button type="button" class="btn outline" data-diary><span class="icon" aria-hidden="true">auto_stories</span>Open our diary</button>`;
      } catch (error) {
        toast(error.message);
        q(".btn", box).disabled = false;
      }
    });
    host.querySelector(".left-actions").before(box);
  }

  // ---------- hooks ----------

  const prev = { home: window.DU.onHome, leave: window.DU.onLeave, join: window.DU.onJoin };
  Object.assign(window.DU, {
    onHome(...args) { prev.home?.(...args); loadDaily(); },
    onJoin(...args) { together = 0; q("#left .dl")?.remove(); prev.join?.(...args); },
    onLeave(...args) { prev.leave?.(...args); showLine(); together = 0; },
    openDiary,
  });
  // answer saved on the home screen while a name gets picked
  document.addEventListener("click", (event) => { if (event.target.closest("[data-who]")) setTimeout(loadDaily, 400); });
  if (document.body.dataset.view === "home") loadDaily();
})();
