// DU Meet · Notes: three notebooks, Uday's, Diya's and Common. Both phones see the same notes
// (saved on the server, synced live in a call). Write by typing, by the mic button, or by
// asking Hey Lord ("Hey Lord, mere notes mein likh do…", "common notes padh ke sunao").

(() => {
  "use strict";
  const { q, esc, store } = window.DU.kit;
  const W = () => window.DU.win;
  const V = () => window.DU.voice;
  const BOOKS = [
    { k: "uday", name: "Uday", icon: "person", tone: "#0a84ff" },
    { k: "diya", name: "Diya", icon: "person", tone: "#ff375f" },
    { k: "common", name: "Common", icon: "group", tone: "#30d158" },
  ];
  const books = {};
  for (const b of BOOKS) books[b.k] = store.get(`du-notes-${b.k}`, []);
  const S = { book: store.get("du-notes-book", ""), q: "", edit: "" };
  const mineKey = (name = me.name) => BOOKS.find((b) => b.name.toLowerCase() === String(name || "").toLowerCase())?.k || "common";
  const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const when = (t) => {
    const d = new Date(t), now = new Date();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
    return `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
  };
  const sorted = (k) => [...books[k]].sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || b.at - a.at);

  // ---------- load and save ----------
  let loaded = false;
  async function load() {
    try {
      const docs = await window.DU.kit.getDocs("settings");
      for (const b of BOOKS) {
        const d = docs.find((x) => x.id === `notes-${b.k}`);
        if (Array.isArray(d?.data?.items)) { books[b.k] = d.data.items; store.set(`du-notes-${b.k}`, books[b.k]); }
      }
      loaded = true;
      paint();
    } catch { /* offline: keep what this phone had */ }
  }
  function save(k) {
    books[k] = books[k].slice(0, 300);
    store.set(`du-notes-${k}`, books[k]);
    if (typeof polling !== "undefined" && polling) send("notes", { k, items: books[k] });
    window.DU.kit.putDoc("settings", { items: books[k] }, `notes-${k}`).catch(() => toast("Couldn't save the note. Check the internet."));
    paint();
    paintTray();
  }
  function add(k, text, by = me.name) {
    const t = String(text || "").trim().slice(0, 4000);
    if (!t) return null;
    const note = { id: id(), text: t, by, at: Date.now() };
    books[k].unshift(note);
    save(k);
    return note;
  }

  // ---------- the window ----------
  function open(book) {
    window.DU.kit.toggleTray(false);
    if (book) S.book = book;
    if (!BOOKS.some((b) => b.k === S.book)) S.book = mineKey();
    const w = W().get("notes") || W().open({
      id: "notes", title: "Notes", icon: "sticky_note_2", w: 400, h: 560,
      html: `<div class="nt">
        <div class="nt-tabs" role="tablist" aria-label="Notebooks"></div>
        <form class="nt-new"><textarea class="field" name="t" rows="2" maxlength="4000" placeholder="Write a note…" aria-label="New note"></textarea>
          <div class="nt-new-acts"><small class="nt-hint">Or say “Hey Lord, add to my notes …”</small><button class="btn primary nt-add" type="submit"><span class="icon">add</span>Add</button></div></form>
        <div class="nt-search"><span class="icon" aria-hidden="true">search</span><input type="search" placeholder="Search notes" aria-label="Search notes" autocomplete="off"></div>
        <ul class="nt-list" aria-live="polite"></ul></div>`,
    });
    const body = w.body;
    if (!body.dataset.wired) {
      body.dataset.wired = "1";
      const form = q(".nt-new", body), ta = q("textarea", form);
      const mic = V()?.micButton?.(ta, { onDone: () => ta.focus() });
      if (mic) q(".nt-new-acts", form).insertBefore(mic, q(".nt-add", form));
      const grow = (el) => { el.style.height = "auto"; el.style.height = `${Math.min(220, el.scrollHeight + 2)}px`; };
      form.addEventListener("submit", (e) => { e.preventDefault(); if (add(S.book, ta.value)) { ta.value = ""; grow(ta); } });
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });
      ta.addEventListener("input", () => grow(ta));
      q(".nt-search input", body).addEventListener("input", (e) => { S.q = e.target.value; paint(); });
      body.addEventListener("click", (e) => {
        const tab = e.target.closest("[data-nb]");
        if (tab) { S.book = tab.dataset.nb; S.edit = ""; store.set("du-notes-book", S.book); return paint(); }
        const b = e.target.closest("[data-na]");
        if (!b) return;
        const nid = b.closest("[data-nid]")?.dataset.nid;
        const list = books[S.book], note = list.find((n) => n.id === nid);
        if (!note) return;
        const act = b.dataset.na;
        if (act === "pin") { note.pin = !note.pin; save(S.book); }
        if (act === "edit") { S.edit = nid; paint(); const e2 = q(`[data-nid="${nid}"] textarea`, body); e2?.focus(); if (e2) grow(e2); }
        if (act === "cancel") { S.edit = ""; paint(); }
        if (act === "save") {
          const v = q(`[data-nid="${nid}"] textarea`, body)?.value.trim();
          if (v) { note.text = v.slice(0, 4000); note.edited = Date.now(); note.editedBy = me.name; }
          S.edit = ""; save(S.book);
        }
        if (act === "copy") navigator.clipboard?.writeText(note.text).then(() => toast("Copied"), () => toast("Couldn't copy"));
        if (act === "del") {
          books[S.book] = list.filter((n) => n.id !== nid);
          save(S.book);
          toast("Note deleted");
        }
      });
    }
    if (!loaded) load();
    paint();
    return w;
  }

  function paint() {
    const w = W()?.get("notes");
    if (!w) return;
    const body = w.body;
    const book = BOOKS.find((b) => b.k === S.book) || BOOKS[2];
    q(".nt-tabs", body).innerHTML = BOOKS.map((b) => `<button role="tab" data-nb="${b.k}" aria-selected="${b.k === book.k}" class="${b.k === book.k ? "on" : ""}" style="--nb:${b.tone}">
      <span class="icon" aria-hidden="true">${b.icon}</span>${b.k === "common" ? "Common" : `${b.name}'s`}<i>${books[b.k].length || ""}</i></button>`).join("");
    q(".nt-new textarea", body).placeholder = book.k === "common" ? "Write a note for both of you…" : `Write in ${book.name}'s notes…`;
    q(".nt-hint", body).textContent = book.k === "common" ? "Or say “Hey Lord, add to common notes …”" : `Or say “Hey Lord, add to ${book.name}'s notes …”`;
    const term = S.q.trim().toLowerCase();
    const items = sorted(book.k).filter((n) => !term || n.text.toLowerCase().includes(term));
    const mark = (t) => (term ? esc(t).replace(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"), "<mark>$1</mark>") : esc(t));
    q(".nt-search", body).hidden = books[book.k].length < 4 && !term;
    q(".nt-list", body).innerHTML = items.length ? items.map((n) => `<li class="nt-note${n.pin ? " pin" : ""}" data-nid="${esc(n.id)}" style="--nb:${book.tone}">
        ${S.edit === n.id
          ? `<textarea class="field" maxlength="4000" aria-label="Edit note">${esc(n.text)}</textarea><div class="nt-acts"><button class="btn ghost small-btn" data-na="cancel">Cancel</button><button class="btn primary small-btn" data-na="save">Save</button></div>`
          : `<p>${mark(n.text)}</p>
        <div class="nt-meta"><small>${n.pin ? `<span class="icon" aria-hidden="true">push_pin</span>` : ""}${esc(n.by || "")} · ${when(n.at)}${n.edited ? " · edited" : ""}</small>
          <span class="nt-acts">
            <button class="icon-btn" data-na="pin" aria-label="${n.pin ? "Unpin" : "Pin to top"}" title="${n.pin ? "Unpin" : "Pin"}"><span class="icon">${n.pin ? "keep_off" : "keep"}</span></button>
            <button class="icon-btn" data-na="edit" aria-label="Edit" title="Edit"><span class="icon">edit</span></button>
            <button class="icon-btn" data-na="copy" aria-label="Copy" title="Copy"><span class="icon">content_copy</span></button>
            <button class="icon-btn" data-na="del" aria-label="Delete" title="Delete"><span class="icon">delete</span></button></span></div>`}
      </li>`).join("")
      : `<li class="nt-empty"><span class="icon" aria-hidden="true">${term ? "search_off" : "edit_note"}</span><p>${term ? "No note matches that." : book.k === "common" ? "Nothing here yet. Plans, ideas, things to remember together." : `${book.name}'s notebook is empty.`}</p></li>`;
  }
  function paintTray() {
    for (const b of BOOKS) { const el = q(`#tray-notes-${b.k}`); if (el) el.textContent = books[b.k].length ? `${books[b.k].length} note${books[b.k].length > 1 ? "s" : ""}` : "Empty"; }
  }
  paintTray();
  load();

  // ---------- Hey Lord's tool ----------
  function whichBook(a) {
    const said = String(a.notebook || "").toLowerCase();
    if (/common|shared|both|dono|hum dono|our|hamare|sab/.test(said)) return "common";
    const named = BOOKS.find((b) => b.k !== "common" && said.includes(b.k));
    if (named) return named.k;
    // "my notes", or nothing said: whoever is asking
    const who = String(a.person || "").trim() || (typeof whoSpokeLast === "function" && whoSpokeLast(10000)) || me.name;
    return mineKey(who);
  }
  const find = (k, what) => {
    const s = String(what || "").trim();
    if (/^\d+$/.test(s)) return sorted(k)[Number(s) - 1];
    if (/^(last|latest|newest|aakhri|last wala)$/i.test(s)) return sorted(k).filter((n) => !n.pin)[0] || sorted(k)[0];
    return V()?.match ? V().match(books[k], s) : books[k].find((n) => n.text.toLowerCase().includes(s.toLowerCase()));
  };
  window.DU.saathiTools?.push({
    name: "notes",
    description: "Their three notebooks: Uday's notes, Diya's notes and Common notes (shared). Read a notebook, add a note (write it neatly, as they meant it), edit one, append to one, pin one, or remove one, and open the Notes window. 'my notes' = the notes of whoever is speaking.",
    parameters: { type: "OBJECT", properties: {
      action: { type: "STRING", enum: ["read", "add", "append", "edit", "remove", "pin", "open"] },
      notebook: { type: "STRING", description: "uday, diya, common, or 'mine'. Empty = the speaker's own." },
      person: { type: "STRING", description: "Who is asking (their name), if known" },
      text: { type: "STRING", description: "For add/append/edit: the note text" },
      which: { type: "STRING", description: "For edit/append/remove/pin: words from the note, its number from read (1 = top), or 'last'" },
    }, required: ["action"] },
    run: (a) => {
      const k = whichBook(a);
      const label = k === "common" ? "Common notes" : `${BOOKS.find((b) => b.k === k).name}'s notes`;
      if (a.action === "open") { open(k); return { opened: label }; }
      if (a.action === "read") return { notebook: label, notes: sorted(k).slice(0, 40).map((n, i) => ({ n: i + 1, text: n.text, by: n.by, when: when(n.at), pinned: Boolean(n.pin) })) };
      if (a.action === "add") {
        const who = String(a.person || "").trim() || (typeof whoSpokeLast === "function" && whoSpokeLast(10000)) || me.name;
        const note = add(k, a.text, who);
        if (!note) return { error: "What should the note say?" };
        if (W()?.get("notes")) { S.book = k; paint(); } else open(k);
        return { added_to: label, note: note.text };
      }
      const note = find(k, a.which);
      if (!note) return { error: `No such note in ${label}`, notes: sorted(k).slice(0, 15).map((n, i) => `${i + 1}. ${n.text.slice(0, 80)}`) };
      if (a.action === "remove") { books[k] = books[k].filter((n) => n !== note); save(k); return { removed: note.text.slice(0, 120) }; }
      if (a.action === "pin") { note.pin = true; save(k); return { pinned: note.text.slice(0, 120) }; }
      const t = String(a.text || "").trim();
      if (!t) return { error: "What should it say?" };
      note.text = (a.action === "append" ? `${note.text}\n${t}` : t).slice(0, 4000);
      note.edited = Date.now(); note.editedBy = me.name;
      save(k);
      return { [a.action === "append" ? "appended" : "edited"]: note.text.slice(0, 200), notebook: label };
    },
  });

  // ---------- hooks ----------
  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const m = /^notes(?:-(uday|diya|common))?$/.exec(button.dataset.tg || "");
      if (m) open(m[1]); else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "notes") return prev.msg?.(message, peer);
      const d = message.data || {};
      if (!books[d.k] || !Array.isArray(d.items)) return;
      books[d.k] = d.items.slice(0, 300).map((n) => ({ ...n, text: String(n.text || "").slice(0, 4000) }));
      store.set(`du-notes-${d.k}`, books[d.k]);
      paint(); paintTray();
    },
  });
  window.DU.notes = { open, books };
})();
