// DU Meet · Saathi, the AI friend who joins the call (Google Gemini Live).
//
// One device "hosts" Saathi: it opens a WebSocket straight to Gemini with a one-time
// token from our server, sends what it hears (its own mic + the partner's voice from the
// call) and plays Saathi's voice. Saathi's voice is also mixed into the host's outgoing
// mic, so the partner hears it through the call like a third person. Captions and state
// go to the partner over the call's data channel.
//
// Modes: just talk, Faisla (judge a disagreement), game host, plan a date, bedtime story.
// Extras: cool-down when voices get loud, "say it softly", promises Saathi remembers,
// verdict cards with a 3-day peace-deal check-in. Uses globals from app.js.

(() => {
  "use strict";
  const { q, esc } = window.DU.kit;
  const { openModal, closeModal } = window.DU;
  const tray = (open) => window.DU.kit.toggleTray(open);
  const myName = () => me.name || prefs.name || "";
  const people = () => {
    if (polling) return [me.name, ...[...peers.values()].map((p) => p.name)].filter(Boolean);
    // on the home page: me plus the couple's other name from the "Who's joining?" picker
    const names = [...new Set([...document.querySelectorAll("[data-who]")].map((b) => b.dataset.who))];
    return [myName(), ...names.filter((n) => n && n !== myName())].filter(Boolean).slice(0, 2);
  };
  const partner = () => [...peers.values()][0];
  const fast = (type, data) => { if (polling) (typeof sendFast === "function" ? sendFast : send)(type, data); };
  const tell = (data) => { if (polling) send("ai", data); };

  const MODE_INFO = {
    talk: { icon: "forum", label: "Just talk", small: "Hang out, ask anything" },
    faisla: { icon: "balance", label: "Faisla", small: "Tell both sides, get a fair verdict" },
    game: { icon: "casino", label: "Game host", small: "Truth or dare, quiz, would you rather" },
    date: { icon: "favorite", label: "Plan a date", small: "Ideas that fit you two" },
    story: { icon: "bedtime", label: "Bedtime story", small: "A story starring you both" },
  };
  const KICKOFF = {
    talk: (n) => `(App: ${me.name} just called you into the call with ${n}. Say a short, warm hello to everyone by name.)`,
    faisla: () => "(App: The Faisla hearing starts now. Do step 1.)",
    game: () => "(App: You were called in as game host. Greet them and offer two or three games to pick from.)",
    date: () => "(App: You were called in to plan a date. Greet them and ask one question to start.)",
    story: () => "(App: You were called in for a bedtime story. Say a soft hello and begin the story.)",
  };
  const TURN_SECONDS = 120;

  const S = {
    info: null,          // /api/ai/state
    view: "home",
    live: null,          // the session on this device (host)
    remote: null,        // { host, mode, aiName } when the partner hosts
    mixTrack: null,
    cap: "", speaking: false,
    turn: null,          // { who, ends }
    verdictCase: null,
    seeing: false,
  };

  const api = async (action, body = {}) => {
    const response = await fetch(`/api/ai/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: myName(), names: people(), ...body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || "Something went wrong");
    return data;
  };
  const aiName = () => S.info?.about?.aiName || S.remote?.aiName || "Saathi";
  async function refresh() {
    try { S.info = await api("state"); } catch (error) { S.info ||= { enabled: false, error: error.message }; }
    paint();
    return S.info;
  }

  // ---------- the panel ----------

  const panel = document.createElement("div");
  panel.className = "modal";
  panel.id = "m-saathi";
  panel.hidden = true;
  panel.innerHTML = `<div class="sheet sa-sheet" role="dialog" aria-modal="true" aria-labelledby="sa-title">
    <header class="sheet-head">
      <button class="icon-btn sa-back" data-sa="home" aria-label="Back" hidden><span class="icon" aria-hidden="true">arrow_back</span></button>
      <div class="sa-brand"><span class="sa-orb mini" aria-hidden="true"><i></i></span><h2 id="sa-title">Saathi</h2></div>
      <button class="icon-btn" data-modal-close aria-label="Close"><span class="icon" aria-hidden="true">close</span></button>
    </header>
    <div class="sheet-body sa-body"></div></div>`;
  document.body.append(panel);
  const body = q(".sa-body", panel);

  function open(view = "home") {
    tray(false);
    S.view = view;
    openModal(panel);
    paint();
    refresh();
  }

  function needsConsent() {
    const consent = S.info?.consent || {};
    return (polling ? people() : [myName()]).filter((n) => n && !consent[n]);
  }

  function paint() {
    if (panel.hidden) return;
    const info = S.info;
    q("#sa-title", panel).textContent = S.view === "home" ? aiName() : ({ faisla: "Faisla", soft: "Say it softly", about: "About us", history: "Past faislas", promises: "Promises", diary: "Our diary" })[S.view] || aiName();
    q(".sa-back", panel).hidden = S.view === "home";
    if (!info) { body.innerHTML = `<div class="sa-loading"><span class="sa-orb"><i></i></span></div>`; return; }
    body.innerHTML = ({ home: homeView, faisla: faislaView, soft: softView, about: aboutView, history: historyView, promises: promisesView })[S.view]?.() ?? "";
  }

  function homeView() {
    const info = S.info;
    const liveNow = S.live || S.remote;
    const missing = needsConsent();
    const off = !info.enabled;
    const blocked = off || missing.length > 0;
    const open = (info.cases || []).find((c) => c.status !== "done");
    const due = (info.cases || []).filter((c) => c.status === "done" && c.followAt && c.followAt * 1000 < Date.now() && !(c.follow || {})[myName()]);
    let html = `<div class="sa-hero"><span class="sa-orb big${liveNow ? " live" : ""}" aria-hidden="true"><i></i></span>
      <p>${esc(aiName())} knows you both, talks in Hinglish, and joins the call like a third friend.</p></div>`;
    if (off) {
      html += `<div class="sa-note warn"><span class="icon" aria-hidden="true">key</span><div><b>Almost ready</b>
        <small>Saathi switches on once the Gemini key is added on the server (GEMINI_API_KEY in Render's Environment).</small></div></div>`;
    } else if (missing.length) {
      const consent = info.consent || {};
      html += `<div class="sa-consent"><b>Before ${esc(aiName())} can listen</b>
        <p>${esc(aiName())} runs on Google Gemini, so what you say during a ${esc(aiName())} conversation is sent to Google to get answers.
        If you turn on "Let ${esc(aiName())} see", camera pictures go too. The diary and study quizzes also use Gemini. It keeps short notes and promises so it remembers you. Admin can wipe all of it any time.</p>
        <div class="sa-who">${(polling ? people() : [myName()]).map((n) => `<span class="${consent[n] ? "ok" : ""}"><span class="icon" aria-hidden="true">${consent[n] ? "check_circle" : "schedule"}</span>${esc(n)}</span>`).join("")}</div>
        ${consent[myName()] ? `<small>Waiting for ${esc(missing.join(" and "))} to agree on their phone.</small>` : `<button class="btn primary" data-sa="agree">I agree</button>`}</div>`;
    }
    if (liveNow) {
      html += `<button class="sa-live-row" data-sa="end"><span class="sa-dot" aria-hidden="true"></span><span><b>${esc(aiName())} is in the call</b><small>${esc(MODE_INFO[(S.live || S.remote).mode]?.label || "")} · tap to end</small></span><span class="icon" aria-hidden="true">call_end</span></button>`;
    }
    if (open) {
      html += `<button class="sa-open-case" data-sa="faisla"><span class="icon" aria-hidden="true">gavel</span><span><b>Open Faisla: ${esc(open.topic)}</b><small>${open.sidesIn.length ? `Sides written: ${esc(open.sidesIn.join(", "))}` : "No sides written yet"}</small></span><span class="icon" aria-hidden="true">chevron_right</span></button>`;
    }
    for (const c of due) {
      html += `<div class="sa-check"><span class="icon" aria-hidden="true">handshake</span><div><b>Peace deal check-in</b><small>${esc(c.topic)}: did you do your part?</small>
        <span class="sa-check-btns"><button class="btn small-btn primary" data-follow="${c.id}" data-kept="1">Yes, I did</button><button class="btn small-btn outline" data-follow="${c.id}" data-kept="0">Not yet</button></span></div></div>`;
    }
    html += `<div class="sa-modes">${Object.entries(MODE_INFO).map(([k, m]) => `<button class="sa-mode ${k}" data-mode="${k}" ${blocked || liveNow ? "disabled" : ""}>
      <span class="sa-mode-ic icon" aria-hidden="true">${m.icon}</span><b>${m.label}</b><small>${m.small}</small></button>`).join("")}</div>`;
    if (!polling) html = html.replace('<div class="sa-modes">', '<div class="sa-modes" hidden>');
    const promises = info.promises || [];
    html += `<div class="sa-tools">
      <button data-sa="soft" ${off ? "disabled" : ""}><span class="icon" aria-hidden="true">spa</span>Say it softly</button>
      <button data-sa="promises"><span class="icon" aria-hidden="true">task_alt</span>Promises${promises.length ? ` <i>${promises.length}</i>` : ""}</button>
      <button data-diary><span class="icon" aria-hidden="true">auto_stories</span>Our diary</button>
      <button data-sa="history"><span class="icon" aria-hidden="true">history</span>Past faislas</button>
      <button data-sa="about"><span class="icon" aria-hidden="true">badge</span>About us</button></div>`;
    return html;
  }

  function faislaView() {
    const open = (S.info.cases || []).find((c) => c.status !== "done");
    if (!open) {
      return `<div class="sa-intro"><span class="icon" aria-hidden="true">balance</span><p>Had a fight? Open a Faisla. Each of you writes your side,
        then ${esc(aiName())} hears you both on the call and gives a fair verdict with a small peace deal.</p></div>
        <label class="sa-label" for="sa-topic">What is it about?</label>
        <input id="sa-topic" class="field" maxlength="140" placeholder="e.g. Late reply last night">
        <button class="btn primary sa-wide" data-sa="new-case"><span class="icon" aria-hidden="true">gavel</span>Open Faisla</button>`;
    }
    const mine = open.sidesIn.includes(myName());
    const others = people().filter((n) => n !== myName());
    return `<div class="sa-case-head"><span class="icon" aria-hidden="true">gavel</span><div><b>${esc(open.topic)}</b><small>Opened by ${esc(open.by || "")}</small></div></div>
      <div class="sa-steps">
        <div class="sa-step ${mine ? "done" : "now"}"><i>1</i><div><b>Write your side, privately</b>
          <small>Only ${esc(aiName())} reads it. ${esc(others.join(" and ") || "Your partner")} sees it after the verdict.</small></div></div>
        <div class="sa-step ${mine ? "now" : ""}"><i>2</i><div><b>The hearing</b><small>${esc(aiName())} joins the call, each of you gets 2 minutes to talk.</small></div></div>
        <div class="sa-step"><i>3</i><div><b>Verdict and peace deal</b><small>Who was right on what, and what each of you does next.</small></div></div>
      </div>
      <label class="sa-label" for="sa-side">Your side${mine ? " (saved, you can still change it)" : ""}</label>
      <div class="sa-side-box"><textarea id="sa-side" class="field" rows="5" maxlength="2500" placeholder="What happened, and how did it make you feel?"></textarea>
        ${("webkitSpeechRecognition" in window || "SpeechRecognition" in window) ? `<button class="icon-btn sa-dictate" data-sa="dictate" aria-label="Speak instead of typing"><span class="icon" aria-hidden="true">mic</span></button>` : ""}</div>
      <div class="sa-who">${people().map((n) => `<span class="${open.sidesIn.includes(n) ? "ok" : ""}"><span class="icon" aria-hidden="true">${open.sidesIn.includes(n) ? "check_circle" : "edit_note"}</span>${esc(n)}</span>`).join("")}</div>
      <div class="sa-row">
        <button class="btn outline" data-sa="save-side">Save my side</button>
        <button class="btn primary" data-sa="hearing" ${S.live || S.remote || !polling ? "disabled" : ""}><span class="icon" aria-hidden="true">record_voice_over</span>Start the hearing</button>
      </div>
      <button class="sa-drop" data-drop="${open.id}"><span class="icon" aria-hidden="true">delete</span>Delete this Faisla</button>`;
  }

  function softView() {
    return `<p class="muted sa-p">Write what you want to say, even if it's angry. ${esc(aiName())} keeps your meaning but makes it kind.</p>
      <textarea id="sa-soft-in" class="field" rows="4" maxlength="800" placeholder="Type it the way you feel it…"></textarea>
      <button class="btn primary sa-wide" data-sa="soften"><span class="icon" aria-hidden="true">spa</span>Make it softer</button>
      <div id="sa-soft-out"></div>`;
  }

  function aboutView() {
    const a = S.info.about || {};
    const field = (k, label, ph) => `<label class="sa-label" for="sa-${k}">${label}</label><textarea id="sa-${k}" class="field" rows="3" maxlength="1500" placeholder="${ph}">${esc(a[k] || "")}</textarea>`;
    return `<p class="muted sa-p">${esc(aiName())} reads this before every conversation. Both of you can edit it.</p>
      <div class="sa-grid2"><div><label class="sa-label" for="sa-aiName">Saathi's name</label><input id="sa-aiName" class="field" maxlength="24" value="${esc(a.aiName || "Saathi")}"></div>
      <div><label class="sa-label" for="sa-voice">Voice</label><select id="sa-voice" class="field">${(S.info.voices || []).map((v) => `<option ${v === a.voice ? "selected" : ""}>${v}</option>`).join("")}</select></div></div>
      ${field("story", "Your story", "When and how you met, how long together, long-distance since…")}
      ${field("likes", "What each of you likes", "Food, songs, movies, dreams, love languages…")}
      ${field("jokes", "Inside jokes and pet names", "Nicknames, running jokes, special words…")}
      ${field("careful", "Be careful about", "Sensitive topics, things that hurt, things to never joke about…")}
      <button class="btn primary sa-wide" data-sa="save-about">Save</button>
      <p class="muted sa-small">${S.info.notes || 0} notes remembered. To wipe everything, use Admin → Settings.</p>`;
  }

  function historyView() {
    const cases = (S.info.cases || []).filter((c) => c.status === "done").reverse();
    if (!cases.length) return `<div class="sa-empty"><span class="icon" aria-hidden="true">balance</span><p>No faislas yet. Hopefully it stays that way.</p></div>`;
    return cases.map((c) => `<button class="sa-hist" data-case="${c.id}"><span class="icon" aria-hidden="true">gavel</span>
      <span><b>${esc(c.verdict?.title || c.topic)}</b><small>${new Date(c.at * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${esc(c.topic)}</small></span>
      <span class="icon" aria-hidden="true">chevron_right</span></button>`).join("");
  }

  function promisesView() {
    const list = S.info.promises || [];
    if (!list.length) return `<div class="sa-empty"><span class="icon" aria-hidden="true">task_alt</span><p>When you promise something during a ${esc(aiName())} conversation, it shows up here.</p></div>`;
    return list.map((p) => `<div class="sa-promise"><span class="sa-pav">${esc((p.who || "?")[0])}</span><div><b>${esc(p.what)}</b><small>${esc(p.who)}${p.when ? ` · ${esc(p.when)}` : ""}</small></div>
      <button class="btn small-btn outline" data-done="${p.id}">Done</button></div>`).join("");
  }

  panel.addEventListener("click", async (event) => {
    const t = event.target;
    const go = t.closest("[data-sa]")?.dataset.sa;
    const mode = t.closest("[data-mode]")?.dataset.mode;
    try {
      if (["home", "faisla", "soft", "about", "history", "promises"].includes(go)) { S.view = go; return paint(); }
      if (go === "agree") { S.info.consent = (await api("consent", { ok: true })).consent; tell({ act: "refresh" }); return paint(); }
      if (go === "end") return S.live ? endVoice("ended") : tell({ act: "end" });
      if (mode) return mode === "faisla" ? (S.view = "faisla", paint()) : startVoice(mode);
      if (go === "new-case") {
        const topic = q("#sa-topic", panel).value.trim();
        if (!topic) return q("#sa-topic", panel).focus();
        await api("case", { topic });
        await refresh();
        tell({ act: "case", topic });
        return;
      }
      if (go === "save-side" || go === "hearing") {
        const open = (S.info.cases || []).find((c) => c.status !== "done");
        const text = q("#sa-side", panel)?.value.trim();
        if (text) { await api("side", { id: open.id, text }); tell({ act: "refresh" }); }
        if (go === "save-side") { toast(text ? "Your side is saved" : "Write something first"); return refresh(); }
        await refresh();
        const fresh = (S.info.cases || []).find((c) => c.id === open.id);
        const missing = people().filter((n) => !fresh?.sidesIn.includes(n));
        if (missing.length && !(await window.DU.kit.confirmBox({ title: "Start without every side?", text: `${missing.join(" and ")} hasn't written a side yet. ${aiName()} can still hear it live.`, ok: "Start anyway", cancel: "Wait" }))) return;
        return startVoice("faisla", open.id);
      }
      if (go === "dictate") return dictate();
      const drop = t.closest("[data-drop]");
      if (drop) {
        if (!(await window.DU.kit.confirmBox({ title: "Delete this Faisla?", text: "It's removed for both of you, with any sides written so far.", ok: "Delete", cancel: "Keep" }))) return;
        await api("drop", { id: drop.dataset.drop });
        tell({ act: "refresh" });
        toast("Faisla deleted");
        S.view = "home";
        return refresh();
      }
      if (go === "soften") return soften();
      if (go === "save-about") {
        const about = {};
        for (const k of ["aiName", "voice", "story", "likes", "jokes", "careful"]) about[k] = q(`#sa-${k}`, panel).value;
        S.info.about = (await api("about", { about })).about;
        tell({ act: "refresh" });
        toast("Saved");
        S.view = "home";
        return paint();
      }
      if (go === "use-soft") {
        const text = q("#sa-soft-out .sa-soft-text", panel)?.textContent || "";
        const input = q("#chat-input");
        if (input) { input.value = text; closeModal(panel); q("[data-action=chat]")?.click(); setTimeout(() => input.focus(), 300); }
        return;
      }
      if (go === "copy-soft") { await navigator.clipboard?.writeText(q("#sa-soft-out .sa-soft-text", panel)?.textContent || ""); return toast("Copied"); }
      const follow = t.closest("[data-follow]");
      if (follow) { await api("follow", { id: follow.dataset.follow, kept: follow.dataset.kept === "1" }); toast(follow.dataset.kept === "1" ? "Proud of you 💛" : "There's still time"); return refresh(); }
      const done = t.closest("[data-done]");
      if (done) { await api("promise", { id: done.dataset.done, done: true }); toast("Promise kept ✓"); return refresh(); }
      const hist = t.closest("[data-case]");
      if (hist) { const c = (S.info.cases || []).find((x) => x.id === hist.dataset.case); if (c) showVerdict(c); }
    } catch (error) {
      toast(error.message);
    }
  });

  async function soften() {
    const text = q("#sa-soft-in", panel).value.trim();
    if (!text) return;
    const out = q("#sa-soft-out", panel);
    out.innerHTML = `<div class="sa-thinking"><span class="sa-orb mini live"><i></i></span>Finding kinder words…</div>`;
    try {
      const r = await api("soften", { text });
      out.innerHTML = `<div class="sa-soft-card"><p class="sa-soft-text">${esc(r.soft || "")}</p>${r.tip ? `<small>${esc(r.tip)}</small>` : ""}
        <div class="sa-row"><button class="btn outline" data-sa="copy-soft"><span class="icon" aria-hidden="true">content_copy</span>Copy</button>
        ${polling ? `<button class="btn primary" data-sa="use-soft"><span class="icon" aria-hidden="true">send</span>Put in chat</button>` : ""}</div></div>`;
    } catch (error) {
      out.innerHTML = `<p class="sa-err">${esc(error.message)}</p>`;
    }
  }

  let dictation = null;
  function dictate() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const box = q("#sa-side", panel);
    const button = q(".sa-dictate", panel);
    if (dictation) { dictation.stop(); return; }
    dictation = new Rec();
    dictation.lang = "hi-IN";
    dictation.interimResults = true;
    dictation.continuous = true;
    const start = box.value ? `${box.value.trim()} ` : "";
    dictation.onresult = (event) => {
      box.value = start + [...event.results].map((r) => r[0].transcript).join(" ");
    };
    dictation.onend = () => { dictation = null; button?.classList.remove("on"); };
    button?.classList.add("on");
    dictation.start();
  }

  // ---------- the live voice session (host) ----------

  const WORKLET = `class Cap extends AudioWorkletProcessor {
    constructor() { super(); this.ratio = sampleRate / 16000; this.buf = []; this.pos = 0; this.acc = 0; this.n = 0; this.sq = 0; }
    process(inputs) {
      const ch = inputs[0] && inputs[0][0];
      if (ch) for (let i = 0; i < ch.length; i++) {
        this.acc += ch[i]; this.n++; this.sq += ch[i] * ch[i];
        this.pos += 1;
        if (this.pos >= this.ratio) { this.pos -= this.ratio; this.buf.push(this.acc / this.n); this.acc = 0; this.n = 0; }
      }
      if (this.buf.length >= 1600) {
        const out = new Int16Array(this.buf.length);
        for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, this.buf[i])) * 0x7fff;
        const rms = Math.sqrt(this.sq / (out.length * this.ratio));
        this.port.postMessage({ pcm: out.buffer, rms }, [out.buffer]);
        this.buf = []; this.sq = 0;
      }
      return true;
    }
  }
  registerProcessor("du-cap", Cap);`;

  const b64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };

  async function startVoice(mode, caseId = null) {
    if (S.live || S.remote) return toast(`${aiName()} is already in the call`);
    if (!polling) return toast(`Join the call first, then call ${aiName()}`);
    if (needsConsent().length) { S.view = "home"; return paint(); }
    closeModal(panel);
    toast(`Calling ${aiName()}…`);
    let t;
    try {
      t = await api("token", { mode, case: caseId });
    } catch (error) {
      return toast(error.message);
    }
    const live = {
      mode, caseId, ws: null, ctx: null, cap: null, sources: new Map(), playing: new Set(), nextTime: 0,
      quietUntil: 0, lines: [], aiLine: "", themLine: "", loud: 0, lastCool: 0, wantVerdict: false, ready: false,
      aiName: t.aiName, timer: null,
    };
    S.live = live;
    try {
      live.ctx = new (window.AudioContext || window.webkitAudioContext)();
      await Promise.race([live.ctx.resume(), new Promise((r) => setTimeout(r, 1500))]);
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      await live.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      live.cap = new AudioWorkletNode(live.ctx, "du-cap");
      const sink = live.ctx.createGain();
      sink.gain.value = 0;
      live.cap.connect(sink).connect(live.ctx.destination);
      live.cap.port.onmessage = (event) => onChunk(live, event.data);
      // Saathi's voice: to my speakers and into my outgoing mic
      live.out = live.ctx.createGain();
      live.out.connect(live.ctx.destination);
      live.mix = live.ctx.createMediaStreamDestination();
      live.out.connect(live.mix);
      const base = prevOutTrack(SLOT.audio) || micTrack();
      if (base) { live.micMix = live.ctx.createMediaStreamSource(new MediaStream([base])); live.micMix.connect(live.mix); }
      S.mixTrack = live.mix.stream.getAudioTracks()[0];
      setOutgoing(SLOT.audio, localTrack(SLOT.audio));
      wireInputs(live);
      live.inputTimer = setInterval(() => wireInputs(live), 2000);
    } catch (error) {
      console.warn(error);
      S.live = null;
      cleanupAudio(live);
      return toast("This browser can't run Saathi's audio");
    }

    connectLive(live, t, true);
    showOrb({ mode, aiName: t.aiName, host: me.id });
    tell({ act: "live", on: true, mode, aiName: t.aiName, host: me.id, caseId });
  }


  // Open the Gemini Live socket. With tools first; if Gemini refuses that setup before the
  // session starts, get a fresh one-use token and connect again without tools.
  function connectLive(live, t, withTools) {
    const decls = withTools ? toolDecls() : [];
    live.ws = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(t.token)}`);
    live.ws.onopen = () => live.ws.send(JSON.stringify({
      setup: {
        model: `models/${t.model}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: t.voice } } },
        },
        systemInstruction: { parts: [{ text: t.system + (decls.length ? TOOL_HINT() : "") }] },
        ...(decls.length ? { tools: [{ functionDeclarations: decls }] } : {}),
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
        realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 900, prefixPaddingMs: 300 } },
      },
    }));
    live.ws.onmessage = async (event) => {
      const raw = typeof event.data === "string" ? event.data : await event.data.text();
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      onServer(live, msg);
    };
    live.ws.onerror = () => { if (!live.ready && !decls.length) toast(`Couldn't reach ${aiName()}`); };
    live.ws.onclose = async (event) => {
      if (S.live !== live) return;
      if (!live.ready && event.reason) console.warn("Gemini closed:", event.code, event.reason);
      if (!live.ready && decls.length) {
        try { const t2 = await api("token", { mode: live.mode, case: live.caseId }); if (S.live === live) return connectLive(live, t2, false); } catch { /* fall through */ }
      }
      endVoice(live.ready ? "dropped" : "failed");
    };
  }

  const prevOutTrack = (slot) => prev.out?.(slot) ?? null;

  function wireInputs(live) {
    const want = new Map();
    const mic = micTrack();
    if (mic) want.set(mic.id, mic);
    for (const peer of peers.values()) {
      const track = peer.audio?.srcObject?.getAudioTracks?.()[0];
      if (track) want.set(track.id, track);
    }
    for (const [id, node] of live.sources) {
      if (!want.has(id)) { node.disconnect(); live.sources.delete(id); }
    }
    for (const [id, track] of want) {
      if (live.sources.has(id)) continue;
      try {
        const node = live.ctx.createMediaStreamSource(new MediaStream([track]));
        node.connect(live.cap);
        live.sources.set(id, node);
      } catch { /* track not ready yet */ }
    }
  }

  function onChunk(live, { pcm, rms }) {
    if (!live.ready || live.ws?.readyState !== 1) return;
    const now = performance.now();
    // While Saathi talks, don't send what the speakers play back to it (no echo loop).
    if (now < live.quietUntil) return;
    live.ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64(pcm), mimeType: "audio/pcm;rate=16000" } } }));
    // cool-down: voices loud for ~4 s → Saathi steps in gently (at most every 90 s)
    live.loud = rms > 0.16 ? live.loud + 1 : Math.max(0, live.loud - 2);
    if (live.loud >= 40 && now - live.lastCool > 90000) {
      live.lastCool = now;
      live.loud = 0;
      say(live, "(App: Their voices are getting loud and heated. Step in gently in one or two sentences: help them pause, breathe, and talk calmly. Don't take sides.)");
      tell({ act: "cool" });
      coolFlash();
    }
  }

  function say(live, text) {
    if (live.ws?.readyState === 1) live.ws.send(JSON.stringify({ realtimeInput: { text } }));
  }


  // ---------- things Saathi can do in the app when asked out loud ----------
  // Modules add tools to window.DU.saathiTools: { name, description, parameters, run(args) → result }.
  const toolList = () => (window.DU.saathiTools || []).filter((t) => t && t.name && typeof t.run === "function");
  const toolDecls = () => toolList().map(({ name, description, parameters }) => (parameters ? { name, description, parameters } : { name, description }));
  const TOOL_HINT = () => (toolList().length
    ? "\n\nYou are inside their video-call app and can use it for them with your tools: their shared task lists "
      + "(add, tick off, remove, read out), opening games and tools, power naps, calm sounds and the story game. "
      + "When they ask for one of these, call the tool straight away, then confirm in a few words. When a task "
      + "list question comes up, read it with the tool first. Only use tools when they ask."
    : "");
  async function runTools(live, calls) {
    const responses = [];
    for (const call of calls) {
      const tool = toolList().find((t) => t.name === call.name);
      let result;
      try { result = tool ? await tool.run(call.args || {}, call) : { error: "No such tool" }; } catch (error) { result = { error: error.message || "Failed" }; }
      responses.push({ id: call.id, name: call.name, response: typeof result === "object" && result ? result : { result: String(result ?? "done") } });
    }
    if (live.ws?.readyState === 1) live.ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
  }

  function onServer(live, msg) {
    if (msg.setupComplete) {
      live.ready = true;
      setOrb({ status: "listening" });
      const others = people().filter((n) => n !== me.name).join(" and ") || "nobody else yet";
      say(live, KICKOFF[live.mode](others));
      return;
    }
    if (msg.toolCall) { runTools(live, msg.toolCall.functionCalls || []); return; }
    if (msg.goAway) return; // the session ends soon; onclose wraps up
    const sc = msg.serverContent;
    if (!sc) return;
    for (const part of sc.modelTurn?.parts || []) {
      if (part.inlineData?.data) play(live, part.inlineData.data);
    }
    if (sc.inputTranscription?.text) {
      if (live.aiLine) { live.lines.push({ who: "ai", text: live.aiLine.trim() }); live.aiLine = ""; }
      live.themLine += sc.inputTranscription.text;
    }
    if (sc.outputTranscription?.text) {
      if (live.themLine) { live.lines.push({ who: "them", text: live.themLine.trim() }); live.themLine = ""; }
      live.aiLine += sc.outputTranscription.text;
      setOrb({ cap: lastSentence(live.aiLine) });
    }
    if (sc.interrupted) stopPlayback(live);
    if (sc.turnComplete) {
      if (live.aiLine) { live.lines.push({ who: "ai", text: live.aiLine.trim() }); live.aiLine = ""; }
      if (live.wantVerdict === "asked") {
        live.wantVerdict = "spoken";
        setTimeout(() => makeVerdict(live), 1200);
      }
    }
  }

  const lastSentence = (text) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= 150) return clean;
    const cut = clean.slice(-150);
    const at = cut.search(/[.!?।]\s/);
    return at >= 0 && at < 110 ? cut.slice(at + 2) : `…${cut.slice(cut.indexOf(" ") + 1)}`;
  };

  function play(live, data) {
    const bin = atob(data);
    const count = bin.length >> 1;
    const buffer = live.ctx.createBuffer(1, count, 24000);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < count; i++) {
      let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
      if (v >= 0x8000) v -= 0x10000;
      ch[i] = v / 32768;
    }
    const src = live.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(live.out);
    const now = live.ctx.currentTime;
    live.nextTime = Math.max(live.nextTime, now + 0.06);
    src.start(live.nextTime);
    live.nextTime += buffer.duration;
    live.playing.add(src);
    src.onended = () => {
      live.playing.delete(src);
      if (!live.playing.size) setOrb({ speaking: false });
    };
    live.quietUntil = performance.now() + (live.nextTime - now) * 1000 + 450;
    setOrb({ speaking: true });
  }

  function stopPlayback(live) {
    for (const src of live.playing) { try { src.stop(); } catch { /* already done */ } }
    live.playing.clear();
    live.nextTime = 0;
    live.quietUntil = 0;
    setOrb({ speaking: false });
  }

  function transcript(live) {
    const lines = [...live.lines];
    if (live.themLine) lines.push({ who: "them", text: live.themLine.trim() });
    if (live.aiLine) lines.push({ who: "ai", text: live.aiLine.trim() });
    return lines.map((l) => `${l.who === "ai" ? live.aiName : people().join("/")}: ${l.text}`).join("\n");
  }

  function cleanupAudio(live) {
    clearInterval(live.inputTimer);
    for (const node of live.sources.values()) node.disconnect();
    live.sources.clear();
    try { live.ctx?.close(); } catch { /* closed */ }
    if (S.mixTrack) {
      S.mixTrack.stop();
      S.mixTrack = null;
      setOutgoing(SLOT.audio, localTrack(SLOT.audio));
    }
  }

  async function endVoice(reason) {
    const live = S.live;
    if (!live) return;
    S.live = null;
    clearInterval(live.seeTimer);
    S.seeing = false;
    stopTurn();
    try { live.ws?.close(); } catch { /* closed */ }
    stopPlayback(live);
    cleanupAudio(live);
    hideOrb();
    tell({ act: "live", on: false });
    if (reason === "failed") toast(`${aiName()} couldn't connect. Try again in a moment`);
    else if (reason === "dropped") toast(`${aiName()} left the call (time limit). Call again any time`);
    paint();
    const text = transcript(live);
    if (live.mode === "faisla" && live.wantVerdict && live.wantVerdict !== "done") await makeVerdict(live, text);
    try {
      const r = await api("remember", { transcript: text, mode: live.mode });
      if (r.promises?.length) {
        toast(`${aiName()} noted ${r.promises.length === 1 ? "a promise" : `${r.promises.length} promises`}`);
        tell({ act: "refresh" });
      }
    } catch { /* nothing to remember, or offline */ }
    refresh();
  }

  async function makeVerdict(live, text = transcript(live)) {
    if (live.wantVerdict === "done" || live.wantVerdict === "making") return;
    live.wantVerdict = "making";
    setOrb({ status: "writing the verdict…" });
    try {
      const { case: c } = await api("verdict", { id: live.caseId, transcript: text });
      live.wantVerdict = "done";
      showVerdict(c);
      tell({ act: "verdict", id: c.id });
      refresh();
    } catch (error) {
      live.wantVerdict = "spoken";
      toast(`Verdict card: ${error.message}`);
    }
    setOrb({ status: "listening" });
  }

  // ---------- "Let Saathi see": a small picture of the call every 1.5 s ----------

  function toggleSee(by = myName()) {
    const live = S.live;
    if (!live) return;
    S.seeing = !S.seeing;
    clearInterval(live.seeTimer);
    if (S.seeing) {
      say(live, `(App: ${by} turned on the cameras for you. From now on you get a picture of the call every couple of seconds; each person's name is written on their part of the picture. Say one short, fun line about what you see, then carry on.)`);
      sendFrame(live);
      live.seeTimer = setInterval(() => sendFrame(live), 1500);
      toast(`${aiName()} can see the call now`);
    } else {
      say(live, "(App: The cameras are off for you now; you can't see them any more.)");
      toast(`${aiName()} can't see any more`);
    }
    setOrb({});
  }

  const frameCanvas = document.createElement("canvas");
  function sendFrame(live) {
    if (!S.seeing || live.ws?.readyState !== 1 || !live.ready) return;
    const tiles = [...document.querySelectorAll(".stage .tile")].filter((t) => {
      const v = t.querySelector("video");
      return t.offsetParent && v?.videoWidth && v.readyState >= 2;
    }).slice(0, 3);
    if (!tiles.length) return;
    const W = 768, H = 432, n = tiles.length, w = W / n;
    frameCanvas.width = W; frameCanvas.height = H;
    const ctx = frameCanvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    tiles.forEach((tile, i) => {
      const v = tile.querySelector("video");
      const screen = tile.classList.contains("screen");
      const scale = (screen ? Math.min : Math.max)(w / v.videoWidth, H / v.videoHeight);
      const vw = v.videoWidth * scale, vh = v.videoHeight * scale;
      ctx.save();
      ctx.beginPath(); ctx.rect(i * w, 0, w, H); ctx.clip();
      ctx.drawImage(v, i * w + (w - vw) / 2, (H - vh) / 2, vw, vh);
      ctx.restore();
      let name = tile.querySelector(".tile-name .name")?.textContent?.trim() || "";
      if (name === "You") name = myName();
      if (name === "You are presenting") name = `${myName()}'s screen`;
      ctx.font = "600 20px sans-serif";
      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.fillRect(i * w + 8, H - 38, ctx.measureText(name).width + 16, 30);
      ctx.fillStyle = "#fff";
      ctx.fillText(name, i * w + 16, H - 16);
    });
    const data = frameCanvas.toDataURL("image/jpeg", 0.6).split(",")[1];
    live.ws.send(JSON.stringify({ realtimeInput: { video: { data, mimeType: "image/jpeg" } } }));
  }

  // ---------- Faisla turns ----------

  function giveTurn(who) {
    if (!S.live) return tell({ act: "turn", who });
    S.turn = { who, ends: Date.now() + TURN_SECONDS * 1000 };
    say(S.live, who === "verdict" ? "(App: Give your verdict now.)" : `(App: It is now ${who}'s turn to explain their side. Let ${who} speak; don't interrupt.)`);
    if (who === "verdict") { S.live.wantVerdict = "asked"; S.turn = null; }
    paintTurn();
    tell({ act: "turnState", turn: S.turn });
    clearInterval(S.turnTimer);
    if (S.turn) S.turnTimer = setInterval(tickTurn, 500);
  }
  function tickTurn() {
    if (!S.turn) return clearInterval(S.turnTimer);
    if (Date.now() >= S.turn.ends) {
      const who = S.turn.who;
      S.turn = null;
      clearInterval(S.turnTimer);
      if (S.live) say(S.live, `(App: ${who}'s two minutes are up. Thank ${who} in one line and continue.)`);
      tell({ act: "turnState", turn: null });
    }
    paintTurn();
  }
  function stopTurn() { S.turn = null; clearInterval(S.turnTimer); paintTurn(); }

  // ---------- the orb in the call ----------

  let orb = null;
  function showOrb({ mode, aiName: name }) {
    hideOrb();
    orb = document.createElement("div");
    orb.className = "sa-card";
    orb.dataset.mode = mode;
    orb.innerHTML = `<div class="sa-card-top"><span class="sa-orb live" aria-hidden="true"><i></i></span>
      <div class="sa-card-txt"><b>${esc(name)}</b><small class="sa-status">connecting…</small></div>
      <button class="sa-card-btn see" data-orb="see" aria-label="Let ${esc(name)} see" title="Let ${esc(name)} see through the cameras"><span class="icon" aria-hidden="true">visibility_off</span></button>
      <button class="sa-card-btn" data-orb="open" aria-label="Open ${esc(name)}"><span class="icon" aria-hidden="true">tune</span></button>
      <button class="sa-card-btn end" data-orb="end" aria-label="Send ${esc(name)} away"><span class="icon" aria-hidden="true">call_end</span></button></div>
      <p class="sa-cap" aria-live="polite"></p>
      ${mode === "faisla" ? `<div class="sa-turns">${people().map((n) => `<button data-turn="${esc(n)}">${esc(n)}'s turn</button>`).join("")}<button data-turn="verdict" class="v"><span class="icon" aria-hidden="true">gavel</span>Verdict</button></div><div class="sa-turn-bar"><i></i><span></span></div>` : ""}`;
    document.body.append(orb);
    // it always opens at the top, centred, with the same shape; it can be moved, and on a
    // computer its width can be changed by dragging the left or right edge
    const wide = matchMedia("(pointer: fine)").matches && innerWidth >= 720;
    window.DU.win?.make(orb, {
      grip: false, edges: wide ? "ew" : false, pinch: false, autoH: true, minW: 300, minH: 76,
      def: () => {
        const w = Math.min(wide ? 400 : 420, innerWidth - 24);
        const tile = document.querySelector("#grid .tile")?.getBoundingClientRect();
        const y = wide ? 14 : Math.max(12, Math.round((tile?.top ?? 0) + 58));
        return { x: Math.round((innerWidth - w) / 2), y, w, h: null };
      },
    });
    orb.addEventListener("click", (event) => {
      const action = event.target.closest("[data-orb]")?.dataset.orb;
      const turn = event.target.closest("[data-turn]")?.dataset.turn;
      if (action === "end") S.live ? endVoice("ended") : tell({ act: "end" });
      if (action === "open") open("home");
      if (action === "see") S.live ? toggleSee() : tell({ act: "see" });
      if (turn) giveTurn(turn);
    });
  }
  function hideOrb() { orb?.remove(); orb = null; S.cap = ""; S.speaking = false; S.seeing = false; }

  let lastSent = 0;
  let pendingSend = null;
  function setOrb(change) {
    if (change.cap !== undefined) S.cap = change.cap;
    if (change.speaking !== undefined) S.speaking = change.speaking;
    if (change.status !== undefined) S.status = change.status;
    paintOrb();
    if (!S.live) return;
    // tell the partner, at most ~4 times a second
    const push = () => { lastSent = Date.now(); pendingSend = null; fast("ai", { act: "st", cap: S.cap, speaking: S.speaking, status: S.status, seeing: S.seeing }); };
    if (Date.now() - lastSent > 250) push();
    else if (!pendingSend) pendingSend = setTimeout(push, 260);
  }
  function paintOrb() {
    if (!orb) return;
    orb.classList.toggle("speaking", S.speaking);
    q(".sa-status", orb).textContent = `${S.speaking ? "speaking" : (S.status || "listening")}${S.seeing ? " · can see you" : ""}`;
    const see = q("[data-orb=see]", orb);
    see.classList.toggle("on", S.seeing);
    q(".icon", see).textContent = S.seeing ? "visibility" : "visibility_off";
    const cap = q(".sa-cap", orb);
    cap.textContent = S.cap;
    cap.hidden = !S.cap;
    cap.scrollTop = cap.scrollHeight; // always show the newest words
    cap.classList.toggle("more", cap.scrollHeight > cap.clientHeight + 2);
  }
  function paintTurn() {
    if (!orb) return;
    const bar = q(".sa-turn-bar", orb);
    if (!bar) return;
    for (const b of orb.querySelectorAll("[data-turn]")) b.classList.toggle("on", S.turn?.who === b.dataset.turn);
    bar.hidden = !S.turn;
    if (!S.turn) return;
    const left = Math.max(0, Math.ceil((S.turn.ends - Date.now()) / 1000));
    q("i", bar).style.width = `${(left / TURN_SECONDS) * 100}%`;
    q("span", bar).textContent = `${S.turn.who} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  }
  setInterval(() => { if (S.turn && !S.live) paintTurn(); }, 500);

  function coolFlash() {
    const el = document.createElement("div");
    el.className = "sa-cool";
    el.innerHTML = `<span class="icon" aria-hidden="true">air</span>Breathe. Slow down. You're on the same team.`;
    (q(".main-area") || document.body).append(el);
    setTimeout(() => el.remove(), 5200);
  }

  // ---------- verdict card ----------

  const vModal = document.createElement("div");
  vModal.className = "modal";
  vModal.id = "m-verdict";
  vModal.hidden = true;
  document.body.append(vModal);
  vModal.addEventListener("click", async (event) => {
    if (event.target.closest("[data-v-close]")) closeModal(vModal);
    const drop = event.target.closest("[data-v-drop]");
    if (!drop) return;
    if (!(await window.DU.kit.confirmBox({ title: "Delete this Faisla?", text: "The verdict and both sides are removed for good.", ok: "Delete", cancel: "Keep" }))) return;
    try {
      await api("drop", { id: drop.dataset.vDrop });
      closeModal(vModal);
      tell({ act: "refresh" });
      toast("Faisla deleted");
      refresh();
    } catch (error) { toast(error.message); }
  });

  function showVerdict(c) {
    const v = c.verdict;
    if (!v) return;
    const names = Object.keys((v.points?.[0] || {}).share || {});
    const colors = ["#0a84ff", "#ff375f", "#30d158", "#ff9f0a"];
    const sideText = c.sides && Object.keys(c.sides).length ? `<details class="vd-sides"><summary>What each of you wrote</summary>${Object.entries(c.sides).map(([n, t]) => `<p><b>${esc(n)}:</b> ${esc(t)}</p>`).join("")}</details>` : "";
    vModal.innerHTML = `<div class="sheet vd-sheet" role="dialog" aria-modal="true" aria-label="Verdict">
      <header class="sheet-head"><span class="vd-badge"><span class="icon" aria-hidden="true">gavel</span>Faisla</span>
        <button class="icon-btn" data-v-close aria-label="Close"><span class="icon" aria-hidden="true">close</span></button></header>
      <div class="sheet-body vd-body">
        <h3>${esc(v.title || c.topic)}</h3>
        <p class="vd-sum">${esc(v.summary || "")}</p>
        <div class="vd-legend">${names.map((n, i) => `<span><i style="background:${colors[i % 4]}"></i>${esc(n)}</span>`).join("")}</div>
        ${(v.points || []).map((p) => `<div class="vd-point"><b>${esc(p.point || "")}</b>
          <div class="vd-bar">${names.map((n, i) => { const pct = Math.max(0, Math.min(100, Number(p.share?.[n]) || 0)); return `<i style="width:${pct}%;background:${colors[i % 4]}" title="${esc(n)} ${pct}%">${pct >= 14 ? `${pct}%` : ""}</i>`; }).join("")}</div>
          <small>${esc(p.why || "")}</small></div>`).join("")}
        <h4>Peace deal</h4>
        <div class="vd-deal">${Object.entries(v.deal || {}).map(([n, list]) => `<div><b>${esc(n)}</b><ul>${[].concat(list).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`).join("")}</div>
        ${v.warm ? `<p class="vd-warm">${esc(v.warm)}</p>` : ""}
        ${sideText}
        <p class="muted sa-small">${esc(aiName())} will ask both of you in 3 days if you kept your part.</p>
        <button class="btn primary sa-wide" data-v-close>We'll do it 🤝</button>
        <button class="sa-drop" data-v-drop="${c.id}"><span class="icon" aria-hidden="true">delete</span>Delete this Faisla</button>
      </div></div>`;
    openModal(vModal);
  }

  // ---------- messages from the partner ----------

  function onAi(d, peer) {
    switch (d.act) {
      case "live":
        if (d.on) {
          S.remote = { host: peer.id, mode: d.mode, aiName: d.aiName, caseId: d.caseId };
          showOrb({ mode: d.mode, aiName: d.aiName });
          toast(`${peer.name} called ${d.aiName} into the call`);
        } else if (S.remote) {
          S.remote = null;
          hideOrb();
          stopTurn();
        }
        paint();
        break;
      case "st":
        if (!S.remote) break;
        S.cap = String(d.cap || "");
        S.speaking = Boolean(d.speaking);
        S.status = d.status || "listening";
        S.seeing = Boolean(d.seeing);
        paintOrb();
        break;
      case "end": if (S.live) endVoice("ended"); break;
      case "turn": if (S.live) giveTurn(String(d.who)); break;
      case "see": if (S.live) toggleSee(peer.name); break;
      case "turnState": S.turn = d.turn || null; paintTurn(); break;
      case "cool": coolFlash(); break;
      case "case":
        toast(`${peer.name} opened a Faisla: ${d.topic}`);
        S.view = "faisla";
        open("faisla");
        break;
      case "verdict":
        refresh().then((info) => { const c = (info.cases || []).find((x) => x.id === d.id); if (c) showVerdict(c); });
        break;
      case "refresh": refresh(); break;
    }
  }

  // ---------- hooks ----------

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave, out: window.DU.outTrack, fast: window.DU.onFast };
  Object.assign(window.DU, {
    outTrack(slot) {
      if (slot === SLOT.audio && S.mixTrack) return S.mixTrack;
      return prev.out?.(slot) ?? null;
    },
    onCoupleClick(button) {
      if (button.dataset.tg === "saathi") open("home");
      else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "ai") return prev.msg?.(message, peer);
      onAi(message.data || {}, peer);
    },
    onFast(message, peer) {
      if (message.type === "ai") onAi(message.data || {}, peer);
      else prev.fast?.(message, peer);
    },
    onCoupleLeave(...args) {
      prev.leave?.(...args);
      if (S.live) endVoice("ended");
      S.remote = null;
      hideOrb();
      stopTurn();
    },
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-home=saathi]")) open("home");
  });

  // A partner who leaves while hosting takes Saathi with them.
  setInterval(() => {
    if (S.remote && !peers.has(S.remote.host)) { S.remote = null; hideOrb(); stopTurn(); paint(); }
  }, 3000);
})();
