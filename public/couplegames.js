// DU Meet · two games made for a couple, on the shared game stage (arena.js):
//   How well do you know me?  one of you answers about yourself in secret, the other guesses;
//                             roles swap every question, right guesses score
//   This or that              both pick in secret, then reveal; the end shows your match %
// No timers: it's meant to be talked over. Questions don't repeat until the deck runs out.

(() => {
  "use strict";
  const A = window.DU.arena;
  const { q, esc } = A;
  const COLORS = ["#0a84ff", "#ff375f"];
  const D = () => window.DU.deck;
  const rnd = (seed) => { let x = seed || 1; return () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; };

  // =================================================================
  // How well do you know me?
  // =================================================================
  {
    const K = "knowme";
    const ROUNDS = 10;
    // {n} = the person being asked about
    const BANK = [
      ["What's {n}'s favourite time of day?", "Early morning", "Afternoon", "Evening", "Late night"],
      ["What would {n} order on a lazy night?", "Pizza", "Biryani", "Momos", "Maggi"],
      ["{n}'s ideal date is…", "A long drive", "Candle-light dinner", "Movie night at home", "Street food walk"],
      ["What does {n} do first when upset?", "Goes quiet", "Talks it out", "Sleeps it off", "Eats something"],
      ["{n}'s dream holiday?", "Mountains", "Beach", "A big foreign city", "A quiet village"],
      ["Which superpower would {n} pick?", "Teleport", "Read minds", "Fly", "Stop time"],
      ["{n}'s love language is mostly…", "Words", "Time together", "Hugs & touch", "Gifts & little things"],
      ["What is {n} most scared of?", "Heights", "Insects", "The dark", "Losing people"],
      ["{n}'s go-to drink?", "Chai", "Coffee", "Cold drink", "Juice / shake"],
      ["How does {n} like to spend a Sunday?", "Sleeping in", "Going out", "Binge-watching", "Getting things done"],
      ["What annoys {n} the most?", "Late replies", "Loud chewing", "Being late", "Being ignored"],
      ["{n}'s favourite season?", "Summer", "Monsoon", "Winter", "Spring"],
      ["Which movie genre does {n} pick?", "Romance", "Comedy", "Thriller / horror", "Action"],
      ["{n} would rather get…", "A handwritten letter", "A surprise visit", "A long call", "A gift"],
      ["What's {n}'s sleeping style?", "Hugging a pillow", "Starfish", "Curled up", "Rolls all night"],
      ["{n}'s biggest weakness?", "Sweets", "Phone", "Sleep", "Shopping"],
      ["How can you tell {n} is happy?", "Can't stop talking", "Big smile, says little", "Sings / dances", "Sends memes"],
      ["{n} is more of a…", "Planner", "Go-with-the-flow", "Last-minute", "Overthinker"],
      ["What would {n} save first in a fire?", "Phone", "Photos / memories", "Wallet & docs", "A favourite thing"],
      ["{n}'s favourite way to say sorry?", "Says sorry straight", "A cute gift / food", "Acts extra sweet", "Waits for things to calm down"],
      ["Which pet would {n} pick?", "Dog", "Cat", "Bird", "Fish / none"],
      ["{n}'s comfort food?", "Dal chawal", "Rajma chawal", "Paratha", "Something sweet"],
      ["What's {n}'s texting style?", "Long paragraphs", "Lots of emojis", "Voice notes", "One-word replies"],
      ["If {n} won a lottery, first thing?", "Travel", "Home for family", "Save it all", "Shopping spree"],
      ["{n} cries most at…", "Sad movies", "Happy moments", "Arguments", "Almost never"],
      ["When {n} is ill, what helps most?", "To be left alone", "Lots of care", "Comfort food", "Their mum"],
      ["{n}'s favourite part of a call with you?", "The start, hearing your voice", "Random talks", "Playing games", "Falling asleep on call"],
      ["What did {n} notice first about you?", "Eyes", "Smile", "Voice", "The way you talk"],
      ["{n}'s music mood most days?", "Romantic", "Sad songs", "Party", "Old classics"],
      ["Morning person or night owl? {n} is…", "Morning person", "Night owl", "Neither, always sleepy", "Depends on the day"],
      ["What would {n} do on a rainy day?", "Chai & pakode", "Dance in the rain", "Sleep", "Watch a movie"],
      ["{n}'s idea of a perfect gift?", "Something handmade", "Flowers / chocolates", "Clothes / jewellery", "An experience / trip"],
      ["{n} would rather…", "Cook together", "Order in", "Eat out", "Skip the meal and talk"],
      ["Which is {n}'s secret talent?", "Singing", "Drawing", "Cooking", "Mimicry"],
      ["How long can {n} stay angry at you?", "Minutes", "A few hours", "A day", "Can't stay angry at all"],
      ["{n}'s phone wallpaper is most likely…", "Your photo", "A nature shot", "Something aesthetic", "Default"],
    ];
    let G = null;
    const mine = () => G.names.indexOf(me.name);
    const subject = (r) => r % 2; // index of the person the question is about

    function begin(names, ids, seed) {
      const el = A.open(K, "How well do you know me?", "");
      A.panel(""); A.live(true);
      G = { el, names, ids, seed, r: -1, scores: [0, 0], picks: {}, over: false, wait: 0 };
      ids.forEach((i) => { D()?.mark(K, i); D()?.count(K, true); });
      q(".ar-body", el).innerHTML = `${A.duel(names, COLORS)}<div class="km">
        <small class="km-n"></small><div class="km-who"></div><p class="km-q" aria-live="polite"></p>
        <div class="km-opts" role="group"></div><p class="km-msg" aria-live="polite"></p></div>`;
      q(".km-opts", el).addEventListener("click", (e) => { const b = e.target.closest("[data-o]"); if (b) pick(Number(b.dataset.o)); });
      next();
    }
    const text = (r) => {
      const [qq, ...opts] = BANK[G.ids[r]];
      const who = G.names[subject(r)];
      const ord = rnd(G.seed + r * 17);
      return { q: qq.replaceAll("{n}", who), opts: opts.map((t, i) => ({ t, i, k: ord() })).sort((a, b) => a.k - b.k) };
    };
    function next() {
      if (!G) return;
      G.r += 1;
      if (G.r >= G.ids.length) return finish();
      const r = G.r, t = text(r), me0 = mine(), about = subject(r) === me0;
      q(".km-n", G.el).textContent = `Question ${r + 1} of ${G.ids.length}`;
      q(".km-who", G.el).innerHTML = about
        ? `<span class="km-tag you">About you · answer honestly 🤫</span>`
        : `<span class="km-tag them">Guess ${esc(G.names[subject(r)])}'s answer 🤔</span>`;
      const qq = q(".km-q", G.el); qq.textContent = t.q; qq.classList.remove("in"); void qq.offsetWidth; qq.classList.add("in");
      q(".km-opts", G.el).innerHTML = t.opts.map((o) => `<button data-o="${o.i}">${esc(o.t)}</button>`).join("");
      q(".km-msg", G.el).textContent = "";
      A.setDuel({ turn: subject(r), scores: G.scores, subs: G.names.map((_, i) => (i === subject(r) ? "answering" : "guessing")) });
      A.status(about ? "Pick your real answer" : `What would ${G.names[subject(r)]} say?`);
      if (G.picks[`${r}-${1 - me0}`] !== undefined) q(".km-msg", G.el).textContent = `${G.names[1 - me0]} has picked. Your turn!`;
    }
    function pick(o) {
      if (!G || G.over || G.picks[`${G.r}-${mine()}`] !== undefined) return;
      G.el.querySelectorAll(".km-opts button").forEach((b) => b.classList.toggle("chosen", Number(b.dataset.o) === o));
      send(K, { t: "pick", r: G.r, o, by: mine() });
      got(G.r, mine(), o);
    }
    function got(r, by, o) {
      if (!G || r < G.r) return;
      G.picks[`${r}-${by}`] = o; // kept even if it arrives before this phone shows question r
      if (r !== G.r) return;
      const other = 1 - mine();
      if (G.picks[`${r}-0`] === undefined || G.picks[`${r}-1`] === undefined) {
        if (by === mine()) { q(".km-msg", G.el).textContent = `Locked in. Waiting for ${G.names[other]}…`; A.sound("move"); }
        else q(".km-msg", G.el).textContent = `${G.names[other]} has picked. Your turn!`;
        return;
      }
      reveal(r);
    }
    function reveal(r) {
      const s = subject(r), g = 1 - s;
      const truth = G.picks[`${r}-${s}`], guess = G.picks[`${r}-${g}`];
      const right = truth === guess;
      if (right) G.scores[g] += 1;
      G.el.querySelectorAll(".km-opts button").forEach((b) => {
        const o = Number(b.dataset.o);
        b.disabled = true;
        b.classList.remove("chosen");
        if (o === truth) b.classList.add("good");
        else if (o === guess) b.classList.add("bad");
      });
      const t = text(r);
      const ans = t.opts.find((x) => x.i === truth)?.t;
      q(".km-msg", G.el).textContent = right
        ? `${g === mine() ? "You know" : `${G.names[g]} knows`} ${s === mine() ? "you" : G.names[s]} so well! 💞`
        : `${s === mine() ? "You" : G.names[s]} said “${ans}”. ${g === mine() ? "Now you know 😄" : `${G.names[g]} missed it`}`;
      A.sound(right ? "good" : "bad");
      if (right) window.DU.us?.burst(["💗", "✨"], 10);
      A.setDuel({ turn: -1, scores: G.scores });
      A.event(`Know me ${r + 1}: “${t.q}” ${G.names[s]} said ${ans}; ${G.names[g]} ${right ? "guessed right" : "missed"}. Score ${G.scores[0]} – ${G.scores[1]}`);
      clearTimeout(G.wait);
      G.wait = setTimeout(next, 2600);
    }
    function finish() {
      G.over = true;
      const [a, b] = G.scores;
      A.over(K, G.names, a === b ? -1 : a > b ? 0 : 1, `${a} – ${b} right guesses`, () => { if (D()?.can(K, "How well do you know me") === false) return; fresh([G.names[1], G.names[0]]); });
    }
    function fresh(names) {
      const ids = (D()?.order(K, BANK.length) || BANK.map((_, i) => i)).slice(0, ROUNDS), seed = Math.floor(Math.random() * 1e9);
      begin(names, ids, seed); send(K, { t: "start", names, ids, seed });
    }
    A.register(K, {
      start() { if (D()?.can(K, "How well do you know me") === false) return; fresh([me.name, A.other().name]); },
      onMsg(d, peer) {
        if (d.t === "start" && Array.isArray(d.ids)) { begin(d.names.map(String), d.ids.map(Number).filter((i) => BANK[i]).slice(0, ROUNDS), Number(d.seed) || 1); toast(`${peer.name} started How well do you know me?`); return; }
        if (d.t === "pick" && G) got(Number(d.r), Number(d.by), Number(d.o));
      },
      describe: () => G && { question: G.r + 1, of: G.ids.length, about: G.names[subject(G.r)], score: G.scores },
      cleanup() { if (G) clearTimeout(G.wait); G = null; },
    });
  }

  // =================================================================
  // This or that: how much do you match?
  // =================================================================
  {
    const K = "match";
    const ROUNDS = 12;
    const BANK = [
      ["☕", "Chai", "Coffee"], ["🏔️", "Mountains", "Beach"], ["🌅", "Sunrise", "Sunset"], ["🐶", "Dogs", "Cats"],
      ["🎬", "Movie at home", "Movie in a theatre"], ["🍕", "Pizza", "Biryani"], ["📞", "Call", "Text"], ["🌧️", "Rain", "Snow"],
      ["🌙", "Night out", "Night in"], ["🎵", "Arijit Singh", "AP Dhillon"], ["🍫", "Chocolate", "Ice cream"], ["✈️", "Plan the trip", "Just go"],
      ["🏠", "Big city", "Small town"], ["📚", "Books", "Series"], ["🍳", "Cook", "Order in"], ["💌", "Love letters", "Love songs"],
      ["🎁", "Surprise gifts", "Gifts you asked for"], ["🛌", "Big spoon", "Little spoon"], ["🕺", "Dance", "Sing"], ["🎢", "Roller coaster", "Ferris wheel"],
      ["🌶️", "Spicy", "Sweet"], ["🏖️", "Relaxing holiday", "Adventure holiday"], ["👫", "Matching outfits", "Never!"], ["📸", "Take photos", "Live the moment"],
      ["🌃", "Long drive", "Long walk"], ["🍿", "Comedy", "Horror"], ["💍", "Big wedding", "Small wedding"], ["🧳", "Pack early", "Pack last minute"],
      ["🎮", "Video games", "Board games"], ["😴", "Early to bed", "Up till 3am"], ["🥞", "Breakfast in bed", "Brunch outside"], ["🛍️", "Shopping", "Window shopping"],
      ["💬", "Talk it out now", "Sleep on it"], ["🏡", "Cosy flat", "Big house"], ["🌸", "Flowers", "Chocolates"], ["🚗", "Road trip", "Flight"],
      ["🎂", "Cake", "Ice-cream cake"], ["🧘", "Gym", "Yoga"], ["🌍", "Travel the world", "Settle in one place"], ["🥰", "Cuddles", "Kisses"],
    ];
    let M = null;
    const mine = () => M.names.indexOf(me.name);
    function begin(names, ids) {
      const el = A.open(K, "This or that", "");
      A.panel(""); A.live(true);
      M = { el, names, ids, r: -1, picks: {}, same: 0, over: false, wait: 0, log: [] };
      ids.forEach((i) => { D()?.mark(K, i); D()?.count(K, true); });
      q(".ar-body", el).innerHTML = `${A.duel(names, COLORS)}<div class="tt">
        <small class="tt-n"></small><div class="tt-meter"><i></i></div><span class="tt-e" aria-hidden="true"></span>
        <div class="tt-opts" role="group"></div><p class="tt-msg" aria-live="polite"></p></div>`;
      q(".tt-opts", el).addEventListener("click", (e) => { const b = e.target.closest("[data-o]"); if (b) pick(Number(b.dataset.o)); });
      next();
    }
    function next() {
      if (!M) return;
      M.r += 1;
      if (M.r >= M.ids.length) return finish();
      const [e, a, b] = BANK[M.ids[M.r]];
      q(".tt-n", M.el).textContent = `${M.r + 1} of ${M.ids.length}`;
      const em = q(".tt-e", M.el); em.textContent = e; em.classList.remove("in"); void em.offsetWidth; em.classList.add("in");
      q(".tt-opts", M.el).innerHTML = `<button data-o="0">${esc(a)}</button><span>or</span><button data-o="1">${esc(b)}</button>`;
      q(".tt-msg", M.el).textContent = "Pick in secret";
      A.setDuel({ turn: -1, scores: [M.same, M.same], subs: ["", ""] });
      A.status("This… or that?");
      if (M.picks[`${M.r}-${1 - mine()}`] !== undefined) q(".tt-msg", M.el).textContent = `${M.names[1 - mine()]} picked. Your turn!`;
    }
    function pick(o) {
      if (!M || M.over || M.picks[`${M.r}-${mine()}`] !== undefined) return;
      M.el.querySelectorAll(".tt-opts button").forEach((b) => b.classList.toggle("chosen", Number(b.dataset.o) === o));
      send(K, { t: "pick", r: M.r, o, by: mine() });
      got(M.r, mine(), o);
    }
    function got(r, by, o) {
      if (!M || r < M.r) return;
      M.picks[`${r}-${by}`] = o; // kept even if it arrives before this phone shows question r
      if (r !== M.r) return;
      const other = 1 - mine();
      if (M.picks[`${r}-0`] === undefined || M.picks[`${r}-1`] === undefined) {
        q(".tt-msg", M.el).textContent = by === mine() ? `Waiting for ${M.names[other]}…` : `${M.names[other]} picked. Your turn!`;
        return;
      }
      const a = M.picks[`${r}-0`], b = M.picks[`${r}-1`], same = a === b;
      if (same) M.same += 1;
      const [, ...opts] = BANK[M.ids[r]];
      M.log.push({ e: BANK[M.ids[r]][0], a: opts[a], b: opts[b], same });
      M.el.querySelectorAll(".tt-opts button").forEach((btn) => {
        const o2 = Number(btn.dataset.o);
        btn.disabled = true;
        btn.classList.remove("chosen");
        btn.innerHTML = `${esc(opts[o2])}<small>${[a === o2 && M.names[0], b === o2 && M.names[1]].filter(Boolean).map(esc).join(" & ")}</small>`;
        if (same && o2 === a) btn.classList.add("good");
      });
      q(".tt-msg", M.el).textContent = same ? "Same pick! 💞" : "Opposites attract 😄";
      q(".tt-meter i", M.el).style.width = `${Math.round((M.same / (r + 1)) * 100)}%`;
      A.sound(same ? "good" : "tick");
      if (same) window.DU.us?.burst(["💞", "✨"], 8);
      A.setDuel({ turn: -1, scores: [M.same, M.same] });
      A.event(`This or that: ${opts.join(" vs ")}. ${M.names[0]}: ${opts[a]}, ${M.names[1]}: ${opts[b]}`);
      clearTimeout(M.wait);
      M.wait = setTimeout(next, 1900);
    }
    function finish() {
      M.over = true;
      A.live(false);
      const pct = Math.round((M.same / M.ids.length) * 100);
      const verdict = pct >= 85 ? "Soulmates. Same brain, two bodies 💘" : pct >= 65 ? "A perfect match 💞" : pct >= 45 ? "Different enough to stay exciting ✨" : "Opposites attract! Never a boring day 😄";
      A.sound("win");
      window.DU.us?.burst(["💘", "💞", "✨"], 22);
      A.event(`This or that finished: ${pct}% match`);
      const p = A.panel(`<div class="tt-end"><div class="tt-ring" style="--p:${pct}"><b>${pct}%</b><small>match</small></div><b class="ar-ptitle">${verdict}</b>
        <ul class="tt-log">${M.log.map((l) => `<li class="${l.same ? "same" : ""}"><span>${l.e}</span>${l.same ? `Both: ${esc(l.a)}` : `${esc(l.a)} · ${esc(l.b)}`}</li>`).join("")}</ul>
        <div class="ar-row"><button class="btn ghost" data-ar="close">Close</button><button class="btn primary" data-ar="again"><span class="icon" aria-hidden="true">replay</span>Play again</button></div></div>`);
      p.onclick = (e) => {
        const a = e.target.closest("[data-ar]")?.dataset.ar;
        if (a === "close") { send(K, { t: "quit" }); A.close(); }
        if (a === "again") { if (D()?.can(K, "This or that") === false) return; fresh(M.names); }
      };
    }
    function fresh(names) {
      const ids = (D()?.order(K, BANK.length) || BANK.map((_, i) => i)).slice(0, ROUNDS);
      begin(names, ids); send(K, { t: "start", names, ids });
    }
    A.register(K, {
      start() { if (D()?.can(K, "This or that") === false) return; fresh([me.name, A.other().name]); },
      onMsg(d, peer) {
        if (d.t === "start" && Array.isArray(d.ids)) { begin(d.names.map(String), d.ids.map(Number).filter((i) => BANK[i]).slice(0, ROUNDS)); toast(`${peer.name} started This or that`); return; }
        if (d.t === "pick" && M) got(Number(d.r), Number(d.by), Number(d.o));
      },
      describe: () => M && { pair: M.r + 1, of: M.ids.length, matches: M.same },
      cleanup() { if (M) clearTimeout(M.wait); M = null; },
    });
  }
})();
