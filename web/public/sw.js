const CACHE = "kotoba-shell-v6";
const SHELL = [
  "./",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./animations/squirrel-animation-12fps.gif",
  "./animations/squirrel-reaction-short.gif",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const pathname = new URL(event.request.url).pathname;
  if (event.request.method !== "GET" || pathname.startsWith("/api/") || pathname.includes("/functions/v1/memory-api")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./")))
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: "もう一度考えたかった言葉があります" };
  }
  event.waitUntil(
    self.registration.showNotification(
      payload.title || "もう一度考えたかった言葉があります",
      {
        body: payload.body || "",
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        tag: payload.reminder_id || "kotoba-reminder",
        renotify: true,
        data: {
          url: payload.url || "./",
          memo_id: payload.memo_id,
          reminder_id: payload.reminder_id
        }
      }
    )
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("navigate" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
