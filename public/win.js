// DU Meet · small floating windows for in-call tools (fun, relax, date night, Saathi).
// A window moves by its top bar, resizes from the corner grip or (for Saathi) by dragging
// an edge or pinching with two fingers, and remembers where it was left.

(() => {
  "use strict";
  window.DU ||= {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
  const GRIP = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 15H15V5M15 15L6 6M1 11V1H11"/></svg>`;

  /**
   * Make a fixed element movable and resizable.
   * opts: key (storage), handle (selector or the element itself when omitted), grip (corner
   * button), edges (drag an edge to resize, no visible grip), pinch, def() default box,
   * minW, minH, autoH (height follows content until resized).
   */
  function make(el, opts = {}) {
    const { key, handle, grip = true, edges = false, pinch = false, minW = 260, minH = 200, autoH = false } = opts;
    const def = opts.def || (() => ({ x: innerWidth - Math.min(360, innerWidth - 16) - 12, y: 70, w: Math.min(360, innerWidth - 16), h: autoH ? null : Math.min(460, innerHeight - 140) }));
    el.classList.add("fwin");
    let box = { ...def(), ...(key ? load(key) || {} : {}) };

    function fit(b, sizing) {
      const vw = innerWidth, vh = innerHeight;
      let w = clamp(b.w, Math.min(minW, vw - 8), vw - 8);
      const realH = b.h == null ? el.offsetHeight || minH : b.h;
      let h = clamp(realH, Math.min(minH, vh - 8), vh - 8);
      if (sizing) { w = Math.min(w, vw - b.x - 4); h = Math.min(h, vh - b.y - 4); }
      return { x: clamp(b.x, 4, Math.max(4, vw - w - 4)), y: clamp(b.y, 4, Math.max(4, vh - h - 4)), w, h: b.h == null ? null : h };
    }
    const put = () => {
      el.style.left = `${box.x}px`;
      el.style.top = `${box.y}px`;
      el.style.width = `${box.w}px`;
      el.style.height = box.h == null ? "" : `${box.h}px`;
    };
    box = fit(box);
    put();

    let g = null;
    if (grip) {
      g = document.createElement("button");
      g.className = "fw-grip";
      g.type = "button";
      g.setAttribute("aria-label", "Resize");
      g.innerHTML = GRIP;
      el.append(g);
    }

    const EDGE = 14;
    const edgeAt = (e) => {
      if (!edges) return "";
      const r = el.getBoundingClientRect();
      let s = "";
      if (edges !== "ew" && e.clientY > r.bottom - EDGE) s += "s";
      if (e.clientX > r.right - EDGE) s += "e";
      else if (e.clientX < r.left + EDGE) s += "w";
      return s;
    };
    if (edges) {
      el.addEventListener("pointermove", (e) => {
        if (e.pointerType !== "mouse" || el.classList.contains("fw-busy")) return;
        const s = edgeAt(e);
        el.style.cursor = s === "se" ? "nwse-resize" : s === "sw" ? "nesw-resize" : s === "s" ? "ns-resize" : s ? "ew-resize" : "";
      });
    }

    const pointers = new Map();
    let pinch0 = null;
    function startDrag(e, mode) {
      e.preventDefault();
      const t = e.currentTarget, x0 = e.clientX, y0 = e.clientY;
      if (box.h == null) box.h = el.offsetHeight;
      const b0 = { ...box };
      try { t.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      let moved = false;
      const move = (ev) => {
        if (pointers.size > 1) return;
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        el.classList.add("fw-busy");
        let b = { ...b0 };
        if (mode === "move") { b.x += dx; b.y += dy; }
        else {
          if (mode.includes("e")) b.w = b0.w + dx;
          if (mode.includes("s")) b.h = b0.h + dy;
          if (mode.includes("w")) { b.w = b0.w - dx; b.x = b0.x + dx; if (b.w < minW) { b.x -= minW - b.w; b.w = minW; } }
        }
        box = fit(b, mode !== "move");
        put();
      };
      const up = () => {
        t.removeEventListener("pointermove", move);
        t.removeEventListener("pointerup", up);
        t.removeEventListener("pointercancel", up);
        el.classList.remove("fw-busy");
        if (moved && key) save(key, box);
        if (moved) { const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; t.addEventListener("click", stop, { capture: true, once: true }); setTimeout(() => t.removeEventListener("click", stop, { capture: true }), 50); }
      };
      t.addEventListener("pointermove", move);
      t.addEventListener("pointerup", up);
      t.addEventListener("pointercancel", up);
    }

    g?.addEventListener("pointerdown", (e) => startDrag(e, "se"));
    const head = handle ? (typeof handle === "string" ? el.querySelector(handle) : handle) : el;
    const interactive = "button, input, textarea, select, a, label, [contenteditable], .fw-nodrag";
    el.addEventListener("pointerdown", (e) => {
      if (e.button && e.pointerType === "mouse") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        if (box.h == null) box.h = el.offsetHeight;
        pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), box: { ...box } };
        el.classList.add("fw-busy");
        return;
      }
      if (e.target.closest(".fw-grip")) return;
      const side = edgeAt(e);
      if (side) return startDrag(e, side);
      if (head && head.contains(e.target) && !e.target.closest(interactive)) startDrag(e, "move");
    });
    if (pinch) {
      el.addEventListener("pointermove", (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (!pinch0 || pointers.size !== 2) return;
        const [a, b] = [...pointers.values()];
        const k = Math.hypot(a.x - b.x, a.y - b.y) / (pinch0.d || 1);
        const b0 = pinch0.box;
        const w = b0.w * k, h = b0.h * k;
        box = fit({ x: b0.x - (w - b0.w) / 2, y: b0.y - (h - b0.h) / 2, w, h });
        put();
      });
    }
    const lift = (e) => {
      pointers.delete(e.pointerId);
      if (pinch0 && pointers.size < 2) { pinch0 = null; el.classList.remove("fw-busy"); if (key) save(key, box); }
    };
    el.addEventListener("pointerup", lift);
    el.addEventListener("pointercancel", lift);
    // the bar (and a pinchable window) takes the touch; scrolling inside the body still works
    if (head) head.style.touchAction = "none";
    if (pinch) el.style.touchAction = "none";

    const refit = () => { if (!el.isConnected) return removeEventListener("resize", refit); box = fit(box); put(); };
    addEventListener("resize", refit);
    return { refit, get box() { return box; } };
  }

  // ---------- a ready-made tool window ----------

  const openWins = new Map();
  let zTop = 380;
  /**
   * open({ id, title, icon, html, w, h, tone, onClose }) → { el, body, close, setTitle }
   * Opening an id that is already open brings it to the front instead.
   */
  function open({ id, title, icon = "", html = "", w = 340, h = 420, tone = "", onClose, autoH = false }) {
    if (openWins.has(id)) { const o = openWins.get(id); o.el.style.zIndex = ++zTop; return o; }
    const el = document.createElement("div");
    el.className = `fw${tone ? ` fw-${tone}` : ""}`;
    el.dataset.win = id;
    el.style.zIndex = ++zTop;
    el.innerHTML = `<header class="fw-top">${icon ? `<span class="fw-ic icon" aria-hidden="true">${esc(icon)}</span>` : ""}<b class="fw-title">${esc(title)}</b><div class="fw-acts"></div>
        <button class="fw-x" type="button" aria-label="Close ${esc(title)}"><span class="icon" aria-hidden="true">close</span></button></header>
      <div class="fw-body">${html}</div>`;
    document.body.append(el);
    const vw = innerWidth, vh = innerHeight;
    const n = openWins.size;
    const def = () => {
      const ww = Math.min(w, vw - 16), hh = autoH ? null : Math.min(h, vh - 120);
      return vw < 640 ? { x: (vw - ww) / 2, y: 60 + n * 18, w: ww, h: hh } : { x: vw - ww - 20 - n * 24, y: 70 + n * 24, w: ww, h: hh };
    };
    make(el, { key: `du-win-${id}`, handle: ".fw-top", def, autoH, minW: Math.min(240, w), minH: 160 });
    el.addEventListener("pointerdown", () => { el.style.zIndex = ++zTop; }, true);
    const o = {
      el,
      body: el.querySelector(".fw-body"),
      acts: el.querySelector(".fw-acts"),
      setTitle: (t) => { el.querySelector(".fw-title").textContent = t; },
      close() {
        if (!openWins.has(id)) return;
        openWins.delete(id);
        el.classList.add("fw-out");
        setTimeout(() => el.remove(), 180);
        onClose?.();
      },
    };
    el.querySelector(".fw-x").addEventListener("click", () => o.close());
    openWins.set(id, o);
    return o;
  }
  const get = (id) => openWins.get(id) || null;
  const closeAll = () => [...openWins.values()].forEach((o) => o.close());

  window.DU.win = { make, open, get, closeAll, esc };
})();
