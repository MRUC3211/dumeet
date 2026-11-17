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

  let msgs = [], el = null, pollT = 0, replying = null, starredOnly = false;
  const unfurls = new Map(); // url -> preview data (cache)
  const VANISH_TTL = 24 * 3600 * 1000;
  let vanish = false; try { vanish = localStorage.getItem("du-vanish") === "1"; } catch { /* private */ }

  // ---------- read receipts + last seen (WhatsApp-style) ----------
  // Each person writes only their own small doc in "settings": { at, read }.
  //   at   = last time their app was active (delivered cursor + last seen)
  //   read = last time they had this chat open and visible (read cursor)
  const kit = () => window.DU?.kit || {};
  const recvId = (name) => "recv-" + String(name || "").toLowerCase();
  const mineMsg = (m) => String(m.from || "").toLowerCase() === String(prefs.name || "").toLowerCase();
  let theirRecv = { at: 0, read: 0 };
  let myRead = 0, lastPush = 0;
  async function pullReceipts() {
    try {
      const docs = await kit().getDocs?.("settings");
      const t = docs?.find((d) => d.id === recvId(partner()))?.data;
      const next = t ? { at: +t.at || 0, read: +t.read || 0 } : theirRecv;
      const changed = next.at !== theirRecv.at || next.read !== theirRecv.read;
      theirRecv = next;
      if (changed && el) { paintStatus(); paintTicks(); }
    } catch { /* offline */ }
  }
  function paintTicks() {                       // update the ticks in place, no full re-render
    if (!el) return;
    const now = Date.now();
    for (const b of el.querySelectorAll(".msgr-b.me[data-i]")) {
      const m = msgs[+b.dataset.i]; if (!m || (m.sendAt && m.sendAt > now)) continue;
      const tick = b.querySelector(".msgr-time .msgr-tick"); if (!tick) continue;
      const read = theirRecv.read >= m.at, delivered = read || theirRecv.at >= m.at;
      tick.classList.toggle("read", read);
      const ic = tick.querySelector(".icon"), want = delivered ? "done_all" : "done";
      if (ic && ic.textContent !== want) ic.textContent = want;
    }
  }
  async function pushReceipt(force) {
    if (!prefs.name) return;
    const now = Date.now();
    if (!force && now - lastPush < 12000) return;
    lastPush = now;
    try { await kit().putDoc?.("settings", { who: prefs.name, at: now, read: myRead }, recvId(prefs.name)); } catch { /* offline */ }
  }
  function markReadIfViewing() {
    if (!el || document.visibilityState === "hidden") return;
    const theirLatest = msgs.filter((m) => !mineMsg(m) && !(m.sendAt && m.sendAt > Date.now())).at(-1)?.at || 0;
    if (theirLatest > myRead) { myRead = Date.now(); pushReceipt(true); }
  }
  function tickFor(at) {                       // ✓ sent · ✓✓ delivered · blue ✓✓ read
    const read = theirRecv.read >= at, delivered = read || theirRecv.at >= at;
    return `<span class="msgr-tick${read ? " read" : ""}"><span class="icon">${delivered ? "done_all" : "done"}</span></span>`;
  }
  function lastSeenText(ts) {
    const d = new Date(ts), now = new Date();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return time;                       // "last seen 4:06 PM"
    if (new Date(now - 864e5).toDateString() === d.toDateString()) return "yesterday";
    return d.toLocaleDateString([], { day: "numeric", month: "short" });
  }
  function paintStatus() {
    const s = q("#msgr-status"); if (!s) return;
    const now = Date.now();
    const online = (theirRecv.read && now - theirRecv.read < 35000) || (theirRecv.at && now - theirRecv.at < 50000);
    s.classList.toggle("online", Boolean(online));
    s.textContent = online ? "online" : theirRecv.at ? "last seen " + lastSeenText(theirRecv.at) : "";
  }

  async function fetchMsgs() {
    try {
      const { docs } = await (await fetch("/api/data?c=messages")).json();
      const now = Date.now();
      const list = (docs || []).map((d) => ({ id: d.id, ...d.data })).filter((m) => m && m.at);
      for (const m of list) if (m.exp && m.exp < now) fetch(`/api/data?c=messages&id=${encodeURIComponent(m.id)}`, { method: "DELETE" }).catch(() => {});
      msgs = list.filter((m) => !(m.exp && m.exp < now)).sort((a, b) => a.at - b.at);
      await pullReceipts();
      pushReceipt(false);
      return true;
    } catch { return false; }
  }
  async function store(doc) {
    const r = await fetch("/api/data", { method: "POST", body: JSON.stringify({ c: "messages", data: doc }) });
    return (await r.json().catch(() => ({}))).doc;
  }
  // nudge the other person's phone (a push notification); rate-limited server-side
  const notify = () => fetch("/api/push/message", { method: "POST", body: JSON.stringify({ from: prefs.name || "" }) }).catch(() => {});

  // called by the in-call chat and by this sheet to save + show a message
  async function persist(from, text, media, reply) {
    if (!text && !(media && media.length)) return;
    const doc = { from: from || prefs.name || "", text: text || "", media: media || [], at: Date.now() };
    if (reply && reply.text !== undefined) doc.reply = { from: reply.from || "", text: String(reply.text || "").slice(0, 80) };
    if (vanish) doc.exp = Date.now() + VANISH_TTL;
    try { const s = await store(doc); if (s) { msgs.push({ id: s.id, ...doc }); if (el) render(true); if (!doc.sendAt) notify(); } } catch { /* offline */ }
  }

  const potdKey = () => new Date().toDateString();
  const potdDue = () => { try { return localStorage.getItem("du-potd") !== potdKey(); } catch { return false; } };
  const potdDone = () => { try { localStorage.setItem("du-potd", potdKey()); } catch { /* private */ } };

  async function open() {
    build();
    if (potdDue()) q("#msgr-potd").hidden = false;
    await fetchMsgs();
    myRead = Date.now();
    render(true);
    if (msgs.length) setSeen(msgs[msgs.length - 1].at);
    paintBadge();
    pushReceipt(true);
    clearInterval(pollT);
    pollT = setInterval(async () => {
      if (!el) return;
      const n = msgs.length, last = msgs[n - 1]?.at;
      await fetchMsgs();   // pullReceipts (inside) refreshes status + ticks on its own
      if (msgs.length !== n || msgs[msgs.length - 1]?.at !== last) render(true);
      markReadIfViewing();
    }, 5000);
  }
  function close() { clearInterval(pollT); if (rec) stopRec(false); el?.remove(); el = null; paintBadge(); }

  // ---------- voice notes (record + send) ----------
  let rec = null, recTimer = 0;
  const fmtDur = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  function toggleSendMic() {
    if (!el) return;
    const has = (q("#msgr-input")?.value.trim().length || 0) > 0;
    const mic = el.querySelector(".msgr-mic"), send = el.querySelector(".msgr-form .send");
    if (mic) mic.hidden = has;
    if (send) send.hidden = !has;
  }
  async function startRec() {
    if (rec || !el) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("Voice notes aren't supported on this browser");
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return toast("Allow microphone access to record a voice note"); }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || "";
    let mr;
    try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
    catch { stream.getTracks().forEach((t) => t.stop()); return toast("Couldn't start recording"); }
    const chunks = [];
    mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    mr.onstop = () => finishRec(rec, chunks);
    rec = { mr, stream, startedAt: Date.now(), send: false };
    try { mr.start(); } catch { stream.getTracks().forEach((t) => t.stop()); rec = null; return toast("Couldn't start recording"); }
    q("#msgr-recbar").hidden = false;
    q("#msgr-form").hidden = true;
    updateRecTime();
    recTimer = setInterval(updateRecTime, 250);
  }
  function stopRec(send) {
    if (!rec) return;
    rec.send = send;
    try { rec.mr.stop(); } catch { /* already stopped */ }
  }
  async function finishRec(r, chunks) {
    clearInterval(recTimer);
    r?.stream.getTracks().forEach((t) => t.stop());
    if (el) { const rb = q("#msgr-recbar"), fm = q("#msgr-form"); if (rb) rb.hidden = true; if (fm) fm.hidden = false; toggleSendMic(); }
    const dur = Math.max(1, Math.round((Date.now() - (r?.startedAt || Date.now())) / 1000));
    rec = null;
    if (!r?.send) return;
    const blob = new Blob(chunks, { type: (chunks[0] && chunks[0].type) || r.mr.mimeType || "audio/webm" });
    if (!blob.size) return;
    toast("Sending…");
    try {
      const up = await (await fetch("/api/media", { method: "POST", headers: { "Content-Type": blob.type }, body: blob })).json();
      persist(prefs.name, "", [{ url: up.url, type: up.type, voice: true, dur }]);
    } catch { toast("Couldn't send the voice note"); }
  }
  function updateRecTime() {
    const t = q("#msgr-rec-time"); if (!t || !rec) return;
    t.textContent = fmtDur((Date.now() - rec.startedAt) / 1000);
  }

  // ---------- voice notes (playback) ----------
  let voiceAudio = null, voiceBox = null;
  function voiceBars(url) {
    let h = 0; for (const c of String(url)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    let out = "";
    for (let i = 0; i < 26; i++) { h = (h * 1103515245 + 12345) & 0x7fffffff; out += `<i style="height:${28 + (h % 68)}%"></i>`; }
    return out;
  }
  const voiceHtml = (x) => `<div class="msgr-voice" data-url="${esc(x.url)}">
    <button type="button" class="msgr-voice-play" aria-label="Play voice message"><span class="icon">play_arrow</span></button>
    <div class="msgr-voice-wave">${voiceBars(x.url)}<span class="msgr-voice-knob"></span></div>
    <span class="msgr-voice-dur">${fmtDur(x.dur || 0)}</span>
  </div>`;
  function resetVoiceUI(box) {
    if (!box) return;
    box.classList.remove("playing");
    const ic = box.querySelector(".msgr-voice-play .icon"); if (ic) ic.textContent = "play_arrow";
    const knob = box.querySelector(".msgr-voice-knob"); if (knob) knob.style.left = "0%";
    const d = box.querySelector(".msgr-voice-dur"); if (d && box.dataset.dur) d.textContent = box.dataset.dur;
  }
  function toggleVoice(box) {
    if (!box) return;
    if (voiceBox === box && voiceAudio && !voiceAudio.paused) { voiceAudio.pause(); return; }
    if (voiceAudio) { try { voiceAudio.pause(); } catch {} resetVoiceUI(voiceBox); }
    voiceBox = box;
    box.dataset.dur = box.querySelector(".msgr-voice-dur")?.textContent || "";
    voiceAudio = new Audio(authUrl(box.dataset.url));
    const ic = box.querySelector(".msgr-voice-play .icon");
    const knob = box.querySelector(".msgr-voice-knob");
    const dur = box.querySelector(".msgr-voice-dur");
    box.classList.add("playing");
    if (ic) ic.textContent = "pause";
    voiceAudio.addEventListener("timeupdate", () => {
      if (!voiceAudio?.duration) return;
      const p = voiceAudio.currentTime / voiceAudio.duration;
      if (knob) knob.style.left = (p * 100) + "%";
      if (dur) dur.textContent = fmtDur(voiceAudio.currentTime);
    });
    voiceAudio.addEventListener("ended", () => resetVoiceUI(box));
    voiceAudio.play().catch(() => { toast("Couldn't play the voice note"); resetVoiceUI(box); });
  }

  function build() {
    if (el) return;
    el = document.createElement("div");
    el.className = "msgr";
    el.innerHTML = `
      <div class="msgr-sheet">
        <header class="msgr-head">
          <button class="icon-btn" data-m="close" aria-label="Back"><span class="icon">arrow_back</span></button>
          <span class="msgr-av" id="msgr-av"></span>
          <span class="msgr-head-id"><b id="msgr-name"></b><small class="msgr-status" id="msgr-status"></small></span>
          <button class="icon-btn" data-m="catchup" title="Catch me up" aria-label="Catch me up"><span class="icon">auto_awesome</span></button>
          <button class="icon-btn msgr-vanish-btn" data-m="vanish" aria-label="Disappearing messages"><span class="icon">timer</span></button>
          <button class="icon-btn msgr-star-btn" data-m="starred" aria-label="Starred messages"><span class="icon">star</span></button>
          <button class="icon-btn msgr-gallery-btn" data-m="gallery" aria-label="Shared photos"><span class="icon">photo_library</span></button>
        </header>
        <div class="msgr-potd" id="msgr-potd" hidden><span class="icon">photo_camera</span><div><b>Photo of the day</b><small>Send one photo or selfie for today 📸</small></div><button type="button" class="btn primary small-btn" data-m="potd-send">Send</button><button type="button" class="icon-btn" data-m="potd-x" aria-label="Dismiss"><span class="icon">close</span></button></div>
        <div class="msgr-list" id="msgr-list"></div>
        <div class="msgr-smart" id="msgr-smart" hidden></div>
        <div class="msgr-replybar" id="msgr-replybar" hidden><div class="msgr-rb-info"><b id="msgr-rb-name"></b><span id="msgr-rb-text"></span></div><button type="button" class="icon-btn" data-m="cancel-reply" aria-label="Cancel"><span class="icon">close</span></button></div>
        <div class="msgr-stickers" id="msgr-stickers" hidden></div>
        <form class="msgr-form" id="msgr-form">
          <button type="button" class="icon-btn" data-m="stickers" title="Stickers" aria-label="Stickers"><span class="icon">mood</span></button>
          <button type="button" class="icon-btn" data-m="attach" title="Attach" aria-label="Attach"><span class="icon">add_circle</span></button>
          <input type="file" accept="image/*" id="msgr-file" hidden>
          <input type="file" accept="image/*" id="msgr-file-once" hidden>
          <input id="msgr-input" placeholder="Message ${esc(partner())}…" maxlength="2000" autocomplete="off">
          <button type="button" class="icon-btn" data-m="schedule" title="Send later" aria-label="Schedule"><span class="icon">schedule_send</span></button>
          <button type="button" class="icon-btn msgr-mic" data-m="mic" title="Record a voice message" aria-label="Record a voice message"><span class="icon">mic</span></button>
          <button class="icon-btn send" aria-label="Send message"><span class="icon">arrow_upward</span></button>
        </form>
        <div class="msgr-recbar" id="msgr-recbar" hidden>
          <button type="button" class="icon-btn danger" data-m="rec-cancel" title="Cancel" aria-label="Cancel recording"><span class="icon">delete</span></button>
          <span class="msgr-rec-dot" aria-hidden="true"></span>
          <span class="msgr-rec-time" id="msgr-rec-time">0:00</span>
          <span class="msgr-rec-hint">Recording… tap to send</span>
          <button type="button" class="icon-btn send" data-m="rec-send" title="Send" aria-label="Send voice message"><span class="icon">arrow_upward</span></button>
        </div>
      </div>
      <div class="msgr-reactpop" id="msgr-reactpop" hidden></div>
      <div class="msgr-ctx" id="msgr-ctx" hidden></div>
      <div class="msgr-attachpop" id="msgr-attachpop" hidden>
        <button data-a="photo"><span class="icon">image</span>Photo</button>
        <button data-a="once"><span class="icon">visibility</span>View-once photo</button>
        <button data-a="location"><span class="icon">location_on</span>Location</button>
      </div>`;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add("open"));
    q("#msgr-name").textContent = partner();
    const av = q("#msgr-av"); const face = window.DU?.faceFor?.(partner());
    if (face) { av.style.backgroundImage = `url("${authUrl(face)}")`; av.classList.add("photo"); } else av.textContent = (partner()[0] || "?").toUpperCase();
    el.addEventListener("click", (e) => {
      if (!e.target.closest("#msgr-reactpop, [data-react]")) q("#msgr-reactpop").hidden = true;
      if (!e.target.closest("#msgr-ctx, .msgr-b")) closeCtx();
      if (!e.target.closest("#msgr-schedpop, [data-m=schedule]")) { const sp = q("#msgr-schedpop"); if (sp) sp.hidden = true; }
      if (!e.target.closest("#msgr-attachpop, [data-m=attach]")) { const ap = q("#msgr-attachpop"); if (ap) ap.hidden = true; }
      if (e.target.closest("[data-m=close]")) return close();
      if (e.target.closest("[data-m=potd-send]")) { potdDone(); q("#msgr-potd").hidden = true; return q("#msgr-file").click(); }
      if (e.target.closest("[data-m=potd-x]")) { potdDone(); return (q("#msgr-potd").hidden = true); }
      if (e.target.closest("[data-m=attach]")) return toggleAttach(e.target.closest("[data-m=attach]"));
      if (e.target.closest("[data-m=vanish]")) return toggleVanish();
      if (e.target.closest("[data-m=catchup]")) return catchUp();
      const sm = e.target.closest("[data-smart]"); if (sm) { persist(prefs.name, sm.dataset.smart, []); q("#msgr-smart").hidden = true; smartFor = "sent"; return; }
      const ab = e.target.closest("[data-a]"); if (ab) { q("#msgr-attachpop").hidden = true; const a = ab.dataset.a; if (a === "photo") q("#msgr-file").click(); else if (a === "once") q("#msgr-file-once").click(); else if (a === "location") shareLocation(); return; }
      const vo = e.target.closest("[data-once]"); if (vo) return revealOnce(+vo.dataset.once);
      if (e.target.closest("[data-m=gallery]")) return openGallery();
      if (e.target.closest("[data-m=cancel-reply]")) return cancelReply();
      if (e.target.closest("[data-m=stickers]")) return toggleStickers();
      if (e.target.closest("[data-m=starred]")) { starredOnly = !starredOnly; q(".msgr-star-btn")?.classList.toggle("on", starredOnly); return render(true); }
      if (e.target.closest("[data-m=schedule]")) return openSchedule(e.target.closest("[data-m=schedule]"));
      const rb = e.target.closest("[data-reply]"); if (rb) return startReply(+rb.dataset.reply);
      const rc = e.target.closest("[data-react]"); if (rc) return openReactPop(+rc.dataset.react, rc);
      const rx = e.target.closest("[data-rx]"); if (rx) return toggleReact(+rx.dataset.rx, rx.dataset.e);
      const sb = e.target.closest("[data-star]"); if (sb) return toggleStar(+sb.dataset.star);
      const db = e.target.closest("[data-del]"); if (db) return deleteMsg(+db.dataset.del);
      const sc = e.target.closest("[data-sched]"); if (sc) return scheduleSend(+sc.dataset.sched);
      const st = e.target.closest("[data-sticker]"); if (st) { sendSticker(st.dataset.sticker); toggleStickers(false); return; }
      const cr = e.target.closest(".ctx-r"); if (cr) { toggleReact(+cr.dataset.rx, cr.dataset.e); closeCtx(); return; }
      const ca = e.target.closest("[data-ctx]");
      if (ca) { const i = +ca.dataset.i, act = ca.dataset.ctx; closeCtx(); if (act === "reply") startReply(i); else if (act === "star") toggleStar(i); else if (act === "delete") deleteMsg(i); else if (act === "copy") { navigator.clipboard?.writeText(msgs[i]?.text || "").then(() => toast("Copied"), () => {}); } return; }
      if (e.target.closest("[data-m=mic]")) return startRec();
      if (e.target.closest("[data-m=rec-cancel]")) return stopRec(false);
      if (e.target.closest("[data-m=rec-send]")) return stopRec(true);
      const vp = e.target.closest(".msgr-voice-play"); if (vp) return toggleVoice(vp.closest(".msgr-voice"));
      const bubble = e.target.closest(".msgr-b[data-i]");
      if (bubble && !e.target.closest("a, img, button")) return openCtx(+bubble.dataset.i, bubble);
    });
    const input = q("#msgr-input");
    input.addEventListener("input", toggleSendMic);
    toggleSendMic();
    enableSwipeReply();
    q("#msgr-form").addEventListener("submit", (e) => { e.preventDefault(); const i = q("#msgr-input"); const t = i.value.trim(); if (!t) return; i.value = ""; toggleSendMic(); const r = replying; cancelReply(); persist(prefs.name, t, [], r); });
    const sendPhoto = async (f, once) => {
      if (!f) return;
      if (f.size > 25 * 1024 * 1024) return toast("Photo must be under 25MB");
      toast("Sending…");
      try { const up = await (await fetch("/api/media", { method: "POST", headers: { "Content-Type": f.type || "image/jpeg" }, body: f })).json(); persist(prefs.name, "", [{ url: up.url, type: up.type, name: f.name, once: once || undefined }]); } catch { toast("Couldn't send the photo"); }
    };
    q("#msgr-file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; sendPhoto(f, false); });
    q("#msgr-file-once").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; sendPhoto(f, true); });
    q(".msgr-vanish-btn")?.classList.toggle("on", vanish);
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
    if (!msgs.length) { list.innerHTML = `<div class="msgr-empty"><span class="icon">chat</span><p>No messages yet — send the first one 💬</p></div>`; return; }
    let html = "", lastDay = "";
    const now = Date.now();
    let any = false;
    msgs.forEach((m, i) => {
      const mine = String(m.from || "").toLowerCase() === String(prefs.name || "").toLowerCase();
      const scheduled = m.sendAt && m.sendAt > now;
      if (scheduled && !mine) return;               // not delivered to the other side yet
      if (starredOnly && !m.star) return;
      any = true;
      const d = new Date(m.at), day = d.toDateString();
      if (!starredOnly && day !== lastDay) { lastDay = day; html += `<div class="msgr-day">${dayLabel(d)}</div>`; }
      const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      if (m.deleted) { html += `<div class="msgr-b deleted ${mine ? "me" : "them"}" data-i="${i}"><span class="msgr-t"><span class="icon">block</span>This message was deleted</span></div>`; return; }
      const reacts = (m.reactions && Object.keys(m.reactions).some((e) => m.reactions[e].length))
        ? `<span class="msgr-reacts">${Object.entries(m.reactions).filter(([, ar]) => ar.length).map(([e, ar]) => `<button class="msgr-rchip${ar.includes(prefs.name) ? " mine" : ""}" data-rx="${i}" data-e="${esc(e)}">${esc(e)}${ar.length > 1 ? " " + ar.length : ""}</button>`).join("")}</span>` : "";
      const vIcon = m.exp ? '<span class="icon msgr-vanish-i">timer</span>' : "";
      const tick = (mine && !scheduled && !m.deleted) ? tickFor(m.at) : "";
      const meta = scheduled
        ? `<span class="msgr-time msgr-sched"><span class="icon">schedule</span>${d.toLocaleString([], { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" })}</span>`
        : `<span class="msgr-time">${vIcon}${m.star ? '<span class="icon msgr-star">star</span>' : ""}${time}${tick}</span>`;
      if (m.sticker) { html += `<div class="msgr-b sticker ${mine ? "me" : "them"}" data-i="${i}"><span class="msgr-sticker">${esc(m.sticker)}</span>${meta}${reacts}</div>`; return; }
      const firstUrl = (m.text || "").match(/https?:\/\/[^\s<]+/)?.[0];
      html += `<div class="msgr-b ${mine ? "me" : "them"}" data-i="${i}"${firstUrl ? ` data-url="${esc(firstUrl)}"` : ""}>`;
      if (m.reply) html += `<span class="msgr-q"><b>${esc(m.reply.from || "")}</b>${esc(m.reply.text || "")}</span>`;
      if (m.loc && typeof m.loc.lat === "number") html += `<a class="msgr-loc" href="https://www.openstreetmap.org/?mlat=${m.loc.lat}&mlon=${m.loc.lon}#map=16/${m.loc.lat}/${m.loc.lon}" target="_blank" rel="noopener noreferrer"><span class="icon">location_on</span><span><b>Location</b><small>${m.loc.lat}, ${m.loc.lon} · Open in Maps</small></span></a>`;
      if (Array.isArray(m.media)) for (const x of m.media) {
        if (!x || typeof x.url !== "string" || !x.url.startsWith("/api/media/")) continue;
        if (x.voice || (x.type || "").startsWith("audio/")) html += voiceHtml(x);
        else if (x.once) {
          if (x.viewed) html += `<span class="msgr-once viewed"><span class="icon">visibility_off</span>Opened</span>`;
          else if (mine) html += `<span class="msgr-once"><span class="icon">visibility</span>View-once photo</span>`;
          else html += `<button class="msgr-once tap" data-once="${i}"><span class="icon">visibility</span>Tap to view once</button>`;
        } else html += `<img class="msgr-img" loading="lazy" src="${esc(authUrl(x.url))}" alt="">`;
      }
      if (m.text) html += `<span class="msgr-t">${linkify(m.text)}</span>`;
      html += `${meta}${reacts}</div>`;
    });
    list.innerHTML = any ? html : `<div class="msgr-empty"><span class="icon">${starredOnly ? "star" : "chat"}</span><p>${starredOnly ? "No starred messages" : "No messages yet — send the first one 💬"}</p></div>`;
    setSeen(now);
    if (scroll) list.scrollTop = list.scrollHeight;
    paintStatus();
    markReadIfViewing();
    loadPreviews();
    maybeSmart();
  }

  // ---------- AI: smart replies + catch me up ----------
  let smartFor = null;
  async function maybeSmart() {
    const smart = q("#msgr-smart"); if (!smart) return;
    const last = msgs[msgs.length - 1];
    const mine = last && String(last.from || "").toLowerCase() === String(prefs.name || "").toLowerCase();
    if (!last || mine || !last.text || last.id === smartFor) { if (!last || mine) smart.hidden = true; return; }
    smartFor = last.id;
    try {
      const res = await fetch("/api/ai/smartreply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: last.text.slice(0, 500) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.replies || !data.replies.length) { smart.hidden = true; return; }
      smart.innerHTML = data.replies.map((r) => `<button data-smart="${esc(r)}">${esc(r)}</button>`).join("");
      smart.hidden = false;
    } catch { smart.hidden = true; }
  }
  async function catchUp() {
    const now = Date.now();
    const recent = msgs.filter((m) => !(m.sendAt && m.sendAt > now) && !m.deleted && (m.text || m.sticker)).slice(-30)
      .map((m) => `${String(m.from || "").toLowerCase() === String(prefs.name || "").toLowerCase() ? "You" : (m.from || "Them")}: ${m.text || m.sticker}`).join("\n");
    if (recent.trim().length < 20) return toast("Not enough messages to summarise yet");
    toast("Catching up…");
    try {
      const res = await fetch("/api/ai/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: recent }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "failed");
      (window.DU.aiCard || (() => toast("Summary ready")))("Catch me up", data.points, data.line);
    } catch (error) { toast(/switched on|GEMINI/i.test(String(error.message || error)) ? "Turn Hey Lord on (AI key)" : "Couldn't make a summary"); }
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

  // ---------- swipe-to-reply (WhatsApp / Telegram style) ----------
  function enableSwipeReply() {
    const list = q("#msgr-list"); if (!list || list.dataset.swipe) return;
    list.dataset.swipe = "1";
    const THRESH = 52, MAX = 80;
    let bubble = null, sx = 0, sy = 0, mx = 0, active = false, decided = false, horiz = false;
    const clear = (animate) => {
      if (bubble) {
        bubble.style.transition = animate ? "transform .2s cubic-bezier(.22,1,.36,1)" : "";
        bubble.style.transform = ""; bubble.style.removeProperty("--swipe"); bubble.style.removeProperty("--swipe-x");
        bubble.classList.remove("swiping");
        if (animate) { const b = bubble; setTimeout(() => { b.style.transition = ""; }, 220); }
      }
      bubble = null; active = false; decided = false; horiz = false; mx = 0;
    };
    list.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;            // reserve swipe for touch
      const b = e.target.closest(".msgr-b[data-i]");
      if (!b || b.classList.contains("deleted")) return;
      bubble = b; sx = e.clientX; sy = e.clientY; active = true; decided = false; horiz = false;
    });
    list.addEventListener("pointermove", (e) => {
      if (!active || !bubble) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        decided = true; horiz = Math.abs(dx) > Math.abs(dy) + 4;
        if (horiz) bubble.classList.add("swiping");
      }
      if (!horiz) return;
      const dir = bubble.classList.contains("me") ? -1 : 1;   // theirs → right, mine → left
      mx = dx;
      const shift = mx * dir > 0 ? Math.min(Math.abs(mx), MAX) * dir : 0;
      bubble.style.transform = `translateX(${shift}px)`;
      bubble.style.setProperty("--swipe-x", shift + "px");
      bubble.style.setProperty("--swipe", String(Math.min(Math.abs(shift) / THRESH, 1)));
    });
    const finish = () => {
      if (!active || !bubble) return clear(false);
      const dir = bubble.classList.contains("me") ? -1 : 1;
      const i = +bubble.dataset.i;
      const reached = horiz && mx * dir >= THRESH;
      clear(true);
      if (reached) { navigator.vibrate?.(12); startReply(i); }
    };
    list.addEventListener("pointerup", finish);
    list.addEventListener("pointercancel", () => clear(true));
    list.addEventListener("pointerleave", () => { if (active) clear(true); });
  }

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
  // WhatsApp-style: tap a message to open a reaction row + actions
  function openCtx(i, bubble) {
    const m = msgs[i]; if (!m || m.deleted) return;
    const mine = String(m.from || "").toLowerCase() === String(prefs.name || "").toLowerCase();
    const ctx = q("#msgr-ctx"); if (!ctx) return;
    const reacts = RX.map((e) => `<button class="ctx-r" data-rx="${i}" data-e="${e}">${e}</button>`).join("");
    let acts = `<button class="ctx-a" data-ctx="reply" data-i="${i}"><span class="icon">reply</span>Reply</button>`
      + `<button class="ctx-a" data-ctx="star" data-i="${i}"><span class="icon">${m.star ? "star" : "star_border"}</span>${m.star ? "Unstar" : "Star"}</button>`;
    if (m.text) acts += `<button class="ctx-a" data-ctx="copy" data-i="${i}"><span class="icon">content_copy</span>Copy</button>`;
    if (mine) acts += `<button class="ctx-a danger" data-ctx="delete" data-i="${i}"><span class="icon">delete</span>Delete</button>`;
    ctx.innerHTML = `<div class="ctx-reacts">${reacts}</div><div class="ctx-acts">${acts}</div>`;
    ctx.hidden = false;
    const r = bubble.getBoundingClientRect(), w = ctx.offsetWidth, h = ctx.offsetHeight;
    let left = mine ? r.right - w : r.left;
    left = Math.max(8, Math.min(innerWidth - w - 8, left));
    let top = r.top - h - 8;
    if (top < 8) top = Math.min(innerHeight - h - 8, r.bottom + 8);
    ctx.style.left = left + "px"; ctx.style.top = top + "px";
    el.querySelector(".ctx-on")?.classList.remove("ctx-on");
    bubble.classList.add("ctx-on");
  }
  function closeCtx() { const c = q("#msgr-ctx"); if (c) c.hidden = true; el?.querySelector(".ctx-on")?.classList.remove("ctx-on"); }

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
    try { const s = await store(doc); if (s) { msgs.push({ id: s.id, ...doc }); render(true); notify(); } } catch { /* offline */ }
  }

  // ---------- attach menu / location / view-once / disappearing ----------
  function toggleAttach(anchor) {
    const p = q("#msgr-attachpop"); if (!p) return;
    if (!p.hidden) { p.hidden = true; return; }
    p.hidden = false;
    const r = anchor.getBoundingClientRect(), h = p.offsetHeight;
    p.style.left = Math.max(8, r.left) + "px";
    p.style.top = Math.max(8, r.top - h - 6) + "px";
  }
  function toggleVanish() {
    vanish = !vanish;
    try { localStorage.setItem("du-vanish", vanish ? "1" : "0"); } catch { /* private */ }
    q(".msgr-vanish-btn")?.classList.toggle("on", vanish);
    toast(vanish ? "Disappearing messages ON — new messages vanish after 24 hours" : "Disappearing messages OFF");
  }
  function shareLocation() {
    if (!navigator.geolocation) return toast("Location isn't available");
    toast("Getting your location…");
    navigator.geolocation.getCurrentPosition((pos) => {
      const doc = { from: prefs.name || "", text: "", media: [], loc: { lat: +pos.coords.latitude.toFixed(5), lon: +pos.coords.longitude.toFixed(5) }, at: Date.now() };
      if (vanish) doc.exp = Date.now() + VANISH_TTL;
      store(doc).then((s) => { if (s) { msgs.push({ id: s.id, ...doc }); render(true); notify(); } });
    }, () => toast("Couldn't get location — allow permission"), { enableHighAccuracy: true, timeout: 10000 });
  }
  function revealOnce(i) {
    const m = msgs[i]; const item = m && Array.isArray(m.media) ? m.media.find((x) => x && x.once && !x.viewed) : null;
    if (!item) return;
    if (window.DU?.lightbox) window.DU.lightbox(authUrl(item.url));
    item.viewed = true; update(m); render();
  }

  // ---------- star / delete / schedule ----------
  function toggleStar(i) { const m = msgs[i]; if (!m) return; m.star = !m.star; update(m); render(); }
  function deleteMsg(i) { const m = msgs[i]; if (!m) return; m.deleted = true; m.text = ""; m.media = []; m.sticker = ""; delete m.reactions; delete m.reply; update(m); render(); }

  function presets() {
    const t9 = new Date(); t9.setHours(21, 0, 0, 0); if (t9.getTime() <= Date.now()) t9.setDate(t9.getDate() + 1);
    const tm9 = new Date(); tm9.setDate(tm9.getDate() + 1); tm9.setHours(9, 0, 0, 0);
    return [["In 1 hour", Date.now() + 3600000], ["Tonight 9 PM", t9.getTime()], ["Tomorrow 9 AM", tm9.getTime()]];
  }
  function openSchedule(anchor) {
    if (!q("#msgr-input").value.trim()) return toast("Type a message first");
    let pop = q("#msgr-schedpop");
    if (!pop) { pop = document.createElement("div"); pop.className = "msgr-schedpop"; pop.id = "msgr-schedpop"; el.append(pop); }
    pop.innerHTML = presets().map(([label, ts]) => `<button data-sched="${ts}"><span class="icon">schedule</span>${label}</button>`).join("");
    pop.hidden = false;
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
    pop.style.top = Math.max(8, r.top - h - 6) + "px";
  }
  async function scheduleSend(ts) {
    const input = q("#msgr-input"), t = input.value.trim(); if (!t) return;
    input.value = ""; const p = q("#msgr-schedpop"); if (p) p.hidden = true;
    const doc = { from: prefs.name || "", text: t, media: [], at: ts, sendAt: ts };
    try { const s = await store(doc); if (s) { msgs.push({ id: s.id, ...doc }); render(true); toast("Message scheduled ⏰"); } } catch { toast("Couldn't schedule"); }
  }

  // ---------- shared photo gallery ----------
  function openGallery() {
    const imgs = [];
    for (const m of msgs) if (Array.isArray(m.media)) for (const x of m.media) if (x && !x.once && typeof x.url === "string" && x.url.startsWith("/api/media/") && String(x.type || "").startsWith("image")) imgs.push(x.url);
    const g = document.createElement("div");
    g.className = "msgr-gallery";
    g.innerHTML = `<header class="msgr-head"><button class="icon-btn" data-g="close" aria-label="Back"><span class="icon">arrow_back</span></button><b>Shared photos</b>${imgs.length > 1 ? '<button class="icon-btn" data-g="reel" aria-label="Play highlight reel"><span class="icon">slideshow</span></button>' : ""}</header>`
      + (imgs.length ? `<div class="msgr-grid">${imgs.map((u) => `<img src="${esc(authUrl(u))}" loading="lazy" alt="">`).join("")}</div>` : `<div class="msgr-empty"><span class="icon">image</span><p>No photos shared yet</p></div>`);
    el.append(g);
    g.addEventListener("click", (e) => {
      if (e.target.closest("[data-g=close]")) return g.remove();
      if (e.target.closest("[data-g=reel]")) return playReel(imgs.map((u) => authUrl(u)));
      const img = e.target.closest("img"); if (img && window.DU?.lightbox) window.DU.lightbox(img.src);
    });
  }

  function playReel(srcs) {
    if (!srcs.length) return;
    const r = document.createElement("div");
    r.className = "msgr-reel";
    r.innerHTML = '<div class="reel-stage"></div><button class="reel-x" aria-label="Close"><span class="icon">close</span></button>';
    document.body.append(r);
    const stage = r.querySelector(".reel-stage");
    let i = 0;
    const show = () => {
      const img = document.createElement("img");
      img.className = "reel-img"; img.src = srcs[i % srcs.length];
      stage.append(img);
      requestAnimationFrame(() => img.classList.add("on"));
      setTimeout(() => { const kids = [...stage.querySelectorAll(".reel-img")]; if (kids.length > 1) kids.slice(0, -1).forEach((k) => k.remove()); }, 1100);
      i += 1;
    };
    show();
    const t = setInterval(() => { if (!r.isConnected) return clearInterval(t); show(); }, 3200);
    r.addEventListener("click", (e) => { if (e.target.closest(".reel-x") || e.target === r || e.target.closest(".reel-stage")) { clearInterval(t); r.remove(); } });
  }

  const unread = () => msgs.filter((m) => m.at > seen && String(m.from || "").toLowerCase() !== String(prefs.name || "").toLowerCase()).length;
  function paintBadge() {
    const n = unread();
    const b = q("#msgr-badge"); if (b) { b.textContent = n > 9 ? "9+" : String(n); b.hidden = !n; }
    const dot = q("#chat-dot"); if (dot) dot.hidden = !n || Boolean(el);   // in-call chat button unread dot
  }
  async function refresh() { await fetchMsgs(); paintBadge(); }

  document.addEventListener("click", (e) => { if (e.target.closest("[data-home=messages]")) open(); });

  // Presence heartbeat: while the app is open on ANY screen (not just the chat),
  // keep my "last active" fresh and pull the partner's state. This is what makes
  // delivered ticks + "online / last seen" work when the other person is around
  // but not sitting inside the chat.
  async function heartbeat() {
    if (document.visibilityState !== "visible" || !prefs.name) return;
    await pullReceipts();        // refresh partner state (repaints ticks/status in place if chat open)
    pushReceipt(false);          // bump my `at` (throttled)
    if (el) paintStatus();
    paintBadge();
  }
  setInterval(heartbeat, 15000);
  setTimeout(heartbeat, 1500);   // register presence shortly after load

  // returning to the tab marks read (if chat open) and re-registers presence at once
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (el) { markReadIfViewing(); paintStatus(); }
    pushReceipt(true);
    pullReceipts();
  });

  // open the chat when a message notification is tapped, or on a /?chat=1 cold open
  navigator.serviceWorker?.addEventListener("message", (e) => { if (e.data?.type === "msg-open") open(); });
  if (/[?&]chat=1/.test(location.search)) setTimeout(open, 600);

  window.DU = window.DU || {};
  window.DU.messenger = { open, persist, refresh };
  const prevHome = window.DU.onHome;
  window.DU.onHome = function (...a) { prevHome?.apply(this, a); setTimeout(refresh, 400); };
})();
