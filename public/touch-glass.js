// DU Meet · Touch the glass: a shared full-screen layer. Press your finger (or
// mouse) to the screen and a glow appears; the other person's touch shows too,
// mirrored, so it feels like you're reaching for each other through one pane of
// glass. When your points meet, they spark. Uses globals from app.js
// (me, send, peers, toast, polling) and window.DU.

(() => {
  "use strict";
  const MINE = "#0a84ff", THEIRS = "#ff2d78";
  const S = { on: false, el: null, canvas: null, ctx: null, raf: 0, mine: new Map(), theirs: [], sendT: 0, buzzT: 0 };

  function enable(on) {
    if (on === S.on) return;
    S.on = on;
    if (on) build(); else teardown();
  }

  function build() {
    const el = document.createElement("div");
    el.className = "tg-glass";
    el.innerHTML = '<canvas class="tg-canvas"></canvas>'
      + '<div class="tg-hint">Apni ungli screen par rakho 💞</div>'
      + '<button class="tg-close" aria-label="Close"><span class="icon">close</span></button>';
    document.body.append(el);
    S.el = el;
    S.canvas = el.querySelector(".tg-canvas");
    S.ctx = S.canvas.getContext("2d");
    size();
    addEventListener("resize", size);
    el.querySelector(".tg-close").addEventListener("click", () => window.DU.kit ? enable(false) : enable(false));
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onUp);
    render();
  }
  function teardown() {
    cancelAnimationFrame(S.raf);
    removeEventListener("resize", size);
    S.el?.remove();
    S.el = S.canvas = S.ctx = null;
    S.mine.clear(); S.theirs = [];
    send("tg", { t: "off" });
  }

  function size() {
    if (!S.canvas) return;
    S.canvas.width = innerWidth; S.canvas.height = innerHeight;
  }

  const norm = (e) => [Math.min(1, Math.max(0, e.clientX / innerWidth)), Math.min(1, Math.max(0, e.clientY / innerHeight))];
  function onDown(e) { if (e.target.closest(".tg-close")) return; S.el.setPointerCapture?.(e.pointerId); S.mine.set(e.pointerId, norm(e)); pushMine(); e.preventDefault(); }
  function onMove(e) { if (!S.mine.has(e.pointerId)) return; S.mine.set(e.pointerId, norm(e)); pushMine(); }
  function onUp(e) { if (!S.mine.has(e.pointerId)) return; S.mine.delete(e.pointerId); pushMine(true); }

  function pushMine(force) {
    const now = performance.now();
    if (!force && now - S.sendT < 55) return;
    S.sendT = now;
    send("tg", { t: "p", pts: [...S.mine.values()] });
  }

  function render() {
    S.raf = requestAnimationFrame(render);
    const ctx = S.ctx, W = S.canvas.width, H = S.canvas.height;
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const mine = [...S.mine.values()].map(([x, y]) => [x * W, y * H]);
    const theirs = S.theirs.map(([x, y]) => [(1 - x) * W, y * H]); // mirror across so we reach toward each other
    for (const [x, y] of theirs) glow(ctx, x, y, THEIRS, 1);
    for (const [x, y] of mine) glow(ctx, x, y, MINE, 1);
    // when a pair meets, spark
    let met = false;
    for (const m of mine) for (const t of theirs) {
      const d = Math.hypot(m[0] - t[0], m[1] - t[1]);
      if (d < Math.min(W, H) * 0.12) { met = true; const mx = (m[0] + t[0]) / 2, my = (m[1] + t[1]) / 2; spark(ctx, mx, my, 1 - d / (Math.min(W, H) * 0.12)); }
    }
    if (met) { const now = performance.now(); if (now - S.buzzT > 500) { S.buzzT = now; navigator.vibrate?.(25); } }
  }
  function glow(ctx, x, y, color, a) {
    const r = Math.min(S.canvas.width, S.canvas.height) * 0.09;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(0.25, color + "cc"); g.addColorStop(1, color + "00");
    ctx.globalAlpha = 0.85 * a; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
  }
  function spark(ctx, x, y, k) {
    const r = Math.min(S.canvas.width, S.canvas.height) * (0.08 + 0.14 * k);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.3, "#ffd6ec"); g.addColorStop(1, "#ff2d7800");
    ctx.globalAlpha = 0.9; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = `${Math.round(r * 0.9)}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("💖", x, y);
  }

  // ---------- hooks ----------
  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      if (button.dataset.tg === "touchglass") { window.DU.kit.toggleTray(false); if (![...peers.values()][0]) return toast("You both need to be on the call first"); enable(!S.on); }
      else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "tg") return prev.msg?.(message, peer);
      const d = message.data || {};
      if (d.t === "off") S.theirs = [];
      else if (d.t === "p" && Array.isArray(d.pts)) {
        S.theirs = d.pts.slice(0, 6).map((p) => [Number(p[0]) || 0, Number(p[1]) || 0]);
        if (!S.on && S.theirs.length) { enable(true); toast(`${peer.name} is touching the glass 💞`); }
      }
    },
    onCoupleLeave(...a) { enable(false); prev.leave?.(...a); },
  });

  window.DU.touchGlass = enable; // for quick checks
})();
