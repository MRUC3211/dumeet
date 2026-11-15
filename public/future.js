// DU Meet · "Future us": Hey Lord imagines the couple's life together a few years
// from now and reveals it as a dreamy full-screen card on both phones.
// Uses globals from app.js (me, peers, send, toast) and window.DU.

(() => {
  "use strict";
  const PEOPLE = ["Uday", "Diya"];
  const names = () => {
    const live = [me.name, ...[...peers.values()].map((p) => p.name)].filter(Boolean);
    return [...new Set(live.length ? live : PEOPLE)].slice(0, 2);
  };

  let busy = false;
  async function openFuture() {
    window.DU.kit.toggleTray(false);
    if (busy) return;
    busy = true;
    toast("Imagining your future together…");
    try {
      const res = await fetch("/api/ai/future", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names: names(), years: 10 }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "failed");
      showFuture(data);
      send("future", data);
    } catch (error) {
      const msg = String(error.message || error);
      toast(/switched on|GEMINI/i.test(msg) ? "Hey Lord isn't on yet — add the AI key on the server" : "Couldn't imagine it, try again");
    } finally { busy = false; }
  }

  let cur = null;
  function showFuture(data) {
    close();
    const scenes = Array.isArray(data.scenes) ? data.scenes.slice(0, 4) : [];
    if (!scenes.length) return;
    const el = document.createElement("div");
    el.className = "future-card";
    el.innerHTML =
      '<button class="fut-x" aria-label="Close"><span class="icon">close</span></button>'
      + '<div class="fut-inner">'
      + '<p class="fut-eyebrow">✨ Future us</p>'
      + `<h2 class="fut-title"></h2>`
      + '<div class="fut-scenes"></div>'
      + '<p class="fut-line"></p>'
      + '<button class="btn primary fut-again">Imagine again</button>'
      + '</div>';
    el.querySelector(".fut-title").textContent = data.title || "Our future";
    const list = el.querySelector(".fut-scenes");
    scenes.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "fut-scene";
      row.style.setProperty("--d", `${0.15 + i * 0.18}s`);
      const em = document.createElement("span"); em.className = "fut-emoji"; em.textContent = s.emoji || "✨";
      const box = document.createElement("div");
      const t = document.createElement("b"); t.textContent = s.title || "";
      const p = document.createElement("p"); p.textContent = s.text || "";
      box.append(t, p);
      row.append(em, box);
      list.append(row);
    });
    el.querySelector(".fut-line").textContent = data.line || "";
    document.body.append(el);
    cur = el;
    requestAnimationFrame(() => el.classList.add("open"));
    el.addEventListener("click", (e) => {
      if (e.target.closest(".fut-x") || e.target === el) close();
      else if (e.target.closest(".fut-again")) { close(); openFuture(); }
    });
  }
  function close() { cur?.remove(); cur = null; }

  const prev = { click: window.DU.onCoupleClick, msg: window.DU.onCouple, leave: window.DU.onCoupleLeave };
  Object.assign(window.DU, {
    onCoupleClick(button) {
      if (button.dataset.tg === "future") openFuture();
      else prev.click?.(button);
    },
    onCouple(message, peer) {
      if (message.type === "future" && message.data) showFuture(message.data);
      else prev.msg?.(message, peer);
    },
    onCoupleLeave(...a) { close(); prev.leave?.(...a); },
  });

  window.DU.showFuture = showFuture; // used by the live reveal and for quick checks
})();
