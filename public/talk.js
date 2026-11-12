// DU Meet · Date night talk cards, written fresh by Saathi's AI (with a built-in deck when
// the AI isn't reachable): Deep talks, Spicy talks, Never have I ever and Truth or dare
// after dark. Spicy ones have a heat level. Both phones always show the same card.

(() => {
  "use strict";
  const { q, esc, store } = window.DU.kit;
  const W = () => window.DU.win;
  const V = () => window.DU.voice;
  const other = () => [...peers.values()][0];
  const tray = () => window.DU.kit.toggleTray(false);

  const KINDS = {
    deep: { title: "Deep talks", icon: "psychology", e: "💭", tone: "night", heat: false, note: "Take turns answering. No rush, no wrong answers." },
    spicy: { title: "Spicy talks", icon: "local_fire_department", e: "🌶️", tone: "rose", heat: true, note: "Just for the two of you. Answer honestly, skip anything you like." },
    never: { title: "Never have I ever", icon: "front_hand", e: "🙈", tone: "rose", heat: true, note: "Both answer in secret, then it shows." },
    dare: { title: "Truth or dare: after dark", icon: "whatshot", e: "🔥", tone: "rose", heat: true, note: "Take turns. Pick truth or dare." },
  };
  const HEAT = [["1", "Sweet"], ["2", "Flirty"], ["3", "Hot"]];
  const maxHeat = () => Math.max(1, Math.min(3, Number(window.DU.policy?.maxHeat) || 3));   // the admin's limit
  const heat = (v) => Math.max(1, Math.min(maxHeat(), Number(v) || 2));

  // the built-in deck, used when the AI can't be reached
  const DECK = {
    deep: ["What's a moment with me you replay in your head?", "What did you need more of as a child?", "What's something you've never told anyone but want to tell me?", "When do you feel most loved by me?", "What scares you about the future, and what excites you?", "What's a dream you gave up on, and would you try again?", "Which small habit of mine do you secretly love?", "What does a perfect ordinary day with me look like?", "When did you last cry, and why?", "What's one thing you'd change about how we fight?", "What's a value you'd never compromise on?", "How do you want us to be in ten years?", "What did your first impression of me get wrong?", "What's something you're proud of that nobody praises?", "What makes you feel safe with someone?"],
    spicy: ["What's the first thing you noticed about me that you found attractive?", "Describe our perfect slow evening together, start to finish.", "What's one thing I do that instantly gets your attention?", "Where's the most romantic place you'd want to kiss me?", "What outfit of mine do you like the most?", "What's a romantic fantasy you've never said out loud?", "What's your favourite way to be touched when you're tired?", "Which memory of us makes you blush?", "What should I whisper to you next time we meet?", "What's something new you'd like us to try together?", "When did you last think about me and smile for no reason?", "What's the most attractive thing about my voice?", "What would you do if I were next to you right now?", "Morning cuddles or late-night talks: which do you want more?", "Rate our first kiss out of 10 and explain."],
    never: ["Never have I ever stalked my partner's old photos.", "Never have I ever practised a kiss on my hand.", "Never have I ever fallen asleep on a call.", "Never have I ever had a crush on a teacher.", "Never have I ever sent a text to the wrong person.", "Never have I ever dreamt about you.", "Never have I ever pretended to be busy to look cool.", "Never have I ever saved a screenshot of our chat.", "Never have I ever been jealous for no reason.", "Never have I ever planned our wedding in my head.", "Never have I ever kissed someone in the rain.", "Never have I ever reread our old messages.", "Never have I ever lied about liking a gift.", "Never have I ever flirted to get out of trouble.", "Never have I ever thought about you in class or at work."],
    truth: ["What's the most romantic thought you had about me this week?", "What's one thing you'd never want me to find out?", "Who was your first crush?", "What's something about me you'd change if you could?", "What's the cheesiest line you've ever used?", "When did you know you liked me?", "What's your guilty pleasure?", "What do you miss most about me right now?", "What's a secret talent nobody knows about?", "What's the most embarrassing thing you've done for love?"],
    dare: ["Say 'I love you' in your most dramatic movie voice.", "Blow a kiss at the camera like a superstar.", "Give me a 20-second compliment speech without stopping.", "Do your best slow-motion hair flip.", "Sing one line of a love song to me.", "Show me the last photo of us on your phone.", "Wink at me three times, each one cuter.", "Whisper something sweet so I have to lean in.", "Do a 10-second dance for me.", "Send me the cheesiest text you can think of, right now.", "Pose like you're on a magazine cover.", "Tell me what you'd cook for our first dinner date at home."],
  };

  const st = { kind: "", level: 2, text: "", n: 0, turn: 0, td: "", votes: {}, loading: false };
  const queues = {};
  const seenKey = (k) => `du-talk-seen-${k}`;
  const seen = (k) => store.get(seenKey(k), []);
  const remember = (k, text) => store.set(seenKey(k), [...seen(k), text].slice(-60));

  async function draw(kind, level) {
    const key = `${kind}-${level}`;
    queues[key] ||= [];
    if (!queues[key].length) {
      try {
        const r = await V().api("cards", { kind, level, avoid: seen(kind) });
        queues[key] = r.cards.filter((c) => !seen(kind).includes(c));
      } catch {
        const fresh = DECK[kind].filter((c) => !seen(kind).includes(c));
        queues[key] = (fresh.length ? fresh : [...DECK[kind]]).sort(() => Math.random() - .5);
      }
    }
    const text = queues[key].shift() || DECK[kind][0];
    remember(kind, text);
    return text;
  }

  async function open(kind, from) {
    tray();
    if (!KINDS[kind]) return;
    if (KINDS[kind].heat && !from && !store.get("du-spicy-ok", false)) {
      const ok = await window.DU.kit.confirmBox?.({ title: "Just for the two of you?", text: "These cards can get romantic and spicy. Both of you should be adults and comfortable. You can always skip a card.", ok: "We're in", cancel: "Not now" });
      if (!ok) return;
      store.set("du-spicy-ok", true);
    }
    const k = KINDS[kind];
    // one deck at a time: the cards share one table
    Object.keys(KINDS).forEach((o) => { if (o !== kind) W().get(`talk-${o}`)?.close(); });
    if (st.kind !== kind) Object.assign(st, { kind, text: "", n: 0, turn: 0, td: "", votes: {} });
    W().get(`talk-${kind}`) || W().open({
      id: `talk-${kind}`, title: k.title, icon: k.icon, w: 360, h: 470, tone: k.tone,
      onClose: () => { if (st.kind === kind) st.kind = ""; V().stopSpeaking(); },
      html: `<div class="tc tc-${kind}">${k.heat ? `<div class="tc-heat" role="group" aria-label="Heat">${HEAT.filter(([v]) => Number(v) <= maxHeat()).map(([v, l]) => `<button data-lv="${v}">${l}</button>`).join("")}</div>` : ""}
        <div class="tc-card"><span class="tc-e" aria-hidden="true">${k.e}</span><small class="tc-n"></small><p class="tc-text"></p><small class="tc-by"></small></div>
        <div class="tc-mid"></div>
        <div class="tc-acts"><button class="btn ghost" data-tc="read" aria-label="Read aloud"><span class="icon">volume_up</span></button><button class="btn primary" data-tc="next"><span class="icon">style</span>Next card</button></div>
        <p class="fw-note center">${k.note}</p></div>`,
    });
    const w = W().get(`talk-${kind}`);
    w.body.onclick = (e) => {
      const lv = e.target.closest("[data-lv]");
      if (lv) { st.level = heat(lv.dataset.lv); store.set("du-talk-heat", st.level); paint(); return next(true); }
      const a = e.target.closest("[data-tc]")?.dataset.tc;
      if (a === "next") next(true);
      if (a === "read" && st.text) V().speak(st.text);
      const td = e.target.closest("[data-td]")?.dataset.td;
      if (td) pickTd(td, true);
      const v = e.target.closest("[data-v]")?.dataset.v;
      if (v != null) vote(v === "1", true);
    };
    st.level = heat(store.get("du-talk-heat", 2));
    if (!from && !st.text) next(true); else paint();
  }

  async function next(mine) {
    if (!mine || st.loading) return;
    const kind = st.kind;
    if (kind === "dare") { Object.assign(st, { text: "", td: "", votes: {}, n: st.n + 1, turn: st.n ? 1 - st.turn : 0 }); send("talk", { t: "card", kind, level: st.level, text: "", n: st.n, turn: st.turn }); return paint(); }
    st.loading = true; paint();
    const text = await draw(kind, st.level);
    st.loading = false;
    if (st.kind !== kind) return;
    Object.assign(st, { text, n: st.n + 1, turn: st.n ? 1 - st.turn : 0, votes: {}, td: "" });
    send("talk", { t: "card", kind, level: st.level, text, n: st.n, turn: st.turn });
    paint();
  }
  async function pickTd(td, mine) {
    if (mine) {
      if (players()[st.turn] !== me.name) return toast(`It's ${players()[st.turn]}'s turn to pick`);
      st.loading = true; st.td = td; paint();
      const text = await draw(td, st.level);
      st.loading = false;
      st.text = text;
      send("talk", { t: "card", kind: "dare", level: st.level, text, n: st.n, turn: st.turn, td });
    }
    paint();
  }
  function vote(yes, mine) {
    st.votes[me.name] = yes;
    if (mine) send("talk", { t: "vote", n: st.n, yes });
    paint();
  }
  const players = () => {
    const names = [me.name, other()?.name].filter(Boolean).sort();
    return names.length ? names : [me.name];
  };

  function paint() {
    const w = W().get(`talk-${st.kind}`);
    if (!w) return;
    w.el.querySelectorAll("[data-lv]").forEach((b) => b.classList.toggle("on", Number(b.dataset.lv) === st.level));
    const card = q(".tc-card", w.body);
    card.classList.toggle("loading", st.loading);
    q(".tc-n", w.body).textContent = st.n ? `Card ${st.n}` : "";
    const turnName = players()[st.turn % players().length];
    const yours = turnName === me.name;
    let text = st.loading ? "Shuffling…" : st.text;
    let by = "";
    let mid = "";
    if (st.kind === "deep" || st.kind === "spicy") by = st.text ? (yours ? "You answer first" : `${turnName} answers first`) : "";
    if (st.kind === "dare") {
      if (!st.text && !st.loading) {
        text = yours ? "Truth or dare?" : `${turnName} is choosing…`;
        mid = `<div class="tc-pick"><button data-td="truth"${yours ? "" : " disabled"}><span>🤫</span><b>Truth</b></button><button data-td="dare"${yours ? "" : " disabled"}><span>😈</span><b>Dare</b></button></div>`;
      } else if (st.td) by = `${st.td === "truth" ? "Truth" : "Dare"} for ${yours ? "you" : turnName}`;
    }
    if (st.kind === "never" && st.text) {
      const names = players();
      const mineV = st.votes[me.name];
      const all = names.every((n) => st.votes[n] != null);
      mid = all
        ? `<div class="tc-res">${names.map((n) => `<div class="${st.votes[n] ? "yes" : "no"}"><small>${esc(n === me.name ? "You" : n)}</small><b>${st.votes[n] ? "🙋 I have" : "🙅 Never"}</b></div>`).join("")}</div>`
        : `<div class="tc-pick"><button data-v="1" class="${mineV === true ? "on" : ""}"><span>🙋</span><b>I have</b></button><button data-v="0" class="${mineV === false ? "on" : ""}"><span>🙅</span><b>Never</b></button></div>${mineV != null ? `<p class="fw-note center">Waiting for ${esc(other()?.name || "them")}…</p>` : ""}`;
    }
    const t = q(".tc-text", w.body);
    if (t.textContent !== text) { t.textContent = text; card.classList.remove("in"); void card.offsetWidth; card.classList.add("in"); }
    q(".tc-by", w.body).textContent = by;
    q(".tc-mid", w.body).innerHTML = mid;
  }

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const kind = { deep: "deep", spicy: "spicy", never: "never", dare: "dare" }[button.dataset.tg];
      if (kind) open(kind); else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "talk") return prev.msg?.(message, peer);
      const d = message.data || {};
      if (d.t === "card" && KINDS[d.kind]) {
        if (st.kind !== d.kind || !W().get(`talk-${d.kind}`)) { st.kind = d.kind; open(d.kind, peer.name); toast(`${peer.name} opened ${KINDS[d.kind].title} ${KINDS[d.kind].e}`); }
        Object.assign(st, { level: heat(d.level), text: String(d.text || "").slice(0, 240), n: Number(d.n) || 0, turn: Number(d.turn) || 0, td: d.td || "", votes: {}, loading: false });
        paint();
      }
      if (d.t === "vote" && Number(d.n) === st.n) { st.votes[peer.name] = Boolean(d.yes); paint(); }
    },
    onCoupleLeave(...args) { prev.leave?.(...args); Object.keys(KINDS).forEach((k) => W().get(`talk-${k}`)?.close()); },
  });
})();
