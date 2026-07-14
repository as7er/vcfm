/* VCFM 路 绂荤嚎缂撳瓨锛圙itHub Pages 鍙嬪ソ锛? * JS/CSS/HTML锛氱綉缁滀紭鍏?+ no-store锛岄伩鍏嶆敼浠ｇ爜鍚庝粛鍚冩棫缂撳瓨
 * 鍏跺畠璧勬簮锛氱紦瀛樹紭鍏? */
const CACHE = "vcfm-v58";
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

  // 浠ｇ爜璧勬簮锛氬己鍒惰蛋缃戠粶锛堢粫杩?HTTP 缂撳瓨锛夛紝澶辫触鍐嶉€€鍥?SW 缂撳瓨
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

  // 鍏跺畠锛氱紦瀛樹紭鍏?  event.respondWith(
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

