// DU Meet · "Us": the little things that belong to just the two of you.
//   Our journey   days together, the next anniversary and milestones
//   Love jar      drop sweet notes in; your partner pulls one out at random
//   Open when…    sealed letters for a moment ("Open when you miss me")
//   Mood          how each of you feels today, and your love battery
//   Bucket list   things to do together, ticked off with the date
//   Hug & kiss    a big hug or kiss that fills your partner's screen
// Everything is saved on the server (settings docs us-*), synced live in a call, and merged
// item by item, so both phones can add at the same time without losing anything.

(() => {
  "use strict";
  const { q, esc, store, getDocs, putDoc } = window.DU.kit;
  const W = () => window.DU.win;
  const COUPLE = ["Uday", "Diya"];
  const myName = () => (typeof me === "object" && me.name) || (typeof prefs === "object" && prefs.name) || "";
  const partner = () => {
    const mine = myName().toLowerCase();
    const other = COUPLE.find((n) => n.toLowerCase() !== mine && COUPLE.some((c) => c.toLowerCase() === mine));
    return other || window.DU.kit.partnerName();
  };
  const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
  const day = 86400000;
  const fmtDate = (t) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

  // ---------- data: lists of items, merged by id (newest edit wins, deletes are kept as tombstones) ----------
  const KEYS = ["jar", "letters", "bucket", "moods", "meta"];
  const D = {};
  for (const k of KEYS) D[k] = store.get(`du-us-${k}`, k === "meta" ? {} : []);
  const live = (k) => D[k].filter((x) => !x.del);
  function mergeList(a, b) {
    const m = new Map();
    for (const x of [...a, ...b]) { if (!x?.id) continue; const o = m.get(x.id); if (!o || (x.u || 0) >= (o.u || 0)) m.set(x.id, x); }
    return [...m.values()].sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, 400);
  }
  const merge = (k, incoming) => {
    if (k === "meta") D.meta = (incoming?.u || 0) >= (D.meta.u || 0) ? { ...incoming } : D.meta;
    else if (Array.isArray(incoming)) D[k] = mergeList(D[k], incoming);
    store.set(`du-us-${k}`, D[k]);
  };
  let loaded = false;
  async function load() {
    try {
      const docs = await getDocs("settings");
      for (const k of KEYS) { const d = docs.find((x) => x.id === `us-${k}`)?.data?.v; if (d) merge(k, d); }
      loaded = true;
      paint(); paintTray();
    } catch { /* offline: keep this phone's copy */ }
  }
  const timers = {};
  function save(k) {
    store.set(`du-us-${k}`, D[k]);
    if (typeof polling !== "undefined" && polling) send("us", { k, v: D[k] });
    paint(); paintTray();
    clearTimeout(timers[k]);
    timers[k] = setTimeout(async () => {
      try { const d = (await getDocs("settings")).find((x) => x.id === `us-${k}`)?.data?.v; if (d) merge(k, d); } catch { /* save ours */ }
      putDoc("settings", { v: D[k] }, `us-${k}`).catch(() => toast("Couldn't save. Check the internet."));
    }, 600);
  }
  const upsert = (k, item) => { item.u = Date.now(); D[k] = mergeList(D[k], [item]); save(k); return item; };
  const remove = (k, it) => upsert(k, { ...it, del: true });

  // ---------- presets ----------
  const LETTERS = [
    ["miss", "Open when you miss me", "🥺"], ["sad", "Open when you're sad", "🌧️"], ["sleep", "Open when you can't sleep", "🌙"],
    ["fight", "Open when we've had a fight", "🕊️"], ["stress", "Open when you're stressed", "🫂"], ["happy", "Open when you're happy", "🌞"],
    ["bday", "Open on your birthday", "🎂"], ["doubt", "Open when you doubt us", "💞"], ["bored", "Open when you're bored", "🎈"],
  ];
  const MOODS = [["🥰", "In love"], ["😊", "Happy"], ["😌", "Calm"], ["🤪", "Silly"], ["😴", "Sleepy"], ["😔", "Low"], ["😤", "Grumpy"], ["🥺", "Missing you"], ["🤒", "Unwell"], ["😰", "Stressed"]];
  const BUCKET = [["travel", "Travel", "flight"], ["food", "Food", "restaurant"], ["fun", "Adventure", "hiking"], ["home", "Cosy", "home"], ["life", "Someday", "auto_awesome"]];
  const BUCKET_IDEAS = ["Watch the sunrise together", "Cook a new dish on a call", "Go on a road trip", "Stargaze somewhere dark", "Take a dance class", "Visit the mountains", "Try street food in a new city", "Write each other real letters", "See the sea together", "Plant something and grow it", "Build a playlist of 50 songs", "Go to a concert"];
  const JAR_IDEAS = ["I love the way you laugh at your own jokes", "You make ordinary days feel special", "My favourite place is next to you", "I'm proud of you, always", "Thank you for being patient with me", "You're my best decision"];
  const MILESTONES = [7, 30, 50, 100, 150, 200, 250, 300, 365, 500, 730, 1000, 1095, 1461, 1500, 1826, 2000, 2500, 3000, 3650];

  // ---------- the window ----------
  const TABS = [
    { k: "journey", name: "Journey", icon: "favorite" },
    { k: "jar", name: "Love jar", icon: "local_florist" },
    { k: "letters", name: "Letters", icon: "mail" },
    { k: "mood", name: "Mood", icon: "mood" },
    { k: "bucket", name: "Bucket list", icon: "checklist" },
  ];
  const S = { tab: store.get("du-us-tab", "journey"), cat: "all", write: "" };
  function open(tab) {
    window.DU.kit.toggleTray(false);
    if (tab) S.tab = tab;
    if (!TABS.some((t) => t.k === S.tab)) S.tab = "journey";
    store.set("du-us-tab", S.tab);
    const w = W().get("us") || W().open({ id: "us", title: "Us", icon: "favorite", w: 420, h: 600, html: `<div class="us"><div class="us-tabs" role="tablist" aria-label="Us"></div><div class="us-pane"></div></div>` });
    if (!w.body.dataset.wired) { w.body.dataset.wired = "1"; wire(w.body); }
    if (!loaded) load();
    paint();
    return w;
  }

  function paint() {
    const w = W()?.get("us");
    if (!w) return;
    const b = w.body;
    const unread = { jar: jarFor().length, letters: live("letters").filter((l) => same(l.to, myName()) && !l.openedAt).length };
    q(".us-tabs", b).innerHTML = TABS.map((t) => `<button role="tab" data-ut="${t.k}" aria-selected="${t.k === S.tab}" class="${t.k === S.tab ? "on" : ""}">
      <span class="icon" aria-hidden="true">${t.icon}</span><span>${t.name}</span>${unread[t.k] ? `<i>${unread[t.k]}</i>` : ""}</button>`).join("");
    const pane = q(".us-pane", b);
    const keep = pane.dataset.tab === S.tab ? pane.querySelector("input:focus, textarea:focus") : null;
    if (keep) return; // don't wipe what they're typing when the partner's change arrives
    pane.dataset.tab = S.tab;
    pane.innerHTML = ({ journey, jar, letters, mood, bucket })[S.tab]();
    pane.classList.remove("in"); void pane.offsetWidth; pane.classList.add("in");
  }

  // ----- Our journey -----
  function journey() {
    const since = D.meta.since;
    if (!since) {
      return `<div class="us-hero"><span class="us-big">💞</span><h3>When did your story start?</h3><p>Pick the day you became “us”. Both of you will see the days together, the next anniversary and your milestones.</p>
        <form class="us-row" data-uf="since"><input class="field" type="date" name="d" max="${new Date().toISOString().slice(0, 10)}" required aria-label="The day you got together"><button class="btn primary">Save</button></form></div>`;
    }
    const start = new Date(`${since}T00:00:00`), now = new Date();
    const days = Math.floor((new Date(now.toDateString()) - start) / day);
    let y = now.getFullYear() - start.getFullYear(), m = now.getMonth() - start.getMonth(), d = now.getDate() - start.getDate();
    if (d < 0) { m -= 1; d += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
    if (m < 0) { y -= 1; m += 12; }
    let next = new Date(now.getFullYear(), start.getMonth(), start.getDate());
    if (next < new Date(now.toDateString())) next = new Date(now.getFullYear() + 1, start.getMonth(), start.getDate());
    const toAnni = Math.round((next - new Date(now.toDateString())) / day);
    const yearN = next.getFullYear() - start.getFullYear();
    let monthsary = new Date(now.getFullYear(), now.getMonth(), Math.min(start.getDate(), 28));
    if (monthsary < new Date(now.toDateString())) monthsary = new Date(now.getFullYear(), now.getMonth() + 1, Math.min(start.getDate(), 28));
    const toMonth = Math.round((monthsary - new Date(now.toDateString())) / day);
    const nextMs = MILESTONES.find((x) => x > days);
    const passed = MILESTONES.filter((x) => x <= days).slice(-4).reverse();
    const parts = [y && `${y} year${y > 1 ? "s" : ""}`, m && `${m} month${m > 1 ? "s" : ""}`, `${d} day${d === 1 ? "" : "s"}`].filter(Boolean).join(", ");
    const today = toAnni === 0 ? `<div class="us-party">🎉 Happy ${yearN}${["th", "st", "nd", "rd"][(yearN % 100 > 10 && yearN % 100 < 14) || yearN % 10 > 3 ? 0 : yearN % 10]} anniversary! 🎉</div>` : "";
    return `${today}<div class="us-days"><small>Together for</small><b data-count="${days}">${days.toLocaleString()}</b><span>days</span><p>${parts}</p><small class="us-since">since ${fmtDate(start)}</small></div>
      <div class="us-cards">
        <div class="us-card"><span class="icon" aria-hidden="true">cake</span><b>${toAnni === 0 ? "Today!" : `${toAnni} day${toAnni > 1 ? "s" : ""}`}</b><small>to your ${yearN}${yearN === 1 ? "st" : yearN === 2 ? "nd" : yearN === 3 ? "rd" : "th"} anniversary</small></div>
        <div class="us-card"><span class="icon" aria-hidden="true">calendar_month</span><b>${toMonth === 0 ? "Today!" : `${toMonth} day${toMonth > 1 ? "s" : ""}`}</b><small>to your monthsary</small></div>
        ${nextMs ? `<div class="us-card wide"><span class="icon" aria-hidden="true">flag</span><b>${nextMs - days} day${nextMs - days > 1 ? "s" : ""} to ${nextMs.toLocaleString()} days</b><small>${fmtDate(start.getTime() + nextMs * day)}</small><i class="us-bar"><i style="width:${Math.round((days / nextMs) * 100)}%"></i></i></div>` : ""}
      </div>
      ${passed.length ? `<h4 class="us-h">Milestones you've crossed</h4><div class="us-chips">${passed.map((x) => `<span>🏅 ${x.toLocaleString()} days</span>`).join("")}</div>` : ""}
      <button class="btn ghost us-edit" data-ua="since-edit"><span class="icon">edit_calendar</span>Change the date</button>`;
  }

  // ----- Love jar -----
  const jarFor = () => live("jar").filter((n) => same(n.to, myName()) && !n.openedAt);
  function jar() {
    const waiting = jarFor();
    const mine = live("jar").filter((n) => same(n.by, myName())).slice(0, 30);
    const opened = live("jar").filter((n) => same(n.to, myName()) && n.openedAt).slice(0, 20);
    const hearts = Array.from({ length: Math.min(14, waiting.length) }, (_, i) => `<i style="--i:${i}">${["💌", "💗", "💖", "💝", "🌸"][i % 5]}</i>`).join("");
    return `<div class="us-jar-wrap">
        <button class="us-jar${waiting.length ? " full" : ""}" data-ua="pull" aria-label="${waiting.length ? `Pull a note from the jar, ${waiting.length} waiting` : "The jar is empty"}">
          <span class="us-jar-lid"></span><span class="us-jar-glass">${hearts}</span></button>
        <p class="us-jar-note">${waiting.length ? `<b>${waiting.length}</b> note${waiting.length > 1 ? "s" : ""} from ${esc(partner())} waiting. Tap the jar!` : `No new notes from ${esc(partner())} yet.`}</p>
        ${S.reveal ? `<div class="us-reveal"><div class="us-paper"><p>${esc(S.reveal.text)}</p><small>— ${esc(S.reveal.by)}, ${fmtDate(S.reveal.at)}</small></div></div>` : ""}
      </div>
      <form class="us-write" data-uf="jar"><textarea class="field" name="t" rows="2" maxlength="500" placeholder="Something sweet for ${esc(partner())}…" aria-label="A note for the jar" required></textarea>
        <div class="us-row"><button type="button" class="btn ghost" data-ua="jar-idea"><span class="icon">lightbulb</span>Idea</button><button class="btn primary"><span class="icon">add</span>Drop in the jar</button></div></form>
      ${opened.length ? `<h4 class="us-h">Notes you've opened</h4><ul class="us-list">${opened.map((n) => `<li><p>${esc(n.text)}</p><small>${esc(n.by)} · ${fmtDate(n.at)}</small></li>`).join("")}</ul>` : ""}
      ${mine.length ? `<h4 class="us-h">Your notes for ${esc(partner())}</h4><ul class="us-list">${mine.map((n) => `<li data-uid="${esc(n.id)}"><p>${esc(n.text)}</p><small>${n.openedAt ? `<span class="icon">done_all</span>Read ${fmtDate(n.openedAt)}` : "Still in the jar"}</small>${n.openedAt ? "" : `<button class="icon-btn" data-ua="jar-del" aria-label="Take it out"><span class="icon">delete</span></button>`}</li>`).join("")}</ul>` : ""}`;
  }
  function pull() {
    const list = jarFor();
    if (!list.length) return toast(`The jar is empty. Ask ${partner()} to drop a note in 😉`);
    const n = list[Math.floor(Math.random() * list.length)];
    const jarEl = q(".us-jar");
    jarEl?.classList.add("shake");
    setTimeout(() => {
      jarEl?.classList.remove("shake");
      S.reveal = n;
      upsert("jar", { ...n, openedAt: Date.now() });
      if (typeof polling !== "undefined" && polling) send("us-ping", { k: "jar", text: `${myName()} just read your love note 💌` });
      burst(["💗", "💖", "✨"]);
    }, 650);
  }

  // ----- Open when… letters -----
  function letters() {
    const forMe = live("letters").filter((l) => same(l.to, myName()));
    const byMe = live("letters").filter((l) => same(l.by, myName()));
    if (S.write) {
      const p = LETTERS.find((x) => x[0] === S.write);
      return `<form class="us-letter-form" data-uf="letter"><div class="us-row"><button type="button" class="icon-btn" data-ua="letter-back" aria-label="Back"><span class="icon">arrow_back</span></button><b>New letter for ${esc(partner())}</b></div>
        <label class="us-lab">Envelope<input class="field" name="label" maxlength="60" value="${esc(p ? p[1] : "Open when ")}" required></label>
        <label class="us-lab">Your letter<textarea class="field" name="t" rows="8" maxlength="3000" placeholder="Dear ${esc(partner())}," required></textarea></label>
        <button class="btn primary"><span class="icon">mark_email_read</span>Seal it</button></form>`;
    }
    const env = (l, mineSide) => {
      const p = LETTERS.find((x) => l.label === x[1]);
      return `<li class="us-env${l.openedAt ? " open" : ""}" data-uid="${esc(l.id)}"><button data-ua="${mineSide ? "letter-view" : "letter-open"}" aria-label="${esc(l.label)}">
        <span class="us-seal">${l.openedAt ? "💌" : p?.[2] || "💞"}</span><span><b>${esc(l.label)}</b><small>${mineSide ? (l.openedAt ? `Opened ${fmtDate(l.openedAt)}` : "Sealed · not opened yet") : l.openedAt ? `From ${esc(l.by)} · opened` : `From ${esc(l.by)} · sealed`}</small></span></button>
        ${mineSide && !l.openedAt ? `<button class="icon-btn" data-ua="letter-del" aria-label="Delete letter"><span class="icon">delete</span></button>` : ""}</li>`;
    };
    return `<div class="us-read" hidden></div>
      <h4 class="us-h">For you</h4>${forMe.length ? `<ul class="us-envs">${forMe.map((l) => env(l, false)).join("")}</ul>` : `<p class="us-empty">No letters from ${esc(partner())} yet.</p>`}
      <h4 class="us-h">Write one for ${esc(partner())}</h4><div class="us-chips pick">${LETTERS.map(([k, t, e]) => `<button data-ua="letter-new" data-lk="${k}">${e} ${esc(t.replace("Open when ", "…").replace("Open on ", "…on "))}</button>`).join("")}<button data-ua="letter-new" data-lk="">✍️ Your own</button></div>
      ${byMe.length ? `<h4 class="us-h">You wrote</h4><ul class="us-envs">${byMe.map((l) => env(l, true)).join("")}</ul>` : ""}`;
  }
  function readLetter(l) {
    const box = q(".us-read");
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<div class="us-paper letter"><b>${esc(l.label)}</b><p>${esc(l.text)}</p><small>— with love, ${esc(l.by)} · ${fmtDate(l.at)}</small><button class="btn ghost" data-ua="read-close">Close</button></div>`;
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ----- Mood -----
  function mood() {
    const moods = live("moods");
    const card = (name) => {
      const m = moods.find((x) => same(x.who, name));
      const fresh = m && Date.now() - m.at < day;
      const b = m?.battery ?? 0;
      return `<div class="us-mood-card${same(name, myName()) ? " me" : ""}"><small>${same(name, myName()) ? "You" : esc(name)}</small>
        <span class="us-mood-e">${fresh ? m.e : "❔"}</span><b>${fresh ? esc(m.l) : "Not shared today"}</b>
        ${fresh ? `<div class="us-batt" aria-label="Love battery ${b}%"><i style="width:${b}%;--h:${Math.round(b * 1.2)}"></i></div><small>Love battery ${b}%${m.note ? ` · “${esc(m.note)}”` : ""}</small><small class="muted">${new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>` : ""}</div>`;
    };
    const mine = moods.find((x) => same(x.who, myName()));
    return `<div class="us-moods">${card(myName())}${card(partner())}</div>
      <form class="us-mood-form" data-uf="mood"><h4 class="us-h">How are you feeling?</h4>
        <div class="us-emojis" role="radiogroup" aria-label="Mood">${MOODS.map(([e, l], i) => `<label title="${l}"><input type="radio" name="m" value="${i}" ${mine && mine.e === e ? "checked" : ""}><span>${e}</span><small>${l}</small></label>`).join("")}</div>
        <label class="us-lab">Love battery <output>${mine?.battery ?? 80}%</output><input type="range" name="b" min="0" max="100" step="5" value="${mine?.battery ?? 80}"></label>
        <input class="field" name="n" maxlength="80" placeholder="A few words (optional)" value="">
        <button class="btn primary"><span class="icon">send</span>Share with ${esc(partner())}</button></form>`;
  }

  // ----- Bucket list -----
  function bucket() {
    const all = live("bucket");
    const shown = all.filter((x) => S.cat === "all" || x.cat === S.cat);
    const done = all.filter((x) => x.done).length;
    const todo = shown.filter((x) => !x.done), finished = shown.filter((x) => x.done);
    const row = (x) => {
      const c = BUCKET.find((b) => b[0] === x.cat) || BUCKET[4];
      return `<li class="us-bk${x.done ? " done" : ""}" data-uid="${esc(x.id)}"><button class="us-check" data-ua="bk-done" aria-pressed="${Boolean(x.done)}" aria-label="${x.done ? "Mark not done" : "Mark done"}"><span class="icon">${x.done ? "check" : ""}</span></button>
        <span><b>${esc(x.text)}</b><small><span class="icon">${c[2]}</span>${c[1]}${x.done ? ` · done ${fmtDate(x.doneAt)}` : ` · added by ${esc(x.by)}`}</small></span>
        <button class="icon-btn" data-ua="bk-del" aria-label="Delete"><span class="icon">close</span></button></li>`;
    };
    return `<div class="us-bk-top"><div class="us-ring" style="--p:${all.length ? Math.round((done / all.length) * 100) : 0}"><b>${done}/${all.length}</b></div><div><b>Our bucket list</b><small>${all.length ? `${all.length - done} dreams to go` : "Dream big, together"}</small></div></div>
      <form class="us-row us-bk-form" data-uf="bucket"><input class="field" name="t" maxlength="120" placeholder="Something to do together…" aria-label="New bucket list item" required>
        <select class="field" name="c" aria-label="Category">${BUCKET.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select><button class="btn primary" aria-label="Add"><span class="icon">add</span></button></form>
      <div class="us-chips pick"><button data-ua="bk-cat" data-c="all" class="${S.cat === "all" ? "on" : ""}">All</button>${BUCKET.map(([k, n, i]) => `<button data-ua="bk-cat" data-c="${k}" class="${S.cat === k ? "on" : ""}"><span class="icon">${i}</span>${n}</button>`).join("")}</div>
      ${shown.length ? `<ul class="us-bks">${todo.map(row).join("")}${finished.map(row).join("")}</ul>` : `<div class="us-empty"><p>Nothing here yet.</p><button class="btn ghost" data-ua="bk-idea"><span class="icon">lightbulb</span>Give us an idea</button></div>`}`;
  }

  // ---------- clicks and forms ----------
  function wire(b) {
    b.addEventListener("input", (e) => { if (e.target.name === "b") e.target.previousElementSibling.textContent = `${e.target.value}%`; });
    b.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target, kind = f.dataset.uf, v = (n) => String(f.elements[n]?.value || "").trim();
      if (kind === "since" && v("d")) { D.meta = { ...D.meta, since: v("d"), u: Date.now() }; save("meta"); burst(["💞", "💗", "✨"]); }
      if (kind === "jar" && v("t")) { upsert("jar", { id: id(), text: v("t").slice(0, 500), by: myName(), to: partner(), at: Date.now() }); toast(`Dropped in the jar for ${partner()} 💌`); ping("jar", `${myName()} dropped a new note in your love jar 💌`); }
      if (kind === "letter" && v("t")) { upsert("letters", { id: id(), label: v("label").slice(0, 60), text: v("t").slice(0, 3000), by: myName(), to: partner(), at: Date.now() }); S.write = ""; toast("Letter sealed 💌"); ping("letters", `${myName()} sealed a letter for you: “${v("label")}”`); }
      if (kind === "mood") {
        const m = MOODS[Number(f.elements.m.value)];
        if (!m) return toast("Pick a mood first");
        const old = live("moods").find((x) => same(x.who, myName()));
        upsert("moods", { id: old?.id || `mood-${myName().toLowerCase()}`, who: myName(), e: m[0], l: m[1], battery: Number(v("b")), note: v("n").slice(0, 80), at: Date.now() });
        ping("mood", `${myName()} is feeling ${m[0]} ${m[1]}`);
        toast(`Shared with ${partner()}`);
      }
      if (kind === "bucket" && v("t")) { upsert("bucket", { id: id(), text: v("t").slice(0, 120), cat: v("c"), by: myName(), at: Date.now() }); }
    });
    b.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-ut]");
      if (tab) { S.tab = tab.dataset.ut; S.write = ""; S.reveal = null; store.set("du-us-tab", S.tab); return paint(); }
      const a = e.target.closest("[data-ua]")?.dataset.ua;
      if (!a) return;
      const uid = e.target.closest("[data-uid]")?.dataset.uid;
      const find = (k) => live(k).find((x) => x.id === uid);
      if (a === "since-edit") { D.meta = { ...D.meta, since: "", u: Date.now() }; save("meta"); }
      if (a === "pull") pull();
      if (a === "jar-idea") { const t = q("[data-uf=jar] textarea", b); t.value = JAR_IDEAS[Math.floor(Math.random() * JAR_IDEAS.length)]; t.focus(); }
      if (a === "jar-del" && find("jar")) remove("jar", find("jar"));
      if (a === "letter-new") { S.write = e.target.closest("[data-lk]").dataset.lk || "custom"; paint(); q("[data-uf=letter] textarea", b)?.focus(); }
      if (a === "letter-back") { S.write = ""; paint(); }
      if (a === "letter-view" && find("letters")) readLetter(find("letters"));
      if (a === "letter-open") {
        const l = find("letters");
        if (!l) return;
        if (!l.openedAt) { upsert("letters", { ...l, openedAt: Date.now() }); ping("letters", `${myName()} opened your letter “${l.label}” 💌`); burst(["💌", "💗", "✨"]); }
        setTimeout(() => readLetter(l), 30);
      }
      if (a === "letter-del" && find("letters")) remove("letters", find("letters"));
      if (a === "read-close") { const r = q(".us-read", b); r.hidden = true; }
      if (a === "bk-cat") { S.cat = e.target.closest("[data-c]").dataset.c; paint(); }
      if (a === "bk-done") { const x = find("bucket"); if (x) { upsert("bucket", { ...x, done: !x.done, doneAt: x.done ? 0 : Date.now() }); if (!x.done) { burst(["🎉", "✨", "💞"]); ping("bucket", `${myName()} ticked off “${x.text}” 🎉`); } } }
      if (a === "bk-del" && find("bucket")) remove("bucket", find("bucket"));
      if (a === "bk-idea") { const have = live("bucket").map((x) => x.text); const idea = BUCKET_IDEAS.find((t) => !have.includes(t)) || BUCKET_IDEAS[0]; const i = q("[data-uf=bucket] input", b); i.value = idea; i.focus(); }
    });
  }
  function ping(k, text) { if (typeof polling !== "undefined" && polling) send("us-ping", { k, text }); }

  // ---------- floating hearts ----------
  function burst(set = ["💗"], n = 18) {
    const box = document.createElement("div");
    box.className = "us-burst";
    box.setAttribute("aria-hidden", "true");
    box.innerHTML = Array.from({ length: n }, () => `<i style="--x:${Math.round(Math.random() * 100)}vw;--d:${(1.6 + Math.random() * 1.4).toFixed(2)}s;--w:${Math.round(Math.random() * 60 - 30)}px;--s:${(0.8 + Math.random() * 0.9).toFixed(2)}">${set[Math.floor(Math.random() * set.length)]}</i>`).join("");
    document.body.append(box);
    setTimeout(() => box.remove(), 3400);
  }

  // ---------- hug & kiss ----------
  const FX = {
    hug: { e: "🫂", t: "sent you a tight hug", set: ["🤗", "💞", "🫶"] },
    kiss: { e: "💋", t: "sent you a kiss", set: ["💋", "😘", "💗"] },
    miss: { e: "🥺", t: "misses you so much", set: ["🥺", "💭", "💗"] },
    love: { e: "❤️", t: "loves you", set: ["❤️", "💖", "💘"] },
  };
  function showFx(k, from) {
    const f = FX[k];
    if (!f) return;
    document.querySelector(".us-fx")?.remove();
    const el = document.createElement("div");
    el.className = `us-fx us-fx-${k}`;
    el.setAttribute("role", "status");
    el.innerHTML = `<div><span>${f.e}</span><b>${esc(from)}</b><small>${f.t}</small></div>`;
    document.body.append(el);
    burst(f.set, 24);
    try { navigator.vibrate?.(k === "hug" ? [80, 60, 200] : [40, 40, 40]); } catch { /* none */ }
    requestAnimationFrame(() => el.classList.add("in"));
    el.onclick = () => el.remove();
    setTimeout(() => { el.classList.remove("in"); setTimeout(() => el.remove(), 400); }, 3200);
  }
  function sendFx(k) {
    window.DU.kit.toggleTray(false);
    if (!(typeof polling !== "undefined" && polling) || !peers.size) return toast(`${partner()} isn't in the call right now`);
    send("us-fx", { k });
    burst(FX[k].set, 10);
    toast(`${FX[k].e} Sent to ${partner()}`);
  }

  // ---------- tray subtitles ----------
  function paintTray() {
    const set = (id, t) => { const el = q(`#${id}`); if (el) el.textContent = t; };
    const n = jarFor().length, l = live("letters").filter((x) => same(x.to, myName()) && !x.openedAt).length;
    set("us-sub-jar", n ? `${n} new note${n > 1 ? "s" : ""} for you 💌` : "Sweet notes for each other");
    set("us-sub-letters", l ? `${l} sealed letter${l > 1 ? "s" : ""} for you` : "Sealed for the right moment");
    const bk = live("bucket");
    set("us-sub-bucket", bk.length ? `${bk.filter((x) => x.done).length} of ${bk.length} done` : "Dreams to do together");
    if (D.meta.since) set("us-sub-journey", `${Math.floor((new Date(new Date().toDateString()) - new Date(`${D.meta.since}T00:00:00`)) / day).toLocaleString()} days together`);
    const badge = n + l;
    const main = q('#tg-tray [data-tg="view-us"] small');
    if (main) main.textContent = badge ? `${badge} new for you 💌` : "Love jar, letters, mood, dreams";
  }
  paintTray();
  setTimeout(load, 1200);

  // ---------- hooks ----------
  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const k = button.dataset.tg || "";
      const m = /^us-(journey|jar|letters|mood|bucket)$/.exec(k);
      if (m) return open(m[1]);
      const fx = /^us-fx-(hug|kiss|miss|love)$/.exec(k);
      if (fx) return sendFx(fx[1]);
      prev.click?.(button);
    },
    onCouple(message, peer) {
      const d = message.data || {};
      if (message.type === "us") { if (KEYS.includes(d.k)) { merge(d.k, d.v); paint(); paintTray(); } return; }
      if (message.type === "us-fx") return showFx(String(d.k), peer?.name || partner());
      if (message.type === "us-ping") { if (d.text) toast(String(d.text).slice(0, 140)); load(); return; }
      prev.msg?.(message, peer);
    },
  });

  // Hey Lord can open these too
  window.DU.saathiTools?.push({
    name: "us_corner",
    description: "Their couple corner. Open a page (journey = days together and anniversary, jar = love jar, letters = open-when letters, mood, bucket = bucket list), add a bucket list item, drop a love note in the jar for the partner, or send a hug/kiss/miss/love to the partner's screen. Also tells how many days they've been together.",
    parameters: { type: "OBJECT", properties: {
      action: { type: "STRING", enum: ["open", "bucket_add", "jar_add", "send", "days"] },
      page: { type: "STRING", enum: ["journey", "jar", "letters", "mood", "bucket"] },
      text: { type: "STRING", description: "For bucket_add / jar_add" },
      kind: { type: "STRING", enum: ["hug", "kiss", "miss", "love"], description: "For send" },
    }, required: ["action"] },
    run: (a) => {
      if (a.action === "open") { open(a.page || "journey"); return { opened: a.page || "journey" }; }
      if (a.action === "days") return D.meta.since ? { since: D.meta.since, days: Math.floor((Date.now() - new Date(`${D.meta.since}T00:00:00`)) / day) } : { error: "They haven't set the day they got together yet (Us → Journey)" };
      if (a.action === "send") { if (!FX[a.kind]) return { error: "hug, kiss, miss or love?" }; sendFx(a.kind); return { sent: a.kind }; }
      const t = String(a.text || "").trim();
      if (!t) return { error: "What should it say?" };
      if (a.action === "bucket_add") { upsert("bucket", { id: id(), text: t.slice(0, 120), cat: "life", by: myName(), at: Date.now() }); return { added: t }; }
      if (a.action === "jar_add") { upsert("jar", { id: id(), text: t.slice(0, 500), by: myName(), to: partner(), at: Date.now() }); ping("jar", `${myName()} dropped a new note in your love jar 💌`); return { dropped_for: partner() }; }
      return { error: "Unknown action" };
    },
  });

  window.DU.us = { open, burst };
})();
