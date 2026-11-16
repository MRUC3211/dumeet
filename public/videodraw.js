// DU Meet · draw on the video: scribble on your own or the other person's tile
// (moustache, glasses, a heart…) and it shows up live on both screens.
// A free overlay (not face-tracked): the drawing stays where you put it.
// Uses globals from app.js (me, peers, send, tileOf, toast) and window.DU.

(() => {
  "use strict";
  const COLORS = ["#ff2d78", "#ffd60a", "#0a84ff", "#30d158", "#ffffff"];
  // strokes are kept per subject: "self" = my tile, "other" = the other person's tile
  const S = { on: false, color: COLORS[0], drawing: false, cur: null, curKey: null, strokes: { self: [], other: [] }, bar: null };

  const otherId = () => [...peers.keys()][0];
  const keyOf = (tile) => (tile.dataset.id === me.id ? "self" : "other");
  const tileForKey = (key) => (key === "self" ? tileOf(me.id) : (otherId() ? tileOf(otherId()) : null));
  const camTiles = () => [tileOf(me.id), tileForKey("other")].filter((t) => t && !t.classList.contains("screen"));

  function canvasOn(tile) {
    if (!tile) return null;
    let c = tile.querySelector(".vdraw-canvas");
    if (!c) { c = document.createElement("canvas"); c.className = "vdraw-canvas"; tile.append(c); }
    const r = tile.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; redraw(keyOf(tile)); }
    return c;
  }

  function redraw(key) {
    const tile = tileForKey(key);
    const c = tile?.querySelector(".vdraw-canvas");
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const st of S.strokes[key]) {
      if (!st.pts.length) continue;
      ctx.strokeStyle = st.color;
      ctx.lineWidth = Math.max(2.5, c.width * 0.012);
      ctx.beginPath();
      st.pts.forEach((p, i) => { const x = p[0] * c.width, y = p[1] * c.height; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
  }

  function pointIn(tile, c, e) {
    const r = c.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  }

  function onDown(e) {
    if (!S.on) return;
    const tile = e.target.closest(".tile");
    if (!tile || tile.classList.contains("screen") || (tile.dataset.id !== me.id && tile.dataset.id !== otherId())) return;
    const c = canvasOn(tile);
    S.drawing = true;
    S.curKey = keyOf(tile);
    S.cur = { color: S.color, pts: [pointIn(tile, c, e)] };
    S.strokes[S.curKey].push(S.cur);
    redraw(S.curKey);
    try { c.setPointerCapture(e.pointerId); } catch { /* ok */ }
    e.preventDefault();
  }
  function onMove(e) {
    if (!S.drawing || !S.cur) return;
    const tile = tileForKey(S.curKey);
    const c = tile?.querySelector(".vdraw-canvas");
    if (!c) return;
    S.cur.pts.push(pointIn(tile, c, e));
    redraw(S.curKey);
  }
  function onUp() {
    if (!S.drawing) return;
    S.drawing = false;
    if (S.cur && S.cur.pts.length > 1) send("vdraw", { t: "s", subject: S.curKey, color: S.cur.color, pts: S.cur.pts.slice(0, 400) });
    S.cur = null;
  }

  function clearAll(local) {
    S.strokes.self = []; S.strokes.other = [];
    redraw("self"); redraw("other");
    if (local) send("vdraw", { t: "clear" });
  }

  // ---------- toolbar ----------

  function showBar() {
    if (S.bar) return;
    const bar = document.createElement("div");
    bar.className = "vdraw-bar";
    bar.innerHTML =
      '<span class="vdraw-colors">' + COLORS.map((c, i) => `<button class="vdraw-dot${i === 0 ? " on" : ""}" data-c="${c}" style="--c:${c}" aria-label="Colour"></button>`).join("") + "</span>"
      + '<button class="vdraw-btn" data-vd="clear"><span class="icon">ink_eraser</span>Clear</button>'
      + '<button class="vdraw-btn done" data-vd="done"><span class="icon">check</span>Done</button>';
    document.body.append(bar);
    S.bar = bar;
    bar.addEventListener("click", (e) => {
      const dot = e.target.closest("[data-c]");
      if (dot) { S.color = dot.dataset.c; bar.querySelectorAll(".vdraw-dot").forEach((d) => d.classList.toggle("on", d === dot)); return; }
      const act = e.target.closest("[data-vd]")?.dataset.vd;
      if (act === "clear") clearAll(true);
      else if (act === "done") enable(false);
    });
  }
  function hideBar() { S.bar?.remove(); S.bar = null; }

  function enable(on) {
    S.on = on;
    document.body.classList.toggle("vdraw-on", on);
    if (on) {
      camTiles().forEach(canvasOn);
      showBar();
      toast("Draw on the video — scribble on either tile ✏️");
    } else {
      hideBar();
    }
  }

  // keep canvases sized to the tiles
  addEventListener("resize", () => { if (document.querySelector(".vdraw-canvas")) camTiles().forEach(canvasOn); });
  document.addEventListener("pointerdown", onDown, { passive: false });
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      if (button.dataset.tg === "videodraw") { window.DU.kit.toggleTray(false); enable(!S.on); }
      else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "vdraw") return prev.msg?.(message, peer);
      const d = message.data || {};
      if (d.t === "clear") { clearAll(false); return; }
      if (d.t === "s" && Array.isArray(d.pts)) {
        const key = d.subject === "self" ? "other" : "self"; // flip to my point of view
        const pts = d.pts.slice(0, 400).map((p) => [Number(p[0]) || 0, Number(p[1]) || 0]);
        S.strokes[key].push({ color: typeof d.color === "string" ? d.color : "#ff2d78", pts });
        canvasOn(tileForKey(key));
        redraw(key);
      }
    },
    onCoupleLeave(...a) { enable(false); S.strokes.self = []; S.strokes.other = []; prev.leave?.(...a); },
  });
})();
