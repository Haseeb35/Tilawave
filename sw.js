// Service worker: makes the site installable and keeps it working offline.
// Bump CACHE when the app shell changes so old files are cleared.
const CACHE = "tilawave-v6";

const SHELL = [
  "./",
  "index.html",
  "quran.html",
  "tasbih.html",
  "calendar.html",
  "hadith.html",
  "duas.html",
  "zakat.html",
  "settings.html",
  "offline.html",
  "404.html",
  "style.css",
  "common.js",
  "app.js",
  "quran.js",
  "tasbih.js",
  "calendar.js",
  "hadith.js",
  "duas.js",
  "zakat.js",
  "settings.js",
  "data/hadith-books.json",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/logo-mark.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
];

// Quran text, tafsir and hadith never change, so serve them from the cache once saved.
const STATIC_DATA_HOSTS = ["api.alquran.cloud", "api.quran.com", "cdn.jsdelivr.net", "raw.githubusercontent.com"];
// Prayer times, places and metal prices: always try for fresh data, fall back to the last copy offline.
const LIVE_DATA_HOSTS = ["api.aladhan.com", "geocoding-api.open-meteo.com", "api.bigdatacloud.net", "latest.currency-api.pages.dev"];
const isLivePrice = (url) => url.pathname.includes("/currency-api");
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // Pages with query strings (quran.html?surah=2) fall back to the cached page.
    const page = networkFirst(request, { ignoreSearch: true });
    // A page never saved, opened offline: show the offline page instead of the browser's error
    event.respondWith(request.mode === "navigate"
      ? page.catch(() => caches.match("offline.html"))
      : page);
  } else if (LIVE_DATA_HOSTS.includes(url.hostname) || isLivePrice(url)) {
    event.respondWith(networkFirst(request));
  } else if (STATIC_DATA_HOSTS.includes(url.hostname) && !url.pathname.includes("/search/")) {
    event.respondWith(cacheFirst(request));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
  // Everything else (e.g. recitation audio) goes straight to the network.
});

async function networkFirst(request, matchOptions) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, matchOptions);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}
