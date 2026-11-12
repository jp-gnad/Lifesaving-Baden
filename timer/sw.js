const staticCache = "lifesaving-timer-static-firebase-v55";
const baseUrl = new URL("./", self.location.href);
const relativeAppShell = [
  "./",
  "./index.html",
  "./login.html",
  "./styles.css?v=20261102-sticky-header-v3",
  "../assets/js/header.js?v=20261102-header-shadow-v1",
  "./app.js?v=20261112-import-reads-v1",
  "./firestore-api.js?v=20261112-import-reads-v1",
  "./participant-store.js?v=20261112-import-reads-v1",
  "../assets/js/clubs-core.js?v=20261112-clubs-v1",
  "../assets/js/person-link-store.js?v=20261112-clubs-v1",
  "../assets/js/auth-core.js?v=20261105-required-setup-v1",
  "../assets/js/firebase-config.js?v=20261101-settings-v11",
  "../assets/img/elch-gelb.png",
  "./icons.svg?v=event-settings",
  "./app-icon-64.png?v=baden-brand-v1",
  "./app-icon-180.png?v=baden-brand-v1",
  "./app-icon-192.png?v=baden-brand-v1",
  "./app-icon-512.png?v=baden-brand-v1",
  "./manifest.webmanifest?v=baden-brand-v1",
  "../manifest.webmanifest?v=20261105-baden-icon-v2",
  "../assets/img/lifesaving-baden-app-180.png",
  "../assets/img/lifesaving-baden-app-192.png",
  "../assets/img/lifesaving-baden-app-512.png",
];
const appShell = relativeAppShell.map((path) => new URL(path, baseUrl).href);
const authScripts = ["../assets/js/clubs-core.js", "../assets/js/person-link-store.js", "../assets/js/auth-core.js", "../assets/js/login.js", "../assets/js/google-handoff.js", "../assets/js/firebase-config.js"]
  .map((path) => new URL(path, baseUrl).href);

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

  const scriptUrl = new URL(url.href);
  scriptUrl.search = "";
  if (authScripts.includes(scriptUrl.href)) {
    event.respondWith(networkFirst(request, staticCache));
    return;
  }

  if (request.mode === "navigate") {
    const fallback = url.pathname.endsWith("/timer/login.html")
      ? new URL("./login.html", baseUrl).href
      : new URL("./index.html", baseUrl).href;
    event.respondWith(networkFirst(request, staticCache, fallback));
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
