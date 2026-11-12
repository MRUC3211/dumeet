// DU Meet · fresh questions every time, and rounds of 10.
//
//  - Every question game (Questions, Would you rather, Truth or dare, Who's more likely, Quiz
//    battle, the Date night cards) asks DU.deck for the next one. Ones you've already had are
//    skipped until the whole deck is used up; what was seen is kept on the server, so both
//    phones (and a new phone) remember it.
//  - A round is 10 questions. After that the game takes a short break (10 minutes by default,
//    Admin can change both numbers), so it stays special instead of being rushed through.
//    Both phones count every card shown, so they agree on when the break starts.

(() => {
  "use strict";
  window.DU ||= {};
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
  };
  const size = () => Math.max(3, Math.min(50, Number(window.DU.policy?.roundSize) || 10));
  const breakMs = () => Math.max(0, Math.min(240, Number(window.DU.policy?.roundBreak ?? 10))) * 60000;

  // ---------- what has been seen (per deck), shared through the server ----------
  let seen = store.get("du-deck-seen", {});
  let dirty = false, timer = 0;
  const key36 = (x) => String(x).slice(0, 160);
  // what the server has, merged into this phone's list (both phones save the same doc)
  function merge(d) {
    if (!d || typeof d !== "object") return;
    for (const [k, list] of Object.entries(d)) seen[k] = [...new Set([...(seen[k] || []), ...(Array.isArray(list) ? list : [])])].slice(-600);
    store.set("du-deck-seen", seen);
  }
  const fetchSeen = () => fetch("/api/data?c=settings").then((r) => (r.ok ? r.json() : null)).then((r) => r?.docs?.find((x) => x.id === "deck-seen")?.data?.seen);
  function loadSeen() { fetchSeen().then(merge).catch(() => {}); }
  function saveSeen() {
    store.set("du-deck-seen", seen);
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!dirty) return;
      dirty = false;
      try { merge(await fetchSeen()); } catch { /* save what we have */ }
      fetch("/api/data", { method: "POST", body: JSON.stringify({ c: "settings", id: "deck-seen", data: { seen } }) }).catch(() => { dirty = true; });
    }, 4000);
  }
  setTimeout(loadSeen, 1500);

  function mark(deck, id) {
    const list = (seen[deck] ||= []);
    const k = key36(id);
    if (!list.includes(k)) { list.push(k); if (list.length > 600) list.splice(0, list.length - 600); saveSeen(); }
  }
  const was = (deck, id) => (seen[deck] || []).includes(key36(id));

  /** A random item nobody has seen yet; when all are used, the deck starts over. */
  function next(deck, items, id = (x) => x) {
    if (!items.length) return null;
    let fresh = items.filter((x) => !was(deck, id(x)));
    if (!fresh.length) { seen[deck] = []; fresh = items.slice(); }
    const pick = fresh[Math.floor(Math.random() * fresh.length)];
    mark(deck, id(pick));
    return pick;
  }
  /** Indices 0..n-1 in a random order, unseen ones first. */
  function order(deck, n) {
    const all = Array.from({ length: n }, (_, i) => i).sort(() => Math.random() - 0.5);
    const fresh = all.filter((i) => !was(deck, i)), old = all.filter((i) => was(deck, i));
    if (!fresh.length) seen[deck] = [];
    return [...fresh, ...old];
  }
  const left = (deck, total) => Math.max(0, total - (seen[deck] || []).length);

  // ---------- rounds ----------
  let rounds = store.get("du-deck-rounds", {});
  const R = (game) => {
    const r = (rounds[game] ||= { n: 0, until: 0 });
    if (r.until && Date.now() >= r.until) { r.n = 0; r.until = 0; }
    return r;
  };
  const wait = (game) => Math.max(0, R(game).until - Date.now());
  /** Count one card shown (yours or your partner's). */
  function count(game, quiet) {
    const r = R(game);
    if (r.until) return;
    r.n += 1;
    if (r.n >= size() && breakMs() > 0) r.until = Date.now() + breakMs();
    store.set("du-deck-rounds", rounds);
    if (r.until && !quiet) setTimeout(() => toast?.(`Round done! ${size()} questions. Next round opens in ${clock(wait(game))}`), 400);
  }
  /** May a new card be drawn? If not, shows the break card and returns false. */
  function can(game, title) {
    const ms = wait(game);
    if (!ms) return true;
    showBreak(game, title);
    return false;
  }
  const progress = (game) => { const r = R(game); return { n: Math.min(r.n, size()), of: size(), wait: wait(game) }; };
  const clock = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  // the partner's phone can be a little behind; the one that hit the limit tells the other
  function sync(game, n, until) {
    const r = R(game);
    if (until && until > Date.now() && (!r.until || until > r.until)) { r.until = until; r.n = size(); }
    else if (Number(n) > r.n && !r.until) r.n = Math.min(Number(n), size());
    store.set("du-deck-rounds", rounds);
  }
  function admin(reset) { if (reset) { rounds = {}; store.set("du-deck-rounds", rounds); } }

  // ---------- the "round done" card ----------
  let card = null, tick = 0;
  function showBreak(game, title = "This game") {
    card?.remove();
    clearInterval(tick);
    card = document.createElement("div");
    card.className = "dk-break";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Round complete");
    const total = breakMs();
    card.innerHTML = `<div class="dk-card">
      <div class="dk-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52"/><circle class="dk-arc" cx="60" cy="60" r="52"/></svg><b class="dk-time"></b></div>
      <h3>Round complete 🎉</h3>
      <p>${String(title).replace(/[<>&]/g, "")} gave you ${size()} questions. Fresh ones unlock when the timer ends, so they stay special.</p>
      <div class="dk-acts"><button class="btn primary" data-dk="other"><span class="icon">sports_esports</span>Play something else</button><button class="btn ghost" data-dk="ok">OK</button></div></div>`;
    document.body.append(card);
    requestAnimationFrame(() => card?.classList.add("in"));
    const arc = card.querySelector(".dk-arc"), t = card.querySelector(".dk-time");
    const paint = () => {
      const ms = wait(game);
      if (!card) return;
      t.textContent = ms ? clock(ms) : "Ready";
      arc.style.strokeDashoffset = String(327 * (1 - (total ? ms / total : 0)));
      if (!ms) { clearInterval(tick); card.querySelector("p").textContent = "The next round is open. Enjoy!"; }
    };
    paint();
    tick = setInterval(paint, 1000);
    card.addEventListener("click", (e) => {
      const a = e.target.closest("[data-dk]")?.dataset.dk;
      if (!a && e.target !== card) return;
      close();
      // after this click is done, or the "click outside closes the menu" handler shuts it again
      if (a === "other") setTimeout(() => { window.DU.kit?.toggleTray?.(true); window.DU.kit?.showTrayView?.("games"); }, 60);
    });
  }
  function close() { clearInterval(tick); const c = card; card = null; if (!c) return; c.classList.remove("in"); setTimeout(() => c.remove(), 250); }
  addEventListener("keydown", (e) => { if (e.key === "Escape" && card) close(); });

  window.DU.deck = { next, order, mark, seen: was, left, count, can, wait, progress, sync, clock, admin, size };
})();
