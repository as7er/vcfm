/* VCFM · 离线缓存（GitHub Pages 友好）
 * JS/CSS/HTML：网络优先，避免改代码后仍吃旧缓存
 * 其它资源：缓存优先
 */
const CACHE = "vcfm-v48";
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

  // 代码资源：先网络，失败再缓存（改队服/头像能立刻生效）
  if (isCodeAsset(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 其它：缓存优先
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
