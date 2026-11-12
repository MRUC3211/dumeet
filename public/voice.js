// DU Meet · voice helpers shared by the tools.
//  - DU.voice.api(action, body): calls Hey Lord's text AI on the server (/api/ai/<action>).
//  - DU.voice.listen(): speech to text with the browser's own recogniser, where it has one.
//  - DU.voice.speak(text): reads text aloud on this phone.
//  - DU.saathiTools: things Hey Lord can do when you ask her out loud in a call (add a task,
//    start a power nap, open a game…). Modules add { name, description, parameters, run }.

(() => {
  "use strict";
  window.DU ||= {};
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const people = () => [me.name, ...[...peers.values()].map((p) => p.name)].filter(Boolean);

  async function api(action, body = {}) {
    const response = await fetch(`/api/ai/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: me.name || "", names: people(), ...body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || "Something went wrong");
    return data;
  }

  /**
   * listen({ onText, onEnd, lang }) → stop(). Text arrives as you speak (final = true at the end).
   * Returns null where the browser can't recognise speech (then ask Hey Lord instead).
   */
  function listen({ onText, onEnd, lang = "en-IN" } = {}) {
    if (!Rec) return null;
    let rec;
    try { rec = new Rec(); } catch { return null; }
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let text = "";
    rec.onresult = (e) => {
      let full = "";
      for (let i = 0; i < e.results.length; i++) full += e.results[i][0].transcript;
      text = full.trim();
      onText?.(text, e.results[e.results.length - 1].isFinal);
    };
    rec.onerror = (e) => { if (e.error === "not-allowed") toast("Allow the microphone to speak"); };
    rec.onend = () => onEnd?.(text);
    try { rec.start(); } catch { return null; }
    return () => { try { rec.stop(); } catch { /* stopped */ } };
  }

  function speak(text, { rate = 1, onEnd } = {}) {
    const s = window.speechSynthesis;
    if (!s || !text) { onEnd?.(); return false; }
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.lang = "en-IN";
    const voice = s.getVoices().find((v) => /en[-_]IN/i.test(v.lang)) || s.getVoices().find((v) => /^en/i.test(v.lang));
    if (voice) u.voice = voice;
    u.onend = () => onEnd?.();
    s.speak(u);
    return true;
  }
  const stopSpeaking = () => { try { window.speechSynthesis?.cancel(); } catch { /* none */ } };

  /** A mic button that fills a text box as you talk. Hidden where speech isn't supported. */
  function micButton(input, { onDone } = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vc-mic";
    b.setAttribute("aria-label", "Speak");
    b.innerHTML = `<span class="icon" aria-hidden="true">mic</span>`;
    if (!Rec) { b.hidden = true; return b; }
    let stop = null;
    b.addEventListener("click", () => {
      if (stop) { stop(); return; }
      const before = input.value ? `${input.value.trim()} ` : "";
      stop = listen({
        onText: (t) => { input.value = before + t; input.dispatchEvent(new Event("input", { bubbles: true })); },
        onEnd: (t) => { stop = null; b.classList.remove("on"); if (t) onDone?.(input.value.trim()); },
      });
      if (stop) b.classList.add("on"); else toast("Speech isn't available here. Ask Hey Lord instead.");
    });
    return b;
  }

  /** Find the item someone means: its number, the exact text, or the closest words. */
  function match(items, what, key = (x) => x.text) {
    const s = String(what || "").trim().toLowerCase();
    if (!s) return null;
    const n = Number(s);
    if (Number.isInteger(n) && n >= 1 && n <= items.length) return items[n - 1];
    const t = (x) => String(key(x) || "").toLowerCase();
    return items.find((x) => t(x) === s) || items.find((x) => t(x).includes(s)) || items.find((x) => t(x) && s.includes(t(x)))
      || items.find((x) => s.split(/\s+/).filter((w) => w.length > 2).some((w) => t(x).includes(w))) || null;
  }

  window.DU.voice = { api, listen, speak, stopSpeaking, micButton, match, canListen: Boolean(Rec) };
  window.DU.saathiTools ||= [];

  // ---------- general things Hey Lord can do: open a tool or game, power nap, calm sounds ----------
  const FEATURES = {
    chess: "Chess", ludo: "Ludo", snl: "Snakes & ladders", quiz: "Quiz battle", clash: "Colour clash card game", word: "Daily word game",
    maths: "Maths duel", memo: "Memory match", pictionary: "Pictionary", race: "Reaction race", ttt: "Tic-tac-toe", c4: "4 in a row",
    rps: "Rock paper scissors", wyr: "Would you rather", tod: "Truth or dare", wheel: "Spin to decide", zameen: "Zameen",
    filters: "Face filters", voicefx: "Voice changer", throw: "Throw things", nudge: "Nudge", celebrate: "Celebrate effects",
    booth: "Photo booth", secret: "Secret note", hold: "Hold hands", story: "Story time",
    sounds: "Calm sounds", breathe: "Breathe", guided: "Guided calm", nap: "Power nap", night: "Night light", sleep: "Sleep call",
    stretch: "Stretch break", eyes: "Eye rest", candle: "Candle-light dinner", stars: "Stargazing", likely: "Who's more likely",
    deep: "Deep talks", spicy: "Spicy talks", never: "Never have I ever", dare: "Truth or dare after dark",
    tasks: "Today's tasks", habits: "Habits", planday: "Plan my day", study: "Study together", watch: "Watch YouTube together",
    listen: "Listen to our songs", draw: "Whiteboard", calendar: "Calendar", list: "Our list", "timer-open": "Timer",
  };
  window.DU.saathiTools.push(
    { name: "open_feature", description: "Open a game or tool in their video-call app. " + Object.entries(FEATURES).map(([k, v]) => `${k} = ${v}`).join("; "),
      parameters: { type: "OBJECT", properties: { feature: { type: "STRING", enum: Object.keys(FEATURES) } }, required: ["feature"] },
      run: (a) => {
        const k = String(a.feature);
        // games start for both at once (no setup screen to tap through)
        if (window.DU.arena?.has(k)) return window.DU.arena.startQuick(k);
        const b = document.querySelector(`#tg-tray [data-tg="${CSS.escape(k)}"]`);
        if (!b) return { error: "Not found" };
        b.click();
        return { opened: FEATURES[k] };
      } },
    { name: "power_nap", description: "Start (or cancel with 0) a power nap timer for both of them; a gentle alarm wakes them.",
      parameters: { type: "OBJECT", properties: { minutes: { type: "NUMBER", description: "5 to 60, or 0 to cancel" } }, required: ["minutes"] },
      run: (a) => { const m = Math.max(0, Math.min(60, Math.round(Number(a.minutes) || 0))); window.DU.nap?.(m); return { minutes: m }; } },
    { name: "play_sound", description: "Play a calm background sound for both, or stop it.",
      parameters: { type: "OBJECT", properties: { sound: { type: "STRING", enum: ["rain", "thunder", "waves", "stream", "forest", "wind", "fire", "night", "cafe", "train", "fan", "chimes", "bowl", "heart", "white", "brown", "stop"] } }, required: ["sound"] },
      run: (a) => { const k = a.sound === "stop" ? "" : String(a.sound); window.DU.sounds?.play(k); return { playing: k || "nothing" }; } },
    { name: "send_chat_message", description: "Send a text message in the call's chat, from the person asking (e.g. a link, an address, a note to keep).",
      parameters: { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] },
      run: (a) => {
        const text = String(a.text || "").trim().slice(0, 1000);
        if (!text) return { error: "Empty message" };
        send("chat", { text });
        addChatMessage(me.name, text, true);
        return { sent: text };
      } },
    { name: "close_windows", description: "Close all open tool windows, games and panels on the screen.",
      parameters: { type: "OBJECT", properties: {} },
      run: () => {
        window.DU.win?.closeAll();
        window.DU.kit?.toggleTray(false);
        document.querySelectorAll(".modal.open").forEach((m) => { if (!m.closest("#meeting-end")) window.DU.closeModal?.(m); });
        return { closed: true };
      } },
  );
})();
