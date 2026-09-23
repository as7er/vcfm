/* VCFM offline cache (GitHub Pages friendly)
 * JS/CSS/HTML: network-first + no-store
 */
// ⚠ 改 js/sim/engine.js 等预缓存资源后必须升这个版本号，否则回访用户会一直用旧引擎。
// v255：中卫线随球前压 + 按防线高度缩放 + 远侧边卫随球前压（e6567a8 / 0692c6a / 2bd9fa5）。
// v263：高光段入场加显式剪辑（修「球员/球/裁判整队瞬移」观感，matchview.js + style.css）。
// v274：角球侧别（事件带 `cornerX`，表现层三条路径统一读它）+ 手机横屏适配 B 方案。
// v275：手机全屏观赛（Android Chrome/Edge 走 `requestFullscreen`，iPhone Safari 不支持
//       ⇒ 按钮隐藏）+ 修「外壳总高比视口多 11px ⇒ 页面永远可滚」的 `--fmm-shell-pad` 口径错。
// v276：全屏入口可发现性（按钮主题色高亮 + 首次进入比赛 toast 一次）。
// v277：切段淡场三处（峰值 0.72→1 并保全遮曲段；reduced-motion 静态全遮；
//       开球 `_segLastEndSimT` 初值 null 不再被 Number() 成 0 而多闪一次）。
// v278：终场体能改为按本场跑动距离占比分摊（`match.js` 的 `drainFitness`）——
//       原先是逐人掷骰子 4~9 点，与跑动无关；球队总量口径不变。
// v279：换边（下半场）**方向/端别大修** —— 进球记给错队（还会被判成乌龙）、
//       两名门将站进球网、越位基本吹不出、前场任意球整队摆到另一端；
//       根因是引擎里一整类「按队名取端」的写法（`team === "home" ? … : …`）。
//       同批还修了：越位线取反、庆祝/入网端别、阶段阵型锚点、赛后 xG 与热区归一化。
// v281：重开直播不再静默重演 —— `openMatch` 按 sessionStorage 记下的进度弹双语提示，
//       并给「直接出战报」作为替代动作；**续播仍未实现**（本轮只做提示，不是功能）。
// v286：段内**整队摆位**（角球/门球/开球）改走「硬置 + 淡场剪辑」，不再用 700 ms 缓动
//       —— 21~22 人一个 0.1 s 帧内搬走 40~76 m，缓动摊成 ~258 m/s 的扫掠（用户报的
//       「球员瞬移到目标站位」）。引擎零改动；规格见 `matchview.js` 的 PLACEMENT_CUT_*。
// v287：界外球从「整场 0 次」恢复到会发生（含高光窗 / 风味 / 文案三处消费者）；
//       赛前加双方**预计首发**预览（手机横屏默认折叠，不挤走必填的赛前讲话）；
//       修「伤退 / 罚下者被画在场上且不动」（直播帧 `compactSimFrame` 缺 `sentOff`
//       ⇒ 离场同步永远拿不到真值）。
const CACHE = "vcfm-v288";
const isVcfmCache = (name) => /^vcfm-v\d+$/.test(name);
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/main.js",
  // 页签渲染层拆到 js/ui/（漏登记会导致离线时该页签白屏）
  "./js/ui/dom.js",
  "./js/ui/finance.js",
  "./js/ui/facilities.js",
  "./js/ui/media.js",
  "./js/ui/manager-workbench.js",
  "./js/manager-onboarding.js",
  "./js/ui/links.js",
  "./js/ui/league-centre.js",
  "./js/engine.js",
  "./js/match.js",
  "./js/match-presentation.js",
  "./js/match-broadcast.js",
  "./js/match-analysis.js",
  "./js/random.js",
  "./js/finance-ledger.js",
  "./js/cash-reservations.js",
  "./js/competition-finance.js",
  "./js/finance-obligations.js",
  "./js/sponsorships.js",
  "./js/league-transition-finance.js",
  "./js/club-debt.js",
  "./js/injuries.js",
  "./js/matchview.js",
  "./js/match-motion-integrity.js",
  "./js/off-ball-movement.js",
  "./js/corner-routines.js",
  // matchview 静态子模块（漏登记会导致离线直播层加载失败）
  "./js/matchview-fsm.js",
  "./js/matchview-coords.js",
  "./js/matchview-intro.js",
  "./js/matchview-director.js",
  "./js/models.js",
  "./js/squad-numbers.js",
  "./js/world-invariants.js",
  "./js/player-positions.js",
  "./js/player-attributes.js",
  "./js/player-roles.js",
  "./js/team-shapes.js",
  "./js/player-habits.js",
  "./js/appearance.js",
  "./js/clubs.js",
  "./js/avatar.js",
  "./js/i18n.js",
  "./js/save.js",
  "./js/save-serialization.js",
  "./js/save-schema.js",
  "./js/player-pathway.js",
  "./js/development-football.js",
  "./js/delegation.js",
  "./js/matchview-replay.js",
  "./js/data.js",
  "./js/discipline.js",
  "./js/career.js",
  "./js/sim/engine.js",
  "./js/player-control.js",
  "./js/collective-defense.js",
  "./js/edge-rules.js",
  "./js/sim/adapt.js",
  "./js/sim/calendar-worker-client.js",
  "./js/sim/calendar-worker.js",
  "./js/sim/match-worker-pool.js",
  "./js/sim/match-worker.js",
  "./js/poaching.js",
  "./js/scoutreport.js",
  "./js/scouting-knowledge.js",
  "./js/contracts.js",
  "./js/loans.js",
  "./js/transfers.js",
  "./js/transfer-negotiations.js",
  "./js/deal-negotiations.js",
  "./js/squad-registration.js",
  "./js/squad-planning.js",
  "./js/inbox.js",
  "./js/relations.js",
  "./js/dressing-room.js",
  "./js/worldpulse.js",
  // 运行时依赖（此前遗漏会导致离线半残）
  "./js/media.js",
  "./js/staff.js",
  "./js/manager-ecosystem.js",
  "./js/manager-jobs.js",
  "./js/intl.js",
  "./js/flags.js",
  "./js/honors.js",
  "./js/cup.js",
  "./js/board.js",
  "./js/training.js",
  "./js/facilities.js",
  "./js/club-finance.js",
  // v153–v154 新增模块（漏登记会导致离线时模块加载失败）
  "./js/squad-balance.js",
  "./js/training-boost.js",
  "./js/matchday-income.js",
  // 存档压缩 / Worker / 品牌（离线半残根因）
  "./js/compress.js",
  "./js/branding.js",
  "./js/club-crest.js",
  "./js/save-worker.js",
  // 球员正式肖像资产池（manifest + 缩略图；大图按需缓存）
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
      .then((cache) =>
        Promise.allSettled(ASSETS.map((asset) => cache.add(asset))).then((results) => {
          const failed = results
            .map((result, index) => (result.status === "rejected" ? ASSETS[index] : null))
            .filter(Boolean);
          if (failed.length) console.warn("VCFM precache failed for:", failed);
        })
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "CLEAR_ALL_CACHES") {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.filter(isVcfmCache).map((k) => caches.delete(k))))
    );
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => isVcfmCache(k) && k !== CACHE).map((k) => caches.delete(k))))
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
