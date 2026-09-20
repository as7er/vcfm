/**
 * 角球侧别 —— **端到端实测**（2026-09-20）
 *
 * 与 `corner-side-consistency-verify.mjs` 的分工：
 *   · 那个是**静态断言**（读源码），保证「代码是这么写的」，防回归。
 *   · 这个是**动态实测**（真跑整场 `js/match.js` 模拟），保证「数据真的是这样」。
 * 两者都要：静态断言防不了「代码对了但数据不对」，动态实测防不了「以后改回随机」。
 *
 * 验什么：
 *   [1] 每场角球事件都带 `cornerX`，且取值 ∈ {2, 98}
 *   [2] 全场汇总的左右分布无偏（各约 50%）
 *   [3] **单场不退化**：不会出现「大量场次整场全同侧」这种掷骰子失效的迹象
 *   [4] 侧别序列随场次变化（不是固定序列）
 *   [5] **非空断言**：必须真的拿到角球。全 0 场 / 全 0 角球一律判失败——
 *       否则「什么都没测到」会被误报成通过（vacuous truth）。
 *
 * 用法：node scripts/corner-side-e2e-probe.mjs [场次=24]
 */

import { CLUB_TEMPLATES } from "../js/data.js";
import { simulateMatchSync } from "../js/match.js";
import { createWorld } from "../js/models.js";

const MATCHES = Number(process.argv[2]) || 24;

// ⚠ 必须用 `createWorld` 造真实 club：手搓的残缺对象缺 `overall`/`power`/`staff`/
//   `finances` 等字段，`createMatchSession` 内部会在读某个字段时抛
//   「Cannot read properties of undefined」。
// ⚠ 起始队也不能随便挑：`createWorld` 会断言 `START_DIVISIONS.includes(user.division)`。
//   照抄 `match-balance-audit.mjs` 的取法（division === 3）。
const startClub = CLUB_TEMPLATES.find((club) => club.division === 3);
if (!startClub) throw new Error("找不到 division===3 的起始队，CLUB_TEMPLATES 结构变了");
const sourceWorld = createWorld(startClub.id, "Corner Side E2E");
const pool = sourceWorld.clubs.slice(0, Math.max(4, MATCHES));

function isolatedWorld(home, away) {
  return {
    userClubId: "corner-observer",
    day: 10,
    season: 2026,
    clubs: [home, away],
    fixtures: [],
    table: Object.fromEntries(
      [home, away].map((club) => [
        club.id,
        { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
      ])
    ),
    news: [],
    media: [],
    inbox: [],
  };
}

const all = [];
let missing = 0;
let illegal = 0;
let errors = 0;

for (let m = 0; m < MATCHES; m++) {
  const home = structuredClone(pool[m % pool.length]);
  const away = structuredClone(pool[(m + 1) % pool.length]);
  if (home.id === away.id) continue;
  const world = isolatedWorld(home, away);
  const fixture = {
    id: `corner-e2e-${m}`,
    home: home.id,
    away: away.id,
    day: 10,
    competition: "league",
    round: m + 1,
    played: false,
  };
  let state = null;
  try {
    state = simulateMatchSync(world, fixture);
  } catch (err) {
    errors++;
    if (errors <= 3) console.log(`⚠ 第 ${m} 场模拟抛错：${err.message}`);
    continue;
  }
  const events = state?.events || [];
  const corners = events.filter((e) => e.type === "corner");
  const sides = corners.map((e) => Number(e.cornerX));
  for (const s of sides) {
    if (!Number.isFinite(s)) missing++;
    else if (s !== 2 && s !== 98) illegal++;
  }
  all.push({ match: m, corners: corners.length, sides });
}

// ─────────────────────────────────────────────────────────────
console.log(`\n跑完 ${all.length}/${MATCHES} 场（抛错 ${errors} 场）\n`);

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

const flat = all.flatMap((r) => r.sides).filter((s) => Number.isFinite(s));
const total = flat.length;
const left = flat.filter((s) => s === 2).length;
const right = flat.filter((s) => s === 98).length;
const withCorners = all.filter((r) => r.corners > 0);

console.log("[0] 非空：真的测到了东西");
check(all.length > 0, `有效场次 > 0`, `实际 ${all.length}`);
check(total > 0, `角球样本 > 0`, `实际 ${total} 个`);

console.log("\n[1] 字段完整性");
console.log(`   角球总数 ${total}，缺侧别 ${missing}，非法侧别 ${illegal}`);
check(missing === 0, "所有角球事件都带 `cornerX`");
check(illegal === 0, "所有 `cornerX` 取值合法（∈ {2, 98}）");

console.log("\n[2] 左右分布（全场汇总）");
const pct = total ? left / total : 0;
console.log(`   左(2) ${left} / 右(98) ${right}  左占比 ${(pct * 100).toFixed(1)}%`);
// 二项分布 p=0.5：3SE = 3 * sqrt(n) / (2n)
const se = total ? Math.sqrt(total) / (2 * total) : 0;
const within = total > 0 && Math.abs(pct - 0.5) <= 3 * se;
check(
  within,
  "分布无偏",
  `左占比 ${(pct * 100).toFixed(1)}%，允差 ±${(3 * se * 100).toFixed(1)}%（3SE）`
);

console.log("\n[3] 单场不退化");
const allSame = withCorners.filter((r) => {
  const s = r.sides.filter(Number.isFinite);
  return s.length >= 3 && (s.every((v) => v === 2) || s.every((v) => v === 98));
});
const degenerate = withCorners.length > 0 && allSame.length > withCorners.length * 0.5;
console.log(`   有角球的场次 ${withCorners.length}，「≥3 球且全同侧」${allSame.length} 场`);
check(!degenerate, "未退化（全同侧场次占比未过半）");

console.log("\n[4] 侧别序列有变化");
const patterns = new Set(withCorners.map((r) => r.sides.filter(Number.isFinite).join(",")));
console.log(`   不同序列 ${patterns.size} 种 / ${withCorners.length} 场`);
check(patterns.size > 1 || withCorners.length <= 1, "不是每场复制粘贴同一序列");

console.log("\n[5] 逐场明细");
for (const r of all) {
  const s = r.sides.map((v) => (v === 2 ? "L" : v === 98 ? "R" : "?")).join("");
  console.log(`   #${String(r.match).padStart(2)}  ${String(r.corners).padStart(2)} 个角球  ${s}`);
}

console.log(
  `\n${failures === 0 ? "✅ 全部通过" : `❌ ${failures} 项失败`}——端到端确认角球侧别来自事件、分布正常。\n`
);
process.exit(failures === 0 ? 0 : 1);
