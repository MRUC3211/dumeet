// DU Meet · Productivity: today's tasks for each of you, daily habits with streaks, and
// "Plan my day" (Saathi orders your tasks into a timetable). Lists are saved, so they're
// there after the call too. In a call you can also just ask Saathi out loud: "add gym to my
// tasks", "mark gym done", "what's left on Diya's list?" — see the tools at the bottom.

(() => {
  "use strict";
  const { q, esc, getDocs, putDoc } = window.DU.kit;
  const W = () => window.DU.win;
  const V = () => window.DU.voice;
  const other = () => [...peers.values()][0];
  const tray = () => window.DU.kit.toggleTray(false);
  const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const slug = (n) => String(n || "me").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const partnerName = () => other()?.name || window.DU.kit.partnerName?.() || "";
  const share = (data) => { if (other()) send("focus", data); };

  // ---------- storage: one doc per person, so two phones rarely write the same doc ----------

  const cache = {}; // "tasks-uday" → data
  async function load(kind, name) {
    const id = `${kind}-${slug(name)}`;
    try {
      const doc = (await getDocs("settings")).find((d) => d.id === id);
      cache[id] = doc?.data || {};
    } catch { cache[id] ||= {}; }
    return cache[id];
  }
  async function save(kind, name, data) {
    const id = `${kind}-${slug(name)}`;
    cache[id] = data;
    await putDoc("settings", data, id);
    share({ t: "changed", kind, name });
  }

  // =================================================================
  // Tasks
  // =================================================================

  const tk = { who: "me" };
  const whoName = (who) => (who === "them" ? partnerName() : me.name);
  async function tasksOf(name) {
    const data = await load("tasks", name);
    const today = day();
    // finished tasks from earlier days drop off; open ones carry over
    const items = (data.items || []).filter((t) => !t.done || (t.doneDay || today) === today);
    return items;
  }
  async function saveTasks(name, items) { await save("tasks", name, { items: items.slice(-80) }); }

  async function openTasks(who = tk.who) {
    tray();
    tk.who = who === "them" && partnerName() ? "them" : "me";
    const w = W().open({
      id: "tasks", title: "Today's tasks", icon: "task_alt", w: 360, h: 540,
      html: `<div class="tk"><div class="tk-tabs"></div>
        <div class="tk-prog"><i></i></div>
        <form class="tk-add"><input class="field" maxlength="140" placeholder="Add a task…" aria-label="New task"><button class="btn primary" aria-label="Add"><span class="icon">add</span></button></form>
        <ul class="tk-list"><li class="tk-empty">Loading…</li></ul>
        <div class="tk-acts"><button class="btn ghost" data-tk="plan"><span class="icon">auto_awesome</span>Plan my day</button><button class="btn ghost" data-tk="clear"><span class="icon">cleaning_services</span>Clear done</button></div>
        <p class="fw-note center tk-tip">In a call, just say: “Saathi, add gym to my tasks” or “mark gym done”.</p></div>`,
    });
    const input = q(".tk-add .field", w.body);
    q(".tk-add", w.body).insertBefore(V().micButton(input, { onDone: (t) => addTask(whoName(tk.who), t) }), q(".tk-add .btn", w.body));
    q(".tk-add", w.body).onsubmit = (e) => { e.preventDefault(); const t = input.value.trim(); if (t) { addTask(whoName(tk.who), t); input.value = ""; } };
    w.body.onclick = async (e) => {
      const tab = e.target.closest("[data-tab]");
      if (tab) { tk.who = tab.dataset.tab; return paintTasks(); }
      const tick = e.target.closest("[data-tick]");
      if (tick) return setDone(whoName(tk.who), tick.dataset.tick);
      const x = e.target.closest("[data-del]");
      if (x) return removeTask(whoName(tk.who), x.dataset.del);
      const a = e.target.closest("[data-tk]")?.dataset.tk;
      if (a === "plan") openPlan();
      if (a === "clear") { const name = whoName(tk.who); const items = await tasksOf(name); await saveTasks(name, items.filter((t) => !t.done)); paintTasks(); }
    };
    paintTasks();
  }

  async function paintTasks(w = W().get("tasks")) {
    if (!w) return;
    const p = partnerName();
    const [mine, theirs] = await Promise.all([tasksOf(me.name), p ? tasksOf(p) : Promise.resolve([])]);
    if (!W().get("tasks")) return;
    const count = (l) => `${l.filter((t) => t.done).length}/${l.length}`;
    q(".tk-tabs", w.body).innerHTML = `<button data-tab="me" class="${tk.who === "me" ? "on" : ""}"><b>Mine</b><small>${count(mine)}</small></button>`
      + (p ? `<button data-tab="them" class="${tk.who === "them" ? "on" : ""}"><b>${esc(p)}</b><small>${count(theirs)}</small></button>` : "");
    const list = tk.who === "them" ? theirs : mine;
    const done = list.filter((t) => t.done).length;
    q(".tk-prog i", w.body).style.width = `${list.length ? (done / list.length) * 100 : 0}%`;
    q(".tk-add .field", w.body).placeholder = tk.who === "them" ? `Add a task for ${p}…` : "Add a task…";
    const sorted = [...list.filter((t) => !t.done), ...list.filter((t) => t.done)];
    q(".tk-list", w.body).innerHTML = sorted.length
      ? sorted.map((t) => `<li class="${t.done ? "done" : ""}"><button class="tk-box" data-tick="${t.id}" aria-label="${t.done ? "Mark not done" : "Mark done"}"><span class="icon" aria-hidden="true">check</span></button><span class="tk-t">${esc(t.text)}${t.by && t.by !== whoName(tk.who) ? `<small>from ${esc(t.by)}</small>` : ""}</span><button class="tk-x" data-del="${t.id}" aria-label="Remove"><span class="icon" aria-hidden="true">close</span></button></li>`).join("")
      : `<li class="tk-empty">${tk.who === "them" ? `${esc(p)} has no tasks yet.` : "Nothing yet. Add what you want to get done today."}</li>`;
  }

  async function addTask(name, text) {
    text = String(text || "").trim().slice(0, 140);
    if (!text || !name) return null;
    const items = await tasksOf(name);
    const t = { id: uid(), text, done: false, by: me.name, at: Date.now() };
    items.push(t);
    await saveTasks(name, items);
    paintTasks();
    if (name !== me.name) toast(`Added to ${name}'s tasks`);
    return t;
  }
  async function setDone(name, id, value) {
    const items = await tasksOf(name);
    const t = items.find((x) => x.id === id);
    if (!t) return null;
    t.done = value ?? !t.done;
    t.doneDay = t.done ? day() : undefined;
    await saveTasks(name, items);
    paintTasks();
    if (t.done) {
      chime();
      if (items.every((x) => x.done)) toast(name === me.name ? "All done for today! 🎉" : `${name} finished everything! 🎉`);
    }
    return t;
  }
  async function removeTask(name, id) {
    const items = await tasksOf(name);
    await saveTasks(name, items.filter((t) => t.id !== id));
    paintTasks();
  }
  function chime() {
    try {
      const c = new (window.AudioContext || window.webkitAudioContext)(), t = c.currentTime;
      [880, 1320].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0, t + i * .08); g.gain.linearRampToValueAtTime(.08, t + i * .08 + .01); g.gain.exponentialRampToValueAtTime(.001, t + i * .08 + .5); o.connect(g).connect(c.destination); o.start(t + i * .08); o.stop(t + i * .08 + .55); });
      setTimeout(() => c.close(), 900);
    } catch { /* no audio */ }
  }

  // find a task by number ("2") or by words ("gym")
  function match(items, what) {
    const s = String(what || "").trim().toLowerCase();
    if (!s) return null;
    const n = Number(s);
    if (Number.isInteger(n) && n >= 1 && n <= items.length) return items[n - 1];
    return items.find((t) => t.text.toLowerCase() === s)
      || items.find((t) => t.text.toLowerCase().includes(s))
      || items.find((t) => s.includes(t.text.toLowerCase()))
      || items.find((t) => s.split(/\s+/).filter((w) => w.length > 2).some((w) => t.text.toLowerCase().includes(w)))
      || null;
  }

  // =================================================================
  // Plan my day (AI)
  // =================================================================

  async function openPlan() {
    const open = (await tasksOf(me.name)).filter((t) => !t.done).map((t) => t.text);
    if (!open.length) return toast("Add a few tasks first");
    const w = W().open({ id: "plan", title: "Plan my day", icon: "auto_awesome", w: 340, h: 500, tone: "calm",
      html: `<div class="pl2"><div class="gr-load"><span class="sa-orb live"><i></i></span><small>Saathi is planning your day…</small></div></div>` });
    try {
      const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
      const r = await V().api("plan", { tasks: open, now });
      if (!W().get("plan")) return;
      q(".pl2", w.body).innerHTML = `<ol class="pl2-list">${r.plan.map((p) => `<li><b>${esc(p.time)}</b><span>${esc(p.task)}${p.mins ? `<small>${p.mins} min</small>` : ""}</span></li>`).join("")}</ol>
        ${r.tip ? `<p class="pl2-tip">${esc(r.tip)}</p>` : ""}<button class="btn ghost wide" data-plan="again"><span class="icon">refresh</span>Plan again</button>`;
      w.body.onclick = (e) => { if (e.target.closest("[data-plan=again]")) { w.close(); setTimeout(openPlan, 200); } };
    } catch (error) {
      if (W().get("plan")) q(".pl2", w.body).innerHTML = `<p class="fw-note center">${esc(error.message)}</p>`;
    }
  }

  // =================================================================
  // Habits: tick each day, keep the streak going
  // =================================================================

  const HABIT_IDEAS = [["💧", "Drink 8 glasses of water"], ["🏃", "Exercise"], ["📖", "Read 10 pages"], ["🧘", "Meditate"], ["😴", "Sleep by 12"], ["📵", "No phone after 11"], ["🥗", "Eat healthy"], ["🙏", "Gratitude"]];
  async function habitsOf(name) { const d = await load("habits", name); return { list: d.list || [], days: d.days || {} }; }
  function streak(h, days) {
    let n = 0;
    const d = new Date();
    if (!(days[day(d)] || []).includes(h.id)) d.setDate(d.getDate() - 1); // today not ticked yet: count up to yesterday
    while ((days[day(d)] || []).includes(h.id)) { n += 1; d.setDate(d.getDate() - 1); }
    return n;
  }
  function openHabits() {
    tray();
    const w = W().open({ id: "habits", title: "Habits", icon: "local_fire_department", w: 360, h: 520,
      html: `<div class="hb"><ul class="hb-list"><li class="tk-empty">Loading…</li></ul>
        <form class="tk-add hb-add"><input class="field" maxlength="60" placeholder="New habit, e.g. Walk 20 min" aria-label="New habit"><button class="btn primary" aria-label="Add"><span class="icon">add</span></button></form>
        <div class="hb-ideas"></div><div class="hb-them"></div></div>` });
    const input = q(".hb-add .field", w.body);
    q(".hb-add", w.body).insertBefore(V().micButton(input), q(".hb-add .btn", w.body));
    q(".hb-add", w.body).onsubmit = (e) => { e.preventDefault(); addHabit(input.value); input.value = ""; };
    w.body.onclick = async (e) => {
      const tick = e.target.closest("[data-hb]");
      if (tick) return tickHabit(me.name, tick.dataset.hb);
      const del = e.target.closest("[data-hbx]");
      if (del) { const h = await habitsOf(me.name); h.list = h.list.filter((x) => x.id !== del.dataset.hbx); await save("habits", me.name, h); return paintHabits(); }
      const idea = e.target.closest("[data-idea]");
      if (idea) addHabit(idea.dataset.idea);
    };
    paintHabits();
  }
  async function addHabit(text) {
    text = String(text || "").trim().slice(0, 60);
    if (!text) return;
    const h = await habitsOf(me.name);
    if (h.list.some((x) => x.name.toLowerCase() === text.toLowerCase())) return toast("Already on your list");
    const idea = HABIT_IDEAS.find((x) => x[1] === text);
    h.list.push({ id: uid(), name: text, e: idea?.[0] || "✨" });
    await save("habits", me.name, h);
    paintHabits();
  }
  async function tickHabit(name, id, value) {
    const h = await habitsOf(name);
    const today = day();
    const set = new Set(h.days[today] || []);
    const on = value ?? !set.has(id);
    if (on) set.add(id); else set.delete(id);
    h.days[today] = [...set];
    const keep = Object.keys(h.days).sort().slice(-120);
    h.days = Object.fromEntries(keep.map((k) => [k, h.days[k]]));
    await save("habits", name, h);
    if (on) chime();
    paintHabits();
    return h.list.find((x) => x.id === id);
  }
  async function paintHabits(w = W().get("habits")) {
    if (!w) return;
    const p = partnerName();
    const [mine, theirs] = await Promise.all([habitsOf(me.name), p ? habitsOf(p) : Promise.resolve(null)]);
    if (!W().get("habits")) return;
    const today = mine.days[day()] || [];
    q(".hb-list", w.body).innerHTML = mine.list.length
      ? mine.list.map((h) => { const n = streak(h, mine.days); return `<li class="${today.includes(h.id) ? "done" : ""}"><button class="hb-tick" data-hb="${h.id}" aria-label="Done today: ${esc(h.name)}"><span>${esc(h.e || "✨")}</span></button><span class="tk-t">${esc(h.name)}<small>${n ? `🔥 ${n} day${n > 1 ? "s" : ""}` : "Start your streak today"}</small></span><button class="tk-x" data-hbx="${h.id}" aria-label="Remove habit"><span class="icon" aria-hidden="true">close</span></button></li>`; }).join("")
      : `<li class="tk-empty">Pick a habit below or add your own.</li>`;
    q(".hb-ideas", w.body).innerHTML = HABIT_IDEAS.filter((i) => !mine.list.some((h) => h.name === i[1])).slice(0, 6).map(([e, t]) => `<button data-idea="${esc(t)}">${e} ${esc(t)}</button>`).join("");
    const td = theirs?.days[day()] || [];
    q(".hb-them", w.body).innerHTML = theirs && theirs.list.length
      ? `<b>${esc(p)} today</b><div>${theirs.list.map((h) => `<span class="${td.includes(h.id) ? "on" : ""}">${esc(h.e || "✨")} ${esc(h.name)}${streak(h, theirs.days) ? ` · 🔥${streak(h, theirs.days)}` : ""}</span>`).join("")}</div>`
      : "";
  }

  // ---------- hooks ----------

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      const run = { tasks: () => openTasks(), habits: openHabits, planday: () => { tray(); openPlan(); } }[button.dataset.tg];
      if (run) run(); else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type !== "focus") return prev.msg?.(message, peer);
      const d = message.data || {};
      if (d.t === "changed") {
        delete cache[`${d.kind}-${slug(d.name)}`];
        if (d.kind === "tasks") paintTasks();
        if (d.kind === "habits") paintHabits();
      }
    },
    onCoupleLeave(...args) { prev.leave?.(...args); },
  });

  // ---------- Saathi can run these when you ask out loud ----------

  const personParam = { type: "STRING", description: "Whose list: the person's name. Leave empty for the person speaking to you (if unsure, ask)." };
  const who = (args) => {
    const names = [me.name, partnerName()].filter(Boolean);
    const want = String(args.person || "").trim().toLowerCase();
    return names.find((n) => n.toLowerCase() === want) || names.find((n) => want && n.toLowerCase().startsWith(want)) || me.name;
  };
  const openList = (name) => { tk.who = name === me.name ? "me" : "them"; if (!W().get("tasks")) openTasks(tk.who); else paintTasks(); };
  window.DU.saathiTools.push(
    { name: "list_tasks", description: "Read someone's tasks for today (what's done and what's left).",
      parameters: { type: "OBJECT", properties: { person: personParam } },
      run: async (a) => { const name = who(a); const items = await tasksOf(name); openList(name); return { person: name, tasks: items.map((t, i) => ({ n: i + 1, task: t.text, done: Boolean(t.done) })) }; } },
    { name: "add_tasks", description: "Add one or more tasks to someone's list for today.",
      parameters: { type: "OBJECT", properties: { person: personParam, tasks: { type: "ARRAY", items: { type: "STRING" }, description: "Short task texts" } }, required: ["tasks"] },
      run: async (a) => { const name = who(a); const added = []; for (const t of (a.tasks || []).slice(0, 10)) { const x = await addTask(name, t); if (x) added.push(x.text); } openList(name); return { person: name, added }; } },
    { name: "complete_task", description: "Tick a task as done (or not done) on someone's list.",
      parameters: { type: "OBJECT", properties: { person: personParam, task: { type: "STRING", description: "Words from the task, or its number" }, done: { type: "BOOLEAN", description: "false to un-tick" } }, required: ["task"] },
      run: async (a) => { const name = who(a); const items = await tasksOf(name); const t = match(items, a.task); if (!t) return { error: `No task like "${a.task}" on ${name}'s list`, tasks: items.map((x) => x.text) }; await setDone(name, t.id, a.done !== false); openList(name); return { person: name, task: t.text, done: a.done !== false }; } },
    { name: "remove_task", description: "Delete a task from someone's list.",
      parameters: { type: "OBJECT", properties: { person: personParam, task: { type: "STRING" } }, required: ["task"] },
      run: async (a) => { const name = who(a); const items = await tasksOf(name); const t = match(items, a.task); if (!t) return { error: "Task not found" }; await removeTask(name, t.id); openList(name); return { removed: t.text }; } },
    { name: "tick_habit", description: "Mark one of the speaker's daily habits as done today.",
      parameters: { type: "OBJECT", properties: { person: personParam, habit: { type: "STRING" } }, required: ["habit"] },
      run: async (a) => { const name = who(a); const h = await habitsOf(name); const x = match(h.list.map((y) => ({ ...y, text: y.name })), a.habit); if (!x) return { error: "Habit not found", habits: h.list.map((y) => y.name) }; await tickHabit(name, x.id, true); return { person: name, habit: x.name, done: true }; } },
  );

  window.DU.focus = { openTasks, addTask, tasksOf };
})();
