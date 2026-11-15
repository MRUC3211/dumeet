// DU Meet · gesture magic: your hand gestures turn into effects on both screens.
// Loads MediaPipe's GestureRecognizer on first use, watches your camera, and when it
// sees a gesture it plays a matching effect on your tile and sends it to the other phone.
// Plus Kiss Cam: a heart frame on both tiles. Uses globals from app.js
// (cameraTrack, me, send, peers, tileOf, toast, polling) and window.DU.

(() => {
  "use strict";
  const q = (s, r = document) => r.querySelector(s);
  const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const MODEL = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

  // kind -> how it looks when it plays
  const EFFECTS = {
    thumbup:    { emoji: ["👍"], label: "Nice!" },
    thumbdown:  { emoji: ["👎"] },
    peace:      { emoji: ["✌️", "✨"] },
    wave:       { emoji: ["👋"], label: "Hi!" },
    fist:       { emoji: ["👊", "💥"] },
    point:      { emoji: ["☝️", "🌟"] },
    iloveyou:   { emoji: ["🤟", "❤️"], label: "Love you" },
    fingerheart:{ emoji: ["💗", "💓", "💕"], label: "💗" },
    hearthands: { emoji: ["💞", "💖", "💗", "💓"], big: true, label: "So much love" },
    kiss:       { emoji: ["💋"], fly: true, label: "Mwah!" },
  };
  const BUILTIN = { Thumb_Up: "thumbup", Thumb_Down: "thumbdown", Victory: "peace", Open_Palm: "wave", Closed_Fist: "fist", Pointing_Up: "point", ILoveYou: "iloveyou" };

  const G = { on: false, rec: null, loading: null, video: null, raf: 0, lastT: -1, cool: {} };

  async function loadRec() {
    if (G.rec) return G.rec;
    G.loading ||= (async () => {
      const vision = await import(`${MP}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
      const make = (delegate) => vision.GestureRecognizer.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", numHands: 2 });
      try { G.rec = await make("GPU"); } catch { G.rec = await make("CPU"); }
      return G.rec;
    })();
    return G.loading;
  }

  function start() {
    const cam = cameraTrack();
    if (!cam || !me.cam) { toast("Turn your camera on to use gestures"); return false; }
    G.video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, autoplay: true });
    G.video.srcObject = new MediaStream([cam]);
    G.video.play().catch(() => {});
    const loop = () => {
      G.raf = requestAnimationFrame(loop);
      const v = G.video;
      if (!G.rec || !v || v.readyState < 2 || v.currentTime === G.lastT) return;
      G.lastT = v.currentTime;
      let res;
      try { res = G.rec.recognizeForVideo(v, performance.now()); } catch { return; }
      detect(res);
    };
    loop();
    return true;
  }

  function stop() {
    cancelAnimationFrame(G.raf);
    if (G.video) G.video.srcObject = null;
    G.video = null; G.lastT = -1;
  }

  const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // Finger heart 🫰: thumb tip and index tip touching, the other fingers folded.
  function fingerHeart(lm) {
    const span = hyp(lm[0], lm[9]) || 1;
    const folded = lm[12].y > lm[10].y && lm[16].y > lm[14].y && lm[20].y > lm[18].y;
    return hyp(lm[4], lm[8]) < span * 0.5 && folded;
  }
  // Heart hands 🫶: two hands, thumbs together and index tips together.
  function heartHands(a, b) {
    const span = hyp(a[0], a[9]) || 1;
    return hyp(a[4], b[4]) < span * 0.9 && hyp(a[8], b[8]) < span * 0.9;
  }

  function detect(res) {
    const hands = res.landmarks || [];
    let fire = null;
    if (hands.length === 2 && heartHands(hands[0], hands[1])) fire = "hearthands";
    else if (hands.length >= 1) {
      const lm = hands[0];
      if (fingerHeart(lm)) fire = "fingerheart";
      else {
        const g = res.gestures?.[0]?.[0];
        if (g && g.score > 0.6 && BUILTIN[g.categoryName]) {
          fire = BUILTIN[g.categoryName];
          // open palm raised up near the face = blowing a kiss
          if (fire === "wave" && lm[9] && lm[9].y < 0.45) fire = "kiss";
        }
      }
    }
    if (fire) trigger(fire);
  }

  function trigger(kind) {
    const now = Date.now();
    if (now - (G.cool[kind] || 0) < 2200) return;
    G.cool[kind] = now;
    playEffect(kind, me.id);
    send("gesture", { g: kind });
    navigator.vibrate?.(20);
  }

  // ---------- effects on a tile ----------

  function layerFor(id) {
    const tile = tileOf(id);
    if (!tile) return null;
    let layer = tile.querySelector(".gfx-layer");
    if (!layer) { layer = document.createElement("div"); layer.className = "gfx-layer"; tile.append(layer); }
    return layer;
  }
  function spawn(layer, ch, opts = {}) {
    const el = document.createElement("span");
    el.className = "gfx" + (opts.cls ? " " + opts.cls : "");
    el.textContent = ch;
    el.style.left = (opts.x ?? (12 + Math.random() * 76)) + "%";
    el.style.fontSize = (opts.size ?? (30 + Math.random() * 26)) + "px";
    el.style.setProperty("--dx", (opts.dx ?? (Math.random() * 60 - 30)) + "px");
    el.style.animationDuration = (opts.dur ?? 1.6) + "s";
    layer.append(el);
    el.addEventListener("animationend", () => el.remove());
  }
  function playEffect(kind, id) {
    const layer = layerFor(id);
    const fx = EFFECTS[kind];
    if (!layer || !fx) return;
    if (fx.fly) {
      spawn(layer, "💋", { cls: "fly", x: 40 + Math.random() * 20, size: 56, dur: 1.9 });
    } else {
      const n = fx.big ? 16 : 8;
      for (let i = 0; i < n; i++) setTimeout(() => layer.isConnected && spawn(layer, fx.emoji[i % fx.emoji.length], { cls: fx.big ? "big" : "" }), i * 70);
    }
    if (fx.label) showLabel(layer, fx.label);
  }
  function showLabel(layer, text) {
    const el = document.createElement("div");
    el.className = "gfx-label";
    el.textContent = text;
    layer.append(el);
    el.addEventListener("animationend", () => el.remove());
  }

  // ---------- kiss cam ----------

  let kissTimer = 0;
  function kissCam(local) {
    if (local) send("kisscam", {});
    document.body.classList.add("kisscam");
    let banner = q(".kisscam-banner");
    if (!banner) { banner = document.createElement("div"); banner.className = "kisscam-banner"; banner.innerHTML = "<b>KISS CAM</b><span>💋</span>"; document.body.append(banner); }
    navigator.vibrate?.(30);
    clearTimeout(kissTimer);
    kissTimer = setTimeout(() => { document.body.classList.remove("kisscam"); q(".kisscam-banner")?.remove(); }, 7000);
  }

  // ---------- toggle + hooks ----------

  function paintTray() { const s = q("#tray-gestures"); if (s) s.textContent = G.on ? "On · show a 👍 🫰 🤟" : "Off · hands → effects"; }

  function toggle() {
    window.DU.kit.toggleTray(false);
    if (G.on) { G.on = false; stop(); paintTray(); return toast("Gestures off"); }
    G.on = true; paintTray();
    toast("Loading gestures…");
    loadRec().then(() => {
      if (!G.on) return;
      if (start()) toast("Gestures on — show 👍 ✌️ 🤟 🫰 to the camera");
    }).catch(() => { G.on = false; paintTray(); toast("Couldn't load gestures here"); });
  }

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const tg = button.dataset.tg;
      if (tg === "gestures") toggle();
      else if (tg === "kisscam") { window.DU.kit.toggleTray(false); kissCam(true); }
      else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type === "gesture") playEffect(String(message.data?.g || ""), peer.id);
      else if (message.type === "kisscam") kissCam(false);
      else prev.msg?.(message, peer);
    },
    onCoupleLeave(...a) { G.on = false; stop(); clearTimeout(kissTimer); document.body.classList.remove("kisscam"); q(".kisscam-banner")?.remove(); prev.leave?.(...a); },
  });
  paintTray();

  // expose for quick manual testing
  window.DU.gestureFx = playEffect;
  window.DU.kissCam = kissCam;
})();
