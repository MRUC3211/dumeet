// DU Meet · the shared stage for turn-based games in a call (chess, ludo, checkers,
// dots & boxes, memory, sea battle). Each game registers itself here; moves travel
// through the normal relay (send) and both phones apply them in the same order.

(() => {
  "use strict";
  const { q, esc, getDocs, putDoc } = window.DU.kit;
  const other = () => [...peers.values()][0];
  const faceHtml = (n) => { const u = window.DU.faceFor?.(n); return u ? `<img src="${esc(u)}" alt="">` : esc((n || "?")[0].toUpperCase()); };
  const games = {};
  let cur = null; // { kind, el, game, startedAt, mine }

  // ---------- frame ----------

  function open(kind, title, html, { mine = false } = {}) {
    close();
    const el = document.createElement("div");
    el.className = `ar ar-${kind}`;
    el.innerHTML = `<header class="ar-top">
        <b class="ar-title">${esc(title)}</b><small class="ar-status" aria-live="polite"></small>
        <div class="ar-tools"></div>
        <button class="ar-x" aria-label="Leave game"><span class="icon" aria-hidden="true">close</span></button>
      </header>
      <div class="ar-body">${html}</div>
      <div class="ar-panel" hidden></div>`;
    document.body.append(el);
    cur = { kind, el, startedAt: mine ? Date.now() : 0 };
    q(".ar-x", el).addEventListener("click", async () => {
      if (cur?.live && !(await window.DU.kit.confirmBox?.({ title: "Leave the game?", text: "The game ends for both of you.", ok: "Leave", cancel: "Stay" }))) return;
      send(kind, { t: "quit" });
      close();
    });
    return el;
  }
  function close() {
    if (!cur) return;
    games[cur.kind]?.cleanup?.();
    cur.el.remove();
    cur = null;
  }
  const status = (text) => { if (cur) q(".ar-status", cur.el).textContent = text; };
  const tools = (html) => { if (cur) q(".ar-tools", cur.el).innerHTML = html; };
  function panel(html) {
    if (!cur) return null;
    const p = q(".ar-panel", cur.el);
    p.innerHTML = html;
    p.hidden = !html;
    return p;
  }
  const live = (on) => { if (cur) cur.live = on; };

  // two-player strip: faces, names, a score or note, and whose turn it is
  function duel(names, colors = ["#0a84ff", "#ff375f"]) {
    return `<div class="ar-duel">${names.map((n, i) => `<div class="ar-pl" data-i="${i}" style="--pc:${colors[i]}">
      <span class="ar-face">${faceHtml(n)}</span><span class="ar-pn"><b>${n === me.name ? "You" : esc(n)}</b><small class="ar-sub"></small></span><b class="ar-score"></b></div>`).join("")}</div>`;
  }
  function setDuel({ turn = -1, scores, subs } = {}) {
    if (!cur) return;
    cur.el.querySelectorAll(".ar-pl").forEach((p, i) => {
      p.classList.toggle("turn", i === turn);
      if (scores) q(".ar-score", p).textContent = scores[i];
      if (subs) q(".ar-sub", p).textContent = subs[i] || "";
    });
  }

  function over(kind, names, winner, detail, again) {
    live(false);
    const mine = names.indexOf(me.name);
    const title = winner < 0 ? "It's a draw" : winner === mine ? "You win! 🎉" : `${esc(names[winner])} wins`;
    sound(winner === mine ? "win" : winner < 0 ? "move" : "lose");
    const p = panel(`${winner >= 0 ? `<span class="ar-big-face">${faceHtml(names[winner])}<i class="icon" aria-hidden="true">workspace_premium</i></span>` : `<span class="ar-big-face draw"><i class="icon" aria-hidden="true">handshake</i></span>`}
      <b class="ar-ptitle">${title}</b>${detail ? `<small>${esc(detail)}</small>` : ""}
      <div class="ar-row"><button class="btn ghost" data-ar="close">Close</button><button class="btn primary" data-ar="again"><span class="icon" aria-hidden="true">replay</span>Rematch</button></div>`);
    p.onclick = (e) => {
      const a = e.target.closest("[data-ar]")?.dataset.ar;
      if (a === "close") { send(kind, { t: "quit" }); close(); }
      if (a === "again") again();
    };
    saveWin(kind, names, winner);
  }

  async function saveWin(kind, names, winner) {
    if (names[0] !== me.name) return; // recorded once, by the first player
    try {
      const all = (await getDocs("settings")).find((d) => d.id === "game-scores")?.data || {};
      const t = { ...(all[kind] || {}) };
      if (winner < 0) t.draws = (t.draws || 0) + 1;
      else t[names[winner]] = (t[names[winner]] || 0) + 1;
      await putDoc("settings", { ...all, [kind]: t }, "game-scores");
    } catch { /* offline */ }
  }

  // ---------- small sounds ----------

  let actx = null;
  function sound(type) {
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime;
      const tone = (f, at, dur, vol = 0.15, wave = "sine") => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = wave; o.frequency.setValueAtTime(f, t + at);
        g.gain.setValueAtTime(0.0001, t + at);
        g.gain.exponentialRampToValueAtTime(vol, t + at + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
        o.connect(g).connect(actx.destination); o.start(t + at); o.stop(t + at + dur + 0.02);
      };
      const knock = (at, f = 180, vol = 0.35) => {
        const len = Math.floor(actx.sampleRate * 0.06), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
        const s = actx.createBufferSource(), bp = actx.createBiquadFilter(), g = actx.createGain();
        bp.type = "bandpass"; bp.frequency.value = f * 6; bp.Q.value = 1.2; g.gain.value = vol;
        s.buffer = buf; s.connect(bp).connect(g).connect(actx.destination); s.start(t + at);
      };
      ({
        move: () => knock(0),
        capture: () => { knock(0, 140, 0.5); knock(0.05, 220, 0.3); },
        check: () => { knock(0); tone(880, 0.02, 0.18, 0.08, "triangle"); },
        dice: () => { for (let i = 0; i < 5; i++) knock(i * 0.06, 260 + i * 30, 0.25); },
        tick: () => tone(1200, 0, 0.05, 0.05),
        good: () => { tone(660, 0, 0.12, 0.1); tone(990, 0.09, 0.18, 0.1); },
        bad: () => tone(200, 0, 0.25, 0.1, "triangle"),
        win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.3, 0.1, "triangle")),
        lose: () => [392, 330, 262].forEach((f, i) => tone(f, i * 0.14, 0.3, 0.08, "triangle")),
        splash: () => { knock(0, 90, 0.5); knock(0.08, 70, 0.3); },
        boom: () => { knock(0, 60, 0.9); knock(0.06, 45, 0.6); tone(90, 0, 0.4, 0.15, "sawtooth"); },
      })[type]?.();
    } catch { /* no audio */ }
  }

  const rand = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const shuffle = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- registry and hooks ----------

  function register(kind, game) { games[kind] = game; }
  function canStart() {
    if (!other()) { toast("Your partner needs to be in the call to play"); return false; }
    window.DU.kit.toggleTray(false);
    return true;
  }
  // Both tapped "start" at the same moment: the lower id's game wins.
  function accept(kind, peer) {
    if (cur?.kind === kind && cur.startedAt && Date.now() - cur.startedAt < 4000 && me.id < peer.id) return false;
    return true;
  }

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const game = games[button.dataset.tg];
      if (game) { if (canStart()) game.start(); }
      else prev.click?.(button);
    },
    onCouple(message, peer) {
      const game = games[message.type];
      if (!game) return prev.msg?.(message, peer);
      const d = message.data || {};
      if (d.t === "quit") { if (cur?.kind === message.type) { close(); toast(`${peer.name} left the game`); } return; }
      if (d.t === "start" && !accept(message.type, peer)) return;
      game.onMsg(d, peer);
    },
    onCoupleLeave(...args) { prev.leave?.(...args); close(); },
  });

  window.DU.arena = { open, close, status, tools, panel, live, duel, setDuel, over, sound, rand, shuffle, register, faceHtml, esc, q, other, current: () => cur };
})();
