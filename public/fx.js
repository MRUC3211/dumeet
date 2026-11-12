// DU Meet · face filters and a voice changer.
// Filters: the camera goes through a canvas where a face tracker (MediaPipe, loaded on first
// use) places ears, a crown, flowers…; the canvas is what the other phone receives.
// Voice: the mic goes through Web Audio (pitch, robot, echo) before it is sent.
// Uses globals from app.js (cameraTrack, micTrack, setOutgoing, SLOT, me, send, toast, tileOf).

(() => {
  "use strict";
  const { q, esc } = window.DU.kit;
  const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

  // ---------- face filters ----------

  const FILTERS = [
    { k: "", e: "🚫", label: "None" },
    { k: "bighead", e: "🎈", label: "Big head" },
    { k: "googly", e: "👀", label: "Googly eyes" },
    { k: "puppy", e: "🐶", label: "Puppy" },
    { k: "bunny", e: "🐰", label: "Bunny" },
    { k: "kitty", e: "🐱", label: "Kitty" },
    { k: "clown", e: "🤡", label: "Clown" },
    { k: "hearteyes", e: "😍", label: "Heart eyes" },
    { k: "pixel", e: "😎", label: "Deal with it" },
    { k: "shades", e: "🕶️", label: "Shades" },
    { k: "mustache", e: "🥸", label: "Mustache" },
    { k: "crown", e: "👑", label: "Crown" },
    { k: "flowers", e: "🌸", label: "Flower crown" },
    { k: "devil", e: "😈", label: "Devil" },
    { k: "angel", e: "😇", label: "Angel" },
    { k: "party", e: "🥳", label: "Party" },
    { k: "film", e: "🎞️", label: "Old film" },
    { k: "glow", e: "✨", label: "Soft glow" },
  ];
  const fx = { k: "", landmarker: null, loading: null, video: null, canvas: null, ctx: null, out: null, srcId: "", raf: 0, face: null, lastT: -1 };

  async function loadTracker() {
    if (fx.landmarker) return fx.landmarker;
    fx.loading ||= (async () => {
      const vision = await import(`${MP}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
      const make = (delegate) => vision.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", numFaces: 1 });
      try { fx.landmarker = await make("GPU"); } catch { fx.landmarker = await make("CPU"); }
      return fx.landmarker;
    })();
    return fx.loading;
  }

  function startPipeline() {
    const cam = cameraTrack();
    if (!cam || !me.cam) return false;
    stopPipeline(false);
    const settings = cam.getSettings();
    fx.video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, autoplay: true });
    fx.video.srcObject = new MediaStream([cam]);
    fx.video.play().catch(() => {});
    fx.canvas = document.createElement("canvas");
    fx.canvas.className = "fx-preview";
    fx.canvas.width = settings.width || 640;
    fx.canvas.height = settings.height || 480;
    fx.ctx = fx.canvas.getContext("2d");
    fx.out = fx.canvas.captureStream(24).getVideoTracks()[0];
    fx.srcId = cam.id;
    const frame = () => {
      fx.raf = requestAnimationFrame(frame);
      const v = fx.video;
      if (!v || v.readyState < 2) return;
      if (v.videoWidth && (fx.canvas.width !== v.videoWidth || fx.canvas.height !== v.videoHeight)) { fx.canvas.width = v.videoWidth; fx.canvas.height = v.videoHeight; }
      const now = performance.now();
      if (fx.landmarker && v.currentTime !== fx.lastT) {
        fx.lastT = v.currentTime;
        try { fx.face = fx.landmarker.detectForVideo(v, now).faceLandmarks?.[0] || null; } catch { fx.face = null; }
      }
      paintFrame(now);
    };
    frame();
    setOutgoing(SLOT.camera, fx.out);
    placePreview();
    return true;
  }

  function stopPipeline(restore = true) {
    cancelAnimationFrame(fx.raf);
    fx.out?.stop();
    fx.canvas?.remove();
    if (fx.video) fx.video.srcObject = null;
    Object.assign(fx, { video: null, canvas: null, ctx: null, out: null, srcId: "", face: null });
    if (restore && me.cam) setOutgoing(SLOT.camera, cameraTrack());
  }

  // our own tile shows the filtered picture too
  function placePreview() {
    if (!fx.canvas) return;
    const tile = tileOf(me.id);
    if (tile && fx.canvas.parentElement !== tile) tile.querySelector("video")?.after(fx.canvas);
  }

  const P = (i) => { const p = fx.face[i]; return [p.x * fx.canvas.width, p.y * fx.canvas.height]; };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function emoji(ctx, ch, x, y, size, angle = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.font = `${Math.round(size)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }

  function whiskers(ctx, nose, fw, angle, color) {
    ctx.save(); ctx.translate(nose[0], nose[1]); ctx.rotate(angle);
    ctx.strokeStyle = color; ctx.lineWidth = fw * .009; ctx.lineCap = "round";
    for (const side of [-1, 1]) for (const k of [-1, 0, 1]) {
      ctx.beginPath(); ctx.moveTo(side * fw * .1, fw * .04 + k * fw * .025); ctx.lineTo(side * fw * .36, fw * .01 + k * fw * .07); ctx.stroke();
    }
    ctx.restore();
  }
  function filmLook(ctx, W, H, now) {
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.max(W, H) * .75);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(20,10,0,.6)");
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,.08)";
    for (let i = 0; i < 160; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
    if (Math.random() < .3) { ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(Math.random() * W, 0, 1.5, H); }
    if (Math.floor(now / 90) % 23 === 0) { ctx.fillStyle = "rgba(255,240,200,.06)"; ctx.fillRect(0, 0, W, H); }
  }
  function confetti(ctx, W, H, now) {
    const cols = ["#ff375f", "#ffd60a", "#0a84ff", "#30d158", "#bf5af2", "#ff9f0a"];
    for (let i = 0; i < 26; i++) {
      const sp = 40 + (i * 37) % 50, x = ((i * 97) % 100) / 100 * W + Math.sin(now / 600 + i) * 18;
      const y = ((now / 1000 * sp + i * 53) % (H + 40)) - 20;
      ctx.save(); ctx.translate(x, y); ctx.rotate(now / 300 + i);
      ctx.fillStyle = cols[i % cols.length]; ctx.fillRect(-5, -3, 10, 6);
      ctx.restore();
    }
  }

  function paintFrame(now) {
    const { ctx, canvas, video } = fx;
    const W = canvas.width, H = canvas.height;
    ctx.filter = fx.k === "glow" ? "brightness(1.08) saturate(1.15) contrast(1.03)" : fx.k === "film" ? "sepia(.85) contrast(1.12) brightness(.95)" : "none";
    ctx.drawImage(video, 0, 0, W, H);
    ctx.filter = "none";
    if (fx.k === "film") { filmLook(ctx, W, H, now); return; }
    if (fx.k === "party") confetti(ctx, W, H, now);
    if (!fx.face || !fx.k) return;
    const L = P(234), R = P(454), top = P(10), chin = P(152), nose = P(1);
    const eyeL = P(33), eyeR = P(263);
    const fw = dist(L, R), angle = Math.atan2(eyeR[1] - eyeL[1], eyeR[0] - eyeL[0]);
    const up = [Math.sin(angle), -Math.cos(angle)]; // unit vector to the top of the head
    const above = (pt, k) => [pt[0] + up[0] * fw * k, pt[1] + up[1] * fw * k];
    const mouthOpen = dist(P(13), P(14)) / fw;
    const eyeC = (side) => { const a = P(side < 0 ? 33 : 263), b = P(side < 0 ? 133 : 362); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    const along = (pt, k) => [pt[0] + Math.cos(angle) * fw * k, pt[1] + Math.sin(angle) * fw * k];
    switch (fx.k) {
      case "bighead": {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const p of fx.face) { const x = p.x * W, y = p.y * H; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rw = (x1 - x0) * .62, rh = (y1 - y0) * .66, k = 1.55;
        ctx.save();
        ctx.beginPath(); ctx.ellipse(cx, cy - rh * .2, rw * k, rh * k, angle, 0, Math.PI * 2); ctx.clip();
        const sx = cx - rw, sy = cy - rh;
        ctx.drawImage(video, sx * video.videoWidth / W, sy * video.videoHeight / H, 2 * rw * video.videoWidth / W, 2 * rh * video.videoHeight / H, cx - rw * k, cy - rh * k - rh * .2, 2 * rw * k, 2 * rh * k);
        ctx.restore();
        break;
      }
      case "googly": {
        fx.eyes ||= [{ x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0 }, { x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0 }];
        [-1, 1].forEach((side, i) => {
          const c = eyeC(side), e = fx.eyes[i], r = fw * .14;
          // the pupil lags behind head movement and falls with gravity, then settles
          const mvx = c[0] - (e.px || c[0]), mvy = c[1] - (e.py || c[1]);
          e.px = c[0]; e.py = c[1];
          e.vx = (e.vx - mvx * .6 - e.x * .08) * .86; e.vy = (e.vy - mvy * .6 + r * .05 - e.y * .08) * .86;
          e.x += e.vx; e.y += e.vy;
          const m = Math.hypot(e.x, e.y), max = r * .48;
          if (m > max) { e.x *= max / m; e.y *= max / m; e.vx *= -.4; e.vy *= -.4; }
          ctx.fillStyle = "#fff"; ctx.strokeStyle = "#111"; ctx.lineWidth = fw * .012;
          ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(c[0] + e.x, c[1] + e.y, r * .5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.beginPath(); ctx.arc(c[0] + e.x - r * .17, c[1] + e.y - r * .17, r * .12, 0, Math.PI * 2); ctx.fill();
        });
        break;
      }
      case "bunny": {
        for (const side of [-1, 1]) {
          const c = above(along(top, side * .2), .42);
          ctx.save(); ctx.translate(c[0], c[1]); ctx.rotate(angle + side * .18);
          ctx.fillStyle = "#fbfbfb"; ctx.beginPath(); ctx.ellipse(0, 0, fw * .13, fw * .42, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#ffb3c7"; ctx.beginPath(); ctx.ellipse(0, fw * .03, fw * .065, fw * .32, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        whiskers(ctx, nose, fw, angle, "#fff");
        ctx.fillStyle = "#ff8fab"; ctx.beginPath(); ctx.ellipse(nose[0], nose[1], fw * .055, fw * .04, angle, 0, Math.PI * 2); ctx.fill();
        if (mouthOpen > .06) { const lip = P(14); ctx.fillStyle = "#fff"; ctx.save(); ctx.translate(lip[0], lip[1]); ctx.rotate(angle); ctx.fillRect(-fw * .05, -fw * .01, fw * .045, fw * .07); ctx.fillRect(fw * .005, -fw * .01, fw * .045, fw * .07); ctx.restore(); }
        break;
      }
      case "kitty": {
        for (const side of [-1, 1]) {
          const c = above(along(top, side * .34), .14);
          ctx.save(); ctx.translate(c[0], c[1]); ctx.rotate(angle + side * .25);
          ctx.fillStyle = "#4a4a4f"; ctx.beginPath(); ctx.moveTo(-fw * .15, fw * .1); ctx.lineTo(0, -fw * .24); ctx.lineTo(fw * .15, fw * .1); ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#ff9fb8"; ctx.beginPath(); ctx.moveTo(-fw * .08, fw * .07); ctx.lineTo(0, -fw * .13); ctx.lineTo(fw * .08, fw * .07); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        whiskers(ctx, nose, fw, angle, "#222");
        ctx.fillStyle = "#ff6f91"; ctx.beginPath(); ctx.moveTo(nose[0] - fw * .04, nose[1] - fw * .02); ctx.lineTo(nose[0] + fw * .04, nose[1] - fw * .02); ctx.lineTo(nose[0], nose[1] + fw * .03); ctx.closePath(); ctx.fill();
        break;
      }
      case "clown": {
        const wig = ["#ff375f", "#ff9f0a", "#ffd60a", "#30d158", "#0a84ff", "#bf5af2"];
        for (let i = 0; i < 14; i++) {
          const t = (i / 13) * 2 - 1, c = above(along(top, t * .62), .02 + (1 - t * t) * .16 - Math.abs(t) * .1);
          ctx.fillStyle = wig[i % wig.length]; ctx.beginPath(); ctx.arc(c[0], c[1], fw * .14, 0, Math.PI * 2); ctx.fill();
        }
        for (const side of [-1, 1]) { const ch = P(side < 0 ? 205 : 425); ctx.fillStyle = "rgba(255, 60, 90, .42)"; ctx.beginPath(); ctx.arc(ch[0], ch[1], fw * .1, 0, Math.PI * 2); ctx.fill(); }
        const g = ctx.createRadialGradient(nose[0] - fw * .03, nose[1] - fw * .03, fw * .01, nose[0], nose[1], fw * .1);
        g.addColorStop(0, "#ff8a8a"); g.addColorStop(.35, "#ff2d2d"); g.addColorStop(1, "#b00000");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(nose[0], nose[1], fw * .1, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "hearteyes": {
        [-1, 1].forEach((side) => { const c = eyeC(side); emoji(ctx, "❤️", c[0], c[1], fw * (.3 + .04 * Math.sin(now / 160)), angle); });
        break;
      }
      case "pixel": {
        const shape = ["XXXXXXXXXXXXXXXXXXXX", ".XWWXXXX..XXXWWXXXX.", ".XWXXXXX..XXWXXXXX..", "..XXXXX....XXXXX...."];
        const mid = [(eyeL[0] + eyeR[0]) / 2, (eyeL[1] + eyeR[1]) / 2], px = fw * 1.15 / 20;
        ctx.save(); ctx.translate(mid[0], mid[1] - px); ctx.rotate(angle);
        shape.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === ".") return; ctx.fillStyle = ch === "W" ? "#fff" : "#000"; ctx.fillRect((x - 10) * px, (y - 1) * px, px + .5, px + .5); }));
        ctx.restore();
        break;
      }
      case "devil": {
        for (const side of [-1, 1]) {
          const c = above(along(top, side * .3), .1);
          ctx.save(); ctx.translate(c[0], c[1]); ctx.rotate(angle + side * .35);
          const g = ctx.createLinearGradient(0, fw * .1, 0, -fw * .26); g.addColorStop(0, "#8b0000"); g.addColorStop(1, "#ff3b30");
          ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-fw * .08, fw * .08); ctx.quadraticCurveTo(-fw * .06 * side - fw * .02, -fw * .1, fw * .05 * side, -fw * .27); ctx.quadraticCurveTo(fw * .02, -fw * .05, fw * .08, fw * .08); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        break;
      }
      case "angel": {
        const c = above(top, .3);
        ctx.save(); ctx.translate(c[0], c[1]); ctx.rotate(angle);
        ctx.shadowColor = "rgba(255, 220, 120, .95)"; ctx.shadowBlur = fw * .15;
        ctx.strokeStyle = "#ffe08a"; ctx.lineWidth = fw * .045;
        ctx.beginPath(); ctx.ellipse(0, Math.sin(now / 500) * fw * .02, fw * .36, fw * .09, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        const g = ctx.createRadialGradient(nose[0], nose[1], fw * .3, nose[0], nose[1], fw * 1.3);
        g.addColorStop(0, "rgba(255, 245, 220, .14)"); g.addColorStop(1, "rgba(255, 245, 220, 0)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        break;
      }
      case "party": {
        const c = above(along(top, .12), .38);
        ctx.save(); ctx.translate(c[0], c[1]); ctx.rotate(angle + .22);
        const h = fw * .62, b = fw * .26;
        ctx.beginPath(); ctx.moveTo(-b, h / 2); ctx.lineTo(0, -h / 2); ctx.lineTo(b, h / 2); ctx.closePath();
        ctx.save(); ctx.clip();
        const stripes = ["#ff375f", "#ffd60a", "#0a84ff", "#30d158"];
        for (let i = -6; i < 8; i++) { ctx.fillStyle = stripes[(i + 8) % 4]; ctx.save(); ctx.rotate(-.6); ctx.fillRect(-h, i * fw * .08, h * 2, fw * .08); ctx.restore(); }
        ctx.restore();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, -h / 2, fw * .07, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case "puppy": {
        for (const side of [-1, 1]) {
          const base = [top[0] + Math.cos(angle) * side * fw * .38, top[1] + Math.sin(angle) * side * fw * .38];
          const c = above(base, .12);
          ctx.save(); ctx.translate(c[0], c[1]); ctx.rotate(angle + side * .45);
          ctx.fillStyle = "#7a4a26"; ctx.beginPath(); ctx.ellipse(0, 0, fw * .17, fw * .3, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#f2a4b5"; ctx.beginPath(); ctx.ellipse(0, fw * .03, fw * .09, fw * .19, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        ctx.save(); ctx.translate(nose[0], nose[1]); ctx.rotate(angle);
        ctx.fillStyle = "#1b1b1d"; ctx.beginPath(); ctx.ellipse(0, -fw * .01, fw * .09, fw * .065, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.beginPath(); ctx.ellipse(-fw * .025, -fw * .03, fw * .025, fw * .014, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        if (mouthOpen > .08) {
          const lip = P(14);
          ctx.save(); ctx.translate(lip[0], lip[1]); ctx.rotate(angle);
          ctx.fillStyle = "#ff6b8b"; ctx.beginPath(); ctx.ellipse(0, fw * .12, fw * .1, fw * .15, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#e0446a"; ctx.lineWidth = fw * .012; ctx.beginPath(); ctx.moveTo(0, fw * .02); ctx.lineTo(0, fw * .2); ctx.stroke();
          ctx.restore();
        }
        break;
      }
      case "crown": { const c = above(top, .32); emoji(ctx, "👑", c[0], c[1], fw * .75, angle); break; }
      case "flowers": {
        const set = ["🌸", "🌼", "🌺", "🌷", "🌼", "🌸", "🌺"];
        set.forEach((f, i) => {
          const t = (i / (set.length - 1)) * 2 - 1; // -1 … 1 across the head
          const base = [top[0] + Math.cos(angle) * t * fw * .55, top[1] + Math.sin(angle) * t * fw * .55];
          const c = above(base, .06 + (1 - t * t) * .1);
          emoji(ctx, f, c[0], c[1], fw * .26, angle + t * .5);
        });
        break;
      }
      case "shades": {
        const mid = [(eyeL[0] + eyeR[0]) / 2, (eyeL[1] + eyeR[1]) / 2];
        emoji(ctx, "🕶️", mid[0], mid[1] + fw * .02, fw * 1.05, angle);
        break;
      }
      case "hearts": {
        for (const side of [-1, 1]) {
          const cheek = P(side < 0 ? 205 : 425);
          const g = ctx.createRadialGradient(cheek[0], cheek[1], 0, cheek[0], cheek[1], fw * .14);
          g.addColorStop(0, "rgba(255, 92, 132, .45)"); g.addColorStop(1, "rgba(255, 92, 132, 0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cheek[0], cheek[1], fw * .14, 0, Math.PI * 2); ctx.fill();
        }
        for (let i = 0; i < 6; i++) {
          const a = now / 1400 + (i / 6) * Math.PI * 2;
          const c = above([top[0] + Math.cos(a) * fw * .7, top[1] + Math.sin(a) * fw * .12], .12);
          emoji(ctx, "❤️", c[0], c[1], fw * (.14 + .03 * Math.sin(now / 300 + i)), 0);
        }
        break;
      }
      case "mustache": {
        const lip = P(0);
        ctx.save(); ctx.translate(lip[0], lip[1] - fw * .035); ctx.rotate(angle);
        ctx.fillStyle = "#2b1b12";
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(side * fw * .1, -fw * .07, side * fw * .22, -fw * .02, side * fw * .26, fw * .03);
          ctx.bezierCurveTo(side * fw * .2, fw * .0, side * fw * .1, fw * .04, 0, fw * .02);
          ctx.fill();
        }
        ctx.restore();
        break;
      }
      case "glow": {
        const g = ctx.createRadialGradient(nose[0], nose[1], fw * .2, nose[0], nose[1], fw * 1.2);
        g.addColorStop(0, "rgba(255, 230, 210, .12)"); g.addColorStop(1, "rgba(255, 230, 210, 0)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        for (const side of [-1, 1]) {
          const cheek = P(side < 0 ? 205 : 425);
          const b = ctx.createRadialGradient(cheek[0], cheek[1], 0, cheek[0], cheek[1], fw * .13);
          b.addColorStop(0, "rgba(255, 120, 140, .22)"); b.addColorStop(1, "rgba(255, 120, 140, 0)");
          ctx.fillStyle = b; ctx.beginPath(); ctx.arc(cheek[0], cheek[1], fw * .13, 0, Math.PI * 2); ctx.fill();
        }
        if (chin) { /* keeps the shape stable */ }
        break;
      }
    }
  }

  async function setFilter(k) {
    if (k && !me.cam) { toast("Turn your camera on to use filters"); return; }
    fx.k = k;
    paintBars();
    if (!k) { stopPipeline(true); send("fx-note", { f: "" }); return; }
    if (!fx.landmarker && k !== "film") {
      toast("Loading filters…");
      try { await loadTracker(); } catch (error) { console.warn(error); fx.k = ""; paintBars(); toast("Filters couldn't load. Check the internet."); return; }
    }
    if (!fx.canvas || fx.srcId !== cameraTrack()?.id) startPipeline();
    const f = FILTERS.find((x) => x.k === k);
    send("fx-note", { f: f?.label || "" });
  }

  // keep the filter alive when the camera is switched, turned off or the tile is redrawn
  setInterval(() => {
    if (!fx.k) return;
    if (!me.cam || !cameraTrack()) { if (fx.canvas) stopPipeline(false); return; }
    if (!fx.canvas || fx.srcId !== cameraTrack().id) startPipeline();
    else placePreview();
  }, 600);

  // ---------- voice changer ----------

  const VOICES = [
    { k: "", e: "🎙️", label: "Normal" },
    { k: "chipmunk", e: "🐿️", label: "Chipmunk" },
    { k: "baby", e: "👶", label: "Baby" },
    { k: "squeaky", e: "🐭", label: "Squeaky" },
    { k: "deep", e: "🦁", label: "Deep" },
    { k: "monster", e: "👹", label: "Monster" },
    { k: "robot", e: "🤖", label: "Robot" },
    { k: "alien", e: "👽", label: "Alien" },
    { k: "ghost", e: "👻", label: "Ghost" },
    { k: "oldman", e: "👴", label: "Old man" },
    { k: "announcer", e: "📢", label: "Announcer" },
    { k: "megaphone", e: "📣", label: "Megaphone" },
    { k: "radio", e: "📻", label: "Old radio" },
    { k: "phone", e: "☎️", label: "Telephone" },
    { k: "underwater", e: "🫧", label: "Underwater" },
    { k: "cave", e: "🏔️", label: "Echo" },
    { k: "stadium", e: "🏟️", label: "Stadium" },
    { k: "shower", e: "🚿", label: "Shower singer" },
  ];
  const vx = { k: "", ctx: null, src: null, dest: null, nodes: [], out: null, srcId: "" };

  /** A pitch shifter built from two crossfading, modulated delay lines. */
  function pitchShifter(c, amount) {
    const delayTime = .1, fadeTime = .05, bufferTime = .1, sr = c.sampleRate;
    const len1 = Math.round(bufferTime * sr), len2 = Math.round((bufferTime - 2 * fadeTime) * sr), len = len1 + len2;
    const ramp = (up) => { const b = c.createBuffer(1, len, sr), d = b.getChannelData(0); for (let i = 0; i < len1; i++) d[i] = up ? (len1 - i) / len : i / len1; return b; };
    const fade = () => { const b = c.createBuffer(1, len, sr), d = b.getChannelData(0), fl = fadeTime * sr, f2 = len1 - fl; for (let i = 0; i < len1; i++) d[i] = i < fl ? Math.sqrt(i / fl) : i >= f2 ? Math.sqrt(1 - (i - f2) / fl) : 1; return b; };
    const input = c.createGain(), output = c.createGain();
    const src = (buf) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; vx.nodes.push(s); return s; };
    const up = amount > 0;
    const m1 = src(ramp(up)), m2 = src(ramp(up));
    const mg1 = c.createGain(), mg2 = c.createGain();
    mg1.gain.value = mg2.gain.value = delayTime * Math.abs(amount);
    const d1 = c.createDelay(1), d2 = c.createDelay(1);
    m1.connect(mg1).connect(d1.delayTime); m2.connect(mg2).connect(d2.delayTime);
    const f1 = src(fade()), f2 = src(fade());
    const mix1 = c.createGain(), mix2 = c.createGain(); mix1.gain.value = mix2.gain.value = 0;
    f1.connect(mix1.gain); f2.connect(mix2.gain);
    input.connect(d1).connect(mix1).connect(output);
    input.connect(d2).connect(mix2).connect(output);
    const t = c.currentTime + .05, t2 = t + bufferTime - fadeTime;
    m1.start(t); f1.start(t); m2.start(t2); f2.start(t2);
    return { input, output };
  }

  // building blocks for the voices
  function reverb(c, secs, decay = 3) {
    const len = Math.round(c.sampleRate * secs), buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    const conv = c.createConvolver(); conv.buffer = buf; return conv;
  }
  function shaper(c, amount) {
    const ws = c.createWaveShaper(), n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
    ws.curve = curve; ws.oversample = "2x"; return ws;
  }
  function band(c, type, f, q = .7, gain = 0) { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain; return b; }
  function lfo(c, rate, depth, target) { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = rate; g.gain.value = depth; o.connect(g).connect(target); o.start(); vx.nodes.push(o); return o; }
  /** dry + wet mix of a reverb */
  function wetDry(c, src, out, wet, verb) { const dg = c.createGain(), wg = c.createGain(); dg.gain.value = 1 - wet * .5; wg.gain.value = wet; src.connect(dg).connect(out); src.connect(verb).connect(wg).connect(out); }

  function buildVoice() {
    const mic = micTrack();
    if (!mic) return false;
    stopVoice(false);
    const c = vx.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (c.state === "suspended") c.resume();
    vx.src = c.createMediaStreamSource(new MediaStream([mic]));
    vx.dest = c.createMediaStreamDestination();
    const chain = (...nodes) => { nodes.reduce((a, b) => { a.connect(b.input || b); return b.output || b; }); };
    if (vx.k === "chipmunk") { const p = pitchShifter(c, .65); chain(vx.src, p, vx.dest); }
    else if (vx.k === "deep") { const p = pitchShifter(c, -.45); const lp = c.createBiquadFilter(); lp.type = "lowshelf"; lp.frequency.value = 300; lp.gain.value = 6; chain(vx.src, p, lp, vx.dest); }
    else if (vx.k === "robot") {
      const ring = c.createGain(); ring.gain.value = 0;
      const osc = c.createOscillator(); osc.frequency.value = 55; osc.connect(ring.gain); osc.start(); vx.nodes.push(osc);
      const comb = c.createDelay(.1); comb.delayTime.value = .012; const fb = c.createGain(); fb.gain.value = .45;
      comb.connect(fb).connect(comb);
      vx.src.connect(ring); ring.connect(comb); ring.connect(vx.dest); comb.connect(vx.dest);
    } else if (vx.k === "cave") {
      const delay = c.createDelay(1); delay.delayTime.value = .22; const fb = c.createGain(); fb.gain.value = .42;
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
      vx.src.connect(vx.dest); vx.src.connect(delay); delay.connect(lp).connect(fb).connect(delay); lp.connect(vx.dest);
    } else if (vx.k === "alien") {
      const p = pitchShifter(c, .3);
      const ring = c.createGain(); ring.gain.value = .5;
      const osc = c.createOscillator(); osc.frequency.value = 9; const depth = c.createGain(); depth.gain.value = .5;
      osc.connect(depth).connect(ring.gain); osc.start(); vx.nodes.push(osc);
      chain(vx.src, p, ring, vx.dest);
    } else if (vx.k === "baby") {
      chain(vx.src, pitchShifter(c, .4), band(c, "highshelf", 2500, .7, 4), vx.dest);
    } else if (vx.k === "squeaky") {
      chain(vx.src, pitchShifter(c, 1), band(c, "highpass", 300), vx.dest);
    } else if (vx.k === "monster") {
      const p = pitchShifter(c, -.75), sh = shaper(c, 6), lo = band(c, "lowshelf", 200, .7, 9), g = c.createGain(); g.gain.value = .7;
      chain(vx.src, p, sh, lo, g, vx.dest);
    } else if (vx.k === "ghost") {
      const p = pitchShifter(c, -.15), trem = c.createGain(); trem.gain.value = .7; lfo(c, 5, .3, trem.gain);
      chain(vx.src, p, trem);
      wetDry(c, trem, vx.dest, .9, reverb(c, 3.2, 2));
    } else if (vx.k === "oldman") {
      const d = c.createDelay(.05); d.delayTime.value = .006; lfo(c, 6, .0025, d.delayTime);
      chain(vx.src, pitchShifter(c, -.12), d, band(c, "bandpass", 1300, .5), vx.dest);
    } else if (vx.k === "announcer") {
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -30; comp.ratio.value = 8;
      const p = pitchShifter(c, -.2), lo = band(c, "lowshelf", 180, .7, 6);
      chain(vx.src, p, lo, comp);
      wetDry(c, comp, vx.dest, .45, reverb(c, 2.2, 3));
    } else if (vx.k === "megaphone") {
      chain(vx.src, band(c, "highpass", 600), band(c, "lowpass", 3600), shaper(c, 30), band(c, "peaking", 1800, 1, 8), (() => { const g = c.createGain(); g.gain.value = .5; return g; })(), vx.dest);
    } else if (vx.k === "radio") {
      chain(vx.src, band(c, "highpass", 450), band(c, "lowpass", 2600), shaper(c, 8), (() => { const g = c.createGain(); g.gain.value = .8; return g; })(), vx.dest);
      loopHiss(c, .015);
    } else if (vx.k === "phone") {
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -35; comp.ratio.value = 12;
      chain(vx.src, band(c, "highpass", 400, 1), band(c, "lowpass", 3000, 1), shaper(c, 3), comp, vx.dest);
    } else if (vx.k === "underwater") {
      const lp = band(c, "lowpass", 550, 3); lfo(c, .6, 180, lp.frequency);
      const d = c.createDelay(.05); d.delayTime.value = .01; lfo(c, 3, .004, d.delayTime);
      chain(vx.src, d, lp, vx.dest);
    } else if (vx.k === "stadium") {
      wetDry(c, vx.src, vx.dest, .8, reverb(c, 4.5, 2.2));
    } else if (vx.k === "shower") {
      const eq = band(c, "peaking", 2500, 1, 4);
      chain(vx.src, pitchShifter(c, .06), eq);
      wetDry(c, eq, vx.dest, .7, reverb(c, 1.2, 4));
    }
    vx.out = vx.dest.stream.getAudioTracks()[0];
    vx.srcId = mic.id;
    setOutgoing(SLOT.audio, vx.out);
    return true;
  }
  function loopHiss(c, level) {
    const len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * level;
    const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.connect(vx.dest); s.start(); vx.nodes.push(s);
  }
  function stopVoice(restore = true) {
    vx.nodes.forEach((n) => { try { n.stop(); } catch { /* done */ } });
    vx.src?.disconnect();
    vx.out?.stop();
    Object.assign(vx, { src: null, dest: null, nodes: [], out: null, srcId: "" });
    if (restore) setOutgoing(SLOT.audio, micTrack());
  }
  function setVoice(k) {
    vx.k = k;
    paintBars();
    if (!k) stopVoice(true);
    else if (!buildVoice()) { vx.k = ""; paintBars(); return toast("No microphone"); }
    const v = VOICES.find((x) => x.k === k);
    send("fx-note", { v: k ? v.label : "" });
    if (k) toast(`${other()?.name || "They"} hear${other() ? "s" : ""} your ${v.label.toLowerCase()} voice`);
  }
  setInterval(() => { if (vx.k && micTrack() && vx.srcId !== micTrack().id) buildVoice(); }, 1000);
  const other = () => [...peers.values()][0];

  // ---------- the picker bars ----------

  let bar = null;
  function openBar(kind) {
    window.DU.kit.toggleTray(false);
    const list = kind === "filters" ? FILTERS : VOICES;
    const w = window.DU.win.open({
      id: kind, title: kind === "filters" ? "Face filters" : "Voice changer", icon: kind === "filters" ? "face_retouching_natural" : "graphic_eq",
      w: 360, h: 430,
      html: `<p class="fw-note">${kind === "filters" ? "Your partner sees you with it. Camera needs to be on." : "Your partner hears your voice changed. Tap Normal to go back."}</p>
        <div class="fx-grid">${list.map((x) => `<button data-fx="${x.k}"><span class="fx-emoji">${x.e}</span><small>${esc(x.label)}</small></button>`).join("")}</div>`,
      onClose: () => { bar = null; },
    });
    bar = w.el;
    bar.dataset.kind = kind;
    paintBars();
    w.body.onclick = (e) => {
      const b = e.target.closest("[data-fx]");
      if (b) { if (kind === "filters") setFilter(b.dataset.fx); else setVoice(b.dataset.fx); }
    };
  }
  function closeBar() { window.DU.win.get("filters")?.close(); window.DU.win.get("voice")?.close(); bar = null; }
  function paintBars() {
    const f = FILTERS.find((x) => x.k === fx.k), v = VOICES.find((x) => x.k === vx.k);
    const tf = q("#tray-filter"), tv = q("#tray-voice");
    if (tf) tf.textContent = fx.k ? `${f.label} · on` : "17 funny looks";
    if (tv) tv.textContent = vx.k ? `${v.label} · on` : "17 voices";
    q("[data-tg=filters]")?.classList.toggle("on", Boolean(fx.k));
    q("[data-tg=voicefx]")?.classList.toggle("on", Boolean(vx.k));
    for (const kind of ["filters", "voice"]) {
      window.DU.win.get(kind)?.el.querySelectorAll("[data-fx]").forEach((b) => b.classList.toggle("on", b.dataset.fx === (kind === "filters" ? fx.k : vx.k)));
    }
  }

  // ---------- hooks ----------

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    outTrack(slot) {
      if (slot === SLOT.camera && fx.k && fx.out && me.cam) return fx.out;
      if (slot === SLOT.audio && vx.k && vx.out) return vx.out;
      return null;
    },
    onCoupleClick(button) {
      if (button.dataset.tg === "filters") openBar("filters");
      else if (button.dataset.tg === "voicefx") openBar("voice");
      else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "fx-note") return prev.msg?.(message, peer);
      const d = message.data || {};
      if (d.f) toast(`${peer.name} put on the ${String(d.f).toLowerCase()} filter`);
      if (d.v) toast(`${peer.name} switched to a ${String(d.v).toLowerCase()} voice`);
    },
    onCoupleLeave(...args) {
      prev.leave?.(...args);
      closeBar();
      fx.k = ""; stopPipeline(false);
      vx.k = ""; stopVoice(false);
      paintBars();
    },
  });
})();
