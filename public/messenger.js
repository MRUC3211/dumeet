// DU Meet · Messenger: a persistent conversation you can open any time, even
// outside a call. Messages are stored on the server (the "messages" collection),
// so history is kept and a message sent while the other is away is waiting for
// them next time. In-call chat is persisted here too, so it's one thread.
// Uses globals from app.js (prefs, toast, window.authUrl) and window.DU.

(() => {
  "use strict";
  const q = (s, r = document) => r.querySelector(s);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PEOPLE = ["Uday", "Diya"];
  const partner = () => PEOPLE.find((p) => p.toLowerCase() !== String(prefs.name || "").toLowerCase()) || "them";
  const authUrl = (u) => (window.authUrl ? window.authUrl(u) : u);

  const SEEN_KEY = "du-msg-seen";
  let seen = 0; try { seen = +localStorage.getItem(SEEN_KEY) || 0; } catch { /* private */ }
  const setSeen = (t) => { seen = Math.max(seen, t || 0); try { localStorage.setItem(SEEN_KEY, seen); } catch { /* private */ } };

  let msgs = [], el = null, pollT = 0, replying = null;
  const unfurls = new Map(); // url -> preview data (cache)

  async function fetchMsgs() {
    try {
      const { docs } = await (await fetch("/api/data?c=messages")).json();
      msgs = (docs || []).map((d) => ({ id: d.id, ...d.data })).filter((m) => m && m.at).sort((a, b) => a.at - b.at);
      return true;
    } catch { return false; }
  }
  async function store(doc) {
    const r = await fetch("/api/data", { method: "POST", body: JSON.stringify({ c: "messages", data: doc }) });
    return (await r.json().catch(() => ({}))).doc;
  }

  // called by the in-call chat and by this sheet to save + show a message
  async function persist(from, text, media, reply) {
    if (!text && !(media && media.length)) return;
    const doc = { from: from || prefs.name || "", text: text || "", media: media || [], at: Date.now() };
    if (reply && reply.text !== undefined) doc.reply = { from: reply.from || "", text: String(reply.text || "").slice(0, 80) };
    try { const s = await store(doc); if (s) { msgs.push({ id: s.id, ...doc }); if (el) render(true); } } catch { /* offline */ }
  }

  async function open() {
    build();
    await fetchMsgs();
    render(true);
    if (msgs.length) setSeen(msgs[msgs.length - 1].at);
    paintBadge();
    clearInterval(pollT);
    pollT = setInterval(async () => { if (!el) return; const n = msgs.length, last = msgs[n - 1]?.at; await fetchMsgs(); if (msgs.length !== n || msgs[msgs.length - 1]?.at !== last) render(true); }, 5000);
  }
  function close() { clearInterval(pollT); el?.remove(); el = null; paintBadge(); }

  function build() {
    if (el) return;
    el = document.createElement("div");
    el.className = "msgr";
    el.innerHTML = `
      <div class="msgr-sheet">
        <header class="msgr-head">
          <button class="icon-btn" data-m="close" aria-label="Back"><span class="icon">arrow_back</span></button>
          <span class="msgr-av" id="msgr-av"></span><b id="msgr-name"></b>
          <button class="icon-btn msgr-gallery-btn" data-m="gallery" aria-label="Shared photos"><span class="icon">photo_library</span></button>
        </header>
        <div class="msgr-list" id="msgr-list"></div>
        <div class="msgr-replybar" id="msgr-replybar" hidden><div class="msgr-rb-info"><b id="msgr-rb-name"></b><span id="msgr-rb-text"></span></div><button type="button" class="icon-btn" data-m="cancel-reply" aria-label="Cancel"><span class="icon">close</span></button></div>
        <div class="msgr-stickers" id="msgr-stickers" hidden></div>
        <form class="msgr-form" id="msgr-form">
          <button type="button" class="icon-btn" data-m="stickers" title="Stickers" aria-label="Stickers"><span class="icon">mood</span></button>
          <label class="icon-btn" title="Photo" aria-label="Send a photo"><span class="icon">add_photo_alternate</span><input type="file" accept="image/*" id="msgr-file" hidden></label>
          <input id="msgr-input" placeholder="Message ${esc(partner())}…" maxlength="2000" autocomplete="off">
          <button class="icon-btn send" aria-label="Send"><span class="icon">arrow_upward</span></button>
        </form>
      </div>
      <div class="msgr-reactpop" id="msgr-reactpop" hidden></div>`;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add("open"));
    q("#msgr-name").textContent = partner();
    const av = q("#msgr-av"); const face = window.DU?.faceFor?.(partner());
    if (face) { av.style.backgroundImage = `url("${authUrl(face)}")`; av.classList.add("photo"); } else av.textContent = (partner()[0] || "?").toUpperCase();
    el.addEventListener("click", (e) => {
      if (!e.target.closest("#msgr-reactpop, [data-react]")) q("#msgr-reactpop").hidden = true;
      if (e.target.closest("[data-m=close]")) return close();
      if (e.target.closest("[data-m=gallery]")) return openGallery();
      if (e.target.closest("[data-m=cancel-reply]")) return cancelReply();
      if (e.target.closest("[data-m=stickers]")) return toggleStickers();
      const rb = e.target.closest("[data-reply]"); if (rb) return startReply(+rb.dataset.reply);
      const rc = e.target.closest("[data-react]"); if (rc) return openReactPop(+rc.dataset.react, rc);
      const rx = e.target.closest("[data-rx]"); if (rx) return toggleReact(+rx.dataset.rx, rx.dataset.e);
      const st = e.target.closest("[data-sticker]"); if (st) { sendSticker(st.dataset.sticker); toggleStickers(false); return; }
    });
    q("#msgr-form").addEventListener("submit", (e) => { e.preventDefault(); const i = q("#msgr-input"); const t = i.value.trim(); if (!t) return; i.value = ""; const r = replying; cancelReply(); persist(prefs.name, t, [], r); });
    q("#msgr-file").addEventListener("change", async (e) => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      if (f.size > 25 * 1024 * 1024) return toast("Photo 25MB se chhoti honi chahiye");
      toast("Sending…");
      try { const up = await (await fetch("/api/media", { method: "POST", headers: { "Content-Type": f.type || "image/jpeg" }, body: f })).json(); persist(prefs.name, "", [{ url: up.url, type: up.type, name: f.name }]); } catch { toast("Photo send nahi hui"); }
    });
  }

  function dayLabel(d) {
    const t = new Date(), y = new Date(Date.now() - 864e5);
    if (d.toDateString() === t.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === t.getFullYear() ? undefined : "numeric" });
  }
  const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

  function render(scroll) {
    const list = q("#msgr-list"); if (!list) return;
    if (!msgs.length) { list.innerHTML = `<div class="msgr-empty"><span class="icon">chat</span><p>Koi message nahi abhi — pehla bhejo 💬</p></div>`; return; }
    let html = "", lastDay = "";
    msgs.forEach((m, i) => {
      const d = new Date(m.at), day = d.toDateString();
      if (day !== lastDay) { lastDay = day; html += `<div class="msgr-day">${dayLabel(d)}</div>`; }
      const mine = String(m.from || "").toLowerCase() === String(prefs.name || "").toLowerCase();
      const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const acts = `<span class="msgr-acts"><button class="msgr-act" data-react="${i}" aria-label="React"><span class="icon">add_reaction</span></button><button class="msgr-act" data-reply="${i}" aria-label="Reply"><span class="icon">reply</span></button></span>`;
      const reacts = (m.reactions && Object.keys(m.reactions).some((e) => m.reactions[e].length))
        ? `<span class="msgr-reacts">${Object.entries(m.reactions).filter(([, a]) => a.length).map(([e, a]) => `<button class="msgr-rchip${a.includes(prefs.name) ? " mine" : ""}" data-rx="${i}" data-e="${esc(e)}">${esc(e)}${a.length > 1 ? " " + a.length : ""}</button>`).join("")}</span>` : "";
      if (m.sticker) { html += `<div class="msgr-b sticker ${mine ? "me" : "them"}">${acts}<span class="msgr-sticker">${esc(m.sticker)}</span><span class="msgr-time">${time}</span>${reacts}</div>`; return; }
      const firstUrl = (m.text || "").match(/https?:\/\/[^\s<]+/)?.[0];
      html += `<div class="msgr-b ${mine ? "me" : "them"}"${firstUrl ? ` data-url="${esc(firstUrl)}"` : ""}>`;
      html += acts;
      if (m.reply) html += `<span class="msgr-q"><b>${esc(m.reply.from || "")}</b>${esc(m.reply.text || "")}</span>`;
      if (Array.isArray(m.media)) html += m.media.filter((x) => x && typeof x.url === "string" && x.url.startsWith("/api/media/")).map((x) => `<img class="msgr-img" loading="lazy" src="${esc(authUrl(x.url))}" alt="">`).join("");
      if (m.text) html += `<span class="msgr-t">${linkify(m.text)}</span>`;
      html += `<span class="msgr-time">${time}</span>${reacts}</div>`;
    });
    list.innerHTML = html;
    setSeen(msgs[msgs.length - 1].at);
    if (scroll) list.scrollTop = list.scrollHeight;
    loadPreviews();
  }

  // ---------- link previews ----------
  async function loadPreviews() {
    for (const b of el.querySelectorAll(".msgr-b[data-url]")) {
      if (b.dataset.done) continue;
      b.dataset.done = "1";
      const url = b.dataset.url;
      try {
        let p = unfurls.get(url);
        if (!p) { p = await (await fetch(`/api/unfurl?url=${encodeURIComponent(url)}`)).json(); unfurls.set(url, p); }
        if (!p || !p.title) continue;
        const card = document.createElement("a");
        card.className = "msgr-link"; card.href = url; card.target = "_blank"; card.rel = "noopener noreferrer";
        card.innerHTML = (p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : "") + `<span class="msgr-link-x"><b>${esc(p.title)}</b>${p.desc ? `<small>${esc(p.desc)}</small>` : ""}<i>${esc(p.site || "")}</i></span>`;
        b.querySelector(".msgr-t")?.before(card);
      } catch { /* ignore */ }
    }
  }

  // ---------- reply ----------
  function startReply(i) {
    const m = msgs[i]; if (!m) return;
    replying = { from: String(m.from || "").toLowerCase() === String(prefs.name || "").toLowerCase() ? "You" : (m.from || partner()), text: m.text || (m.media?.length ? "Photo" : "") };
    q("#msgr-rb-name").textContent = replying.from;
    q("#msgr-rb-text").textContent = replying.text;
    q("#msgr-replybar").hidden = false;
    q("#msgr-input").focus();
  }
  function cancelReply() { replying = null; const rb = q("#msgr-replybar"); if (rb) rb.hidden = true; }

  // ---------- reactions + stickers ----------
  const RX = ["❤️", "😂", "👍", "😮", "😢", "🔥", "🥰", "👏"];
  const STICKERS = ["😘", "🥰", "😍", "🤗", "😂", "😜", "🥳", "😎", "😴", "🥺", "😭", "😡", "👍", "🙏", "💪", "🎉", "🌹", "💐", "🌙", "💯", "🫶", "💞", "💋", "✨", "🫂", "🙈"];

  async function update(m) { const { id, ...data } = m; try { await fetch("/api/data", { method: "POST", body: JSON.stringify({ c: "messages", id, data }) }); } catch { /* offline */ } }

  function openReactPop(i, anchor) {
    const pop = q("#msgr-reactpop");
    pop.innerHTML = RX.map((e) => `<button data-rx="${i}" data-e="${e}">${e}</button>`).join("");
    pop.hidden = false;
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
    pop.style.top = Math.max(8, r.top - h - 6) + "px";
  }
  function toggleReact(i, emoji) {
    const m = msgs[i]; if (!m) return;
    m.reactions = m.reactions || {};
    const arr = m.reactions[emoji] = m.reactions[emoji] || [];
    const name = prefs.name || "", k = arr.indexOf(name);
    if (k >= 0) arr.splice(k, 1); else arr.push(name);
    if (!arr.length) delete m.reactions[emoji];
    q("#msgr-reactpop").hidden = true;
    update(m); render();
  }
  function toggleStickers(force) {
    const p = q("#msgr-stickers"); if (!p) return;
    const show = force === undefined ? p.hidden : force;
    if (show && !p.dataset.built) { p.innerHTML = STICKERS.map((e) => `<button data-sticker="${e}">${e}</button>`).join(""); p.dataset.built = "1"; }
    p.hidden = !show;
  }
  async function sendSticker(emoji) {
    const doc = { from: prefs.name || "", text: "", media: [], sticker: emoji, at: Date.now() };
    try { const s = await store(doc); if (s) { msgs.push({ id: s.id, ...doc }); render(true); } } catch { /* offline */ }
  }

  // ---------- shared photo gallery ----------
  function openGallery() {
    const imgs = [];
    for (const m of msgs) if (Array.isArray(m.media)) for (const x of m.media) if (x && typeof x.url === "string" && x.url.startsWith("/api/media/") && String(x.type || "").startsWith("image")) imgs.push(x.url);
    const g = document.createElement("div");
    g.className = "msgr-gallery";
    g.innerHTML = `<header class="msgr-head"><button class="icon-btn" data-g="close" aria-label="Back"><span class="icon">arrow_back</span></button><b>Shared photos</b></header>`
      + (imgs.length ? `<div class="msgr-grid">${imgs.map((u) => `<img src="${esc(authUrl(u))}" loading="lazy" alt="">`).join("")}</div>` : `<div class="msgr-empty"><span class="icon">image</span><p>Abhi koi photo share nahi hui</p></div>`);
    el.append(g);
    g.addEventListener("click", (e) => {
      if (e.target.closest("[data-g=close]")) return g.remove();
      const img = e.target.closest("img"); if (img && window.DU?.lightbox) window.DU.lightbox(img.src);
    });
  }

  const unread = () => msgs.filter((m) => m.at > seen && String(m.from || "").toLowerCase() !== String(prefs.name || "").toLowerCase()).length;
  function paintBadge() { const b = q("#msgr-badge"); if (!b) return; const n = unread(); b.textContent = n > 9 ? "9+" : String(n); b.hidden = !n; }
  async function refresh() { await fetchMsgs(); paintBadge(); }

  document.addEventListener("click", (e) => { if (e.target.closest("[data-home=messages]")) open(); });

  window.DU = window.DU || {};
  window.DU.messenger = { open, persist, refresh };
  const prevHome = window.DU.onHome;
  window.DU.onHome = function (...a) { prevHome?.apply(this, a); setTimeout(refresh, 400); };
})();
