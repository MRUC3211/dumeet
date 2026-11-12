// DU Meet · presenting from a phone.
// Phone browsers (and the installed app) can't share the screen, so on phones "Present"
// shows photos and videos from the gallery instead: they are drawn onto a canvas and
// sent in the presentation slot, exactly like a shared screen. Swipe through with the bar.
(() => {
  const { openModal, closeModal } = window.DU;

  let show = null; // { slides, index, canvas, ctx, timer, bar }

  // ---------- chooser ----------
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.id = "m-present";
  modal.hidden = true;
  modal.innerHTML = `<div class="sheet narrow pp-sheet">
    <header class="sheet-head"><h2>Present from your phone</h2>
      <button class="icon-btn" data-modal-close aria-label="Close"><span class="icon" aria-hidden="true">close</span></button></header>
    <div class="sheet-body">
      <button class="pp-pick" data-pp="media"><span class="pp-ic"><span class="icon" aria-hidden="true">photo_library</span></span>
        <span><b>Photos and videos</b><small>Pick one or many. Everyone sees them big, and you swipe through.</small></span></button>
      <button class="pp-pick" data-pp="camera"><span class="pp-ic back"><span class="icon" aria-hidden="true">cameraswitch</span></span>
        <span><b>Show what's around you</b><small>Switches to your back camera.</small></span></button>
      <p class="pp-note"><span class="icon" aria-hidden="true">info</span>Phones don't let websites or web apps share the whole screen. On a laptop, Present shares your screen as usual.</p>
      <input type="file" accept="image/*,video/*" multiple hidden>
    </div></div>`;
  document.body.append(modal);
  const input = modal.querySelector("input");

  modal.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-pp]")?.dataset.pp;
    if (pick === "media") input.click();
    if (pick === "camera") {
      closeModal(modal);
      if (me.facing === "environment") return toast("Your back camera is already on");
      flipCamera().then(() => { if (me.facing === "environment") toast("Back camera on. Tap switch camera to come back"); });
    }
  });
  input.addEventListener("change", () => {
    const files = [...input.files].filter((f) => /^(image|video)\//.test(f.type)).slice(0, 30);
    input.value = "";
    if (!files.length) return;
    closeModal(modal);
    start(files);
  });

  // ---------- presenting ----------
  async function start(files) {
    const slides = files.map((file) => ({ file, url: URL.createObjectURL(file), video: file.type.startsWith("video/") }));
    const canvas = document.createElement("canvas");
    canvas.width = 1280; canvas.height = 720;
    show = { slides, index: 0, canvas, ctx: canvas.getContext("2d"), el: null };
    await load(0);
    const track = canvas.captureStream(24).getVideoTracks()[0];
    track.contentHint = "detail";
    const stop = track.stop.bind(track);
    track.stop = () => { stop(); finish(); };
    show.timer = setInterval(draw, 1000 / 24);
    me.screenTrack = track;
    me.phoneShow = true;
    setOutgoing(SLOT.screen, track);
    stageAppeared(screenId(me.id));
    renderAll();
    sendState({ screen: true });
    buildBar();
    toast("You are presenting to everyone");
  }

  function load(index) {
    const slide = show.slides[index];
    show.el?.pause?.();
    return new Promise((resolve) => {
      const el = document.createElement(slide.video ? "video" : "img");
      if (slide.video) {
        Object.assign(el, { muted: true, playsInline: true, loop: true, preload: "auto" });
        el.setAttribute("playsinline", "");
        el.onloadeddata = () => { el.play().catch(() => {}); resolve(); };
      } else {
        el.onload = () => resolve();
      }
      el.onerror = () => resolve();
      el.src = slide.url;
      show.el = el;
      setTimeout(resolve, 4000);
    }).then(() => {
      // match the canvas to the photo's shape (portrait photos stay big)
      const w = show.el.videoWidth || show.el.naturalWidth || 1280, h = show.el.videoHeight || show.el.naturalHeight || 720;
      const scale = Math.min(1, 1280 / Math.max(w, h));
      show.canvas.width = Math.max(2, Math.round(w * scale / 2) * 2);
      show.canvas.height = Math.max(2, Math.round(h * scale / 2) * 2);
      draw();
      paintBar();
    });
  }

  function draw() {
    if (!show) return;
    const { ctx, canvas, el } = show;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    try { ctx.drawImage(el, 0, 0, canvas.width, canvas.height); } catch { /* not ready yet */ }
  }

  function go(step) {
    if (!show || show.slides.length < 2) return;
    show.index = (show.index + step + show.slides.length) % show.slides.length;
    load(show.index);
  }

  function finish() {
    if (!show) return;
    clearInterval(show.timer);
    show.el?.pause?.();
    for (const slide of show.slides) URL.revokeObjectURL(slide.url);
    show.bar?.remove();
    show = null;
    me.phoneShow = false;
  }

  // ---------- presenter bar ----------
  function buildBar() {
    const bar = document.createElement("div");
    bar.className = "pp-bar";
    bar.innerHTML = `<button class="pp-btn" data-go="-1" aria-label="Previous"><span class="icon" aria-hidden="true">chevron_left</span></button>
      <span class="pp-count"></span>
      <button class="pp-btn" data-go="1" aria-label="Next"><span class="icon" aria-hidden="true">chevron_right</span></button>
      <button class="pp-btn" data-play aria-label="Play or pause"><span class="icon" aria-hidden="true">pause</span></button>
      <button class="pp-stop" data-action="share"><span class="icon" aria-hidden="true">stop_screen_share</span>Stop</button>`;
    bar.addEventListener("click", (event) => {
      const go1 = event.target.closest("[data-go]");
      if (go1) go(Number(go1.dataset.go));
      if (event.target.closest("[data-play]") && show?.el?.tagName === "VIDEO") {
        show.el.paused ? show.el.play() : show.el.pause();
        paintBar();
      }
    });
    // swipe on the bar or on your own presentation tile
    let x0 = null;
    const down = (e) => { x0 = e.touches?.[0]?.clientX ?? null; };
    const up = (e) => {
      const x1 = e.changedTouches?.[0]?.clientX;
      if (x0 != null && x1 != null && Math.abs(x1 - x0) > 50) go(x1 < x0 ? 1 : -1);
      x0 = null;
    };
    for (const target of [bar, document.querySelector(".stage")]) {
      target?.addEventListener("touchstart", down, { passive: true });
      target?.addEventListener("touchend", up, { passive: true });
    }
    document.querySelector("#room")?.append(bar) ?? document.body.append(bar);
    show.bar = bar;
    paintBar();
  }

  function paintBar() {
    if (!show?.bar) return;
    const { slides, index, el, bar } = show;
    const many = slides.length > 1;
    bar.querySelector(".pp-count").textContent = many ? `${index + 1} of ${slides.length}` : (slides[0].video ? "Video" : "Photo");
    for (const b of bar.querySelectorAll("[data-go]")) b.hidden = !many;
    const play = bar.querySelector("[data-play]");
    play.hidden = el?.tagName !== "VIDEO";
    play.querySelector(".icon").textContent = el?.paused ? "play_arrow" : "pause";
  }

  window.DU.phonePresent = () => {
    if (me.screenTrack) return;
    openModal(modal);
  };
})();
