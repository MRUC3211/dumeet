// DU Meet · Study together: a shared focus timer for the call (25 + 5 style rounds).
// Both see the same timer. Leaving the app during focus shows up for the other one
// (with a little teasing). In every break Hey Lord makes a quick 3-question quiz from your
// topic or a photo of your notes (the photo goes to Gemini only for that, never saved).
// At the end the study time goes into Our diary. Uses globals from app.js.

(() => {
  "use strict";
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const { openModal, closeModal } = window.DU;
  const myName = () => me.name || prefs.name || "";
  const people = () => [me.name, ...[...peers.values()].map((p) => p.name)].filter(Boolean);
  const share = (data) => { if (polling) send("study", data); };
  const api = async (action, body = {}) => {
    const response = await fetch(`/api/ai/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: myName(), names: people(), ...body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || "Something went wrong");
    return data;
  };

  const PLANS = [
    { id: "25", focus: 25, brk: 5, rounds: 4, label: "25 + 5", small: "4 rounds · 2 h" },
    { id: "50", focus: 50, brk: 10, rounds: 2, label: "50 + 10", small: "2 rounds · 2 h" },
    { id: "45", focus: 45, brk: 15, rounds: 2, label: "45 + 15", small: "2 rounds · 2 h" },
  ];
  const TAUNTS = [
    "Phone ne phir se jeet liya? 😏",
    "Reels baad mein, syllabus pehle!",
    "Itni der? Chai bana rahe the ya Netflix?",
    "Focus mode tha, Instagram mode nahi 😄",
    "Wapas aa gaye, shabaash. Ab tikna!",
    "Hey Lord ne dekh liya tha, bas bol nahi raha tha 👀",
  ];
  const BREAK_LINES = ["Paani piyo, stretch karo 🧘", "Aankhen screen se hatao, 20 second door dekho 👀", "Ek glass paani, ek smile 🙂", "Uth ke thoda chal lo 🚶"];

  const st = {
    on: false, phase: "focus", ends: 0, paused: false, pausedLeft: 0,
    plan: PLANS[0], round: 1, topics: {}, away: {}, scores: {}, by: "",
  };
  const mine = { topic: "", image: "", quiz: true, focusSecs: 0, rounds: 0, right: 0, total: 0, asked: [], awayAt: 0, aways: 0 };
  let saathi = null; // { enabled, consent }

  const left = () => Math.max(0, st.paused ? st.pausedLeft : (st.ends - Date.now()) / 1000);
  const clock = (secs) => { secs = Math.ceil(secs); return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`; };
  const stateMsg = () => ({ act: "state", on: st.on, phase: st.phase, left: left(), paused: st.paused, plan: st.plan.id, round: st.round, topics: st.topics, by: st.by });

  // ---------- setup sheet ----------

  const sheet = document.createElement("div");
  sheet.className = "modal";
  sheet.id = "m-study";
  sheet.hidden = true;
  sheet.innerHTML = `<div class="sheet narrow st-sheet" role="dialog" aria-modal="true" aria-labelledby="st-title">
    <header class="sheet-head"><h2 id="st-title">Study together</h2>
      <button class="icon-btn" data-modal-close aria-label="Close"><span class="icon" aria-hidden="true">close</span></button></header>
    <div class="sheet-body st-body"></div></div>`;
  document.body.append(sheet);
  const sbody = q(".st-body", sheet);
  const fileInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
  sheet.append(fileInput);

  async function openSetup() {
    window.DU.kit?.toggleTray?.(false);
    if (!polling) return toast("Join the call first");
    paintSetup();
    openModal(sheet);
    try { saathi = await api("state"); } catch { saathi = { enabled: false }; }
    paintSetup();
  }

  function quizNote() {
    if (!saathi) return `<small class="st-q-note">Checking Hey Lord…</small>`;
    if (!saathi.enabled) return `<small class="st-q-note">Quizzes need Hey Lord (the Gemini key on the server).</small>`;
    if (!saathi.consent?.[myName()]) return `<small class="st-q-note">Open Hey Lord once and tap "I agree" to get quizzes.</small>`;
    return `<small class="st-q-note">Your topic and photo go to Gemini only to make the quiz. Nothing is saved.</small>`;
  }
  const quizReady = () => Boolean(saathi?.enabled && saathi.consent?.[myName()]);

  function paintSetup() {
    // keep what was typed or switched while the sheet repaints
    const typed = q("#st-topic", sheet);
    if (typed) mine.topic = typed.value;
    const sw = q("[data-st=quiz]", sheet);
    if (sw && !sw.disabled) mine.quiz = sw.checked;
    const joining = st.on;
    sbody.innerHTML = `${joining ? "" : `<p class="st-intro">Focus together with cameras on. Each break, Hey Lord quizzes you on what you just studied.</p>
      <div class="st-plans" role="radiogroup" aria-label="Plan">${PLANS.map((p) => `<button role="radio" aria-checked="${p.id === st.plan.id}" data-plan="${p.id}"><b>${p.label}</b><small>${p.small}</small></button>`).join("")}</div>`}
      ${joining ? `<p class="st-intro">${esc(st.by)} started a ${st.plan.label} session. Add what you're studying so Hey Lord can quiz you.</p>` : ""}
      <label class="sa-label" for="st-topic">What are you studying?</label>
      <input id="st-topic" class="field" maxlength="120" placeholder="e.g. DBMS normalisation, Accounts ch 4" value="${esc(mine.topic)}">
      <div class="st-photo">${mine.image ? `<img src="data:image/jpeg;base64,${mine.image}" alt="Your notes"><span><b>Notes photo added</b><small>The quiz comes from this page.</small></span>
        <button class="icon-btn" data-st="photo-off" aria-label="Remove the photo"><span class="icon" aria-hidden="true">close</span></button>`
        : `<button class="st-photo-add" data-st="photo"><span class="icon" aria-hidden="true">add_a_photo</span><span><b>Add a notes photo</b><small>Optional: the quiz comes from that page</small></span></button>`}</div>
      <label class="st-switch"><input type="checkbox" data-st="quiz" ${mine.quiz && quizReady() ? "checked" : ""} ${quizReady() ? "" : "disabled"}><span class="st-track"><i></i></span><span><b>Quiz me in breaks</b>${quizNote()}</span></label>
      <button class="btn primary sa-wide" data-st="${joining ? "save" : "start"}"><span class="icon" aria-hidden="true">${joining ? "check" : "play_arrow"}</span>${joining ? "Save" : "Start studying"}</button>`;
  }

  sheet.addEventListener("click", (event) => {
    const plan = event.target.closest("[data-plan]");
    if (plan) {
      st.plan = PLANS.find((p) => p.id === plan.dataset.plan) || PLANS[0];
      for (const b of sheet.querySelectorAll("[data-plan]")) b.setAttribute("aria-checked", String(b === plan));
      return;
    }
    const go = event.target.closest("[data-st]")?.dataset.st;
    if (go === "photo") fileInput.click();
    if (go === "photo-off") { mine.image = ""; mine.topic = q("#st-topic", sheet).value; paintSetup(); }
    if (go === "start" || go === "save") {
      mine.topic = q("#st-topic", sheet).value.trim();
      mine.quiz = Boolean(q("[data-st=quiz]", sheet)?.checked);
      st.topics[myName()] = mine.topic;
      closeModal(sheet);
      if (go === "start") start();
      else { share({ act: "topic", name: myName(), topic: mine.topic }); paintBar(); }
    }
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    mine.topic = q("#st-topic", sheet)?.value || mine.topic;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
      const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      mine.image = canvas.toDataURL("image/jpeg", 0.75).split(",")[1];
    } catch {
      toast("Couldn't read that photo");
    }
    paintSetup();
  });

  // ---------- the session ----------

  function start() {
    Object.assign(st, { on: true, phase: "focus", round: 1, paused: false, ends: Date.now() + st.plan.focus * 60000, by: myName(), away: {}, scores: {} });
    Object.assign(mine, { focusSecs: 0, rounds: 0, right: 0, total: 0, asked: [], aways: 0 });
    showBar();
    share(stateMsg());
    chime(1);
    toast(`Focus time. ${st.plan.focus} minutes, phones down 📵`);
  }

  function apply(d, peer) {
    const wasOn = st.on;
    const before = { phase: st.phase, round: st.round };
    st.plan = PLANS.find((p) => p.id === d.plan) || st.plan;
    Object.assign(st, { on: d.on, phase: d.phase, round: d.round, paused: d.paused, by: d.by || st.by });
    st.topics = { ...d.topics, [myName()]: st.topics[myName()] ?? mine.topic };
    if (d.paused) st.pausedLeft = d.left; else st.ends = Date.now() + d.left * 1000;
    if (!wasOn && st.on) {
      Object.assign(mine, { focusSecs: 0, rounds: 0, right: 0, total: 0, asked: [], aways: 0 });
      st.away = {}; st.scores = {};
      showBar();
      chime(1);
      toast(`${peer.name} started Study together`);
      openSetup();
    } else if (wasOn && st.on) {
      // the other device reached the end of a phase a moment before this one
      if (before.phase === "focus" && st.phase === "break") enterBreak();
      if (before.phase === "break" && st.phase === "focus") enterFocus();
    }
    paintBar();
  }

  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    if (!st.on || st.paused) return;
    if (st.phase === "focus" && !document.hidden) mine.focusSecs += Math.min(dt, 2);
    if (left() <= 0) advance();
    paintBar();
  }, 500);

  function advance() {
    if (st.phase === "focus") {
      if (st.round >= st.plan.rounds) { mine.rounds += 1; return finish(true); }
      st.phase = "break";
      st.ends = Date.now() + st.plan.brk * 60000;
      enterBreak();
    } else {
      st.round += 1;
      st.phase = "focus";
      st.ends = Date.now() + st.plan.focus * 60000;
      enterFocus();
    }
    if (st.by === myName() || !people().includes(st.by)) share(stateMsg());
  }

  function enterBreak() {
    mine.rounds += 1;
    chime(2);
    toast(`Break! ${st.plan.brk} minutes. ${BREAK_LINES[Math.floor(Math.random() * BREAK_LINES.length)]}`);
    if (mine.quiz && quizReady() && (mine.topic || mine.image)) quiz();
  }

  function enterFocus() {
    closeModal(qModal);
    chime(1);
    toast(`Round ${st.round} of ${st.plan.rounds}. Back to focus 💪`);
  }

  function togglePause() {
    if (st.paused) { st.ends = Date.now() + st.pausedLeft * 1000; st.paused = false; }
    else { st.pausedLeft = left(); st.paused = true; }
    share(stateMsg());
    paintBar();
  }

  async function finish(done, quiet = false, silent = false) {
    if (!st.on) return;
    st.on = false;
    hideBar();
    closeModal(qModal);
    if (!quiet) share({ act: "stop", done });
    const minutes = Math.round(mine.focusSecs / 60);
    if (minutes >= 1) {
      api("study-log", { mins: minutes, rounds: mine.rounds, right: mine.right, total: mine.total, topic: mine.topic }).catch(() => {});
    }
    if (!silent && (minutes >= 1 || mine.total)) showSummary(done, minutes);
  }

  // ---------- leaving the app during focus ----------

  document.addEventListener("visibilitychange", () => {
    if (!st.on || st.paused || st.phase !== "focus") return;
    if (document.hidden) {
      mine.awayAt = Date.now();
      share({ act: "away", name: myName() });
    } else if (mine.awayAt) {
      const secs = Math.round((Date.now() - mine.awayAt) / 1000);
      mine.awayAt = 0;
      share({ act: "back", name: myName(), secs });
      if (secs >= 20) {
        mine.aways += 1;
        toast(`Welcome back. ${secs >= 60 ? `${Math.round(secs / 60)} min` : `${secs} sec`} away, Hey Lord noticed 😏`);
      }
    }
  });

  // ---------- break quiz ----------

  const qModal = document.createElement("div");
  qModal.className = "modal";
  qModal.id = "m-quiz";
  qModal.hidden = true;
  qModal.innerHTML = `<div class="sheet narrow qz-sheet" role="dialog" aria-modal="true" aria-labelledby="qz-title">
    <header class="sheet-head"><h2 id="qz-title">Break quiz</h2>
      <button class="icon-btn" data-modal-close aria-label="Close"><span class="icon" aria-hidden="true">close</span></button></header>
    <div class="sheet-body qz-body"></div></div>`;
  document.body.append(qModal);
  const qbody = q(".qz-body", qModal);
  let qz = null; // { questions, cheer, i, picked, right }

  async function quiz() {
    qz = null;
    qbody.innerHTML = `<div class="qz-load"><span class="sa-orb big live" aria-hidden="true"><i></i></span><p>Hey Lord is making your quiz…</p></div>`;
    openModal(qModal);
    try {
      const r = await api("quiz", { topic: mine.topic, image: mine.image || undefined, avoid: mine.asked });
      qz = { ...r, i: 0, picked: null, right: 0 };
      mine.asked.push(...r.questions.map((x) => x.q));
    } catch (error) {
      qbody.innerHTML = `<div class="qz-load"><span class="icon qz-err" aria-hidden="true">error</span><p>${esc(error.message)}</p><button class="btn outline" data-modal-close>Okay</button></div>`;
      return;
    }
    paintQuiz();
  }

  function paintQuiz() {
    if (!qz) return;
    const total = qz.questions.length;
    if (qz.i >= total) {
      const r = qz.right;
      const line = r === total ? "Full marks! Topper vibes 🏆" : r === 0 ? "Koi baat nahi, agle round mein pakka 💪" : r >= total / 2 ? "Achha hai! Thoda aur revise, phir full marks 😎" : "Hmm, yeh part dobara dekh lo 📖";
      qbody.innerHTML = `<div class="qz-done"><div class="qz-score"><b>${r}</b><span>/ ${total}</span></div><p>${line}</p>
        <button class="btn primary sa-wide" data-modal-close>Back to the break</button></div>`;
      return;
    }
    const item = qz.questions[qz.i];
    const picked = qz.picked;
    qbody.innerHTML = `${qz.i === 0 && qz.cheer ? `<p class="qz-cheer"><span class="sa-orb mini" aria-hidden="true"><i></i></span>${esc(qz.cheer)}</p>` : ""}
      <div class="qz-prog">${qz.questions.map((_, k) => `<i class="${k < qz.i ? "done" : k === qz.i ? "now" : ""}"></i>`).join("")}</div>
      <p class="qz-q">${esc(item.q)}</p>
      <div class="qz-opts">${item.options.map((o, k) => {
        const cls = picked === null ? "" : k === item.answer ? "right" : k === picked ? "wrong" : "dim";
        return `<button data-pick="${k}" class="${cls}" ${picked === null ? "" : "disabled"}><i>${"ABCD"[k]}</i><span>${esc(o)}</span></button>`;
      }).join("")}</div>
      ${picked === null ? "" : `<p class="qz-why ${picked === item.answer ? "ok" : ""}"><b>${picked === item.answer ? "Sahi jawab!" : "Not quite."}</b> ${esc(item.why)}</p>
        <button class="btn primary sa-wide" data-next>${qz.i + 1 < total ? "Next question" : "See my score"}</button>`}`;
  }

  qModal.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-pick]");
    if (pick && qz && qz.picked === null) {
      qz.picked = Number(pick.dataset.pick);
      const ok = qz.picked === qz.questions[qz.i].answer;
      if (ok) qz.right += 1;
      paintQuiz();
      return;
    }
    if (event.target.closest("[data-next]") && qz) {
      qz.i += 1;
      qz.picked = null;
      if (qz.i >= qz.questions.length) {
        mine.right += qz.right;
        mine.total += qz.questions.length;
        st.scores[myName()] = { right: mine.right, total: mine.total };
        share({ act: "score", name: myName(), right: qz.right, total: qz.questions.length, sumRight: mine.right, sumTotal: mine.total });
        paintBar();
      }
      paintQuiz();
    }
  });

  // ---------- the bar on the call ----------

  let bar = null;
  function showBar() {
    hideBar();
    bar = document.createElement("div");
    bar.className = "st-bar";
    bar.innerHTML = `<span class="st-ring"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5"/><circle class="st-arc" cx="18" cy="18" r="15.5"/></svg><span class="icon" aria-hidden="true">menu_book</span></span>
      <div class="st-txt"><b><span class="st-phase"></span> <span class="st-time"></span></b><small class="st-sub"></small></div>
      <button class="st-btn" data-bar="pause" aria-label="Pause"><span class="icon" aria-hidden="true">pause</span></button>
      <button class="st-btn" data-bar="edit" aria-label="Your topic and quiz"><span class="icon" aria-hidden="true">edit_note</span></button>
      <button class="st-btn end" data-bar="stop" aria-label="End study session"><span class="icon" aria-hidden="true">stop</span></button>`;
    bar.addEventListener("click", async (event) => {
      const act = event.target.closest("[data-bar]")?.dataset.bar;
      if (act === "pause") togglePause();
      if (act === "edit") openSetup();
      if (act === "stop") {
        const ok = await window.DU.kit?.confirmBox?.({ title: "End the study session?", text: "It ends for both of you, and your study time goes into Our diary.", ok: "End", cancel: "Keep going" });
        if (ok) finish(false);
      }
    });
    (q(".main-area") || document.body).append(bar);
    paintBar();
  }
  function hideBar() { bar?.remove(); bar = null; }

  function paintBar() {
    if (!bar) return;
    const total = (st.phase === "focus" ? st.plan.focus : st.plan.brk) * 60;
    const l = left();
    bar.dataset.phase = st.phase;
    bar.classList.toggle("paused", st.paused);
    q(".st-phase", bar).textContent = st.paused ? "Paused" : st.phase === "focus" ? "Focus" : "Break";
    q(".st-time", bar).textContent = clock(l);
    q(".st-arc", bar).style.strokeDashoffset = String(97.4 * (1 - l / total));
    q(".st-ring .icon", bar).textContent = st.phase === "focus" ? "menu_book" : "local_cafe";
    q("[data-bar=pause] .icon", bar).textContent = st.paused ? "play_arrow" : "pause";
    const bits = [`Round ${st.round} of ${st.plan.rounds}`];
    const away = Object.keys(st.away).filter((n) => st.away[n]);
    if (away.length) bits.push(`${away.join(", ")} left the app 👀`);
    else {
      const scores = Object.entries(st.scores).map(([n, s]) => `${n === myName() ? "You" : n} ${s.right}/${s.total}`);
      if (scores.length) bits.push(`Quiz: ${scores.join(" · ")}`);
      else {
        const topics = Object.entries(st.topics).filter(([, t]) => t).map(([n, t]) => `${n === myName() ? "You" : n}: ${t}`);
        if (topics.length) bits.push(topics.join(" · "));
      }
    }
    q(".st-sub", bar).textContent = bits.join(" · ");
  }

  // ---------- summary ----------

  function showSummary(done, minutes) {
    const scores = Object.entries(st.scores).map(([n, s]) => `<span>${esc(n === myName() ? "You" : n)} <b>${s.right}/${s.total}</b></span>`).join("");
    const line = done ? (mine.aways ? `Done! Bas ${mine.aways} baar phone pe gaye, next time zero 😄` : "Done, and not once on the phone. Legends 🏆") : "Good session. Every minute counts 📚";
    qbody.innerHTML = `<div class="qz-done"><span class="icon st-trophy" aria-hidden="true">${done ? "emoji_events" : "menu_book"}</span>
      <div class="qz-score"><b>${minutes}</b><span>min focused</span></div>
      <p>${line}</p>${scores ? `<div class="st-scores">${scores}</div>` : ""}
      <small class="muted">Saved to Our diary.</small>
      <button class="btn primary sa-wide" data-modal-close>Nice</button></div>`;
    q("#qz-title", qModal).textContent = done ? "Session complete" : "Study session ended";
    openModal(qModal);
    setTimeout(() => { q("#qz-title", qModal).textContent = "Break quiz"; }, 60000);
  }

  // ---------- a soft chime ----------

  function chime(times) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < times; i++) {
        for (const [f, delay] of [[784, 0], [1047, 0.14]]) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          const t = ctx.currentTime + i * 0.45 + delay;
          o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
          o.connect(g).connect(ctx.destination);
          o.start(t); o.stop(t + 0.65);
        }
      }
      setTimeout(() => ctx.close(), 2000);
    } catch { /* no audio */ }
  }

  // ---------- messages and hooks ----------

  function onStudy(d, peer) {
    switch (d.act) {
      case "state": apply(d, peer); break;
      case "topic": st.topics[d.name] = d.topic; paintBar(); break;
      case "stop":
        if (st.on) {
          if (d.done && st.phase === "focus") mine.rounds += 1;
          toast(d.done ? "Study session complete 🎉" : `${peer.name} ended the study session`);
          finish(Boolean(d.done), true);
        }
        break;
      case "away": st.away[d.name] = true; paintBar(); break;
      case "back":
        st.away[d.name] = false;
        if (d.secs >= 20) toast(`${d.name} is back after ${d.secs >= 60 ? `${Math.round(d.secs / 60)} min` : `${d.secs} sec`}. ${TAUNTS[Math.floor(Math.random() * TAUNTS.length)]}`);
        paintBar();
        break;
      case "score":
        st.scores[d.name] = { right: d.sumRight, total: d.sumTotal };
        toast(`${d.name} scored ${d.right}/${d.total} in the quiz${d.right === d.total ? " 🔥" : ""}`);
        paintBar();
        break;
    }
  }

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave, peer: window.DU.onCouplePeer };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      if (button.dataset.tg === "study") openSetup();
      else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type === "study") onStudy(message.data || {}, peer);
      else prev.msg?.(message, peer);
    },
    onCouplePeer(...args) {
      prev.peer?.(...args);
      if (st.on) setTimeout(() => share(stateMsg()), 1500);
    },
    onCoupleLeave(...args) {
      prev.leave?.(...args);
      if (st.on) finish(false, true, true);
    },
    openStudy: openSetup,
  });
})();
