const staticCache = "lifesaving-timer-static-firebase-v4";
const baseUrl = new URL("./", self.location.href);
const relativeAppShell = [
  "./",
  "./index.html",
  "./styles.css?v=firebase-access-v4",
  "./app.js?v=firebase-access-v4",
  "./firestore-api.js?v=firebase-access-v4",
  "../assets/js/firebase-config.js?v=timer-firebase-v1",
  "./icons.svg?v=event-settings",
  "./app-icon-64.png",
  "./app-icon-180.png",
  "./app-icon-192.png",
  "./app-icon-512.png",
  "./manifest.webmanifest",
];
const appShell = relativeAppShell.map((path) => new URL(path, baseUrl).href);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(staticCache).then((cache) => cache.addAll(appShell)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("lifesaving-timer-") && key !== staticCache)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName, fallbackRequest = request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(fallbackRequest);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, staticCache, new URL("./index.html", baseUrl).href));
    return;
  }

  const withoutSearch = new URL(url.href);
  withoutSearch.search = "";
  if (appShell.includes(url.href) || appShell.some((entry) => {
    const cached = new URL(entry);
    cached.search = "";
    return cached.href === withoutSearch.href;
  })) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then(async (response) => {
        if (response.ok) await (await caches.open(staticCache)).put(request, response.clone());
        return response;
      })),
    );
  }
});
