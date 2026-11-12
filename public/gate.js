// DU Meet · lock screen.
// The password is asked on every visit and every reload: the access token lives only in
// this page's memory (never in a cookie or storage). The rest of the app is loaded only
// after the lock is opened.

(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  // Android Chrome offers "install app" once; keep the offer for the Install button.
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); window.DU_installPrompt = event; });
  window.addEventListener("appinstalled", () => { window.DU_installPrompt = null; });

  const SCRIPTS = ["/app.js", "/home.js", "/tools.js", "/couple.js", "/extras.js"];
  let token = "";

  // Every call to the server carries the token; links that can't send headers (images,
  // downloads, sendBeacon) get it as ?k=
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (token && url.startsWith("/api/")) init = { ...init, headers: { ...(init.headers || {}), "X-Auth": token } };
    return nativeFetch(input, init);
  };
  window.authUrl = (url) => (token && url.startsWith("/api/") ? `${url}${url.includes("?") ? "&" : "?"}k=${token}` : url);
  const nativeBeacon = navigator.sendBeacon?.bind(navigator);
  if (nativeBeacon) navigator.sendBeacon = (url, data) => nativeBeacon(window.authUrl(url), data);

  function loadScripts(list) {
    return list.reduce((chain, src) => chain.then(() => new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.body.append(script);
    })), Promise.resolve());
  }

  async function unlock() {
    $("#gate").classList.add("leaving");
    try {
      await loadScripts(SCRIPTS);
    } catch (error) {
      $("#gate").classList.remove("leaving");
      showError("Could not load the app. Check the internet and reload.");
      return;
    }
    setTimeout(() => $("#gate").remove(), 400);
  }

  function showError(text) {
    const box = $("#gate-error");
    box.textContent = text;
    box.hidden = !text;
  }

  async function start() {
    let required = true;
    let length = 0;
    try {
      const info = await (await nativeFetch("/api/auth-info")).json();
      required = info.required;
      length = info.len || 0;
      window.DU_adminLen = info.adminLen || 0;
    } catch {
      $("#gate-sub").textContent = "Can't reach the server";
      showError("Check the internet and reload.");
      return;
    }
    if (!required) return unlock();

    $("#gate-sub").textContent = "Enter the password to continue";
    $("#gate-field").hidden = false;
    $("#gate-input").focus();
    // Opens as soon as the last character is typed; no need to press the arrow.
    $("#gate-input").addEventListener("input", (event) => {
      if (length && event.target.value.length === length && !$("#gate-form").classList.contains("busy")) $("#gate-form").requestSubmit();
    });
    $("#gate-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if ($("#gate-form").classList.contains("busy")) return;
      const input = $("#gate-input");
      const form = $("#gate-form");
      showError("");
      form.classList.add("busy");
      try {
        const response = await nativeFetch("/api/login", { method: "POST", body: JSON.stringify({ password: input.value }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Wrong password");
        token = result.token;
        input.value = "";
        $("#gate-form").classList.add("ok");
        setTimeout(unlock, 380);
      } catch (error) {
        showError(error.message === "Failed to fetch" ? "Can't reach the server" : error.message);
        form.classList.remove("shake");
        void form.offsetWidth;
        form.classList.add("shake");
        input.select();
      } finally {
        form.classList.remove("busy");
      }
    });
  }

  start();
})();
