// DU Meet · Same sky: a little shared view of both your local times, weather and
// sky (day / evening / night), so even far apart it feels like one sky. Each phone
// stores its own time-zone + weather in a shared doc; the view reads both.
// Uses globals from app.js (prefs) and window.DU.kit (getDocs/putDoc).

(() => {
  "use strict";
  const PEOPLE = ["Uday", "Diya"];
  const partner = () => PEOPLE.find((p) => p.toLowerCase() !== String(prefs.name || "").toLowerCase()) || "them";
  const kit = () => window.DU.kit;
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const WX = [[0, "☀️", "🌙"], [1, "🌤️", "🌙"], [2, "⛅", "☁️"], [3, "☁️", "☁️"], [45, "🌫️", "🌫️"], [51, "🌦️", "🌧️"], [61, "🌧️", "🌧️"], [71, "🌨️", "🌨️"], [80, "🌦️", "🌧️"], [95, "⛈️", "⛈️"]];
  const wxIcon = (c, day) => { let p = WX[0]; for (const w of WX) if (c >= w[0]) p = w; return day ? p[1] : p[2]; };
  const tzNow = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localHour = (tz) => { try { return +new Intl.DateTimeFormat([], { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()); } catch { return new Date().getHours(); } };
  const localTime = (tz) => { try { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz }); } catch { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } };
  const scene = (h) => (h >= 6 && h < 17 ? "day" : h >= 17 && h < 20 ? "eve" : "night");

  async function myWeather() {
    const base = { tz: tzNow(), at: Date.now() };
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { maximumAge: 30 * 60000, timeout: 10000 }));
      const lat = pos.coords.latitude.toFixed(2), lon = pos.coords.longitude.toFixed(2);
      const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day`)).json();
      return { ...base, t: Math.round(w.current.temperature_2m), c: w.current.weather_code, d: w.current.is_day };
    } catch { return base; }
  }
  async function readSky() { try { return (await kit().getDocs("settings")).find((d) => d.id === "sky")?.data || {}; } catch { return {}; } }
  async function writeSky(mine) { try { const sky = await readSky(); sky[prefs.name] = mine; await kit().putDoc("settings", sky, "sky"); } catch { /* offline */ } }

  let timer = 0, elx = null;
  async function open() {
    if (!prefs.name) return;
    close();
    const el = document.createElement("div"); el.className = "samesky"; elx = el;
    el.innerHTML = '<button class="ss-x" aria-label="Close"><span class="icon">close</span></button>'
      + '<div class="ss-pair"><div class="ss-one" id="ss-me"></div><div class="ss-one" id="ss-them"></div></div>'
      + '<p class="ss-line">Under the same sky 💫</p>';
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add("open"));
    el.addEventListener("click", (e) => { if (e.target.closest(".ss-x") || e.target === el) close(); });

    let mine = { tz: tzNow(), at: Date.now() }, theirs = null;
    renderOne("#ss-me", prefs.name, mine, true);
    renderOne("#ss-them", partner(), null, false);
    mine = await myWeather(); renderOne("#ss-me", prefs.name, mine, true); writeSky(mine);
    theirs = (await readSky())[partner()] || null; renderOne("#ss-them", partner(), theirs, false);
    clearInterval(timer);
    timer = setInterval(() => {
      if (!el.isConnected) return clearInterval(timer);
      const a = el.querySelector("#ss-me .ss-time"); if (a) a.textContent = localTime(mine.tz);
      const b = el.querySelector("#ss-them .ss-time"); if (b && theirs) b.textContent = localTime(theirs.tz);
    }, 1000);
  }
  function close() { clearInterval(timer); elx?.remove(); elx = null; }

  function renderOne(sel, name, data, me) {
    const box = document.querySelector(sel); if (!box) return;
    if (!data) { box.className = "ss-one night"; box.innerHTML = `<div class="ss-sky"><span class="ss-orb">🌙</span></div><div class="ss-info"><div class="ss-name">${esc(name)}</div><div class="ss-wait">Not shared yet</div></div>`; return; }
    const h = localHour(data.tz), sc = scene(h), day = data.d !== undefined ? data.d : (h >= 6 && h < 19 ? 1 : 0);
    box.className = "ss-one " + sc;
    const stars = sc === "night" ? '<i class="ss-star" style="left:20%;top:22%"></i><i class="ss-star" style="left:65%;top:30%"></i><i class="ss-star" style="left:40%;top:15%"></i><i class="ss-star" style="left:80%;top:18%"></i>' : "";
    const wx = data.t !== undefined ? `${wxIcon(data.c || 0, day)} ${data.t}°` : "";
    box.innerHTML = `<div class="ss-sky">${stars}<span class="ss-orb">${sc === "night" ? "🌙" : "☀️"}</span></div>`
      + `<div class="ss-info"><div class="ss-name">${esc(name)}${me ? " · You" : ""}</div><div class="ss-time">${localTime(data.tz)}</div><div class="ss-wx">${wx}</div></div>`;
  }

  document.addEventListener("click", (e) => { if (e.target.closest("[data-home=samesky]")) open(); });
  window.DU = window.DU || {};
  window.DU.sameSky = open;
})();
