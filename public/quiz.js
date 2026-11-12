// DU Meet · Quiz battle: the same 10 questions on both phones, 15 seconds each.
// A right answer scores 100 plus up to 100 for speed. Answers stay hidden until both
// have answered (or the time runs out), then both phones reveal and move on together.

(() => {
  "use strict";
  const A = window.DU.arena;
  const { q, esc } = A;
  const K = "quiz";
  const COLORS = ["#0a84ff", "#ff375f"];
  const ROUNDS = 10, LIMIT = 15000;

  // [question, [options], index of the right one, topic]
  const BANK = [
    ["Which planet is known as the Red Planet?", ["Venus", "Mars", "Jupiter", "Mercury"], 1, "Space"],
    ["How many minutes are there in a day?", ["1,440", "1,240", "1,600", "960"], 0, "Numbers"],
    ["What is the capital of Australia?", ["Sydney", "Melbourne", "Canberra", "Perth"], 2, "World"],
    ["Which gas do plants take in from the air?", ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"], 2, "Science"],
    ["Which is the largest ocean on Earth?", ["Atlantic", "Indian", "Arctic", "Pacific"], 3, "World"],
    ["How many players does a cricket team have on the field?", ["9", "10", "11", "12"], 2, "Sports"],
    ["Which Indian city is called the Pink City?", ["Jaipur", "Udaipur", "Jodhpur", "Agra"], 0, "India"],
    ["What is the national animal of India?", ["Lion", "Elephant", "Tiger", "Peacock"], 2, "India"],
    ["Which is the smallest prime number?", ["0", "1", "2", "3"], 2, "Numbers"],
    ["How many hearts does an octopus have?", ["1", "2", "3", "4"], 2, "Nature"],
    ["Which fruit has its seeds on the outside?", ["Kiwi", "Strawberry", "Guava", "Fig"], 1, "Food"],
    ["What is the hardest natural substance?", ["Gold", "Iron", "Quartz", "Diamond"], 3, "Science"],
    ["Which river flows through Varanasi?", ["Yamuna", "Ganga", "Godavari", "Narmada"], 1, "India"],
    ["How many bones are in an adult human body?", ["186", "206", "226", "306"], 1, "Science"],
    ["Which country gifted the Statue of Liberty to the USA?", ["France", "England", "Spain", "Italy"], 0, "World"],
    ["Which is the fastest land animal?", ["Lion", "Horse", "Cheetah", "Deer"], 2, "Nature"],
    ["What does a thermometer measure?", ["Pressure", "Temperature", "Humidity", "Speed"], 1, "Science"],
    ["Which state is famous for the dance Kathakali?", ["Kerala", "Tamil Nadu", "Odisha", "Assam"], 0, "India"],
    ["How many sides does a hexagon have?", ["5", "6", "7", "8"], 1, "Numbers"],
    ["Which planet has the most famous rings?", ["Mars", "Uranus", "Saturn", "Neptune"], 2, "Space"],
    ["What is the main ingredient of guacamole?", ["Avocado", "Peas", "Spinach", "Cucumber"], 0, "Food"],
    ["Which is the tallest mountain in the world?", ["K2", "Kangchenjunga", "Everest", "Lhotse"], 2, "World"],
    ["In which sport is the term 'love' used for zero?", ["Badminton", "Tennis", "Golf", "Hockey"], 1, "Sports"],
    ["Which vitamin do we get from sunlight?", ["Vitamin A", "Vitamin B12", "Vitamin C", "Vitamin D"], 3, "Science"],
    ["What colour do you get by mixing blue and yellow?", ["Green", "Purple", "Orange", "Brown"], 0, "Fun"],
    ["Which bird is a symbol of peace?", ["Eagle", "Dove", "Parrot", "Crow"], 1, "Fun"],
    ["How many days are there in a leap year?", ["364", "365", "366", "367"], 2, "Numbers"],
    ["Which Indian festival is called the festival of lights?", ["Holi", "Diwali", "Onam", "Lohri"], 1, "India"],
    ["Which organ pumps blood around the body?", ["Lungs", "Liver", "Heart", "Kidneys"], 2, "Science"],
    ["What is the largest planet in our solar system?", ["Earth", "Saturn", "Neptune", "Jupiter"], 3, "Space"],
    ["Which language has the most native speakers?", ["English", "Hindi", "Mandarin Chinese", "Spanish"], 2, "World"],
    ["What is the boiling point of water at sea level?", ["90 °C", "100 °C", "110 °C", "120 °C"], 1, "Science"],
    ["Which animal is known as the ship of the desert?", ["Horse", "Camel", "Donkey", "Yak"], 1, "Nature"],
    ["How many colours are in a rainbow?", ["5", "6", "7", "8"], 2, "Fun"],
    ["Which is the longest river in the world?", ["Amazon", "Nile", "Yangtze", "Ganga"], 1, "World"],
    ["What is 15 × 4?", ["45", "50", "60", "75"], 2, "Numbers"],
    ["Which country is famous for sushi?", ["China", "Japan", "Thailand", "Korea"], 1, "Food"],
    ["Which is the national flower of India?", ["Rose", "Sunflower", "Lotus", "Marigold"], 2, "India"],
    ["Which instrument has 88 keys?", ["Guitar", "Piano", "Harmonium", "Violin"], 1, "Fun"],
    ["Which country is home to the kangaroo?", ["New Zealand", "South Africa", "Australia", "Brazil"], 2, "World"],
    ["What do bees make?", ["Milk", "Silk", "Honey", "Wax only"], 2, "Nature"],
    ["How many continents are there?", ["5", "6", "7", "8"], 2, "World"],
    ["Which planet is closest to the Sun?", ["Venus", "Mercury", "Earth", "Mars"], 1, "Space"],
    ["Which city is known as the City of Joy?", ["Mumbai", "Kolkata", "Chennai", "Delhi"], 1, "India"],
    ["Which is the largest mammal?", ["Elephant", "Blue whale", "Giraffe", "Hippo"], 1, "Nature"],
    ["What is the square root of 144?", ["10", "11", "12", "14"], 2, "Numbers"],
    ["How many strings does a standard guitar have?", ["4", "5", "6", "7"], 2, "Fun"],
    ["Which dessert is made by deep-frying milk dough and soaking it in syrup?", ["Rasgulla", "Gulab jamun", "Kheer", "Barfi"], 1, "Food"],
    ["What is the freezing point of water?", ["0 °C", "-10 °C", "4 °C", "10 °C"], 0, "Science"],
    ["Which shape has three sides?", ["Square", "Triangle", "Pentagon", "Circle"], 1, "Fun"],
    ["In which year did India become independent?", ["1945", "1947", "1950", "1952"], 1, "India"],
    ["Which part of the plant makes food using sunlight?", ["Root", "Stem", "Leaf", "Flower"], 2, "Science"],
    ["What is the currency of Japan?", ["Yuan", "Won", "Yen", "Baht"], 2, "World"],
    ["How many hours are there in a week?", ["148", "168", "178", "186"], 1, "Numbers"],
  ];
  BANK.push(...(window.DU.bank?.quiz || []));   // more from bank.js
  let Z = null;

  const mineIdx = () => Z.names.indexOf(me.name);
  const pts = (ms) => 100 + Math.max(0, Math.round(((LIMIT - ms) / LIMIT) * 100));

  function begin(names, qs) {
    const el = A.open(K, "Quiz battle", "");
    A.panel(""); A.live(true);
    Z = { el, names, qs, round: -1, scores: [0, 0], ans: {}, t0: 0, timer: 0, tick: 0, over: false };
    qs.forEach((i) => { DK().mark("quiz", i); DK().count("quiz", true); });
    q(".ar-body", el).innerHTML = `${A.duel(names, COLORS)}<div class="qz">
      <div class="qz-top"><small class="qz-n"></small><small class="qz-topic"></small></div>
      <div class="qz-bar"><i></i></div>
      <p class="qz-q"></p><div class="qz-opts"></div><small class="qz-msg" aria-live="polite"></small></div>`;
    q(".qz-opts", el).addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (!b || !Z || Z.over) return;
      answer(Number(b.dataset.a));
    });
    next();
  }

  function next() {
    if (!Z) return;
    Z.round += 1;
    if (Z.round >= ROUNDS) return finish();
    Z.ans = {}; Z.revealed = false;
    const [text, opts, , topic] = BANK[Z.qs[Z.round]];
    q(".qz-n", Z.el).textContent = `Question ${Z.round + 1} of ${ROUNDS}`;
    q(".qz-topic", Z.el).textContent = topic;
    const qq = q(".qz-q", Z.el); qq.textContent = text; qq.classList.remove("in"); void qq.offsetWidth; qq.classList.add("in");
    q(".qz-opts", Z.el).innerHTML = opts.map((o, i) => `<button type="button" data-a="${i}"><span>${"ABCD"[i]}</span><b>${esc(o)}</b><em></em></button>`).join("");
    q(".qz-msg", Z.el).textContent = "";
    Z.t0 = performance.now();
    const bar = q(".qz-bar i", Z.el);
    bar.style.transition = "none"; bar.style.width = "100%"; void bar.offsetWidth;
    bar.style.transition = `width ${LIMIT}ms linear`; bar.style.width = "0%";
    clearTimeout(Z.timer);
    Z.timer = setTimeout(() => { if (Z && Z.ans[me.name] == null) answer(-1); }, LIMIT);
    A.setDuel({ turn: -1, scores: Z.scores, subs: ["thinking…", "thinking…"] });
    A.status("Pick fast for more points");
  }

  function answer(a) {
    if (!Z || Z.ans[me.name] != null) return;
    const ms = a < 0 ? LIMIT : Math.min(LIMIT, Math.round(performance.now() - Z.t0));
    Z.ans[me.name] = { a, ms };
    send(K, { t: "ans", r: Z.round, a, ms });
    Z.el.querySelectorAll(".qz-opts button").forEach((b, i) => { b.disabled = true; b.classList.toggle("pick", i === a); });
    A.sound("tick");
    q(".qz-msg", Z.el).textContent = a < 0 ? "Time's up!" : "Locked in. Waiting for the other answer…";
    paintSubs();
    maybeReveal();
  }
  function paintSubs() {
    A.setDuel({ scores: Z.scores, subs: Z.names.map((n) => (Z.ans[n] ? "answered ✓" : "thinking…")) });
  }

  function maybeReveal() {
    if (!Z || Z.revealed || Z.names.some((n) => Z.ans[n] == null)) return;
    Z.revealed = true;
    clearTimeout(Z.timer);
    const bar = q(".qz-bar i", Z.el);
    bar.style.width = `${bar.getBoundingClientRect().width}px`; bar.style.transition = "none";
    const right = BANK[Z.qs[Z.round]][2];
    const gained = Z.names.map((n) => (Z.ans[n].a === right ? pts(Z.ans[n].ms) : 0));
    gained.forEach((g, i) => { Z.scores[i] += g; });
    const btns = Z.el.querySelectorAll(".qz-opts button");
    btns.forEach((b, i) => {
      b.classList.toggle("right", i === right);
      const who = Z.names.filter((n) => Z.ans[n].a === i);
      b.classList.toggle("wrong", i !== right && who.length > 0);
      q("em", b).innerHTML = who.map((n) => `<i style="--pc:${COLORS[Z.names.indexOf(n)]}">${A.faceHtml(n)}</i>`).join("");
    });
    const mine = gained[mineIdx()];
    A.sound(mine ? "good" : "bad");
    q(".qz-msg", Z.el).textContent = mine ? `Right! +${mine}` : Z.ans[me.name].a < 0 ? "Too slow this time" : "Not quite";
    A.setDuel({ scores: Z.scores, subs: gained.map((g) => (g ? `+${g}` : "+0")) });
    setTimeout(next, 2600);
  }

  function finish() {
    Z.over = true;
    const [a, b] = Z.scores;
    A.setDuel({ turn: -1, scores: Z.scores, subs: ["", ""] });
    A.over(K, Z.names, a === b ? -1 : a > b ? 0 : 1, `${a} – ${b} points`, rematch);
  }

  // fresh questions first (DU.deck remembers which ones you've had); one game = one round of 10
  const DK = () => window.DU.deck;
  function pick() { return DK().order("quiz", BANK.length).slice(0, ROUNDS); }
  function start() {
    if (!DK().can("quiz", "Quiz battle")) return;
    const names = [me.name, A.other().name], qs = pick();
    begin(names, qs);
    send(K, { t: "start", names, qs });
  }
  function rematch() {
    if (!DK().can("quiz", "Quiz battle")) return;
    const qs = pick();
    begin(Z.names, qs);
    send(K, { t: "start", names: Z.names, qs });
  }
  function onMsg(d, peer) {
    if (d.t === "start" && Array.isArray(d.qs)) { begin(d.names, d.qs.filter((i) => BANK[i]).slice(0, ROUNDS)); toast(`${peer.name} started Quiz battle`); return; }
    if (d.t !== "ans" || !Z || Z.over) return;
    const take = () => {
      if (!Z) return;
      if (d.r > Z.round) return setTimeout(take, 150); // they're a moment ahead
      if (d.r !== Z.round || Z.ans[peer.name] != null) return;
      Z.ans[peer.name] = { a: Number(d.a), ms: Math.max(0, Math.min(LIMIT, Number(d.ms) || LIMIT)) };
      paintSubs();
      maybeReveal();
    };
    take();
  }
  A.register(K, { start, onMsg, cleanup() { if (Z) clearTimeout(Z.timer); Z = null; } });
})();
