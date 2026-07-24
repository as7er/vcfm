/* VCFM offline cache (GitHub Pages friendly)
 * JS/CSS/HTML: network-first + no-store
 */
const CACHE = "vcfm-v123";
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
  "./js/avatar-assets.js",
  "./js/i18n.js",
  "./js/save.js",
  "./js/data.js",
  "./js/discipline.js",
  "./js/career.js",
  "./js/sim/engine.js",
  "./js/sim/adapt.js",
  "./js/poaching.js",
  "./js/scoutreport.js",
  "./js/contracts.js",
  "./js/loans.js",
  "./js/transfers.js",
  "./js/inbox.js",
  "./js/relations.js",
  "./js/worldpulse.js",
  // 运行时依赖（此前遗漏会导致离线半残）
  "./js/media.js",
  "./js/staff.js",
  "./js/intl.js",
  "./js/honors.js",
  "./js/cup.js",
  "./js/board.js",
  "./js/training.js",
  "./js/facilities.js",
  // 存档压缩 / Worker / 品牌（离线半残根因）
  "./js/compress.js",
  "./js/branding.js",
  "./js/save-worker.js",
  // 球员正式肖像资产池（manifest + 缩略图；大图按需缓存）
  "./assets/player-avatars/manifest.json",
  "./assets/player-avatars/thumbnails/avatar-0001.webp",
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
