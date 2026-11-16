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
  };

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
      F.sig = {
        smile: (get("mouthSmileLeft") + get("mouthSmileRight")) / 2,
        jawOpen: get("jawOpen"),
        blink: (get("eyeBlinkLeft") + get("eyeBlinkRight")) / 2,
        face: true,
      };
    };
    loop();
    return true;
  }
  function stopFace() { cancelAnimationFrame(F.raf); if (F.video) F.video.srcObject = null; F.video = null; F.lastT = -1; }

  // ---------- round state machine ----------
  const R = { id: null, phase: "idle", st: {}, loopT: 0, timer: 0, started: 0, myScore: 0, theirScore: null };
  const other = () => [...peers.values()][0];

  function reset() {
    clearInterval(R.loopT); clearTimeout(R.timer);
    R.phase = "idle"; R.id = null; R.st = {}; R.myScore = 0; R.theirScore = null;
    stopFace();
    hideOverlay();
  }

  async function invite(id) {
    if (!other()) return toast("Game ke liye doosre ka aana zaroori hai");
    R.id = id; R.phase = "inviting";
    showOverlay();
    paintInvite(GAMES[id], true);
    send("cg", { t: "invite", g: id });
    await loadFace().catch(() => {});
  }

  function onInvited(id) {
    if (!GAMES[id]) return;
    R.id = id; R.phase = "invited";
    showOverlay();
    paintInvite(GAMES[id], false);
    loadFace().catch(() => {});
  }

  function accept() {
    if (R.phase !== "invited") return;
    send("cg", { t: "accept", g: R.id });
    beginCountdown();
  }
  function decline() { send("cg", { t: "decline" }); reset(); }

  function beginCountdown() {
    R.phase = "count";
    startFace();
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
    paintPlay(game);
    R.loopT = setInterval(() => {
      if (R.phase !== "play") return;
      const out = game.tick(F.sig, R.st) || {};
      if (game.mode === "lose-first" && out.lost) { iLost(); return; }
      if (game.mode === "high-score") {
        R.myScore = R.st.score || 0;
        updateScore(R.myScore);
        if (Date.now() - R.started >= (game.duration || 12000)) finishScore();
      }
    }, 90);
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
    },
    onCoupleLeave(...a) { reset(); prev.leave?.(...a); },
  });

  window.DU.camGame = { invite, result, GAMES }; // for quick checks
})();
