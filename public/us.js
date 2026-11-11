// DU Meet · "us": the home screen and everything two people keep together.
//
// Two people, "a" and "b". Each phone remembers which one it is (localStorage).
// Shared things live on the server (/api/us/…): profile, calendar notes, memories,
// open-when letters, scheduled surprises, daily answers, hearts, call and focus stats.

(() => {
  "use strict";

  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const store = {
    get(key, fallback = null) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
    },
  };

  const US_ROOM = "us-call";
  let who = store.get("du-us-who");             // "a" | "b" | null
  let profile = { a: {}, b: {} };
  const partner = () => (who === "a" ? "b" : "a");
  const nameOf = (person) => profile[person]?.name || (person === who ? "You" : "Your love");
  const myName = () => nameOf(who);
  const theirName = () => nameOf(partner());

  // ---------- server ----------

  async function json(response) {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  const api = {
    list: (c) => fetch(`/api/us/docs?c=${c}&who=${who}`).then(json).then((r) => r.docs),
    put: (c, data, id) => fetch("/api/us/docs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ who, c, id, data }),
    }).then(json).then((r) => r.doc),
    del: (c, id) => fetch(`/api/us/docs?c=${c}&id=${encodeURIComponent(id)}`, { method: "DELETE" }).then(json),
    heart: (live = false) => fetch("/api/us/heart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ who, live }) }).then(json),
    pulse: (since) => fetch(`/api/us/pulse?who=${who}&since=${since}`).then(json),
    media: (blob) => fetch("/api/us/media", { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob }).then(json),
  };

  // ---------- time helpers ----------

  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };
  const daysBetween = (a, b) => Math.round((parseDay(dayKey(b)) - parseDay(dayKey(a))) / 86400000);
  const timeIn = (tz, opts = {}) => {
    try {
      return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz || undefined, ...opts }).format(new Date()).replace(/\s?(am|pm)/i, (m) => ` ${m.trim().toUpperCase()}`);
    } catch {
      return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, ...opts }).format(new Date());
    }
  };
  const hourIn = (tz) => {
    try { return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz || undefined }).format(new Date())) % 24; } catch { return new Date().getHours(); }
  };
  const prettyDate = (date, opts = { day: "numeric", month: "short", year: "numeric" }) => new Date(date).toLocaleDateString([], opts);
  const prettyDateTime = (date) => new Date(date).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  function duration(secs, short = false) {
    secs = Math.max(0, Math.round(secs));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (short) return h ? `${h}h ${m}m` : m ? `${m}m` : `${secs}s`;
    return h ? `${h}:${pad(m)}:${pad(secs % 60)}` : `${pad(m)}:${pad(secs % 60)}`;
  }
  function ago(seconds) {
    const diff = Date.now() / 1000 - seconds;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
    return prettyDate(seconds * 1000, { day: "numeric", month: "short" });
  }
  function greeting(hour) {
    if (hour < 5) return "Still awake";
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    if (hour < 21) return "Good evening";
    return "Good night";
  }

  // ---------- weather (Open-Meteo, no key needed) ----------

  const WEATHER = {
    0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Cloudy"],
    45: ["🌫️", "Fog"], 48: ["🌫️", "Fog"], 51: ["🌦️", "Drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌦️", "Drizzle"],
    61: ["🌧️", "Rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"], 71: ["🌨️", "Snow"], 73: ["🌨️", "Snow"],
    75: ["❄️", "Heavy snow"], 80: ["🌦️", "Showers"], 81: ["🌧️", "Showers"], 82: ["⛈️", "Storm showers"],
    95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Thunderstorm"], 99: ["⛈️", "Thunderstorm"],
  };
  async function weatherFor(person) {
    const place = profile[person];
    if (!place?.lat) return null;
    const key = `du-weather-${person}`;
    const cached = store.get(key);
    if (cached && cached.lat === place.lat && Date.now() - cached.at < 20 * 60 * 1000) return cached;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,weather_code,is_day&timezone=auto`;
      const { current } = await json(await fetch(url));
      const [emoji, label] = WEATHER[current.weather_code] ?? ["🌡️", ""];
      const result = { at: Date.now(), lat: place.lat, temp: Math.round(current.temperature_2m), emoji: current.is_day || !emoji.includes("☀") ? emoji : "🌙", label };
      store.set(key, result);
      return result;
    } catch {
      return cached;
    }
  }
  async function findCity(name) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=en`;
    const { results = [] } = await json(await fetch(url));
    return results.map((r) => ({
      label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
      city: r.name, lat: r.latitude, lon: r.longitude, tz: r.timezone,
    }));
  }

  // ---------- toasts & love animations ----------

  const say = (text) => (typeof toast === "function" ? toast(text) : console.log(text));

  function burstHearts(count = 18, from = null) {
    const layer = q("#love-layer");
    const rect = from?.getBoundingClientRect();
    const x0 = rect ? rect.left + rect.width / 2 : innerWidth / 2;
    const y0 = rect ? rect.top + rect.height / 2 : innerHeight * 0.6;
    for (let i = 0; i < count; i++) {
      const heart = document.createElement("span");
      heart.className = "love-heart";
      heart.textContent = ["💗", "💖", "💕", "❤️", "💘"][i % 5];
      const angle = (Math.random() * 1.4 - 0.7) - Math.PI / 2;
      const dist = 120 + Math.random() * 220;
      heart.style.cssText = `left:${x0}px;top:${y0}px;--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist}px;--s:${0.7 + Math.random() * 0.9};--r:${Math.random() * 60 - 30}deg;animation-delay:${i * 25}ms`;
      layer.append(heart);
      setTimeout(() => heart.remove(), 2200);
    }
  }

  function bigHeart(text) {
    const layer = q("#love-layer");
    const box = document.createElement("div");
    box.className = "love-big";
    box.innerHTML = `<span class="love-big-heart">💖</span><p>${esc(text)}</p>`;
    layer.append(box);
    burstHearts(26);
    navigator.vibrate?.([80, 60, 80, 60, 220]);
    setTimeout(() => box.remove(), 3200);
  }

  function showGift({ icon = "💌", title, body, from, foot = "", onClose }) {
    const gift = q("#gift");
    gift.innerHTML = `
      <div class="gift-card">
        <div class="gift-icon">${icon}</div>
        ${from ? `<p class="gift-from">${esc(from)}</p>` : ""}
        <h3>${esc(title)}</h3>
        <div class="gift-body">${esc(body).replace(/\n/g, "<br>")}</div>
        ${foot}
        <button class="btn primary wide" data-gift-close>Close</button>
      </div>`;
    gift.hidden = false;
    requestAnimationFrame(() => gift.classList.add("open"));
    burstHearts(14);
    const close = () => {
      gift.classList.remove("open");
      setTimeout(() => { gift.hidden = true; gift.innerHTML = ""; }, 300);
      onClose?.();
    };
    q("[data-gift-close]", gift).onclick = close;
    gift.onclick = (event) => { if (event.target === gift) close(); };
  }

  // ---------- floating background hearts ----------

  function seedFloaties() {
    const box = q(".floaties");
    if (!box || box.childElementCount) return;
    for (let i = 0; i < 14; i++) {
      const dot = document.createElement("i");
      dot.style.cssText = `left:${Math.random() * 100}%;animation-duration:${14 + Math.random() * 16}s;animation-delay:-${Math.random() * 20}s;--s:${0.4 + Math.random() * 0.8}`;
      box.append(dot);
    }
  }

  // ---------- onboarding: who is who ----------

  async function loadProfile() {
    try {
      const docs = await fetch(`/api/us/docs?c=profile&who=${who || "a"}`).then(json).then((r) => r.docs);
      const main = docs.find((doc) => doc.id === "main");
      if (main) profile = { a: {}, b: {}, ...main.data };
    } catch {
      say("Couldn't reach the server");
    }
  }

  async function saveProfile(patch) {
    profile = { ...profile, ...patch };
    await fetch("/api/us/docs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ who: who || "a", c: "profile", id: "main", data: patch }),
    });
  }

  function cityPicker(container, initial, onPick) {
    container.innerHTML = `
      <div class="city-picker">
        <input class="field" placeholder="City (e.g. Delhi)" value="${esc(initial?.city || "")}" autocomplete="off">
        <div class="city-results"></div>
      </div>`;
    const input = q("input", container);
    const results = q(".city-results", container);
    let timer;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const text = input.value.trim();
      if (text.length < 2) { results.innerHTML = ""; return; }
      timer = setTimeout(async () => {
        try {
          const cities = await findCity(text);
          results.innerHTML = cities.map((c, i) => `<button type="button" class="city-option" data-i="${i}">${esc(c.label)}</button>`).join("")
            || `<p class="muted small">No city found</p>`;
          for (const button of qa(".city-option", results)) {
            button.onclick = () => {
              const city = cities[button.dataset.i];
              input.value = city.label;
              results.innerHTML = "";
              onPick(city);
            };
          }
        } catch {
          results.innerHTML = `<p class="muted small">Couldn't search right now</p>`;
        }
      }, 350);
    });
  }

  function onboard() {
    const box = q("#onboard");
    const hasNames = profile.a?.name && profile.b?.name;
    box.hidden = false;
    if (hasNames) {
      box.innerHTML = `
        <div class="onboard-card">
          <span class="onboard-heart">💞</span>
          <h2>Who's holding this phone?</h2>
          <p class="muted">This phone will remember it.</p>
          <div class="who-pick">
            <button class="who-btn" data-who="a"><span class="pair-avatar" style="--hue:350">${esc(profile.a.name[0])}</span>${esc(profile.a.name)}</button>
            <button class="who-btn" data-who="b"><span class="pair-avatar" style="--hue:280">${esc(profile.b.name[0])}</span>${esc(profile.b.name)}</button>
          </div>
        </div>`;
      for (const button of qa("[data-who]", box)) {
        button.onclick = () => {
          who = button.dataset.who;
          store.set("du-us-who", who);
          box.hidden = true;
          renderHome();
        };
      }
      return;
    }
    // First time ever: set up both people.
    const draft = { a: {}, b: {} };
    box.innerHTML = `
      <form class="onboard-card" id="setup-form">
        <span class="onboard-heart">💞</span>
        <h2>Let's make this place yours</h2>
        <p class="muted">Takes 20 seconds. You can change it later in settings.</p>
        <label class="field-label">Your name</label>
        <input class="field" name="me" required maxlength="24" placeholder="e.g. Uday">
        <label class="field-label">Your city <small class="muted">for time &amp; weather</small></label>
        <div id="city-me"></div>
        <label class="field-label">Your partner's name</label>
        <input class="field" name="you" required maxlength="24" placeholder="Their name">
        <label class="field-label">Their city</label>
        <div id="city-you"></div>
        <label class="field-label">Together since</label>
        <input class="field" type="date" name="since">
        <button class="btn primary wide">Start</button>
      </form>`;
    cityPicker(q("#city-me", box), null, (city) => { draft.a = { ...draft.a, ...city }; });
    cityPicker(q("#city-you", box), null, (city) => { draft.b = { ...draft.b, ...city }; });
    q("#setup-form", box).onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      who = "a";
      store.set("du-us-who", who);
      await saveProfile({
        a: { ...draft.a, name: form.get("me").trim() },
        b: { ...draft.b, name: form.get("you").trim() },
        since: form.get("since") || "",
      });
      box.hidden = true;
      renderHome();
      say("All set. Send the link to your love 💌");
    };
  }

  // ---------- home ----------

  function paintPerson(element, person) {
    const p = profile[person] || {};
    q(".pair-avatar", element).textContent = (p.name || "?")[0].toUpperCase();
    q(".pair-avatar", element).style.setProperty("--hue", person === "a" ? 350 : 280);
    q("b", element).textContent = person === who ? `${p.name || "You"}` : (p.name || "Partner");
    q(".pair-clock", element).textContent = `${timeIn(p.tz)}${p.city ? ` · ${p.city}` : ""}`;
    weatherFor(person).then((w) => {
      q(".pair-weather", element).textContent = w ? `${w.emoji} ${w.temp}° ${w.label}` : "";
    });
  }

  function paintClocks() {
    if (!who) return;
    paintPerson(q("#pair-me"), who);
    paintPerson(q("#pair-you"), partner());
    const myHour = hourIn(profile[who]?.tz);
    const theirHour = hourIn(profile[partner()]?.tz);
    q("#us-greet").textContent = `${greeting(myHour)}, ${myName()}`;
    let hint = `It's ${timeIn(profile[partner()]?.tz)} for ${theirName()}`;
    if (theirHour >= 23 || theirHour < 6) hint += ` · ${theirName()} might be sleeping 🌙`;
    if (!inCall.length) q("#call-hint").textContent = hint;
  }

  function paintSince() {
    const el = q("#us-since");
    if (!profile.since) { el.textContent = ""; return; }
    const days = daysBetween(parseDay(profile.since), new Date());
    el.innerHTML = `<b>${days.toLocaleString()}</b> days together`;
    const sinceDate = parseDay(profile.since);
    const today = new Date();
    if (sinceDate.getDate() === today.getDate() && days > 0) {
      const months = (today.getFullYear() - sinceDate.getFullYear()) * 12 + today.getMonth() - sinceDate.getMonth();
      el.innerHTML += months % 12 === 0 ? ` · Happy ${months / 12} year anniversary! 🎉` : ` · Happy ${months} months 💞`;
    }
  }

  function paintCountdown() {
    const card = q("#countdown-card");
    if (!profile.meet) {
      card.hidden = false;
      card.innerHTML = `<div class="cd-empty"><span class="icon">flight_takeoff</span><div><b>When do you meet next?</b><p class="muted small">Set the date and count down together</p></div><button class="chip-btn" data-us="set-meet">Set date</button></div>`;
      return;
    }
    const days = daysBetween(new Date(), parseDay(profile.meet));
    card.hidden = false;
    if (days < 0) {
      card.innerHTML = `<div class="cd-empty"><span class="icon">favorite</span><div><b>Hope it was magical 💞</b><p class="muted small">Plan the next one?</p></div><button class="chip-btn" data-us="set-meet">New date</button></div>`;
      return;
    }
    card.innerHTML = `
      <div class="cd">
        <div class="cd-num"><span class="count-up" data-to="${days}">${days}</span><small>${days === 1 ? "day" : "days"}</small></div>
        <div class="cd-text"><b>${days === 0 ? "Today you meet! 🥹" : "until we meet"}</b><p class="muted small">${prettyDate(parseDay(profile.meet), { weekday: "short", day: "numeric", month: "long" })}</p>
          <div class="cd-bar"><i style="--p:${Math.max(4, 100 - Math.min(100, days))}%"></i></div></div>
        <button class="icon-btn" data-us="set-meet" aria-label="Change date"><span class="icon">edit</span></button>
      </div>`;
    countUp(card);
  }

  function countUp(root) {
    for (const el of qa(".count-up", root)) {
      const to = Number(el.dataset.to) || 0;
      const start = performance.now();
      setTimeout(() => { el.textContent = to.toLocaleString(); }, 1100); // in case animation frames are paused
      const step = (now) => {
        const t = Math.min(1, (now - start) / 900);
        el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3))).toLocaleString();
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  // ---------- daily question ----------

  const QUESTIONS = [
    "Aaj ka sabse accha moment kya tha?", "Agar abhi mere paas hote, toh hum kya kar rahe hote?",
    "Meri kaunsi aadat tumhe secretly cute lagti hai?", "Hamari pehli baat tumhe yaad hai? Kya feel hua tha?",
    "Ek jagah jahan hum saath mein jaana chahiye?", "Tumhara comfort food kya hai jab mood off ho?",
    "Kaunsa gaana sunke meri yaad aati hai?", "Agar ek din ke liye kuch bhi kar sakte, kya karoge?",
    "Mujhme kya ek cheez badalni chahiye? (honestly 😅)", "Tumhara dream ghar kaisa hoga?",
    "Kaunsi movie hum saath dekhein next?", "Bachpan ki sabse funny yaad?",
    "Hamari relationship ka theme song kya hona chahiye?", "Aaj kis baat pe proud feel kiya?",
    "Kis cheez se tumhe sabse zyada darr lagta hai?", "Agar hum ek pet rakhein, toh kaunsa?",
    "Tumhe kaise pata chalta hai ki main pareshan hoon?", "5 saal baad hum kahan honge?",
    "Ek cheez jo tum mujhe bolna chahte ho par bol nahi paaye?", "Perfect Sunday kaisa hoga hamara?",
    "Tumhara favourite photo of us kaunsa hai?", "Kaunsi chhoti baat tumhe bahut khush kar deti hai?",
    "Meri kaunsi line tumhe yaad reh gayi?", "Agar aaj ek superpower milti, kaunsi?",
    "Long distance ne humein kya sikhaya?", "Pehli date pe kya karna chahoge (ya kiya tha)?",
    "Tumhari ek secret talent?", "Kaunsi cheez ke liye tum mujhe thank you bolna chahoge?",
    "Hum dono mein se zyada filmy kaun hai?", "Aaj ka mood ek emoji mein?",
    "Kaunsa khaana hum saath mein banayein?", "Tumhara love language kya hai?",
    "Agar hum ek din ke liye role swap karein?", "Kaunsi trip hamari bucket list mein top pe ho?",
    "Mere bina tumhara din kaisa hota hai?", "Ek cheez jo tumne mujhse seekhi?",
    "Ek yaad jo kabhi bhoolna nahi chahte?", "Kaunsa compliment tumhe sabse zyada pasand hai?",
    "Shaadi mein kaunsa gaana pe dance karoge? 💃", "Agar hum ek dukaan kholein, kis cheez ki?",
    "Kaunsi baat pe hum sabse zyada hasse the?", "Tum mujhe ek shabd mein describe karo",
    "Kaunsi aadat hum saath mein shuru karein?", "Raat ko neend na aaye toh kya karte ho?",
    "Mere saath kaunsa adventure karna hai?", "Aaj kisne tumhe smile karaya?",
    "Agar hum ek web series hote, toh naam kya hota?", "Tumhara ideal birthday kaisa ho?",
    "Mujhse milke sabse pehle kya karoge?", "Kis cheez ke liye tum grateful ho aaj?",
  ];
  const todayQuestion = () => QUESTIONS[Math.floor(parseDay(dayKey()).getTime() / 86400000) % QUESTIONS.length];

  async function paintQuestion() {
    const card = q("#question-card");
    const id = dayKey();
    card.innerHTML = `<p class="eyebrow"><span class="icon">help</span>Question of the day</p><h3 class="q-text">${esc(todayQuestion())}</h3><div class="q-body muted small">Loading…</div>`;
    let doc;
    try {
      doc = (await api.list("answers")).find((d) => d.id === id);
    } catch {
      q(".q-body", card).textContent = "Offline";
      return;
    }
    const data = doc?.data ?? {};
    const mine = data[who];
    const theirs = data[partner()];
    const theyAnswered = theirs || data[`${partner()}_answered`];
    const body = q(".q-body", card);
    body.classList.remove("muted", "small");
    if (!mine) {
      body.innerHTML = `
        <form class="q-form">
          <textarea class="field" rows="2" maxlength="600" placeholder="Your answer… (${esc(theirName())} sees it only after answering too)" required></textarea>
          <div class="q-foot"><span class="muted small">${theyAnswered ? `🔒 ${esc(theirName())} has answered. Answer to unlock!` : `${esc(theirName())} hasn't answered yet`}</span><button class="btn primary small-btn">Answer</button></div>
        </form>`;
      q("form", body).onsubmit = async (event) => {
        event.preventDefault();
        const text = q("textarea", body).value.trim();
        if (!text) return;
        await api.put("answers", { text }, id);
        burstHearts(10, q("button", body));
        paintQuestion();
      };
      return;
    }
    body.innerHTML = `
      <div class="answers">
        <div class="answer mine"><small>${esc(myName())}</small><p>${esc(mine)}</p></div>
        <div class="answer ${theirs ? "" : "waiting"}"><small>${esc(theirName())}</small><p>${theirs ? esc(theirs) : `Waiting for ${esc(theirName())}'s answer… 💭`}</p></div>
      </div>`;
  }

  // ---------- inbox: delivered surprises ----------

  async function paintInbox() {
    const card = q("#inbox-card");
    try {
      const docs = await api.list("scheduled");
      const recent = docs.filter((d) => d.data.to === who && d.data.at > Date.now() / 1000 - 3 * 86400)
        .sort((x, y) => y.data.at - x.data.at);
      if (!recent.length) { card.hidden = true; return; }
      const latest = recent[0];
      card.hidden = false;
      card.innerHTML = `<button class="inbox" data-open-msg="${esc(latest.id)}"><span class="inbox-icon">💌</span><div><b>A message from ${esc(theirName())}</b><p class="muted small">${ago(latest.data.at)} · tap to read</p></div><span class="icon">chevron_right</span></button>`;
      q("[data-open-msg]", card).onclick = () => showGift({ title: "For you", from: `From ${theirName()} · ${prettyDateTime(latest.data.at * 1000)}`, body: latest.data.body });
    } catch {
      card.hidden = true;
    }
  }

  // ---------- presence & hearts (pulse) ----------

  let inCall = [];
  let pulseTimer = null;
  let since = store.get(`du-since-${who}`, 0);

  let pulsing = false;
  async function pulse() {
    clearTimeout(pulseTimer);
    if (!who || pulsing) return;
    pulsing = true;
    try {
      const data = await api.pulse(since || Date.now() / 1000 - 60);
      for (const heart of data.hearts.sort((x, y) => x.at - y.at)) {
        bigHeart(`${theirName()} is thinking of you`);
        await sleep(600);
      }
      for (const message of data.messages) {
        showGift({ title: "A surprise for you", from: `From ${theirName()}`, body: message.data.body });
        paintInbox();
      }
      since = data.now;
      store.set(`du-since-${who}`, since);
      const wasInCall = inCall.length;
      inCall = data.inCall;
      paintCallOrb(data.callStart);
      if (!wasInCall && inCall.length && !polling && !q("#home").hidden) navigator.vibrate?.([200, 100, 200]);
    } catch {
      // offline: try again later
    }
    pulsing = false;
    const fast = !q("#home").hidden || polling;
    pulseTimer = setTimeout(pulse, fast ? 5000 : 15000);
  }

  function paintCallOrb() {
    const orb = q("#call-orb");
    if (!orb) return;
    const waiting = inCall.length > 0 && !polling;
    orb.classList.toggle("waiting", waiting);
    q("#orb-label").textContent = waiting ? `Join ${theirName()}` : `Call ${theirName()}`;
    if (waiting) q("#call-hint").textContent = `${inCall.join(" & ")} ${inCall.length > 1 ? "are" : "is"} in the call, waiting for you 💞`;
    else paintClocks();
  }

  async function sendHeart(button) {
    burstHearts(16, button);
    button?.classList.add("pop");
    setTimeout(() => button?.classList.remove("pop"), 500);
    navigator.vibrate?.(40);
    try {
      await api.heart();
      say(`${theirName()} will feel it 💗`);
    } catch {
      say("Couldn't send. Check the internet");
    }
  }

  // ---------- one-tap call ----------

  async function call(audioOnly = false) {
    if (!who) return onboard();
    history.pushState(null, "", `/?room=${US_ROOM}`);
    await openLobby(US_ROOM);
    if (audioOnly && me.cam) await setCamera(false);
    q("#name-input").value = myName();
    joinMeeting();
  }

  // ---------- sheets (feature screens) ----------

  let sheetName = null;
  const SHEETS = {};

  function openSheet(name) {
    if (!who) return onboard();
    sheetName = name;
    const sheet = q("#sheet");
    sheet.hidden = false;
    sheet.dataset.sheet = name;
    q("#sheet-action").innerHTML = "";
    q("#sheet-body").innerHTML = `<div class="sheet-loading"><span class="spinner"></span></div>`;
    requestAnimationFrame(() => sheet.classList.add("open"));
    history.pushState({ sheet: name }, "", location.href);
    SHEETS[name]();
  }

  function closeSheet(fromHistory = false) {
    const sheet = q("#sheet");
    if (sheet.hidden) return;
    sheet.classList.remove("open");
    sheetName = null;
    setTimeout(() => { if (!sheetName) sheet.hidden = true; }, 320);
    stopVoice();
    if (!fromHistory && history.state?.sheet) history.back();
    renderHome();
  }

  const setTitle = (text, action = "") => {
    q("#sheet-title").textContent = text;
    q("#sheet-action").innerHTML = action;
  };
  const body = () => q("#sheet-body");

  // ----- calendar -----

  const NOTE_COLORS = ["rose", "violet", "amber", "mint"];
  let calMonth = new Date();
  let calSelected = dayKey();

  SHEETS.calendar = async () => {
    setTitle("Our calendar");
    let notes = [];
    try { notes = await api.list("calendar"); } catch { body().innerHTML = `<p class="empty">Couldn't load. Check the internet.</p>`; return; }
    const byDay = new Map();
    for (const note of notes) {
      if (!byDay.has(note.data.date)) byDay.set(note.data.date, []);
      byDay.get(note.data.date).push(note);
    }
    const special = new Map();
    if (profile.meet) special.set(profile.meet, "✈️ We meet");
    if (profile.since) {
      const s = parseDay(profile.since);
      special.set(`${calMonth.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`, "💞 Anniversary");
    }

    const render = () => {
      const y = calMonth.getFullYear();
      const m = calMonth.getMonth();
      const first = new Date(y, m, 1);
      const startDay = (first.getDay() + 6) % 7; // Monday first
      const days = new Date(y, m + 1, 0).getDate();
      const today = dayKey();
      let cells = "";
      for (let i = 0; i < startDay; i++) cells += `<span class="cal-cell blank"></span>`;
      for (let d = 1; d <= days; d++) {
        const key = `${y}-${pad(m + 1)}-${pad(d)}`;
        const dayNotes = byDay.get(key) || [];
        const color = dayNotes[0]?.data.color;
        cells += `<button class="cal-cell ${key === today ? "today" : ""} ${key === calSelected ? "selected" : ""} ${dayNotes.length ? `has c-${color}` : ""} ${special.has(key) ? "special" : ""}" data-day="${key}">
          <span>${d}</span>${dayNotes.length ? `<i class="cal-dots">${dayNotes.slice(0, 3).map((n) => `<b class="c-${n.data.color}"></b>`).join("")}</i>` : ""}${special.has(key) ? `<em>${special.get(key).split(" ")[0]}</em>` : ""}</button>`;
      }
      const selNotes = byDay.get(calSelected) || [];
      body().innerHTML = `
        <div class="cal">
          <div class="cal-head">
            <button class="icon-btn" data-cal="-1" aria-label="Previous month"><span class="icon">chevron_left</span></button>
            <h3>${first.toLocaleDateString([], { month: "long", year: "numeric" })}</h3>
            <button class="icon-btn" data-cal="1" aria-label="Next month"><span class="icon">chevron_right</span></button>
          </div>
          <div class="cal-week">${["M", "T", "W", "T", "F", "S", "S"].map((d) => `<span>${d}</span>`).join("")}</div>
          <div class="cal-grid">${cells}</div>
        </div>
        <section class="day-panel">
          <h3>${prettyDate(parseDay(calSelected), { weekday: "long", day: "numeric", month: "long" })}</h3>
          ${special.has(calSelected) ? `<p class="special-line">${special.get(calSelected)}</p>` : ""}
          <ul class="day-notes">${selNotes.map((n) => `
            <li class="day-note c-${n.data.color}"><div><p>${esc(n.data.text)}</p><small>${esc(nameOf(n.data.who))}</small></div>
            ${n.data.who === who ? `<button class="icon-btn" data-del-note="${esc(n.id)}" aria-label="Delete"><span class="icon">delete</span></button>` : ""}</li>`).join("") || `<li class="empty small">Nothing yet. Add a plan, a reminder, a sweet thing to remember.</li>`}</ul>
          <form class="note-form">
            <input class="field" maxlength="200" placeholder="Add a note for this day…" required>
            <div class="color-pick">${NOTE_COLORS.map((c, i) => `<label><input type="radio" name="color" value="${c}" ${i === 0 ? "checked" : ""}><b class="c-${c}"></b></label>`).join("")}</div>
            <button class="btn primary small-btn">Add</button>
          </form>
        </section>`;
      for (const b of qa("[data-cal]")) b.onclick = () => { calMonth = new Date(y, m + Number(b.dataset.cal), 1); render(); };
      for (const b of qa("[data-day]")) b.onclick = () => { calSelected = b.dataset.day; render(); q(".day-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); };
      for (const b of qa("[data-del-note]")) {
        b.onclick = async () => {
          await api.del("calendar", b.dataset.delNote);
          notes = notes.filter((n) => n.id !== b.dataset.delNote);
          byDay.set(calSelected, (byDay.get(calSelected) || []).filter((n) => n.id !== b.dataset.delNote));
          render();
        };
      }
      q(".note-form").onsubmit = async (event) => {
        event.preventDefault();
        const text = q(".note-form input.field").value.trim();
        const color = q(".note-form input[name=color]:checked").value;
        const doc = await api.put("calendar", { date: calSelected, text, color, who });
        if (!byDay.has(calSelected)) byDay.set(calSelected, []);
        byDay.get(calSelected).push(doc);
        render();
      };
    };
    render();
  };

  // ----- memories (diary + call moments) -----

  async function shrinkImage(file, max = 1600) {
    if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.86));
    } catch {
      return file;
    }
  }

  let voice = null; // { recorder, chunks, stream, blob, started }
  function stopVoice() {
    if (voice?.recorder?.state === "recording") voice.recorder.stop();
    voice?.stream?.getTracks().forEach((t) => t.stop());
  }

  function mediaHtml(list = []) {
    if (!list.length) return "";
    return `<div class="mem-media n${Math.min(list.length, 4)}">${list.map((m) => {
      if (m.type?.startsWith("image/")) return `<img src="${esc(m.url)}" alt="" loading="lazy" data-zoom>`;
      if (m.type?.startsWith("video/")) return `<video src="${esc(m.url)}" controls playsinline preload="metadata"></video>`;
      if (m.type?.startsWith("audio/")) return `<div class="voice-note"><span class="icon">graphic_eq</span><audio src="${esc(m.url)}" controls preload="none"></audio></div>`;
      return "";
    }).join("")}</div>`;
  }

  SHEETS.memories = async () => {
    setTitle("Our memories", `<button class="btn primary small-btn" data-mem-new><span class="icon">add</span>Add</button>`);
    let items = [];
    try {
      const [diary, moments] = await Promise.all([api.list("diary"), api.list("moments")]);
      items = [...diary.map((d) => ({ ...d, kind: "diary" })), ...moments.map((d) => ({ ...d, kind: "moments" }))]
        .sort((x, y) => (y.data.at || 0) - (x.data.at || 0));
    } catch {
      body().innerHTML = `<p class="empty">Couldn't load. Check the internet.</p>`;
      return;
    }
    let lastMonth = "";
    const cards = items.map((item) => {
      const month = new Date(item.data.at * 1000).toLocaleDateString([], { month: "long", year: "numeric" });
      const header = month !== lastMonth ? `<h4 class="mem-month">${month}</h4>` : "";
      lastMonth = month;
      const isMoment = item.kind === "moments";
      return `${header}
        <article class="mem ${isMoment ? "moment" : ""}">
          <div class="mem-meta"><span class="pair-avatar sm" style="--hue:${item.data.who === "a" ? 350 : 280}">${esc(nameOf(item.data.who)[0])}</span>
            <span><b>${isMoment ? "Call moment 📸" : esc(nameOf(item.data.who))}</b><small>${prettyDateTime(item.data.at * 1000)}</small></span>
            ${item.data.who === who ? `<button class="icon-btn" data-del-mem="${esc(item.kind)}:${esc(item.id)}" aria-label="Delete"><span class="icon">delete</span></button>` : ""}</div>
          ${item.data.text ? `<p class="mem-text">${esc(item.data.text).replace(/\n/g, "<br>")}</p>` : ""}
          ${mediaHtml(item.data.media)}
        </article>`;
    }).join("");
    body().innerHTML = `
      <div class="mem-compose" hidden>
        <textarea class="field" rows="3" maxlength="3000" placeholder="Write something to remember…"></textarea>
        <div class="mem-previews"></div>
        <div class="mem-tools">
          <label class="chip-btn"><span class="icon">add_photo_alternate</span>Photo / video<input type="file" accept="image/*,video/*" multiple hidden></label>
          <button class="chip-btn" data-voice><span class="icon">mic</span><span>Voice note</span></button>
          <span class="grow"></span>
          <button class="btn primary small-btn" data-mem-save>Save</button>
        </div>
      </div>
      <div class="timeline">${cards || `<div class="empty-art"><span>📷</span><p>Your story starts here. Add a photo, a voice note, or a little note.</p></div>`}</div>`;

    const compose = q(".mem-compose");
    const files = [];
    const previews = q(".mem-previews");
    q("[data-mem-new]").onclick = () => { compose.hidden = !compose.hidden; if (!compose.hidden) q("textarea", compose).focus(); };
    const paintPreviews = () => {
      previews.innerHTML = files.map((f, i) => `<span class="mem-prev">${f.type.startsWith("image/") ? `<img src="${URL.createObjectURL(f)}" alt="">` : `<span class="icon">${f.type.startsWith("audio/") ? "graphic_eq" : "movie"}</span>`}<button data-rm="${i}" aria-label="Remove">×</button></span>`).join("");
      for (const b of qa("[data-rm]", previews)) b.onclick = () => { files.splice(Number(b.dataset.rm), 1); paintPreviews(); };
    };
    q("input[type=file]", compose).onchange = (event) => {
      for (const file of event.target.files) {
        if (file.size > 25 * 1024 * 1024) { say(`${file.name} is over 25 MB`); continue; }
        files.push(file);
      }
      event.target.value = "";
      paintPreviews();
    };
    const voiceBtn = q("[data-voice]", compose);
    voiceBtn.onclick = async () => {
      if (voice?.recorder?.state === "recording") {
        voice.recorder.stop();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
        const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
        voice = { recorder, stream, chunks: [], started: Date.now() };
        recorder.ondataavailable = (e) => e.data.size && voice.chunks.push(e.data);
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(voice.chunks, { type: recorder.mimeType || "audio/webm" });
          files.push(new File([blob], "voice", { type: blob.type.split(";")[0] }));
          voiceBtn.classList.remove("recording");
          q("span:last-child", voiceBtn).textContent = "Voice note";
          paintPreviews();
        };
        recorder.start();
        voiceBtn.classList.add("recording");
        const tick = () => {
          if (voice?.recorder?.state !== "recording") return;
          q("span:last-child", voiceBtn).textContent = `Stop · ${duration((Date.now() - voice.started) / 1000)}`;
          setTimeout(tick, 500);
        };
        tick();
      } catch {
        say("Microphone not allowed");
      }
    };
    q("[data-mem-save]", compose).onclick = async (event) => {
      const button = event.currentTarget;
      const text = q("textarea", compose).value.trim();
      if (!text && !files.length) return say("Write something or add a photo");
      button.disabled = true;
      button.textContent = "Saving…";
      try {
        const media = [];
        for (const file of files) {
          const ready = await shrinkImage(file);
          const uploaded = await api.media(ready);
          media.push({ id: uploaded.id, url: uploaded.url, type: uploaded.type });
        }
        await api.put("diary", { who, text, media, at: Date.now() / 1000 });
        burstHearts(12, button);
        SHEETS.memories();
      } catch {
        say("Couldn't save. Try again");
        button.disabled = false;
        button.textContent = "Save";
      }
    };
    for (const b of qa("[data-del-mem]")) {
      b.onclick = async () => {
        if (!confirm("Delete this memory?")) return;
        const [c, id] = b.dataset.delMem.split(":");
        await api.del(c, id);
        b.closest(".mem").remove();
      };
    }
    for (const img of qa("[data-zoom]")) img.onclick = () => zoom(img.src);
  };

  function zoom(src) {
    const gift = q("#gift");
    gift.innerHTML = `<img class="zoomed" src="${esc(src)}" alt="">`;
    gift.hidden = false;
    requestAnimationFrame(() => gift.classList.add("open"));
    gift.onclick = () => { gift.classList.remove("open"); setTimeout(() => { gift.hidden = true; }, 300); };
  }

  // ----- open-when letters -----

  const LETTER_PRESETS = ["Jab udaas ho 🥺", "Jab neend na aaye 🌙", "Jab meri yaad aaye 💭", "Jab gussa ho 😤", "Jab khush ho ✨", "Birthday par 🎂", "Jab hum ladein 🫂"];
  let letterTab = "for";

  SHEETS.letters = async () => {
    setTitle("Open-when letters", `<button class="btn primary small-btn" data-letter-new><span class="icon">edit</span>Write</button>`);
    let letters = [];
    try { letters = await api.list("letters"); } catch { body().innerHTML = `<p class="empty">Couldn't load.</p>`; return; }
    const forMe = letters.filter((l) => l.data.to === who);
    const fromMe = letters.filter((l) => l.data.from === who);
    const list = letterTab === "for" ? forMe : fromMe;
    const now = Date.now() / 1000;
    body().innerHTML = `
      <div class="seg"><button class="${letterTab === "for" ? "on" : ""}" data-tab="for">For you <i>${forMe.length}</i></button><button class="${letterTab === "from" ? "on" : ""}" data-tab="from">From you <i>${fromMe.length}</i></button></div>
      <div class="letters">${list.map((l) => {
        const locked = l.data.locked || (l.data.unlock && l.data.unlock > now);
        const opened = Boolean(l.data.opened);
        return `<button class="envelope ${opened ? "opened" : ""} ${locked ? "locked" : ""}" data-letter="${esc(l.id)}">
          <span class="env-flap"></span><span class="env-seal">${locked ? "🔒" : opened ? "💌" : "💗"}</span>
          <b>${esc(l.data.title)}</b>
          <small>${letterTab === "for" ? (locked ? `Opens ${prettyDateTime(l.data.unlock * 1000)}` : opened ? `Opened ${ago(l.data.opened)}` : "Sealed · tap to open") : (opened ? `Opened ${ago(l.data.opened)} 🥹` : locked ? `Unlocks ${prettyDateTime(l.data.unlock * 1000)}` : "Not opened yet")}</small>
        </button>`;
      }).join("") || `<div class="empty-art"><span>✉️</span><p>${letterTab === "for" ? `No letters yet. Ask ${esc(theirName())} to write you one 😉` : `Write a letter ${esc(theirName())} can open when it's needed most.`}</p></div>`}</div>`;
    for (const b of qa("[data-tab]")) b.onclick = () => { letterTab = b.dataset.tab; SHEETS.letters(); };
    q("[data-letter-new]").onclick = writeLetter;
    for (const b of qa("[data-letter]")) {
      b.onclick = async () => {
        const letter = letters.find((l) => l.id === b.dataset.letter);
        const locked = letter.data.locked || (letter.data.unlock && letter.data.unlock > Date.now() / 1000);
        if (locked) { b.classList.add("shake"); setTimeout(() => b.classList.remove("shake"), 500); return say(`Opens on ${prettyDateTime(letter.data.unlock * 1000)}`); }
        b.classList.add("opening");
        await sleep(650);
        showGift({ icon: "💌", title: letter.data.title, from: letterTab === "for" ? `From ${nameOf(letter.data.from)}` : `To ${nameOf(letter.data.to)}`, body: letter.data.body });
        if (letterTab === "for" && !letter.data.opened) {
          await api.put("letters", { ...letter.data, opened: Date.now() / 1000 }, letter.id);
        }
        b.classList.remove("opening");
        if (letterTab === "for") SHEETS.letters();
      };
    }
  };

  function writeLetter() {
    setTitle("Write a letter");
    body().innerHTML = `
      <form class="letter-form">
        <label class="field-label">Open when…</label>
        <div class="chips">${LETTER_PRESETS.map((t) => `<button type="button" class="chip-btn" data-preset="${esc(t)}">${esc(t)}</button>`).join("")}</div>
        <input class="field" name="title" maxlength="80" placeholder="Jab…" required>
        <label class="field-label">Your letter</label>
        <textarea class="field paper" name="body" rows="9" maxlength="8000" placeholder="Dear ${esc(theirName())}," required></textarea>
        <label class="field-label">Lock until <small class="muted">(optional, e.g. a birthday)</small></label>
        <input class="field" type="datetime-local" name="unlock">
        <button class="btn primary wide"><span class="icon">send</span>Seal the letter</button>
      </form>`;
    for (const b of qa("[data-preset]")) b.onclick = () => { q("input[name=title]").value = b.dataset.preset; };
    q(".letter-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      const unlock = form.get("unlock") ? new Date(form.get("unlock")).getTime() / 1000 : 0;
      await api.put("letters", { from: who, to: partner(), title: form.get("title").trim(), body: form.get("body"), unlock, at: Date.now() / 1000 });
      burstHearts(18, q(".letter-form button.wide"));
      say("Sealed with love 💌");
      letterTab = "from";
      SHEETS.letters();
    };
  }

  // ----- scheduled surprises -----

  SHEETS.messages = async () => {
    setTitle("Surprise messages");
    let docs = [];
    try { docs = await api.list("scheduled"); } catch { body().innerHTML = `<p class="empty">Couldn't load.</p>`; return; }
    const now = Date.now() / 1000;
    const mine = docs.filter((d) => d.data.from === who).sort((x, y) => x.data.at - y.data.at);
    const got = docs.filter((d) => d.data.to === who).sort((x, y) => y.data.at - x.data.at);
    const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
    const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    body().innerHTML = `
      <form class="sched-form card">
        <p class="eyebrow"><span class="icon">schedule_send</span>Write now, ${esc(theirName())} gets it later</p>
        <textarea class="field" name="body" rows="3" maxlength="2000" placeholder="Happy birthday meri jaan 🎂…" required></textarea>
        <div class="sched-row">
          <input class="field" type="datetime-local" name="at" value="${local(midnight)}" required>
          <button class="btn primary small-btn"><span class="icon">send</span>Schedule</button>
        </div>
        <div class="chips"><button type="button" class="chip-btn" data-when="midnight">Tonight 12:00</button><button type="button" class="chip-btn" data-when="morning">Tomorrow 7:00</button><button type="button" class="chip-btn" data-when="hour">In 1 hour</button></div>
      </form>
      <h4 class="list-title">Waiting to be delivered</h4>
      <ul class="sched-list">${mine.filter((d) => d.data.at > now).map((d) => `
        <li><span class="icon">hourglass_top</span><div><p>${esc(d.data.body)}</p><small>Arrives ${prettyDateTime(d.data.at * 1000)}</small></div><button class="icon-btn" data-del-msg="${esc(d.id)}" aria-label="Cancel"><span class="icon">close</span></button></li>`).join("") || `<li class="empty small">Nothing scheduled</li>`}</ul>
      <h4 class="list-title">Received</h4>
      <ul class="sched-list">${got.map((d) => `
        <li class="got" data-read="${esc(d.id)}"><span class="icon">mark_email_read</span><div><p>${esc(d.data.body)}</p><small>${prettyDateTime(d.data.at * 1000)}</small></div></li>`).join("") || `<li class="empty small">Nothing yet</li>`}</ul>
      <h4 class="list-title">Delivered from you</h4>
      <ul class="sched-list">${mine.filter((d) => d.data.at <= now).reverse().map((d) => `
        <li><span class="icon">done_all</span><div><p>${esc(d.data.body)}</p><small>${prettyDateTime(d.data.at * 1000)}</small></div></li>`).join("") || `<li class="empty small">Nothing yet</li>`}</ul>`;
    const atInput = q("input[name=at]");
    for (const b of qa("[data-when]")) {
      b.onclick = () => {
        const d = new Date();
        if (b.dataset.when === "midnight") d.setHours(24, 0, 0, 0);
        if (b.dataset.when === "morning") { d.setDate(d.getDate() + 1); d.setHours(7, 0, 0, 0); }
        if (b.dataset.when === "hour") d.setTime(d.getTime() + 3600000);
        atInput.value = local(d);
      };
    }
    q(".sched-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      const at = new Date(form.get("at")).getTime() / 1000;
      if (at < Date.now() / 1000 - 60) return say("Pick a time in the future");
      await api.put("scheduled", { from: who, to: partner(), body: form.get("body").trim(), at });
      burstHearts(12, q(".sched-form button.btn"));
      say(`Scheduled for ${prettyDateTime(at * 1000)} 💌`);
      SHEETS.messages();
    };
    for (const b of qa("[data-del-msg]")) b.onclick = async () => { await api.del("scheduled", b.dataset.delMsg); SHEETS.messages(); };
    for (const li of qa("[data-read]")) li.onclick = () => { const d = got.find((x) => x.id === li.dataset.read); showGift({ title: "For you", from: `From ${theirName()}`, body: d.data.body }); };
  };

  // ----- focus timer & stopwatch -----

  const TIMER_KEY = "du-timer";
  const LABELS = ["📚 Padhai", "💬 Baat", "💼 Kaam", "🏃 Workout", "🧘 Me time"];
  const timer = store.get(TIMER_KEY, { mode: "stopwatch", label: LABELS[0], startedAt: 0, elapsed: 0, target: 25 * 60 });
  const saveTimer = () => store.set(TIMER_KEY, timer);
  const elapsedNow = () => timer.elapsed + (timer.startedAt ? (Date.now() - timer.startedAt) / 1000 : 0);
  let timerFrame = null;

  async function finishTimer() {
    const secs = elapsedNow();
    timer.startedAt = 0;
    timer.elapsed = 0;
    saveTimer();
    if (secs >= 30) {
      try { await api.put("study", { who, label: timer.label, secs: Math.round(secs), at: Date.now() / 1000 }); } catch { /* offline */ }
      say(`Saved ${duration(secs, true)} of ${timer.label} ✨`);
    }
  }

  SHEETS.timer = async () => {
    setTitle("Focus");
    const R = 108;
    const C = 2 * Math.PI * R;
    body().innerHTML = `
      <div class="seg"><button data-mode="stopwatch" class="${timer.mode === "stopwatch" ? "on" : ""}">Stopwatch</button><button data-mode="pomodoro" class="${timer.mode === "pomodoro" ? "on" : ""}">Timer</button></div>
      <div class="chips center">${LABELS.map((l) => `<button class="chip-btn ${l === timer.label ? "on" : ""}" data-label="${esc(l)}">${esc(l)}</button>`).join("")}</div>
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 240 240"><circle cx="120" cy="120" r="${R}" class="ring-bg"/><circle cx="120" cy="120" r="${R}" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
        <div class="ring-center"><span class="ring-time">00:00</span><small class="ring-sub"></small></div>
      </div>
      <div class="pomo-set" ${timer.mode === "pomodoro" ? "" : "hidden"}>${[15, 25, 45, 60, 90].map((m) => `<button class="chip-btn ${timer.target === m * 60 ? "on" : ""}" data-min="${m}">${m} min</button>`).join("")}</div>
      <div class="timer-actions">
        <button class="btn outline" data-t="reset"><span class="icon">restart_alt</span>Reset</button>
        <button class="btn primary big" data-t="go"><span class="icon">play_arrow</span><span>Start</span></button>
        <button class="btn outline" data-t="save"><span class="icon">check</span>Done</button>
      </div>
      <section class="today-focus"><h4 class="list-title">Today</h4><div class="focus-today muted small">…</div></section>
      <p class="muted small center">Tip: in a call, open ✨ Together → Study together to run one timer for both of you.</p>`;

    const fg = q(".ring-fg");
    const paint = () => {
      const secs = elapsedNow();
      const isPomo = timer.mode === "pomodoro";
      const shown = isPomo ? Math.max(0, timer.target - secs) : secs;
      q(".ring-time").textContent = duration(shown);
      q(".ring-sub").textContent = timer.startedAt ? timer.label : secs ? "Paused" : timer.label;
      const fraction = isPomo ? Math.min(1, secs / timer.target) : (secs % 3600) / 3600;
      fg.style.strokeDashoffset = String(C * (1 - fraction));
      const go = q("[data-t=go]");
      q(".icon", go).textContent = timer.startedAt ? "pause" : "play_arrow";
      q("span:last-child", go).textContent = timer.startedAt ? "Pause" : secs ? "Resume" : "Start";
      q(".ring-wrap").classList.toggle("running", Boolean(timer.startedAt));
      if (isPomo && timer.startedAt && secs >= timer.target) {
        navigator.vibrate?.([300, 150, 300]);
        bigHeart(`${timer.label} done! Proud of you`);
        finishTimer().then(paintToday);
      }
      if (sheetName === "timer") timerFrame = requestAnimationFrame(paint);
    };
    const paintToday = async () => {
      try {
        const today = dayKey();
        const docs = (await api.list("study")).filter((d) => dayKey(new Date(d.data.at * 1000)) === today);
        const sum = (person) => docs.filter((d) => d.data.who === person).reduce((t, d) => t + d.data.secs, 0);
        q(".focus-today").innerHTML = `
          <div class="focus-pair"><div><b>${duration(sum(who), true)}</b><small>${esc(myName())}</small></div><span>💪</span><div><b>${duration(sum(partner()), true)}</b><small>${esc(theirName())}</small></div></div>
          <ul class="focus-list">${docs.slice(0, 8).map((d) => `<li><span>${esc(d.data.label)}</span><span>${esc(nameOf(d.data.who))}</span><b>${duration(d.data.secs, true)}</b></li>`).join("")}</ul>`;
      } catch { /* offline */ }
    };
    for (const b of qa("[data-mode]")) b.onclick = () => { if (timer.startedAt) return say("Pause first"); timer.mode = b.dataset.mode; timer.elapsed = 0; saveTimer(); SHEETS.timer(); };
    for (const b of qa("[data-label]")) b.onclick = () => { timer.label = b.dataset.label; saveTimer(); qa("[data-label]").forEach((x) => x.classList.toggle("on", x === b)); };
    for (const b of qa("[data-min]")) b.onclick = () => { if (timer.startedAt) return; timer.target = Number(b.dataset.min) * 60; saveTimer(); qa("[data-min]").forEach((x) => x.classList.toggle("on", x === b)); };
    q("[data-t=go]").onclick = () => {
      if (timer.startedAt) { timer.elapsed = elapsedNow(); timer.startedAt = 0; } else { timer.startedAt = Date.now(); }
      saveTimer();
    };
    q("[data-t=reset]").onclick = () => { timer.startedAt = 0; timer.elapsed = 0; saveTimer(); };
    q("[data-t=save]").onclick = async () => { await finishTimer(); paintToday(); };
    cancelAnimationFrame(timerFrame);
    paint();
    paintToday();
  };

  // ----- stats -----

  SHEETS.stats = async () => {
    setTitle("Our stats");
    let calls, hearts, study;
    try { [calls, hearts, study] = await Promise.all([api.list("calls"), api.list("hearts"), api.list("study")]); } catch { body().innerHTML = `<p class="empty">Couldn't load.</p>`; return; }
    const secs = calls.reduce((t, c) => t + c.data.secs, 0);
    const longest = calls.reduce((m, c) => Math.max(m, c.data.secs), 0);
    const days = new Set(calls.map((c) => dayKey(new Date(c.data.start * 1000))));
    let streak = 0;
    const d = new Date();
    if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1); // today not over yet
    while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(); day.setDate(day.getDate() - i);
      const key = dayKey(day);
      week.push({ label: day.toLocaleDateString([], { weekday: "narrow" }), secs: calls.filter((c) => dayKey(new Date(c.data.start * 1000)) === key).reduce((t, c) => t + c.data.secs, 0) });
    }
    const maxWeek = Math.max(1, ...week.map((w) => w.secs));
    const heartsBy = (p) => hearts.filter((h) => h.data.from === p).length;
    const studyBy = (p) => study.filter((s) => s.data.who === p).reduce((t, s) => t + s.data.secs, 0);
    const hours = secs / 3600;
    const fun = hours < 1 ? "Abhi toh shuruaat hai 😌"
      : hours < 10 ? `Itni baat = ${Math.max(1, Math.round(hours / 2.5))} Bollywood movies 🍿`
      : hours < 50 ? `Itni baat mein ek poori web series khatam ho jaati 📺 (${Math.round(hours / 0.75)} episodes!)`
      : `Itna toh log Delhi se London flight mein bhi nahi bolte ✈️ (${Math.round(hours / 9)} flights worth)`;
    body().innerHTML = `
      <div class="stat-hero"><span class="count-up" data-to="${Math.floor(hours)}">0</span><small>hours together on call</small><p>${fun}</p></div>
      <div class="stat-grid">
        <div class="stat"><b class="count-up" data-to="${calls.length}">0</b><small>calls</small></div>
        <div class="stat"><b>${duration(longest, true)}</b><small>longest call</small></div>
        <div class="stat fire"><b class="count-up" data-to="${streak}">0</b><small>day streak 🔥</small></div>
        <div class="stat"><b>${calls.length ? duration(secs / calls.length, true) : "0m"}</b><small>average call</small></div>
      </div>
      <section class="card"><h4 class="list-title">This week</h4>
        <div class="bars">${week.map((w) => `<div class="bar"><i style="--h:${Math.round((w.secs / maxWeek) * 100)}%"></i><small>${w.label}</small></div>`).join("")}</div></section>
      <section class="card duel"><h4 class="list-title">Who sends more love?</h4>
        <div class="duel-row"><span>${esc(myName())}</span><div class="duel-bar"><i style="--p:${Math.round((heartsBy(who) / Math.max(1, heartsBy(who) + heartsBy(partner()))) * 100)}%"></i></div><span>${esc(theirName())}</span></div>
        <p class="muted small center">💗 ${heartsBy(who)} vs ${heartsBy(partner())} 💗</p></section>
      <section class="card duel"><h4 class="list-title">Focus time</h4>
        <div class="focus-pair"><div><b>${duration(studyBy(who), true)}</b><small>${esc(myName())}</small></div><span>📚</span><div><b>${duration(studyBy(partner()), true)}</b><small>${esc(theirName())}</small></div></div></section>`;
    countUp(body());
  };

  // ----- settings -----

  SHEETS.settings = async () => {
    setTitle("Settings");
    const me_ = profile[who] || {};
    const you = profile[partner()] || {};
    body().innerHTML = `
      <form class="settings-form">
        <label class="field-label">Your name</label><input class="field" name="myname" value="${esc(me_.name || "")}" maxlength="24">
        <label class="field-label">Your city · now ${esc(me_.city || "not set")}</label><div id="set-city-me"></div>
        <label class="field-label">Partner's name</label><input class="field" name="yourname" value="${esc(you.name || "")}" maxlength="24">
        <label class="field-label">Partner's city · now ${esc(you.city || "not set")}</label><div id="set-city-you"></div>
        <label class="field-label">Together since</label><input class="field" type="date" name="since" value="${esc(profile.since || "")}">
        <label class="field-label">Next time we meet</label><input class="field" type="date" name="meet" value="${esc(profile.meet || "")}">
        <button class="btn primary wide">Save</button>
      </form>
      <section class="card install-help">
        <h4 class="list-title">Put DU Meet on your home screen</h4>
        <p><b>iPhone:</b> open in Safari → Share <span class="icon inline">ios_share</span> → <b>Add to Home Screen</b>.</p>
        <p><b>Android:</b> Chrome menu ⋮ → <b>Install app</b> / Add to Home screen.</p>
        <button class="chip-btn" data-install hidden><span class="icon">install_mobile</span>Install now</button>
      </section>
      <section class="card"><h4 class="list-title">This phone</h4>
        <p class="muted small">This phone is <b>${esc(myName())}</b>'s.</p>
        <button class="chip-btn" data-switch-who><span class="icon">swap_horiz</span>I'm ${esc(theirName())}, switch</button>
      </section>
      <section class="card"><h4 class="list-title">Privacy</h4>
        <p class="muted small">Video and voice go straight between your two phones, encrypted end to end (WebRTC DTLS-SRTP), even through the relay. Recording only starts if both of you say yes. Everything here is behind your password.</p>
      </section>`;
    const patch = { a: { ...profile.a }, b: { ...profile.b } };
    cityPicker(q("#set-city-me"), null, (city) => { patch[who] = { ...patch[who], ...city }; });
    cityPicker(q("#set-city-you"), null, (city) => { patch[partner()] = { ...patch[partner()], ...city }; });
    q(".settings-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      patch[who].name = form.get("myname").trim() || patch[who].name;
      patch[partner()].name = form.get("yourname").trim() || patch[partner()].name;
      await saveProfile({ ...patch, since: form.get("since"), meet: form.get("meet") });
      for (const p of ["a", "b"]) localStorage.removeItem(`du-weather-${p}`);
      say("Saved 💞");
      closeSheet();
    };
    q("[data-switch-who]").onclick = () => { who = partner(); store.set("du-us-who", who); since = 0; say(`This phone is now ${myName()}'s`); closeSheet(); };
    if (installPrompt) {
      const b = q("[data-install]");
      b.hidden = false;
      b.onclick = async () => { installPrompt.prompt(); installPrompt = null; b.hidden = true; };
    }
  };

  function setMeetDate() {
    openSheet("settings");
    setTimeout(() => q("input[name=meet]")?.focus(), 400);
  }

  // ---------- home render ----------

  async function renderHome() {
    seedFloaties();
    if (!who || !profile.a?.name) { await loadProfile(); }
    if (!who || !profile[who]?.name) return onboard();
    q("#onboard").hidden = true;
    paintClocks();
    paintSince();
    paintCountdown();
    paintQuestion();
    paintInbox();
    paintCallOrb();
    qa(".reveal").forEach((el, i) => { el.style.animationDelay = `${i * 70}ms`; el.classList.add("in"); });
  }

  // ---------- events ----------

  document.addEventListener("click", (event) => {
    const us = event.target.closest("[data-us]");
    if (us) {
      const action = us.dataset.us;
      if (action === "call") call(false);
      else if (action === "call-audio") call(true);
      else if (action === "heart") sendHeart(us);
      else if (action === "settings") openSheet("settings");
      else if (action === "sheet-back") closeSheet();
      else if (action === "set-meet") setMeetDate();
    }
    const sheetButton = event.target.closest("[data-sheet]");
    if (sheetButton && !sheetButton.closest("#sheet")) openSheet(sheetButton.dataset.sheet);
  });

  window.addEventListener("popstate", () => { if (sheetName) closeSheet(true); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && sheetName) closeSheet(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { pulse(); if (!q("#home").hidden) paintClocks(); } });
  setInterval(() => { if (!q("#home").hidden && who) paintClocks(); }, 30000);

  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event; });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  // ---------- hooks used by app.js / together.js ----------

  window.DU = Object.assign(window.DU || {}, {
    get who() { return who; },
    get profile() { return profile; },
    myName, theirName, nameOf, api, burstHearts, bigHeart, showGift, say, esc, duration, dayKey,
    isUsRoom: () => room === US_ROOM,
    onHome() { renderHome(); pulse(); },
    onJoin() { if (room === US_ROOM) { inCall = []; pulse(); } },
    onLeave() {
      const us = room === US_ROOM;
      document.getElementById("left-title").textContent = us ? `Call ended` : "You left the meeting";
      const started = joinedAt ? (Date.now() - joinedAt) / 1000 : 0;
      document.getElementById("left-sub").textContent = us && started > 30 ? `${duration(started, true)} together · ${["Miss you already 🥺", "Talk soon 💞", "Sweet dreams 🌙", "That was nice 💗"][Math.floor(Math.random() * 4)]}` : "";
    },
    sendHeart,
  });

  // The "left" screen: go home instead of the old meeting home.
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-action=home]")) setTimeout(() => window.DU.onHome(), 0);
  }, true);

  if (!new URLSearchParams(location.search).get("room")) {
    loadProfile().then(() => { renderHome(); pulse(); });
  } else {
    loadProfile().then(pulse);
  }
})();
