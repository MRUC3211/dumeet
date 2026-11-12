// DU Meet · follows the admin's switches on every phone: hidden features, Saathi on/off,
// the spiciest card level, maintenance and a banner. Also obeys the admin's live commands
// (mute, camera off, reload, a message) and counts which features get opened.

(() => {
  "use strict";
  window.DU ||= {};
  const P = (window.DU.policy = { saathiOn: true, maxHeat: 3, hidden: [], maintenance: false, banner: "" });
  const style = document.createElement("style");
  document.head.append(style);
  let bannerEl = null;

  function apply(c) {
    Object.assign(P, c);
    const hide = [...(c.hidden || [])];
    if (c.saathiOn === false) hide.push("saathi", "wake", "story", "planday");
    style.textContent = hide.length ? `${hide.map((k) => `#tg-tray [data-tg="${CSS.escape(k)}"]`).join(",")}{display:none!important}` : "";
    // a pinned message for both of them
    const text = c.maintenance ? c.maintenanceText : c.banner;
    if (text) {
      if (!bannerEl) {
        bannerEl = document.createElement("div");
        bannerEl.className = "pol-banner";
        bannerEl.setAttribute("role", "status");
        bannerEl.innerHTML = `<span class="icon" aria-hidden="true"></span><p></p><button class="icon-btn" aria-label="Hide"><span class="icon">close</span></button>`;
        bannerEl.querySelector("button").onclick = () => { bannerEl.hidden = true; P.dismissed = bannerEl.dataset.t; };
        document.body.append(bannerEl);
      }
      bannerEl.querySelector(".icon").textContent = c.maintenance ? "construction" : "campaign";
      bannerEl.querySelector("p").textContent = text;
      bannerEl.classList.toggle("warn", Boolean(c.maintenance));
      bannerEl.dataset.t = text;
      bannerEl.hidden = P.dismissed === text && !c.maintenance;
    } else if (bannerEl) bannerEl.hidden = true;
    window.DU.onPolicy?.(P);
  }

  async function load() {
    try {
      const r = await fetch("/api/config");
      if (r.ok) apply(await r.json());
    } catch { /* offline: keep the last switches */ }
  }
  load();
  setInterval(load, 60000);

  // ---------- the admin's live commands ----------
  window.DU.onAdmin = (d) => {
    if (d.do === "policy") return load();
    if (d.do === "reload") return setTimeout(() => location.reload(), 400);
    if (d.do === "mute") { if (typeof setMic === "function") setMic(false); toast("Admin muted your mic"); }
    if (d.do === "camoff") { if (typeof setCamera === "function") setCamera(false); toast("Admin turned your camera off"); }
    if (d.do === "toast" && d.text) announce(d.text);
  };
  function announce(text) {
    const el = document.createElement("div");
    el.className = "pol-note";
    el.setAttribute("role", "alert");
    el.innerHTML = `<span class="icon" aria-hidden="true">campaign</span><div><b>Message from admin</b><p></p></div>`;
    el.querySelector("p").textContent = text;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add("in"));
    try { navigator.vibrate?.([30, 60, 30]); } catch { /* no vibration */ }
    const close = () => { el.classList.remove("in"); setTimeout(() => el.remove(), 300); };
    el.onclick = close;
    setTimeout(close, 9000);
  }

  // ---------- which features get used ----------
  let counts = {};
  document.addEventListener("click", (e) => {
    const b = e.target.closest("#tg-tray [data-tg]");
    const k = b?.dataset.tg;
    if (!k || /^(view-|tray)/.test(k)) return;
    counts[k] = (counts[k] || 0) + 1;
  }, true);
  function flush(beacon) {
    if (!Object.keys(counts).length) return;
    const body = JSON.stringify({ name: (typeof me === "object" && me.name) || "", counts });
    counts = {};
    fetch("/api/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: Boolean(beacon) }).catch(() => {});
  }
  setInterval(() => flush(false), 120000);
  addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(false); });
})();
