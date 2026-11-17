// DU Meet · camera games: live, face-detection mini-games played between the two
// of you on the call (Don't laugh, Longest smile…). A small engine reads your
// expression with MediaPipe FaceLandmarker and syncs the round to both phones.
// Uses globals from app.js (cameraTrack, me, send, peers, toast, polling) and window.DU.

(() => {
  "use strict";
  const q = (s, r = document) => r.querySelector(s);
  const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

  // ---------- the games ----------
  // tick(sig, st) runs every frame for the local player. mode decides who wins.
  const GAMES = {
    dontlaugh: {
      name: "Don't laugh", icon: "😐", tag: "Jo pehle hansa, wo haara", mode: "lose-first",
      hud: "Keep a straight face 😐", go: "Don't laugh!",
      tick: (sig, st) => { if (sig.smile > 0.42 || sig.jawOpen > 0.5) { st.hot = (st.hot || 0) + 1; if (st.hot >= 4) return { lost: true }; } else st.hot = 0; return null; },
    },
    longestsmile: {
      name: "Longest smile", icon: "😄", tag: "Sabse der tak, sabse badi smile", mode: "high-score", duration: 12000,
      hud: "SMILE! 😄", go: "Smile!",
      tick: (sig, st) => { if (sig.smile > 0.35) st.score = Math.round(((st.score || 0) + sig.smile) * 100) / 100; return null; },
    },
    stare: {
      name: "Stare contest", icon: "👁️", tag: "Jo pehle palak jhapka, wo haara", mode: "lose-first",
      hud: "Don't blink 👁️", go: "Stare!",
      tick: (sig, st) => { if (sig.blink > 0.5) { st.hot = (st.hot || 0) + 1; if (st.hot >= 3) return { lost: true }; } else st.hot = 0; return null; },
    },
    catchmouth: {
      name: "Catch in your mouth", icon: "👄", tag: "Girti cheezein muh khol ke pakdo", detector: "face",
      play(api) {
        let score = 0;
        api.top().innerHTML = `<div class="cg-hud">👄 Muh khol ke catch karo!</div>`;
        api.center().innerHTML = `<div class="cm-zone"><div class="cm-mouth">😐</div></div><div class="cg-score">0</div>`;
        const zone = api.center().querySelector(".cm-zone"), mouth = api.center().querySelector(".cm-mouth"), scoreEl = api.center().querySelector(".cg-score");
        const FOODS = ["🍬", "🍔", "🍩", "🍎", "🍒", "🧁", "🍿"];
        api.track(setInterval(() => {
          const s = document.createElement("span"); s.className = "cm-food"; s.textContent = FOODS[Math.floor(Math.random() * FOODS.length)];
          s.style.left = (12 + Math.random() * 76) + "%"; s.style.animationDuration = (1.9 + Math.random() * 0.9) + "s";
          zone.append(s); s.addEventListener("animationend", () => s.remove());
        }, 620));
        api.track(setInterval(() => {
          const open = api.sig().jawOpen > 0.4;
          mouth.textContent = open ? "😮" : "😐";
          if (!open) return;
          const m = mouth.getBoundingClientRect();
          for (const f of zone.querySelectorAll(".cm-food:not(.caught)")) {
            const r = f.getBoundingClientRect();
            if (Math.abs((r.top + r.height / 2) - (m.top + m.height / 2)) < 56 && Math.abs((r.left + r.width / 2) - (m.left + m.width / 2)) < 72) {
              f.classList.add("caught"); f.textContent = "✨"; score += 1; scoreEl.textContent = score;
            }
          }
        }, 70));
        api.track(setTimeout(() => api.scoreDone(score), 15000));
      },
    },
    rps: {
      name: "Rock Paper Scissors", icon: "✊", tag: "✊ ✋ ✌️ — best of 3", detector: "hand",
      play(api) {
        const st = api.state;
        Object.assign(st, { me: 0, they: 0, round: 0, myPick: null, theyPick: null });
        const MAP = { Closed_Fist: "rock", Open_Palm: "paper", Victory: "scissors" };
        const EMO = { rock: "✊", paper: "✋", scissors: "✌️" };
        const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
        st.resolve = () => {
          if (!st.myPick || !st.theyPick) return;
          let line;
          if (st.myPick === st.theyPick) line = "Draw! 🤝";
          else if (BEATS[st.myPick] === st.theyPick) { st.me += 1; line = "You win the round! 🎉"; }
          else { st.they += 1; line = `${api.esc(api.other()?.name || "They")} win`; }
          api.center().innerHTML = `<div class="cg-rps">${EMO[st.myPick]} <span>vs</span> ${EMO[st.theyPick]}</div><div class="cg-rps-line">${line}</div>`;
          st.myPick = st.theyPick = null;
          if (st.me >= 2 || st.they >= 2) api.track(setTimeout(() => api.done(st.me > st.they, st.me > st.they ? `🏆 Aap jeet gaye! (${st.me}-${st.they})` : `😅 Aap haare (${st.they}-${st.me})`), 1500));
          else api.track(setTimeout(roundStart, 1700));
        };
        function captureShoot() {
          // Sample the hand for ~1s and take the gesture seen most — far more reliable
          // than reading a single frame (which used to just default to rock).
          const counts = {}; let n = 0;
          const sample = api.track(setInterval(() => {
            n += 1;
            const g = MAP[api.sig().gesture];
            if (g) counts[g] = (counts[g] || 0) + 1;
            if (n >= 11) {
              clearInterval(sample);
              const pick = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "rock";
              st.myPick = pick;
              api.send({ k: "pick", v: st.myPick });
              st.resolve();
            }
          }, 90));
        }
        function roundStart() {
          st.round += 1;
          api.top().innerHTML = `<div class="cg-hud">You ${st.me} — ${st.they} ${api.esc(api.other()?.name || "them")}</div>`;
          const words = ["Rock…", "Paper…", "Scissors…", "SHOOT! ✊✋✌️"];
          let i = 0;
          const show = () => { api.center().innerHTML = `<div class="cg-go">${words[i]}</div>`; if (i < 3) { i += 1; api.track(setTimeout(show, 650)); } else { api.center().innerHTML = `<div class="cg-go">SHOOT! ✊✋✌️</div><div class="cg-rps-line">Apna haath dikhao…</div>`; captureShoot(); } };
          show();
        }
        roundStart();
      },
      onMsg(d, api) { if (d.k === "pick") { api.state.theyPick = d.v; api.state.resolve && api.state.resolve(); } },
    },
    makemelaugh: {
      name: "Make me laugh", icon: "🤪", tag: "Guard 30s na hanse to jeeta", detector: "face",
      play(api) {
        const guard = api.isInviter;
        api.top().innerHTML = `<div class="cg-hud">${guard ? "😐 30s — hanso mat!" : "🤪 Unhe hasao!"}</div>`;
        api.center().innerHTML = `<div class="cg-go">${guard ? "Keep a straight face!" : "Make faces 😜"}</div><div class="cg-score">30</div>`;
        api.track(setTimeout(() => api.center().querySelector(".cg-go")?.classList.add("gone"), 1100));
        const scoreEl = api.center().querySelector(".cg-score");
        let left = 30, hot = 0;
        api.track(setInterval(() => { left -= 1; if (scoreEl) scoreEl.textContent = Math.max(0, left); if (left <= 0 && guard) { api.send({ k: "survived" }); api.done(true, "🏆 Aap nahi hanse — jeet!"); } }, 1000));
        if (guard) api.track(setInterval(() => { const s = api.sig(); if (s.smile > 0.42 || s.jawOpen > 0.5) { hot += 1; if (hot >= 4) { api.send({ k: "laughed" }); api.done(false, "😄 Aap hans gaye — haar!"); } } else hot = 0; }, 100));
      },
      onMsg(d, api) { if (d.k === "laughed") api.done(true, "🏆 Unhe hasa diya — aap jeete!"); else if (d.k === "survived") api.done(false, "😐 Wo nahi hanse — aap haare"); },
    },
    freeze: {
      name: "Freeze dance", icon: "🕺", tag: "Music ruke to FREEZE — hile to out", detector: "motion",
      play(api) {
        api.state.out = false;
        const dance = () => {
          if (api.state.out) return;
          api.top().innerHTML = `<div class="cg-hud">🕺 DANCE!</div>`;
          api.center().innerHTML = `<div class="cg-go">Dance! 💃🕺</div>`;
          api.track(setTimeout(freeze, 2500 + Math.random() * 2200));
        };
        const freeze = () => {
          if (api.state.out) return;
          api.top().innerHTML = `<div class="cg-hud cg-freeze">🧊 FREEZE!</div>`;
          api.center().innerHTML = `<div class="cg-go freeze">FREEZE! 🧊</div>`;
          let n = 0;
          const t = api.track(setInterval(() => {
            n += 1;
            if (n < 4) return;
            if (api.sig().motion > 0.14) { clearInterval(t); api.state.out = true; api.send({ k: "moved" }); api.done(false, "🫨 Aap hil gaye — out!"); }
            else if (n > 18) { clearInterval(t); dance(); }
          }, 100));
        };
        dance();
      },
      onMsg(d, api) { if (d.k === "moved") api.done(true, "🏆 Wo hil gaye — aap jeete!"); },
    },
    vibe: {
      name: "Vibe meter", icon: "💞", tag: "Dono saath smile karo, meter full karo", detector: "face",
      play(api) {
        api.top().innerHTML = `<div class="cg-hud">💞 Dono saath smile karo!</div>`;
        api.center().innerHTML = `<div class="cg-vibe"><div class="cg-vibe-fill"></div></div><div class="cg-score">0%</div>`;
        const fill = api.center().querySelector(".cg-vibe-fill"), scoreEl = api.center().querySelector(".cg-score");
        let vibe = 0;
        api.track(setInterval(() => {
          const mySmile = api.sig().smile > 0.3;
          if (mySmile !== api.state.sent) { api.state.sent = mySmile; api.send({ k: "smile", v: mySmile }); }
          vibe = Math.max(0, Math.min(100, vibe + (mySmile && api.state.theirSmile ? 2.6 : -1.2)));
          fill.style.width = vibe + "%"; scoreEl.textContent = Math.round(vibe) + "%";
          if (vibe >= 100) { api.send({ k: "full" }); api.done(true, "💖 100%! Perfect vibe 💞"); }
        }, 100));
      },
      onMsg(d, api) { if (d.k === "smile") api.state.theirSmile = d.v; else if (d.k === "full") api.done(true, "💖 100%! Perfect vibe 💞"); },
    },
    copyface: {
      name: "Copy my expression", icon: "😲", tag: "Ek face banaye, doosra copy kare", detector: "face",
      play(api) {
        if (api.isInviter) {
          api.top().innerHTML = `<div class="cg-hud">😎 Koi ek expression banao…</div>`;
          api.center().innerHTML = `<div class="cg-go">Hold it… <b id="cf-n">3</b></div>`;
          let n = 3;
          api.track(setInterval(() => {
            n -= 1; const el = document.getElementById("cf-n"); if (el) el.textContent = Math.max(0, n);
            if (n <= 0) { api.state.target = api.sig().vec; api.send({ k: "target", v: api.state.target }); api.top().innerHTML = `<div class="cg-hud">⏳ ${api.esc(api.other()?.name || "They")} copy kar rahe hain…</div>`; api.center().innerHTML = `<div class="cg-wait"><span class="cg-spin"></span>Dekho…</div>`; }
          }, 1000));
        } else {
          api.top().innerHTML = `<div class="cg-hud">⏳ ${api.esc(api.other()?.name || "They")} face bana rahe hain…</div>`;
          api.center().innerHTML = `<div class="cg-wait"><span class="cg-spin"></span>Ready ho jao…</div>`;
        }
      },
      onMsg(d, api) {
        if (d.k === "target" && !api.isInviter) copierMatch(api, d.v);
        else if (d.k === "result") api.done((d.pct || 0) >= 70, `🎯 ${api.esc(api.other()?.name || "They")} ne ${d.pct}% match kiya`);
      },
    },
  };

  function similarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return 0;
    let s = 0; const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) s += ((a[i] || 0) - (b[i] || 0)) ** 2;
    return Math.max(0, 1 - Math.sqrt(s) / 1.2);
  }
  function copierMatch(api, target) {
    api.top().innerHTML = `<div class="cg-hud">😲 Yeh face copy karo!</div>`;
    api.center().innerHTML = `<div class="cg-go">Copy! <b id="cf-n">3</b></div><div class="cg-score">0%</div>`;
    const scoreEl = api.center().querySelector(".cg-score");
    let best = 0, left = 30;
    const loop = api.track(setInterval(() => {
      best = Math.max(best, similarity(api.sig().vec, target));
      scoreEl.textContent = Math.round(best * 100) + "%";
      left -= 1; const nEl = document.getElementById("cf-n"); if (nEl) nEl.textContent = Math.ceil(left / 10);
      if (left <= 0) { clearInterval(loop); const pct = Math.round(best * 100); api.send({ k: "result", pct }); api.done(pct >= 70, `🎯 Aapne ${pct}% match kiya!`); }
    }, 100));
  }

  // ---------- face detection ----------
  const F = { lm: null, loading: null, video: null, raf: 0, lastT: -1, sig: { smile: 0, jawOpen: 0, blink: 0, face: false } };

  async function loadFace() {
    if (F.lm) return F.lm;
    F.loading ||= (async () => {
      const vision = await import(`${MP}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
      const make = (delegate) => vision.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: FACE_MODEL, delegate }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true });
      try { F.lm = await make("GPU"); } catch { F.lm = await make("CPU"); }
      return F.lm;
    })();
    return F.loading;
  }
  function startFace() {
    const cam = cameraTrack();
    if (!cam) return false;
    F.video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, autoplay: true });
    F.video.srcObject = new MediaStream([cam]);
    F.video.play().catch(() => {});
    const loop = () => {
      F.raf = requestAnimationFrame(loop);
      const v = F.video;
      if (!F.lm || !v || v.readyState < 2 || v.currentTime === F.lastT) return;
      F.lastT = v.currentTime;
      let res;
      try { res = F.lm.detectForVideo(v, performance.now()); } catch { return; }
      const bs = res.faceBlendshapes?.[0]?.categories;
      if (!bs) { F.sig = { smile: 0, jawOpen: 0, blink: 0, face: false }; return; }
      const get = (name) => bs.find((c) => c.categoryName === name)?.score || 0;
      const a2 = (x, y) => (get(x) + get(y)) / 2;
      const smile = (get("mouthSmileLeft") + get("mouthSmileRight")) / 2;
      F.sig = {
        smile, jawOpen: get("jawOpen"), blink: (get("eyeBlinkLeft") + get("eyeBlinkRight")) / 2, face: true,
        // a compact "expression" vector for the copy-the-face game
        vec: [smile, get("jawOpen"), get("browInnerUp"), a2("browDownLeft", "browDownRight"), get("mouthPucker"), a2("cheekSquintLeft", "cheekSquintRight"), a2("eyeSquintLeft", "eyeSquintRight"), a2("mouthFrownLeft", "mouthFrownRight")],
      };
    };
    loop();
    return true;
  }
  function stopFace() { cancelAnimationFrame(F.raf); if (F.video) F.video.srcObject = null; F.video = null; F.lastT = -1; }

  // ---------- hand detection (for Rock Paper Scissors etc.) ----------
  const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
  const H = { rec: null, loading: null, video: null, raf: 0, lastT: -1, sig: { gesture: "", hand: false } };
  async function loadHand() {
    if (H.rec) return H.rec;
    H.loading ||= (async () => {
      const vision = await import(`${MP}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
      const make = (delegate) => vision.GestureRecognizer.createFromOptions(files, { baseOptions: { modelAssetPath: HAND_MODEL, delegate }, runningMode: "VIDEO", numHands: 1 });
      try { H.rec = await make("GPU"); } catch { H.rec = await make("CPU"); }
      return H.rec;
    })();
    return H.loading;
  }
  function startHand() {
    const cam = cameraTrack();
    if (!cam) return false;
    H.video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, autoplay: true });
    H.video.srcObject = new MediaStream([cam]);
    H.video.play().catch(() => {});
    const loop = () => {
      H.raf = requestAnimationFrame(loop);
      const v = H.video;
      if (!H.rec || !v || v.readyState < 2 || v.currentTime === H.lastT) return;
      H.lastT = v.currentTime;
      let res;
      try { res = H.rec.recognizeForVideo(v, performance.now()); } catch { return; }
      const g = res.gestures?.[0]?.[0];
      H.sig = { gesture: g && g.score > 0.5 ? g.categoryName : "", hand: !!res.landmarks?.length };
    };
    loop();
    return true;
  }
  function stopHand() { cancelAnimationFrame(H.raf); if (H.video) H.video.srcObject = null; H.video = null; H.lastT = -1; }

  // ---------- motion detection (for Freeze dance) — just a frame difference, no model ----------
  const M = { video: null, canvas: null, ctx: null, prev: null, raf: 0, sig: { motion: 0 } };
  function startMotion() {
    const cam = cameraTrack();
    if (!cam) return false;
    M.video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, autoplay: true });
    M.video.srcObject = new MediaStream([cam]);
    M.video.play().catch(() => {});
    M.canvas = document.createElement("canvas"); M.canvas.width = 32; M.canvas.height = 24; M.ctx = M.canvas.getContext("2d", { willReadFrequently: true });
    M.prev = null;
    const loop = () => {
      M.raf = requestAnimationFrame(loop);
      const v = M.video;
      if (!v || v.readyState < 2) return;
      M.ctx.drawImage(v, 0, 0, 32, 24);
      const cur = M.ctx.getImageData(0, 0, 32, 24).data;
      if (M.prev) {
        let diff = 0;
        for (let i = 0; i < cur.length; i += 4) diff += Math.abs(cur[i] - M.prev[i]) + Math.abs(cur[i + 1] - M.prev[i + 1]) + Math.abs(cur[i + 2] - M.prev[i + 2]);
        M.sig = { motion: Math.min(1, diff / (32 * 24 * 3 * 255) * 6) };
      }
      M.prev = cur;
    };
    loop();
    return true;
  }
  function stopMotion() { cancelAnimationFrame(M.raf); if (M.video) M.video.srcObject = null; M.video = null; M.prev = null; }

  // ---------- generic detector + signal ----------
  const loadDetector = (kind) => (kind === "hand" ? loadHand() : kind === "motion" ? Promise.resolve() : loadFace());
  const startDetector = (kind) => (kind === "hand" ? startHand() : kind === "motion" ? startMotion() : startFace());
  const stopDetector = () => { stopFace(); stopHand(); stopMotion(); };
  const signal = () => { const d = GAMES[R.id]?.detector; return d === "hand" ? H.sig : d === "motion" ? M.sig : F.sig; };

  // ---------- round state machine ----------
  const R = { id: null, phase: "idle", st: {}, loopT: 0, timer: 0, started: 0, myScore: 0, theirScore: null, inviter: false, tracked: [] };
  const other = () => [...peers.values()][0];
  const track = (id) => { R.tracked.push(id); return id; };
  const clearTracked = () => { R.tracked.forEach((t) => { clearInterval(t); clearTimeout(t); }); R.tracked = []; };

  function reset() {
    clearInterval(R.loopT); clearTimeout(R.timer); clearTracked();
    R.phase = "idle"; R.id = null; R.st = {}; R.myScore = 0; R.theirScore = null;
    stopDetector();
    hideOverlay();
  }

  async function invite(id) {
    if (!other()) return toast("Game ke liye doosre ka aana zaroori hai");
    R.id = id; R.phase = "inviting"; R.inviter = true;
    showOverlay();
    paintInvite(GAMES[id], true);
    send("cg", { t: "invite", g: id });
    await loadDetector(GAMES[id].detector).catch(() => {});
  }

  function onInvited(id) {
    if (!GAMES[id]) return;
    R.id = id; R.phase = "invited"; R.inviter = false;
    showOverlay();
    paintInvite(GAMES[id], false);
    loadDetector(GAMES[id].detector).catch(() => {});
  }

  function accept() {
    if (R.phase !== "invited") return;
    send("cg", { t: "accept", g: R.id });
    beginCountdown();
  }
  function decline() { send("cg", { t: "decline" }); reset(); }

  function beginCountdown() {
    R.phase = "count";
    startDetector(GAMES[R.id].detector);
    let n = 3;
    const tick = () => {
      if (n <= 0) return startRound();
      paintCountdown(n);
      n -= 1;
      R.timer = setTimeout(tick, 900);
    };
    tick();
  }

  function startRound() {
    const game = GAMES[R.id];
    R.phase = "play"; R.st = {}; R.started = Date.now(); R.myScore = 0; R.theirScore = null;
    if (game.play) { game.play(gameApi()); return; }   // custom game drives itself
    paintPlay(game);
    R.loopT = setInterval(() => {
      if (R.phase !== "play") return;
      const out = game.tick(signal(), R.st) || {};
      if (game.mode === "lose-first" && out.lost) { iLost(); return; }
      if (game.mode === "high-score") {
        R.myScore = R.st.score || 0;
        updateScore(R.myScore);
        if (Date.now() - R.started >= (game.duration || 12000)) finishScore();
      }
    }, 90);
  }

  // what a custom game gets to drive its own round
  function gameApi() {
    return {
      sig: signal, top, center, bottom, me, other, esc, state: R.st,
      isInviter: R.inviter,
      send: (o) => send("cg", { t: "g", ...o }),
      track, play: paintPlay,
      scoreDone: (my) => { R.myScore = my; R.phase = "wait-score"; clearTracked(); send("cg", { t: "score", v: my }); paintWaitScore(); maybeDecideScore(); },
      done: (win, text) => { if (R.phase === "play") { R.phase = "done"; clearInterval(R.loopT); clearTracked(); result(win, text); } },
    };
  }

  function iLost() {
    if (R.phase !== "play") return;
    R.phase = "done";
    clearInterval(R.loopT);
    send("cg", { t: "lost" });
    result(false, "😄 Aap hans/jhapak gaye!");
  }
  function theyLost() {
    if (R.phase !== "play" && R.phase !== "count") return;
    R.phase = "done";
    clearInterval(R.loopT);
    result(true, "🎉 Aap jeet gaye!");
  }
  function finishScore() {
    if (R.phase !== "play") return;
    R.phase = "wait-score";
    clearInterval(R.loopT);
    send("cg", { t: "score", v: R.myScore });
    paintWaitScore();
    maybeDecideScore();
  }
  function maybeDecideScore() {
    if (R.phase !== "wait-score" || R.theirScore == null) return;
    const win = R.myScore > R.theirScore, tie = R.myScore === R.theirScore;
    R.phase = "done";
    result(win, tie ? `🤝 Tie! (${R.myScore} - ${R.theirScore})` : win ? `🎉 Aap jeet gaye! (${R.myScore} - ${R.theirScore})` : `😅 ${other()?.name || "Unhone"} jeet gaye (${R.theirScore} - ${R.myScore})`);
  }

  function rematch() { if (R.id) { const id = R.id; reset(); invite(id); } }

  // ---------- overlay UI ----------
  let el = null;
  function showOverlay() {
    if (el) return;
    el = document.createElement("div");
    el.className = "cg-overlay";
    el.innerHTML = '<div class="cg-top"></div><div class="cg-center"></div><div class="cg-bottom"></div>';
    document.body.append(el);
    el.addEventListener("click", (e) => {
      const act = e.target.closest("[data-cg]")?.dataset.cg;
      if (act === "accept") accept();
      else if (act === "decline" || act === "close") { if (R.phase === "inviting" || R.phase === "invited") decline(); else reset(); }
      else if (act === "again") rematch();
    });
  }
  function hideOverlay() { el?.remove(); el = null; }
  const top = () => q(".cg-top", el), center = () => q(".cg-center", el), bottom = () => q(".cg-bottom", el);

  function paintInvite(game, mine) {
    top().innerHTML = `<div class="cg-title"><span class="cg-ic">${game.icon}</span><b>${game.name}</b></div><p>${game.tag}</p>`;
    center().innerHTML = mine
      ? `<div class="cg-wait"><span class="cg-spin"></span>Waiting for ${esc(other()?.name || "them")}…</div>`
      : `<div class="cg-ask">${esc(other()?.name || "They")} wants to play <b>${game.name}</b></div>`;
    bottom().innerHTML = mine
      ? `<button class="cg-btn ghost" data-cg="close">Cancel</button>`
      : `<button class="cg-btn ghost" data-cg="decline">Decline</button><button class="cg-btn go" data-cg="accept">Let's play</button>`;
  }
  function paintCountdown(n) {
    top().innerHTML = `<div class="cg-title"><span class="cg-ic">${GAMES[R.id].icon}</span><b>${GAMES[R.id].name}</b></div>`;
    center().innerHTML = `<div class="cg-count">${n}</div>`;
    bottom().innerHTML = "";
  }
  function paintPlay(game) {
    top().innerHTML = `<div class="cg-hud">${game.hud}</div>`;
    center().innerHTML = `<div class="cg-go">${game.go}</div>` + (game.mode === "high-score" ? `<div class="cg-score">0</div>` : "");
    setTimeout(() => center()?.querySelector(".cg-go")?.classList.add("gone"), 900);
    bottom().innerHTML = `<button class="cg-btn ghost" data-cg="close">Quit</button>`;
  }
  function updateScore(v) { const s = center()?.querySelector(".cg-score"); if (s) s.textContent = Math.round(v); }
  function paintWaitScore() { top().innerHTML = `<div class="cg-hud">Time's up!</div>`; center().innerHTML = `<div class="cg-wait"><span class="cg-spin"></span>Scores…</div>`; }
  function result(win, text) {
    top().innerHTML = "";
    center().innerHTML = `<div class="cg-result ${win ? "win" : "lose"}"><div class="cg-res-emo">${win ? "🏆" : "🙈"}</div><div class="cg-res-t">${esc(text)}</div></div>`;
    bottom().innerHTML = `<button class="cg-btn ghost" data-cg="close">Close</button><button class="cg-btn go" data-cg="again">Rematch</button>`;
    if (win) burst();
  }
  function burst() {
    const c = center();
    for (let i = 0; i < 18; i++) { const s = document.createElement("span"); s.className = "cg-confetti"; s.textContent = ["🎉", "✨", "💖", "⭐"][i % 4]; s.style.left = Math.random() * 100 + "%"; s.style.animationDelay = Math.random() * 0.4 + "s"; c.append(s); setTimeout(() => s.remove(), 2000); }
  }
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // ---------- tray picker ----------
  function openPicker() {
    window.DU.kit.toggleTray(false);
    if (!other()) return toast("Pehle doosre ka call pe aana zaroori hai");
    showOverlay();
    top().innerHTML = `<div class="cg-title"><span class="cg-ic">🎮</span><b>Camera games</b></div><p>Live, face se khele jaate hain</p>`;
    center().innerHTML = `<div class="cg-list">${Object.entries(GAMES).map(([id, g]) => `<button class="cg-pick" data-pick="${id}"><span class="cg-ic">${g.icon}</span><span><b>${g.name}</b><small>${g.tag}</small></span></button>`).join("")}</div>`;
    bottom().innerHTML = `<button class="cg-btn ghost" data-cg="close">Close</button>`;
    center().querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => invite(b.dataset.pick)));
  }

  // ---------- hooks ----------
  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) { if (button.dataset.tg === "camgames") openPicker(); else prev.click?.(button); },
    onCouple(message, peer) {
      if (message.type !== "cg") return prev.msg?.(message, peer);
      const d = message.data || {};
      if (d.t === "invite") onInvited(String(d.g || ""));
      else if (d.t === "accept") { if (R.phase === "inviting") beginCountdown(); }
      else if (d.t === "decline") { if (R.phase === "inviting") { toast(`${peer.name} abhi busy hai`); reset(); } }
      else if (d.t === "lost") theyLost();
      else if (d.t === "score") { R.theirScore = Number(d.v) || 0; maybeDecideScore(); }
      else if (d.t === "g") GAMES[R.id]?.onMsg?.(d, gameApi());
    },
    onCoupleLeave(...a) { reset(); prev.leave?.(...a); },
  });

  window.DU.camGame = { invite, result, GAMES, demo: (id) => { reset(); if (!GAMES[id]) return; showOverlay(); R.id = id; R.inviter = true; R.phase = "count"; startDetector(GAMES[id].detector); startRound(); } }; // demo starts a round's UI
})();
