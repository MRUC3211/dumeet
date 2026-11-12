// DU Meet · Maths duel: 10 quick sums, the same on both phones. Tap the right answer first to
// win the point; a wrong tap freezes you for a second and a half. The first player's phone
// is the referee, so a near-tie is decided in one place and both phones agree.

(() => {
  "use strict";
  const A = window.DU.arena;
  const { q } = A;
  const K = "maths";
  const COLORS = ["#0a84ff", "#ff375f"];
  const ROUNDS = 10, LIMIT = 15000, LOCK = 1500;
  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

  function makeQ(level) {
    const kind = ["+", "−", "×", "÷", "+", "×"][ri(0, 5)];
    let a, b, ans;
    if (kind === "+") { a = ri(12, 40 + level * 12); b = ri(8, 30 + level * 10); ans = a + b; }
    if (kind === "−") { a = ri(30, 60 + level * 12); b = ri(6, a - 4); ans = a - b; }
    if (kind === "×") { a = ri(3, 9 + Math.floor(level / 2)); b = ri(4, 12 + level); ans = a * b; }
    if (kind === "÷") { b = ri(3, 9 + Math.floor(level / 3)); ans = ri(3, 12 + level); a = b * ans; }
    const opts = new Set([ans]);
    const near = [1, 2, 10, -1, -2, -10, b, -b, 5, -5].sort(() => Math.random() - .5);
    for (const d of near) { if (opts.size >= 4) break; if (ans + d > 0) opts.add(ans + d); }
    return { text: `${a} ${kind} ${b}`, ans, opts: [...opts].sort(() => Math.random() - .5) };
  }

  let M = null;
  const mine = () => M.names.indexOf(me.name);
  const ref = () => M.names[0] === me.name;

  function begin(names, qs) {
    const el = A.open(K, "Maths duel", "");
    A.panel(""); A.live(true);
    M = { el, names, qs, r: -1, scores: [0, 0], decided: {}, lockUntil: 0, timer: 0, over: false };
    q(".ar-body", el).innerHTML = `${A.duel(names, COLORS)}<div class="md">
      <small class="md-n"></small><div class="md-bar"><i></i></div>
      <p class="md-q"></p><div class="md-opts"></div><p class="md-msg" aria-live="polite"></p></div>`;
    q(".md-opts", el).addEventListener("click", (e) => {
      const b = e.target.closest("[data-o]");
      if (b) tap(Number(b.dataset.o), b);
    });
    next();
  }

  function next() {
    if (!M) return;
    M.r += 1;
    if (M.r >= ROUNDS) return finish();
    const Q = M.qs[M.r];
    q(".md-n", M.el).textContent = `Sum ${M.r + 1} of ${ROUNDS}`;
    const qq = q(".md-q", M.el); qq.textContent = `${Q.text} = ?`; qq.classList.remove("in"); void qq.offsetWidth; qq.classList.add("in");
    q(".md-opts", M.el).innerHTML = Q.opts.map((o) => `<button data-o="${o}">${o}</button>`).join("");
    q(".md-msg", M.el).textContent = "";
    M.lockUntil = 0;
    const bar = q(".md-bar i", M.el);
    bar.style.transition = "none"; bar.style.width = "100%"; void bar.offsetWidth;
    bar.style.transition = `width ${LIMIT}ms linear`; bar.style.width = "0%";
    clearTimeout(M.timer);
    if (ref()) M.timer = setTimeout(() => decide(M.r, -1), LIMIT);
    A.setDuel({ turn: -1, scores: M.scores });
    A.status("Tap the right answer first");
  }

  function tap(v, b) {
    if (!M || M.over || M.decided[M.r] !== undefined) return;
    if (Date.now() < M.lockUntil) return;
    const Q = M.qs[M.r];
    if (v !== Q.ans) {
      b.classList.add("bad");
      M.lockUntil = Date.now() + LOCK;
      A.sound("bad");
      q(".md-msg", M.el).textContent = "Wrong! Frozen for a moment…";
      setTimeout(() => { if (M && Date.now() >= M.lockUntil) q(".md-msg", M.el).textContent = ""; }, LOCK);
      return;
    }
    b.classList.add("good");
    if (ref()) decide(M.r, mine());
    else send(K, { t: "claim", r: M.r });
  }

  // referee only: the first right answer wins the round
  function decide(r, who) {
    if (!M || M.decided[r] !== undefined || r !== M.r) return;
    send(K, { t: "point", r, who });
    point(r, who);
  }
  function point(r, who) {
    if (!M || M.decided[r] !== undefined) return;
    M.decided[r] = who;
    clearTimeout(M.timer);
    const bar = q(".md-bar i", M.el);
    bar.style.width = `${bar.getBoundingClientRect().width}px`; bar.style.transition = "none";
    if (who >= 0) M.scores[who] += 1;
    const Q = M.qs[r];
    M.el.querySelectorAll(".md-opts button").forEach((b) => { b.disabled = true; if (Number(b.dataset.o) === Q.ans) b.classList.add("good"); });
    q(".md-msg", M.el).textContent = who < 0 ? `Time's up! It was ${Q.ans}` : who === mine() ? "Point to you! ⚡" : `${M.names[who]} was faster`;
    A.sound(who === mine() ? "good" : "tick");
    A.setDuel({ turn: who, scores: M.scores });
    A.event(`Maths duel, sum ${r + 1}: ${Q.text} = ${Q.ans}. ${who < 0 ? "Nobody got it in time" : `${M.names[who]} got it first`}. Score ${M.names[0]} ${M.scores[0]} – ${M.scores[1]} ${M.names[1]}`);
    setTimeout(next, 1400);
  }

  function finish() {
    M.over = true;
    const [a, b] = M.scores;
    A.over(K, M.names, a === b ? -1 : a > b ? 0 : 1, `${a} – ${b}`, rematch);
  }

  const makeAll = () => Array.from({ length: ROUNDS }, (_, i) => makeQ(i));
  function start() {
    const names = [me.name, A.other().name], qs = makeAll();
    begin(names, qs);
    send(K, { t: "start", names, qs });
  }
  function rematch() {
    const qs = makeAll();
    begin(M.names, qs);
    send(K, { t: "start", names: M.names, qs });
  }
  function onMsg(d, peer) {
    if (d.t === "start" && Array.isArray(d.qs)) {
      const qs = d.qs.slice(0, ROUNDS).map((x) => ({ text: String(x.text).slice(0, 30), ans: Number(x.ans), opts: (x.opts || []).slice(0, 4).map(Number) }));
      begin(d.names, qs); toast(`${peer.name} started Maths duel`); return;
    }
    if (!M) return;
    if (d.t === "claim" && ref()) decide(Number(d.r), M.names.indexOf(peer.name));
    if (d.t === "point") point(Number(d.r), Number(d.who));
  }
  A.register(K, { start, onMsg, cleanup() { if (M) clearTimeout(M.timer); M = null; } });
})();
