// DU Meet service worker: makes the app installable and opens instantly.
// Pages and API calls always go to the network (calls and data must be live);
// only icons are cached.
const CACHE = "du-meet-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith("/icons/")) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const response = await fetch(event.request);
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    }),
  );
});

// "Call me" ring: the push has no payload; ask the server who rang this device.
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let from = "";
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const res = await fetch("/api/push/latest", { method: "POST", body: JSON.stringify({ endpoint: sub?.endpoint || "" }) });
      from = (await res.json()).from || "";
    } catch { /* show a plain ring */ }
    await self.registration.showNotification(from ? `${from} is calling you` : "Someone is calling you", {
      body: "Tap to join the call on DU Meet",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "du-ring",
      renotify: true,
      requireInteraction: true,
      vibrate: [400, 200, 400, 200, 400, 200, 800],
      data: { url: "/?room=our-room" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = tabs.find((c) => new URL(c.url).origin === location.origin);
    if (open) { await open.focus(); open.postMessage({ type: "ring-open" }); return; }
    await self.clients.openWindow(url);
  })());
});
