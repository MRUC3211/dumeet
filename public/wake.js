// DU Meet · "Hey Lord": say it during a call and Hey Lord joins by herself, already knowing
// what you asked ("Hey Lord, open chess", "Hey Lord, add gym to my tasks"). It rides on
// the speech recogniser the call already uses for captions, on this phone only, and only
// while the mic is on and Hey Lord isn't already in the call. A "Hey Lord" visit ends by
// itself after ~30 s of quiet. Turn it on or off from Tools → More.

(() => {
  "use strict";
  const { q, store } = window.DU.kit;
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const saathi = () => window.DU.saathi;

  // On iPhone the recogniser can fight the call for the mic, so it starts off there.
  let on = store.get("du-wake", !iOS);
  let blocked = false;
  let armed = null;       // { cmd, timer, until } while we catch what follows "Hey Lord"
  let lastFire = 0;

  // "Hey Lord" / "My Lord" / "Hi Lord" (also how phones tend to mishear it, and in Hindi)
  const NAMES = ["lord", "lard", "laud", "lawd", "lourd", "lords", "लॉर्ड", "लार्ड", "लोर्ड", "लॉड"];
  const HEY = ["hey", "hi", "hay", "hai", "hello", "ok", "okay", "oye", "oy", "are", "arey", "arre", "he", "my", "mai", "mere", "हे", "है", "हाय", "हेलो", "ओके", "अरे", "ओए", "माय", "मेरे"];
  const ONE_WORD = ["heylord", "hilord", "mylord", "helord", "हेलॉर्ड", "मायलॉर्ड"];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function pattern() {
    // a renamed assistant is also heard by its own name ("Hey <name>")
    const custom = String(saathi()?.name?.() || "").trim().toLowerCase().replace(/^(hey|hi|my)\s+/, "");
    const names = [...new Set([...NAMES, ...(custom && custom !== "lord" ? [custom] : [])])];
    const pre = `(?:^|[\\s,.!?।])`, post = `(?=$|[\\s,.!?।])`;
    return new RegExp(`${pre}(?:(?:${HEY.map(esc).join("|")})[\\s,-]*(?:${names.map(esc).join("|")})|${ONE_WORD.map(esc).join("|")})${post}`, "i");
  }

  const wanted = () => Boolean(on && !blocked && window.DU.policy?.saathiOn !== false && Rec && polling && me.mic
    && (armed || !saathi()?.active()));
  window.DU.wakeWanted = wanted;

  window.DU.onHearBlocked = () => {
    if (!on || blocked) return;
    blocked = true;
    toast("Microphone speech is blocked here, so \"Hey Lord\" can't listen. Tap Hey Lord instead.");
    paint();
  };

  window.DU.onHeard = (text, final) => {
    if (!wanted()) return;
    const m = text.match(pattern());
    if (!armed) {
      if (!m || saathi()?.active() || Date.now() - lastFire < 4000) return;
      armed = { done: "", cur: "", timer: 0, cap: setTimeout(finish, 9000) };
      chime();
      showPill();
      // start connecting now; what follows is handed over before she says anything
      saathi()?.wake("").then((ok) => { if (!ok) disarm(); });
    }
    armed.cur = m ? text.slice(m.index + m[0].length).replace(/^[\s,.!?।]+/, "").trim() : text.trim();
    if (final) { armed.done = `${armed.done} ${armed.cur}`.trim(); armed.cur = ""; }
    const cmd = `${armed.done} ${armed.cur}`.trim();
    pillText(cmd);
    clearTimeout(armed.timer);
    // a pause ends the request; just "Hey Lord" waits a little longer for the rest
    armed.timer = setTimeout(finish, final ? (cmd ? 700 : 3000) : 1700);
  };

  function finish() {
    if (!armed) return;
    const cmd = `${armed.done} ${armed.cur}`.trim();
    lastFire = Date.now();
    saathi()?.ask?.(cmd);
    disarm();
  }
  function disarm() {
    if (armed) { clearTimeout(armed.timer); clearTimeout(armed.cap); }
    armed = null;
    setTimeout(hidePill, 900);
    setTimeout(() => typeof updateRecognition === "function" && updateRecognition(), 300);
  }

  // ---------- the little "Listening…" pill ----------
  let pill = null;
  function showPill() {
    pill?.remove();
    pill = document.createElement("div");
    pill.className = "wk-pill";
    pill.setAttribute("role", "status");
    pill.innerHTML = `<span class="sa-orb mini live" aria-hidden="true"><i></i></span><span class="wk-t"><b>${saathi()?.name?.() || "Hey Lord"}</b><small>Listening…</small></span>`;
    (document.querySelector("#meeting") || document.body).append(pill);
    requestAnimationFrame(() => pill?.classList.add("in"));
  }
  function pillText(t) {
    const s = pill && q(".wk-t small", pill);
    if (s) s.textContent = t ? `“${t.length > 60 ? `…${t.slice(-58)}` : t}”` : "Listening…";
  }
  function hidePill() {
    const p = pill;
    pill = null;
    if (!p) return;
    p.classList.remove("in");
    setTimeout(() => p.remove(), 260);
  }

  let actx = null;
  function chime() {
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      actx.resume?.();
      const t = actx.currentTime;
      [[880, 0], [1320, 0.09]].forEach(([f, d]) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0, t + d);
        g.gain.linearRampToValueAtTime(0.07, t + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.35);
        o.connect(g).connect(actx.destination);
        o.start(t + d); o.stop(t + d + 0.4);
      });
    } catch { /* no sound */ }
    try { navigator.vibrate?.(25); } catch { /* no vibration */ }
  }

  // ---------- on / off ----------
  function paint() {
    const b = q("#tg-tray [data-tg=wake]");
    const l = q("#tray-wake");
    b?.classList.toggle("on", on && !blocked && Boolean(Rec));
    if (l) l.textContent = !Rec ? "Not in this browser · use Chrome" : blocked ? "Blocked · allow the mic" : on ? "On · just say “Hey Lord”" : "Off · tap to turn on";
  }
  function toggle() {
    if (!Rec) return toast("This browser can't listen for \"Hey Lord\". Use Chrome, or tap Hey Lord.");
    on = !on;
    blocked = false;
    store.set("du-wake", on);
    paint();
    toast(on ? "Say “Hey Lord” anytime in a call" : "“Hey Lord” is off");
    if (typeof updateRecognition === "function") updateRecognition();
  }
  paint();

  // keep the recogniser in step with the call, the mic and Hey Lord coming and going
  let was = null;
  setInterval(() => {
    const w = wanted();
    if (w !== was) { was = w; if (typeof updateRecognition === "function") updateRecognition(); }
  }, 1500);

  const prev = { click: window.DU.onCoupleClick };
  window.DU.onCoupleClick = (button) => {
    if (button.dataset.tg === "wake") { window.DU.kit.toggleTray(false); toggle(); } else prev.click?.(button);
  };
  window.DU.wake = { toggle, get on() { return on; }, supported: Boolean(Rec) };
})();
