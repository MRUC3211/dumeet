// DU Meet · Audio-reactive scene: an ambient glow behind the call that pulses and
// shifts colour with the call's sound (your mic + the other person's voice + any
// music playing together). A personal light show. Uses globals from app.js
// (micTrack, peers, me, toast) and window.DU.

(() => {
  "use strict";
  const S = { on: false, ctx: null, analyser: null, src: null, raf: 0, el: null, hue: 265, data: null, retime: 0 };

  function tracks() {
    const list = [];
    const mt = (typeof micTrack === "function" && micTrack()) || null; if (mt) list.push(mt);
    for (const p of peers.values()) { const t = p.audio?.srcObject?.getAudioTracks?.()[0]; if (t) list.push(t); }
    return list;
  }

  function start() {
    const list = tracks();
    if (!list.length) { toast("Light show needs a mic or some sound"); return false; }
    try {
      S.ctx = window.audioContext || (window.audioContext = new (window.AudioContext || window.webkitAudioContext)());
      if (S.ctx.state === "suspended") S.ctx.resume();
      S.src = S.ctx.createMediaStreamSource(new MediaStream(list));
      S.analyser = S.ctx.createAnalyser(); S.analyser.fftSize = 256; S.analyser.smoothingTimeConstant = 0.8;
      S.src.connect(S.analyser); // read only — not connected to the speakers
      S.data = new Uint8Array(S.analyser.frequencyBinCount);
    } catch { toast("Light show isn't supported on this browser"); return false; }
    S.el = document.createElement("div");
    S.el.className = "audioscene";
    S.el.innerHTML = '<div class="as-glow"></div>';
    document.body.append(S.el);
    loop();
    return true;
  }

  function loop() {
    S.raf = requestAnimationFrame(loop);
    if (!S.analyser) return;
    // reconnect tracks if someone (un)muted or joined
    const now = performance.now();
    if (now - S.retime > 2000) { S.retime = now; try { S.src.disconnect(); S.src = S.ctx.createMediaStreamSource(new MediaStream(tracks())); S.src.connect(S.analyser); } catch { /* ignore */ } }
    S.analyser.getByteFrequencyData(S.data);
    let sum = 0; for (let i = 0; i < S.data.length; i++) sum += S.data[i];
    const level = Math.min(1, (sum / S.data.length) / 90); // 0..1
    S.hue = (S.hue + 0.5 + level * 4) % 360;
    const glow = S.el.firstElementChild;
    glow.style.setProperty("--lvl", level.toFixed(3));
    glow.style.setProperty("--hue", Math.round(S.hue));
  }

  function stop() {
    cancelAnimationFrame(S.raf);
    try { S.src?.disconnect(); } catch { /* ignore */ }
    S.el?.remove();
    S.el = S.analyser = S.src = null;
  }

  function enable(on) { if (on === S.on) return; S.on = on; if (on) { if (!start()) S.on = false; } else stop(); }

  const prev = { click: window.DU.onCoupleClick, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) { if (button.dataset.tg === "audioscene") { window.DU.kit.toggleTray(false); enable(!S.on); toast(S.on ? "Light show on 🌌" : "Light show off"); } else prev.click?.(button); },
    onCoupleLeave(...a) { if (S.on) { S.on = false; stop(); } prev.leave?.(...a); },
  });
  window.DU.audioScene = enable; // for quick checks
})();
