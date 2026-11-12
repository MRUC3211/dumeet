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
    { k: "puppy", e: "🐶", label: "Puppy" },
    { k: "crown", e: "👑", label: "Crown" },
    { k: "flowers", e: "🌸", label: "Flowers" },
    { k: "shades", e: "🕶️", label: "Shades" },
    { k: "hearts", e: "😍", label: "Hearts" },
    { k: "mustache", e: "🥸", label: "Mustache" },
    { k: "glow", e: "✨", label: "Glow" },
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

  function paintFrame(now) {
    const { ctx, canvas, video } = fx;
    const W = canvas.width, H = canvas.height;
    ctx.filter = fx.k === "glow" ? "brightness(1.08) saturate(1.15) contrast(1.03)" : "none";
    ctx.drawImage(video, 0, 0, W, H);
    ctx.filter = "none";
    if (!fx.face || !fx.k) return;
    const L = P(234), R = P(454), top = P(10), chin = P(152), nose = P(1);
    const eyeL = P(33), eyeR = P(263);
    const fw = dist(L, R), angle = Math.atan2(eyeR[1] - eyeL[1], eyeR[0] - eyeL[0]);
    const up = [Math.sin(angle), -Math.cos(angle)]; // unit vector to the top of the head
    const above = (pt, k) => [pt[0] + up[0] * fw * k, pt[1] + up[1] * fw * k];
    const mouthOpen = dist(P(13), P(14)) / fw;
    switch (fx.k) {
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
    if (!fx.landmarker) {
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
    { k: "deep", e: "🦁", label: "Deep" },
    { k: "robot", e: "🤖", label: "Robot" },
    { k: "cave", e: "🏔️", label: "Echo" },
    { k: "alien", e: "👽", label: "Alien" },
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
    }
    vx.out = vx.dest.stream.getAudioTracks()[0];
    vx.srcId = mic.id;
    setOutgoing(SLOT.audio, vx.out);
    return true;
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
    closeBar();
    const list = kind === "filters" ? FILTERS : VOICES;
    bar = document.createElement("div");
    bar.className = `fx-bar ${kind}`;
    bar.dataset.kind = kind;
    bar.innerHTML = `<div class="fx-strip">${list.map((x) => `<button data-fx="${x.k}"><span class="fx-emoji">${x.e}</span><small>${esc(x.label)}</small></button>`).join("")}</div><button class="fx-x" aria-label="Done"><span class="icon">check</span></button>`;
    q(".main-area").append(bar);
    paintBars();
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fx]");
      if (b) { if (kind === "filters") setFilter(b.dataset.fx); else setVoice(b.dataset.fx); }
      else if (e.target.closest(".fx-x")) closeBar();
    });
  }
  function closeBar() { bar?.remove(); bar = null; }
  function paintBars() {
    const f = FILTERS.find((x) => x.k === fx.k), v = VOICES.find((x) => x.k === vx.k);
    const tf = q("#tray-filter"), tv = q("#tray-voice");
    if (tf) tf.textContent = fx.k ? `${f.label} · on` : "On your camera";
    if (tv) tv.textContent = vx.k ? `${v.label} · on` : "Funny voices";
    q("[data-tg=filters]")?.classList.toggle("on", Boolean(fx.k));
    q("[data-tg=voicefx]")?.classList.toggle("on", Boolean(vx.k));
    bar?.querySelectorAll("[data-fx]").forEach((b) => b.classList.toggle("on", b.dataset.fx === (bar.dataset.kind === "filters" ? fx.k : vx.k)));
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
