// DU Meet · Together mode: replace the background behind each of you with the SAME
// scene (beach, cafe, night, hearts…) using MediaPipe selfie segmentation, so side
// by side it feels like you're in one place. The chosen scene is synced to both.
// Uses globals from app.js (cameraTrack, setOutgoing, SLOT, me, send, peers, tileOf, toast).

(() => {
  "use strict";
  const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const SEG_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

  const SCENES = [
    { k: "beach", label: "Beach", draw: beach },
    { k: "cafe", label: "Cafe", draw: cafe },
    { k: "night", label: "Night", draw: night },
    { k: "hearts", label: "Hearts", draw: hearts },
    { k: "room", label: "Cozy", draw: room },
  ];
  const sceneOf = (k) => SCENES.find((s) => s.k === k) || SCENES[0];

  const T = { on: false, bg: "beach", seg: null, loading: null, video: null, canvas: null, ctx: null, mask: null, maskCtx: null, out: null, raf: 0, lastT: -1, bar: null };

  // ---------- scene painters (drawn on a canvas, no external images) ----------
  function fillGrad(ctx, W, H, stops) { const g = ctx.createLinearGradient(0, 0, 0, H); stops.forEach(([o, c]) => g.addColorStop(o, c)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  function bokeh(ctx, W, H, color, n, t) { for (let i = 0; i < n; i++) { const x = ((i * 97) % 100) / 100 * W + Math.sin(t / 1400 + i) * 8, y = ((i * 57) % 100) / 100 * H, r = (6 + (i % 5) * 5) * (H / 480); ctx.globalAlpha = 0.14 + (i % 4) * 0.05; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); } ctx.globalAlpha = 1; }
  function beach(ctx, W, H) { fillGrad(ctx, W, H, [[0, "#ffe3b3"], [.45, "#ff9a76"], [1, "#ff6a88"]]); ctx.fillStyle = "rgba(255,244,214,.95)"; ctx.beginPath(); ctx.arc(W * 0.72, H * 0.34, H * 0.13, 0, 7); ctx.fill(); ctx.fillStyle = "rgba(24,60,96,.4)"; ctx.fillRect(0, H * 0.74, W, H * 0.26); ctx.fillStyle = "rgba(255,255,255,.12)"; for (let i = 0; i < 4; i++) ctx.fillRect(0, H * (0.76 + i * 0.05), W, 2); }
  function cafe(ctx, W, H, t) { fillGrad(ctx, W, H, [[0, "#6b4530"], [1, "#241812"]]); bokeh(ctx, W, H, "#ffcf8f", 16, t); }
  function night(ctx, W, H, t) { fillGrad(ctx, W, H, [[0, "#1b1147"], [1, "#07071a"]]); bokeh(ctx, W, H, "#9ad0ff", 20, t); ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.arc(W * 0.8, H * 0.22, H * 0.06, 0, 7); ctx.fill(); }
  function hearts(ctx, W, H, t) { fillGrad(ctx, W, H, [[0, "#ff8fb3"], [1, "#b02a86"]]); ctx.font = `${Math.round(H * 0.08)}px serif`; ctx.textAlign = "center"; for (let i = 0; i < 9; i++) { const x = ((i * 83) % 100) / 100 * W, y = (((t / 40 + i * 60) % (H + 60)) - 30); ctx.globalAlpha = 0.5; ctx.fillText("💗", x, y); } ctx.globalAlpha = 1; }
  function room(ctx, W, H, t) { fillGrad(ctx, W, H, [[0, "#3a2f4a"], [1, "#171320"]]); bokeh(ctx, W, H, "#ffb37a", 10, t); const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.7); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.5)"); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H); }

  // ---------- segmentation pipeline ----------
  async function loadSeg() {
    if (T.seg) return T.seg;
    T.loading ||= (async () => {
      const vision = await import(`${MP}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
      const make = (delegate) => vision.ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: SEG_MODEL, delegate }, runningMode: "VIDEO", outputCategoryMask: false, outputConfidenceMasks: true });
      try { T.seg = await make("GPU"); } catch { T.seg = await make("CPU"); }
      return T.seg;
    })();
    return T.loading;
  }

  function start() {
    const cam = cameraTrack();
    if (!cam || !me.cam) { toast("Camera on karo together mode ke liye"); return false; }
    stop(false);
    const set = cam.getSettings();
    const W = Math.min(set.width || 640, 720), H = Math.round(W * ((set.height || 480) / (set.width || 640)));
    T.video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, autoplay: true });
    T.video.srcObject = new MediaStream([cam]);
    T.video.play().catch(() => {});
    T.canvas = document.createElement("canvas"); T.canvas.className = "fx-preview"; T.canvas.width = W; T.canvas.height = H;
    T.ctx = T.canvas.getContext("2d");
    T.mask = document.createElement("canvas"); T.maskCtx = T.mask.getContext("2d");
    T.out = T.canvas.captureStream(24).getVideoTracks()[0];
    const frame = () => {
      T.raf = requestAnimationFrame(frame);
      const v = T.video;
      if (v.readyState < 2) return;
      if (v.videoWidth && (T.canvas.width !== Math.min(v.videoWidth, 720))) { T.canvas.width = Math.min(v.videoWidth, 720); T.canvas.height = Math.round(T.canvas.width * (v.videoHeight / v.videoWidth)); }
      const now = performance.now();
      if (T.seg && v.currentTime !== T.lastT) {
        T.lastT = v.currentTime;
        try { T.seg.segmentForVideo(v, now, composite); } catch { paintBgOnly(now); }
      } else if (!T.seg) {
        paintBgOnly(now);
      }
    };
    frame();
    setOutgoing(SLOT.camera, T.out);
    preview();
    return true;
  }

  function composite(result) {
    const ctx = T.ctx, W = T.canvas.width, H = T.canvas.height, now = performance.now();
    const mask = result.confidenceMasks?.[0];
    if (!mask) { paintBgOnly(now); return; }
    const mw = mask.width, mh = mask.height, md = mask.getAsFloat32Array();
    if (T.mask.width !== mw) { T.mask.width = mw; T.mask.height = mh; }
    const id = T.maskCtx.createImageData(mw, mh);
    for (let i = 0; i < md.length; i++) id.data[i * 4 + 3] = md[i] * 255; // person confidence → alpha
    T.maskCtx.putImageData(id, 0, 0);
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(T.video, 0, 0, W, H);
    ctx.globalCompositeOperation = "destination-in";
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(T.mask, 0, 0, W, H);
    ctx.globalCompositeOperation = "destination-over";
    sceneOf(T.bg).draw(ctx, W, H, now);
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
    mask.close?.();
  }
  function paintBgOnly(now) { const ctx = T.ctx, W = T.canvas.width, H = T.canvas.height; sceneOf(T.bg).draw(ctx, W, H, now); }

  function stop(restore = true) {
    cancelAnimationFrame(T.raf);
    T.out?.stop();
    T.canvas?.remove();
    if (T.video) T.video.srcObject = null;
    T.video = T.canvas = T.ctx = T.out = null; T.lastT = -1;
    if (restore && me.cam) setOutgoing(SLOT.camera, cameraTrack());
  }
  function preview() { const tile = tileOf(me.id); if (tile && T.canvas && T.canvas.parentElement !== tile) tile.querySelector("video")?.after(T.canvas); }

  // ---------- picker + enable ----------
  function thumb(scene) {
    const c = document.createElement("canvas"); c.width = 96; c.height = 64;
    scene.draw(c.getContext("2d"), 96, 64, 0);
    return c;
  }
  function showBar() {
    if (T.bar) return;
    const bar = document.createElement("div");
    bar.className = "tog-bar";
    const scenes = document.createElement("div"); scenes.className = "tog-scenes";
    for (const s of SCENES) {
      const b = document.createElement("button"); b.className = "tog-scene" + (s.k === T.bg ? " on" : ""); b.dataset.k = s.k;
      b.append(thumb(s)); const lb = document.createElement("span"); lb.textContent = s.label; b.append(lb);
      b.addEventListener("click", () => pick(s.k));
      scenes.append(b);
    }
    const off = document.createElement("button"); off.className = "tog-off"; off.innerHTML = '<span class="icon">close</span>Off';
    off.addEventListener("click", () => enable(false));
    bar.append(scenes, off);
    document.body.append(bar);
    T.bar = bar;
  }
  function hideBar() { T.bar?.remove(); T.bar = null; }
  function markBar() { T.bar?.querySelectorAll(".tog-scene").forEach((b) => b.classList.toggle("on", b.dataset.k === T.bg)); }

  function pick(k) {
    T.bg = k; markBar();
    send("together", { t: "bg", bg: k });
  }

  function enable(on, bg) {
    if (bg) T.bg = bg;
    if (on === T.on) { if (on) markBar(); return; }
    T.on = on;
    if (on) {
      showBar();
      toast("Loading Together mode…");
      loadSeg().then(() => { if (T.on) start(); }).catch(() => { toast("Together mode load nahi hua"); });
      send("together", { t: "on", bg: T.bg });
    } else {
      stop(); hideBar();
      send("together", { t: "off" });
    }
  }

  // ---------- hooks ----------
  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      if (button.dataset.tg === "together") { window.DU.kit.toggleTray(false); if (![...peers.values()][0]) return toast("Doosre ka call pe aana zaroori hai"); enable(!T.on); }
      else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "together") return prev.msg?.(message, peer);
      const d = message.data || {};
      if (d.t === "on") { const was = T.on; enable(true, typeof d.bg === "string" ? d.bg : T.bg); if (!was) toast(`${peer.name} ne Together mode on kiya 🌴`); }
      else if (d.t === "off") { if (T.on) { enable(false); toast(`${peer.name} ne Together mode band kiya`); } }
      else if (d.t === "bg" && typeof d.bg === "string") { T.bg = d.bg; markBar(); }
    },
    onCoupleLeave(...a) { if (T.on) { T.on = false; stop(); hideBar(); } prev.leave?.(...a); },
  });

  window.DU.togetherScene = (k, c) => sceneOf(k).draw(c.getContext("2d"), c.width, c.height, 0); // for quick checks
})();
