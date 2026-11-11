// DU Meet · things just for the two of you, during a call:
// love notes, memories (photos), countdown, questions to talk about, bucket list and stats.
// Everything is saved on the server (Supabase), so it is still there next time.
// Uses globals from app.js (send, peers, me, toast, joinedAt) and helpers from tools.js.

(() => {
  "use strict";
  const { q, esc, pad, store, dayKey, parseDay, getDocs, putDoc, delDoc, upload, confirmBox, toggleTray, shrinkImage } = window.DU.kit;
  const { openModal, closeModal } = window.DU;

  const PAIR = { Uday: "Diya", Diya: "Uday" };
  const otherName = () => [...peers.values()][0]?.name || PAIR[me.name] || "them";
  const DAY = 86400000;
  const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const daysUntil = (key) => Math.round((parseDay(key) - today0()) / DAY);
  const shortDate = (ms) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  const when = (ms) => {
    const diff = (Date.now() - ms) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < DAY / 1000) return `${Math.floor(diff / 3600)} h ago`;
    return shortDate(ms);
  };
  const empty = (icon, text) => `<div class="empty-art"><span class="icon">${icon}</span><p>${esc(text)}</p></div>`;
  const span = window.DU.span;

  // ---------- one sheet, many tools ----------

  const tool = { name: "", docs: {} };
  const body = () => q("#tool-body");
  const isOpen = (name) => tool.name === name && !q("#m-tool").hidden;

  function openTool(name, title) {
    toggleTray(false);
    tool.name = name;
    q("#tool-title").textContent = title;
    q("#m-tool .sheet").dataset.tool = name;
    body().innerHTML = `<div class="loading"><span class="spinner"></span></div>`;
    openModal(q("#m-tool"));
  }
  async function load(collection) {
    tool.docs[collection] = await getDocs(collection);
    return tool.docs[collection];
  }
  const failed = () => { body().innerHTML = empty("cloud_off", "Couldn't load this. Check the internet and try again."); };
  const tell = (c) => send("couple-sync", { c });

  const RENDER = {};
  async function show(name, title, collection) {
    openTool(name, title);
    try { await load(collection); } catch { return failed(); }
    RENDER[name]();
  }

  // ---------- love notes ----------

  async function openLetters() {
    await show("letters", "Love notes", "letters");
    // opening them marks the ones for me as read
    for (const doc of tool.docs.letters || []) {
      if (doc.data.from !== me.name && !doc.data.read) putDoc("letters", { ...doc.data, read: true }, doc.id).catch(() => {});
    }
    setTimeout(refreshUnread, 1200);
  }
  RENDER.letters = () => {
    const docs = tool.docs.letters || [];
    body().innerHTML = `
      <form class="letter-form" data-form="letter">
        <textarea class="field" name="text" rows="3" maxlength="2000" placeholder="Write something for ${esc(otherName())}…" required></textarea>
        <div class="row-end"><span class="muted small">They'll see it right away, or the next time they join.</span><button class="btn primary"><span class="icon">send</span>Send</button></div>
      </form>
      ${docs.length ? `<ul class="letters">${docs.map((d) => {
        const mine = d.data.from === me.name;
        return `<li class="letter ${mine ? "mine" : ""} ${!mine && !d.data.read ? "new" : ""}">
          <header><span class="l-from">${mine ? "From you" : `From ${esc(d.data.from)}`}</span><span class="muted small">${esc(when(d.data.at))}</span>
          ${mine ? `<button class="icon-btn small" data-del="letters:${esc(d.id)}" aria-label="Delete"><span class="icon">delete</span></button>` : ""}</header>
          <p>${esc(d.data.text)}</p></li>`;
      }).join("")}</ul>` : empty("mail", "No notes yet. Write the first one.")}`;
  };

  async function refreshUnread() {
    try {
      const docs = await getDocs("letters");
      const unread = docs.filter((d) => d.data.from !== me.name && !d.data.read);
      q("#tray-letters").textContent = unread.length ? `${unread.length} new for you` : "Leave a note";
      q("#tray-letters").classList.toggle("hot", unread.length > 0);
      q(".tray-badge").hidden = unread.length === 0;
      return unread;
    } catch { return []; }
  }

  // ---------- memories ----------

  RENDER.memories = () => {
    const docs = tool.docs.memories || [];
    body().innerHTML = `
      <div class="tool-top"><p class="muted">${docs.length ? `${docs.length} photo${docs.length > 1 ? "s" : ""} of you two` : "Your photos together"}</p>
        <label class="btn outline small-btn"><span class="icon">add_photo_alternate</span>Add<input type="file" accept="image/*" multiple hidden data-mem-add></label></div>
      ${docs.length ? `<div class="mem-grid">${docs.map((d) => `
        <figure class="mem" data-mem="${esc(d.data.url)}"><img loading="lazy" src="${esc(authUrl(d.data.url))}" alt="Photo from ${esc(shortDate(d.data.at))}">
          <figcaption>${esc(shortDate(d.data.at))}</figcaption>
          <button class="mem-del" data-del="memories:${esc(d.id)}" aria-label="Delete photo"><span class="icon">delete</span></button></figure>`).join("")}</div>`
        : empty("photo_library", "Tap the camera button in the call bar. Every photo is saved here for both of you.")}`;
  };

  // ---------- countdown ----------

  async function getDates() {
    try { return (await getDocs("settings")).find((d) => d.id === "dates")?.data || {}; } catch { return null; }
  }
  RENDER.countdown = () => {
    const dates = tool.docs.dates || {};
    const left = dates.next ? daysUntil(dates.next) : null;
    const together = dates.since ? -daysUntil(dates.since) : null;
    const big = left === null || left < 0
      ? `<div class="cd-big muted-big"><span class="icon">hourglass_empty</span><p>When do you meet next? Set the date below.</p></div>`
      : left === 0 ? `<div class="cd-big today"><b>Today</b><span>${esc(dates.label || "You meet today")}</span></div>`
        : `<div class="cd-big"><b>${left}</b><span>day${left > 1 ? "s" : ""} until ${esc(dates.label || "we meet")}</span><small>${esc(parseDay(dates.next).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }))}</small></div>`;
    body().innerHTML = `
      ${big}
      ${together !== null && together >= 0 ? `<div class="cd-since"><span class="icon">favorite</span><span><b>${together.toLocaleString()}</b> days together</span></div>` : ""}
      <form class="cd-form" data-form="dates">
        <label><span>Next time we meet</span><input class="field" type="date" name="next" value="${esc(dates.next || "")}"></label>
        <label><span>What's the plan?</span><input class="field" name="label" maxlength="40" placeholder="e.g. Diwali at home" value="${esc(dates.label || "")}"></label>
        <label><span>Together since</span><input class="field" type="date" name="since" value="${esc(dates.since || "")}"></label>
        <button class="btn primary wide">Save</button>
      </form>`;
  };
  async function openCountdown() {
    openTool("countdown", "Countdown");
    const dates = await getDates();
    if (dates === null) return failed();
    tool.docs.dates = dates;
    RENDER.countdown();
  }
  async function refreshCountdown(greet = false) {
    const dates = await getDates();
    const line = q("#tray-count");
    if (!dates?.next || daysUntil(dates.next) < 0) { line.textContent = "Till we meet"; return; }
    const left = daysUntil(dates.next);
    line.textContent = left === 0 ? "It's today!" : `${left} day${left > 1 ? "s" : ""} to go`;
    if (greet && left === 0) toast(`Today's the day: ${dates.label || "you meet today"}`);
  }

  // ---------- questions ----------

  const DECKS = {
    "Deep talk": [
      "What's something you've never told anyone?", "When did you feel closest to me?", "What are you most afraid of right now?",
      "What does a perfect day with me look like?", "What's one thing you'd change about how we talk?", "What made you fall for me?",
      "What's a dream you've quietly given up on?", "When do you feel most like yourself?", "What's something I do that makes you feel loved?",
      "What's the hardest thing about being apart for you?", "What do you want us to be like in 10 years?", "What's a memory you replay often?",
    ],
    Fun: [
      "If we swapped lives for a day, what would you do first?", "What's the weirdest food you'd actually eat?", "Which movie character am I most like?",
      "What's your most useless talent?", "If you could have one superpower for a week, which one?", "What song describes us?",
      "What's the funniest thing that happened to you this week?", "Pineapple on pizza, final answer?", "What would your villain name be?",
      "What's the most embarrassing thing on your phone?", "If we had a pet together, what would we name it?", "What's your guilty-pleasure show?",
    ],
    "Would you rather": [
      "Would you rather travel the world or have a dream house?", "Would you rather read my mind or have me read yours?",
      "Would you rather live in the mountains or by the sea?", "Would you rather never use social media again or never watch movies again?",
      "Would you rather have a long weekend every week or double salary?", "Would you rather relive our first date or skip to our next one?",
      "Would you rather cook together or order in forever?", "Would you rather be famous or rich?", "Would you rather always be early or always be late?",
      "Would you rather have breakfast in Paris or dinner in Tokyo?",
    ],
    "Future us": [
      "Where should we travel first together?", "What does our home look like?", "What tradition should we start?",
      "What's one thing we must do before we turn 30?", "City life or a quiet town?", "What would our Sunday mornings be like?",
      "What's something you want to learn together?", "How do we celebrate our anniversaries?", "What's on your list for our next meet?",
    ],
    Memories: [
      "What's your favourite memory of us?", "What did you first think when you saw me?", "What's the best gift you've ever got?",
      "What's a moment you wish you could relive?", "Which of our calls do you remember the most?", "What was the best day of this year so far?",
      "What's a song that reminds you of me?", "What's the funniest fight we've had?", "What's the sweetest thing I've done for you?",
    ],
  };
  const asked = new Set(store.get("du-asked", []));
  let deck = store.get("du-deck", "Deep talk");

  function pickQuestion(name) {
    const list = DECKS[name] || DECKS["Deep talk"];
    let pool = list.filter((text) => !asked.has(text));
    if (!pool.length) { list.forEach((text) => asked.delete(text)); pool = list; }
    const text = pool[Math.floor(Math.random() * pool.length)];
    asked.add(text);
    store.set("du-asked", [...asked].slice(-200));
    return text;
  }
  function ask(name = deck) {
    const text = pickQuestion(name);
    showQuestion({ deck: name, text, by: me.name });
    send("question", { deck: name, text });
    closeModal(q("#m-tool"));
  }
  function showQuestion({ deck: name, text, by }) {
    const card = q("#tg-question");
    card.innerHTML = `<small><span class="icon">forum</span>${esc(name)} · ${by === me.name ? "you asked" : `${esc(by)} asked`}</small>
      <p>${esc(text)}</p>
      <div class="q-actions"><button class="btn small-btn q-next" data-tg="q-next"><span class="icon">shuffle</span>Next</button><button class="icon-btn" data-tg="q-close" aria-label="Close"><span class="icon">close</span></button></div>`;
    card.dataset.deck = name;
    card.hidden = false;
    card.classList.remove("in");
    void card.offsetWidth;
    card.classList.add("in");
  }
  RENDER.questions = () => {
    body().innerHTML = `<p class="muted">Pick a deck. The question shows up for both of you.</p>
      <div class="decks">${Object.keys(DECKS).map((name, i) => `<button class="deck d${i}" data-deck="${esc(name)}"><b>${esc(name)}</b><small>${DECKS[name].length} questions</small></button>`).join("")}</div>`;
  };

  // ---------- bucket list ----------

  RENDER.bucket = () => {
    const docs = (tool.docs.bucket || []).slice().sort((a, b) => Number(a.data.done) - Number(b.data.done));
    const done = docs.filter((d) => d.data.done).length;
    body().innerHTML = `
      <form class="bucket-form" data-form="bucket"><input class="field" name="text" maxlength="120" placeholder="Something to do together…" required autocomplete="off"><button class="btn primary"><span class="icon">add</span>Add</button></form>
      ${docs.length ? `<div class="progress"><div style="width:${Math.round((done / docs.length) * 100)}%"></div></div><p class="muted small">${done} of ${docs.length} done</p>
        <ul class="bucket">${docs.map((d) => `<li class="${d.data.done ? "done" : ""}">
          <button class="check" data-check="${esc(d.id)}" aria-label="${d.data.done ? "Mark as not done" : "Mark as done"}"><span class="icon">${d.data.done ? "check_circle" : "radio_button_unchecked"}</span></button>
          <span class="b-text">${esc(d.data.text)}<small>${d.data.done ? `Done ${esc(shortDate(d.data.doneAt || d.data.at))}` : `Added by ${esc(d.data.by)}`}</small></span>
          <button class="icon-btn small" data-del="bucket:${esc(d.id)}" aria-label="Delete"><span class="icon">close</span></button></li>`).join("")}</ul>`
        : empty("checklist", "Make a list of things you want to do together: trips, dates, firsts.")}`;
  };

  // ---------- stats ----------

  RENDER.stats = () => {
    const docs = (tool.docs.meetings || []).filter((d) => d.data.people?.length > 1);
    const total = docs.reduce((t, d) => t + d.data.secs, 0);
    const days = new Set(docs.map((d) => dayKey(new Date(d.data.start * 1000))));
    let streak = 0;
    const cursor = today0();
    if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (days.has(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
    const longest = docs.reduce((m, d) => Math.max(m, d.data.secs), 0);
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = today0();
      d.setDate(d.getDate() - i);
      const key = dayKey(d);
      week.push({ label: d.toLocaleDateString([], { weekday: "narrow" }), secs: docs.filter((m) => dayKey(new Date(m.data.start * 1000)) === key).reduce((t, m) => t + m.data.secs, 0) });
    }
    const max = Math.max(...week.map((w) => w.secs), 1);
    const weekTotal = week.reduce((t, w) => t + w.secs, 0);
    body().innerHTML = `
      <div class="streak"><span class="flame icon">local_fire_department</span><div><b>${streak} day${streak === 1 ? "" : "s"}</b><span>${streak ? "calling streak · keep it going" : "Call today to start a streak"}</span></div></div>
      <div class="stat-grid">
        <div><b>${docs.length}</b><span>Calls together</span></div>
        <div><b>${span(total)}</b><span>Total time</span></div>
        <div><b>${span(longest)}</b><span>Longest call</span></div>
        <div><b>${docs.length ? span(total / docs.length) : "0 min"}</b><span>Average call</span></div>
      </div>
      <p class="panel-label">This week · ${span(weekTotal)}</p>
      <div class="bars">${week.map((w) => `<div class="bar"><i style="height:${Math.max(4, Math.round((w.secs / max) * 100))}%" title="${esc(span(w.secs))}"></i><span>${w.label}</span></div>`).join("")}</div>
      <p class="muted small">Counted when both of you are in a call. The call you're in now is added when it ends.</p>`;
  };

  // ---------- clicks and forms inside the sheet ----------

  q("#tool-body").addEventListener("click", async (event) => {
    const del = event.target.closest("[data-del]");
    if (del) {
      event.stopPropagation();
      const [collection, id] = del.dataset.del.split(":");
      if (!(await confirmBox({ title: "Delete this?", text: "It will be deleted for both of you.", ok: "Delete", cancel: "Keep" }))) return;
      try {
        await delDoc(collection, id);
        tool.docs[collection] = tool.docs[collection].filter((d) => d.id !== id);
        RENDER[tool.name]();
        tell(collection);
      } catch { toast("Couldn't delete it"); }
      return;
    }
    const mem = event.target.closest("[data-mem]");
    if (mem) return window.DU.lightbox(authUrl(mem.dataset.mem));
    const deckButton = event.target.closest("[data-deck]");
    if (deckButton) { deck = deckButton.dataset.deck; store.set("du-deck", deck); return ask(deck); }
    const check = event.target.closest("[data-check]");
    if (check) {
      const doc = tool.docs.bucket.find((d) => d.id === check.dataset.check);
      if (!doc) return;
      doc.data = { ...doc.data, done: !doc.data.done, doneAt: Date.now() };
      RENDER.bucket();
      if (doc.data.done) { navigator.vibrate?.(20); toast("Done together"); }
      try { await putDoc("bucket", doc.data, doc.id); tell("bucket"); } catch { toast("Couldn't save"); }
    }
  });

  q("#tool-body").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form));
    const button = form.querySelector("button:last-child");
    button.disabled = true;
    try {
      if (form.dataset.form === "letter") {
        await putDoc("letters", { from: me.name, text: data.text.trim(), at: Date.now(), read: false });
        toast("Note sent");
        await load("letters");
        tell("letters");
      } else if (form.dataset.form === "bucket") {
        await putDoc("bucket", { text: data.text.trim(), done: false, by: me.name, at: Date.now() });
        await load("bucket");
        tell("bucket");
      } else if (form.dataset.form === "dates") {
        const dates = { next: data.next, label: data.label.trim(), since: data.since, by: me.name };
        await putDoc("settings", dates, "dates");
        tool.docs.dates = dates;
        refreshCountdown();
        toast("Saved");
        tell("settings");
      }
      RENDER[tool.name]();
    } catch {
      toast("Couldn't save. Check the internet.");
      button.disabled = false;
    }
  });

  q("#tool-body").addEventListener("change", async (event) => {
    if (!event.target.matches("[data-mem-add]")) return;
    const files = [...event.target.files].slice(0, 10);
    event.target.value = "";
    toast("Adding photos…");
    for (const file of files) {
      try {
        const uploaded = await upload(await shrinkImage(file));
        await putDoc("memories", { url: uploaded.url, type: uploaded.type, by: me.name, at: Date.now() });
      } catch { toast(`Couldn't add ${file.name}`); }
    }
    await load("memories").catch(() => {});
    if (isOpen("memories")) RENDER.memories();
    tell("memories");
  });

  const openMemories = () => show("memories", "Memories", "memories");

  window.DU = Object.assign(window.DU, {
    openMemories,
    onCoupleClick(button) {
      ({
        letters: openLetters,
        memories: openMemories,
        countdown: openCountdown,
        questions: () => { openTool("questions", "Questions"); RENDER.questions(); },
        bucket: () => show("bucket", "Bucket list", "bucket"),
        stats: () => show("stats", "Our stats", "meetings"),
        "q-next": () => ask(q("#tg-question").dataset.deck || deck),
        "q-close": () => { q("#tg-question").hidden = true; send("question", { close: true }); },
      })[button.dataset.tg]?.();
    },
    async onCouple(message, peer) {
      const data = message.data || {};
      if (message.type === "question") {
        if (data.close) q("#tg-question").hidden = true;
        else if (DECKS[data.deck]) showQuestion({ deck: data.deck, text: String(data.text).slice(0, 300), by: peer.name });
        return;
      }
      if (message.type !== "couple-sync") return;
      const c = data.c;
      if (c === "letters") {
        toast(`${peer.name} sent you a love note`);
        navigator.vibrate?.([30, 60, 30]);
        refreshUnread();
      }
      if (c === "settings") refreshCountdown();
      const name = { letters: "letters", memories: "memories", bucket: "bucket" }[c];
      if (name && isOpen(name)) { await load(c).catch(() => {}); RENDER[name](); }
      if (c === "settings" && isOpen("countdown")) { tool.docs.dates = (await getDates()) || {}; RENDER.countdown(); }
    },
    async onCoupleJoin() {
      refreshCountdown(true);
      const unread = await refreshUnread();
      if (unread.length) setTimeout(() => toast(`${unread[0].data.from} left you ${unread.length > 1 ? `${unread.length} love notes` : "a love note"} · open ✨`), 1500);
    },
    onCoupleLeave() {
      q("#tg-question").hidden = true;
      tool.name = "";
    },
  });
})();
