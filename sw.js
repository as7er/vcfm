/* VCFM offline cache (GitHub Pages friendly)
 * JS/CSS/HTML: network-first + no-store
 */
const CACHE = "vcfm-v59";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/main.js",
  "./js/engine.js",
  "./js/match.js",
  "./js/matchview.js",
  "./js/models.js",
  "./js/clubs.js",
  "./js/avatar.js",
  "./js/i18n.js",
  "./js/save.js",
  "./js/data.js",
  "./js/discipline.js",
  "./js/career.js",
  "./js/poaching.js",
  "./js/scoutreport.js",
  "./js/contracts.js",
  "./js/loans.js",
  "./js/transfers.js",
  "./js/inbox.js",
  "./js/relations.js",
  "./js/worldpulse.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

const isCodeAsset = (url) => {
  const p = url.pathname;
  return (
    p.endsWith(".js") ||
    p.endsWith(".css") ||
    p.endsWith(".html") ||
    p.endsWith("/") ||
    p.endsWith("/index.html")
  );
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "CLEAR_ALL_CACHES") {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isCodeAsset(url)) {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match(url.pathname)))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
