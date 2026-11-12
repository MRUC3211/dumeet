// DU Meet · Daily word: guess the day's 5-letter word in 5 tries. Blue means the letter is in
// the right place, orange means it's in the word but elsewhere. You both get the same word
// each day, one per day, and you can see each other's progress (colours only, no letters).

(() => {
  "use strict";
  const { q, esc, store } = window.DU.kit;
  const W = () => window.DU.win;
  const other = () => [...peers.values()][0];
  const tray = () => window.DU.kit.toggleTray(false);
  const TRIES = 5;
  const WORDS = "about above actor acute admit adopt adult after again agent agree ahead alarm album alert alike alive allow alone along alter angel anger angle angry apart apple apply arena argue arise array aside asset audio avoid award aware awful bacon badge baker basic beach beard beast began begin being belly below bench berry birth black blade blame blank blast blend bless blind block blood bloom board boost booth brain brand brave bread break brick bride brief bring broad broke brown brush build bunch burst buyer cabin cable candy cargo carry catch cause chain chair chalk charm chart chase cheap check cheek cheer chess chest chick chief child chill choir chose civil claim class clean clear clerk click cliff climb clock close cloth cloud coach coast color count court cover crack craft crane crash crazy cream crime crisp cross crowd crown crush curve cycle daily dance dated dealt death debut delay depth diary dirty dizzy doubt dough dozen draft drama drank dream dress dried drink drive eager early earth eaten elbow elder empty enemy enjoy enter entry equal error essay event every exact exist extra faith false fancy feast fence fever fiber field fifty fight final first flame flash fleet flesh float flood floor flour fluid focus force forth forty forum found frame fresh front frost fruit funny ghost giant given glass globe glory glove grace grade grain grand grant grape grass grave great green greet grief grill group grown guard guess guest guide habit happy heart heavy hello hobby honey honor horse hotel house human humor hurry ideal image index inner input issue jelly jewel joint judge juice knife knock known label large laser later laugh layer learn least leave lemon level light limit linen local loose lover lower loyal lucky lunch magic major maker mango march marry match maybe mayor meant medal media mercy metal meter minor minus model money month moral motor mount mouse mouth movie music naive nerve never night noble noise north novel nurse ocean offer often olive onion opera orbit order other outer owner paint panel panic paper party pasta patch peace peach pearl phone photo piano piece pilot pizza place plain plane plant plate point polar power press price pride prime print prize proof proud queen quick quiet quilt quite radio raise rally ranch range rapid ratio reach react ready relax reply rider ridge right river roast robot rocky rough round route royal rural sauce scale scarf scene score scout shade shake shape share shark sharp sheep shelf shell shift shine shirt shock shoot shore short shout sight silly since skill skirt sleep slice slide smart smell smile smoke snack snake solar solid solve sorry sound south space spare spark speak speed spell spend spice spill spine split spoon sport spray squad stack staff stage stain stair stake stamp stand start state steam steel stick still stone store storm story stove strap straw strip study stuff style sugar suite sunny super sweet swing table taste teach teeth thank theme thick thing think third three throw thumb tiger tight timer tired title toast today token tooth topic torch total touch tough tower toxic trace track trade train treat trend trial tribe trick truck truly trust truth tulip twist uncle under union unity upper upset urban usual valid value video virus visit vital vivid voice wagon waste watch water wheel where while white whole woman world worry worth would wound write wrong young youth zebra".split(" ");
  const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // the same word for everyone on the same date: a fixed shuffle, then one per day
  function wordFor(date) {
    const [y, m, d] = date.split("-").map(Number);
    const n = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
    const order = WORDS.map((_, i) => i);
    let s = 20240611;
    for (let i = order.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    return WORDS[order[((n % order.length) + order.length) % order.length]].toUpperCase();
  }
  function score(guess, answer) {
    const res = Array(5).fill("x"), left = {};
    for (let i = 0; i < 5; i++) { if (guess[i] === answer[i]) res[i] = "g"; else left[answer[i]] = (left[answer[i]] || 0) + 1; }
    for (let i = 0; i < 5; i++) if (res[i] !== "g" && left[guess[i]]) { res[i] = "y"; left[guess[i]] -= 1; }
    return res.join("");
  }

  const S = { day: "", answer: "", guesses: [], cur: "", them: null, busy: false };
  function load() {
    const today = day();
    if (S.day !== today) {
      const saved = store.get("du-word", {});
      Object.assign(S, { day: today, answer: wordFor(today), guesses: saved.day === today ? saved.guesses || [] : [], cur: "" });
      const them = store.get("du-word-them", {});
      S.them = them.day === today ? them : null;
    }
  }
  const done = () => S.guesses.includes(S.answer) || S.guesses.length >= TRIES;
  const won = () => S.guesses.includes(S.answer);
  const save = () => store.set("du-word", { day: S.day, guesses: S.guesses });
  const progress = () => ({ t: "progress", day: S.day, rows: S.guesses.map((g) => score(g, S.answer)), done: done(), won: won() });

  function open() {
    tray();
    load();
    if (!W().get("word")) {
      W().open({ id: "word", title: "Daily word", icon: "spellcheck", w: 360, h: 600,
        onClose: () => document.removeEventListener("keydown", onKey),
        html: `<div class="wd"><div class="wd-them"></div><div class="wd-grid"></div><p class="wd-msg" aria-live="polite"></p><div class="wd-keys"></div></div>` });
      const w = W().get("word");
      w.body.addEventListener("click", (e) => {
        const k = e.target.closest("[data-k]")?.dataset.k;
        if (k) press(k);
        if (e.target.closest("[data-wd=share]")) shareIt();
      });
      document.addEventListener("keydown", onKey);
    }
    if (other()) send("word", { ...progress(), ask: true });
    paint();
  }
  function onKey(e) {
    if (!W().get("word") || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input, textarea, [contenteditable]")) return;
    if (e.key === "Enter") press("ENTER");
    else if (e.key === "Backspace") press("BACK");
    else if (/^[a-z]$/i.test(e.key)) press(e.key.toUpperCase());
    else return;
    e.preventDefault();
  }
  function press(k) {
    if (done() || S.busy) return;
    if (k === "BACK") S.cur = S.cur.slice(0, -1);
    else if (k === "ENTER") return submit();
    else if (S.cur.length < 5) S.cur += k;
    paint();
  }
  function submit() {
    const w = W().get("word");
    if (S.cur.length < 5) { shake(); return say("Five letters, please"); }
    S.guesses.push(S.cur);
    S.cur = "";
    save();
    S.busy = true;
    paint(true);
    setTimeout(() => {
      S.busy = false;
      if (won()) say(["Genius! 🤯", "Brilliant! 🎉", "Great! 😎", "Nice one! 👏", "Phew! 😅"][S.guesses.length - 1]);
      else if (done()) say(`The word was ${S.answer}`);
      if (other()) send("word", progress());
      paint();
      if (w && done()) streakUpdate();
    }, 5 * 260 + 200);
  }
  function streakUpdate() {
    const st = store.get("du-word-stats", { played: 0, wins: 0, streak: 0, last: "" });
    if (st.last === S.day) return;
    const y = new Date(); y.setDate(y.getDate() - 1);
    st.played += 1;
    if (won()) { st.wins += 1; st.streak = st.last === day(y) ? st.streak + 1 : 1; } else st.streak = 0;
    st.last = S.day;
    store.set("du-word-stats", st);
    paint();
  }
  const say = (t) => { const m = q(".wd-msg", W().get("word")?.body); if (m) { m.textContent = t; m.classList.remove("pop"); void m.offsetWidth; m.classList.add("pop"); } };
  const shake = () => { const row = W().get("word")?.body.querySelectorAll(".wd-row")[S.guesses.length]; row?.animate([{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-4px)" }, { transform: "none" }], { duration: 300 }); };

  function paint(reveal = false) {
    const w = W().get("word");
    if (!w) return;
    const rows = [];
    for (let r = 0; r < TRIES; r++) {
      const g = S.guesses[r];
      const res = g ? score(g, S.answer) : "";
      const letters = g || (r === S.guesses.length ? S.cur : "");
      const flip = reveal && r === S.guesses.length - 1;
      rows.push(`<div class="wd-row">${[0, 1, 2, 3, 4].map((i) => `<span class="wd-t${letters[i] ? " in" : ""}${res ? ` r-${res[i]}` : ""}${flip ? " flip" : ""}" style="--d:${i * 260}ms">${esc(letters[i] || "")}</span>`).join("")}</div>`);
    }
    q(".wd-grid", w.body).innerHTML = rows.join("");
    // keyboard colours: best result per letter
    const best = {};
    const rank = { g: 3, y: 2, x: 1 };
    S.guesses.forEach((g) => { const res = score(g, S.answer); [...g].forEach((ch, i) => { if (!best[ch] || rank[res[i]] > rank[best[ch]]) best[ch] = res[i]; }); });
    const KB = ["QWERTYUIOP", "ASDFGHJKL", "ENTER ZXCVBNM BACK"];
    q(".wd-keys", w.body).innerHTML = done()
      ? `<div class="wd-end"><b>${won() ? `Solved in ${S.guesses.length}/${TRIES}` : `Today's word: ${S.answer}`}</b><small>${stats()}</small><small>A new word comes tomorrow.</small><button class="btn primary" data-wd="share"><span class="icon">ios_share</span>Share result</button></div>`
      : KB.map((row) => `<div>${(row.includes(" ") ? row.split(" ").flatMap((p) => (p.length > 1 && p !== "ENTER" && p !== "BACK" ? [...p] : [p])) : [...row]).map((k) => `<button data-k="${k}" class="${k.length > 1 ? "wide" : ""} ${best[k] ? `r-${best[k]}` : ""}" aria-label="${k === "BACK" ? "Delete" : k}">${k === "BACK" ? '<span class="icon">backspace</span>' : k === "ENTER" ? "Enter" : k}</button>`).join("")}</div>`).join("");
    const p = other()?.name || window.DU.kit.partnerName?.() || "";
    q(".wd-them", w.body).innerHTML = S.them && p
      ? `<small>${esc(p)}</small><div class="wd-mini">${S.them.rows.map((r) => `<i>${[...r].map((c) => `<b class="r-${c}"></b>`).join("")}</i>`).join("") || "<em>not started</em>"}</div><small>${S.them.done ? (S.them.won ? `solved in ${S.them.rows.length}` : "missed it") : `${S.them.rows.length}/${TRIES}`}</small>`
      : "";
  }
  function stats() { const st = store.get("du-word-stats", { played: 0, wins: 0, streak: 0 }); return `Played ${st.played} · Won ${st.wins} · Streak 🔥${st.streak}`; }
  async function shareIt() {
    const grid = S.guesses.map((g) => [...score(g, S.answer)].map((c) => ({ g: "🟦", y: "🟧", x: "⬛" })[c]).join("")).join("\n");
    const text = `Daily word ${S.day} · ${won() ? S.guesses.length : "X"}/${TRIES}\n${grid}`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast("Copied"); } } catch { /* cancelled */ }
  }

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, peer: window.DU.onCouplePeer };
  Object.assign(window.DU, {
    onCoupleClick(button) { if (button.dataset.tg === "word") open(); else prev.click?.(button); },
    onCouple(message, peer) {
      if (message.type !== "word") return prev.msg?.(message, peer);
      const d = message.data || {};
      load();
      if (d.t === "progress" && d.day === S.day && Array.isArray(d.rows)) {
        const first = !S.them;
        S.them = { day: d.day, rows: d.rows.slice(0, TRIES).map((r) => String(r).replace(/[^gyx]/g, "").slice(0, 5)), done: Boolean(d.done), won: Boolean(d.won) };
        store.set("du-word-them", S.them);
        if (d.done && d.won && !first) toast(`${peer.name} solved today's word in ${S.them.rows.length} 🎉`);
        paint();
        if (d.ask && S.guesses.length) send("word", progress());
      }
    },
  });
})();
