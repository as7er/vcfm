/**
 * 评分榜口径审计（2026-09-19）。
 *
 * 用户报告：「球员评分榜里，只出场次数不多的高平均评分的竟然也可以上榜排在前列」。
 *
 * 本审计做两件事：
 *   1. **锁死门槛**：断言联赛榜 ≥10 场、赛事榜 ≥4 场，且界面文案与之逐字一致
 *      （文案与逻辑不一致是这类 bug 最常见的复发形态）；
 *   2. **复现问题本身**：用评分公式的**真实口径**（`match.js` 的
 *      `applyMatchRatings`：基础 6.4 + 进球×0.95 + 助攻×0.55 + 噪声±0.225，
 *      单场封顶 9.6）做蒙特卡洛，断言：
 *        · 门槛 3 时，前 20 名里确实混入大量低出场球员（**复现用户现象**）；
 *        · 门槛 10 时，这些低出场球员被挡住（**修复确实有效**）。
 *      第 2 项是**反假通过**保障：若哪天有人把门槛改回去，或评分公式变了
 *      导致蒙特卡洛不再复现，这条会失败。
 *
 * 用法: node scripts/ratings-leaderboard-audit.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

const engineSource = read("js/engine.js");
const cupSource = read("js/cup.js");
const i18nSource = read("js/i18n.js");
const htmlSource = read("index.html");
const leagueCentreSource = read("js/ui/league-centre.js");

// ———————————————— 1. 门槛与文案必须一致 ————————————————
const LEAGUE_MIN_APPS = 10;
const COMPETITION_MIN_APPS = 4;

assert.ok(
  engineSource.includes(`x.apps >= ${LEAGUE_MIN_APPS}`),
  `the league ratings board must require at least ${LEAGUE_MIN_APPS} appearances`
);
assert.ok(
  cupSource.includes(`entry.stats.apps >= ${COMPETITION_MIN_APPS}`),
  `the competition ratings board must require at least ${COMPETITION_MIN_APPS} appearances`
);

// 文案：中英 + HTML 默认文本 + 空榜提示，四处都要对齐。
// ⚠ 只改逻辑不改文案 = 用户看到「至少 3 场」却一个 3 场的人都没有，比不改更糟。
for (const [what, text] of [
  ["zh i18n hint", `"stats.ratingsHint": "至少 ${LEAGUE_MIN_APPS} 场出场 · 场均评分"`],
  ["en i18n hint", `"stats.ratingsHint": "Min ${LEAGUE_MIN_APPS} apps · average rating"`],
  ["zh competition hint", `"clubIntl.ratingsHint": "至少 ${COMPETITION_MIN_APPS} 场出场 · 本赛事场均评分"`],
  ["en competition hint", `"clubIntl.ratingsHint": "Min ${COMPETITION_MIN_APPS} apps · competition average rating"`],
]) {
  assert.ok(i18nSource.includes(text), `${what} must state the new threshold (${text})`);
}
assert.ok(
  htmlSource.includes(`data-i18n="stats.ratingsHint">至少 ${LEAGUE_MIN_APPS} 场出场`),
  "the static HTML hint must match the i18n string (it is rendered before i18n applies)"
);
assert.ok(
  htmlSource.includes(`data-i18n="clubIntl.ratingsHint">至少 ${COMPETITION_MIN_APPS} 场出场`),
  "the static competition hint must match the i18n string"
);
assert.ok(
  leagueCentreSource.includes(`至少 ${LEAGUE_MIN_APPS} 场出场后显示评分榜`),
  "the empty-board message must state the new threshold"
);

// ———————————————— 2. 用真实评分口径复现并验证修复 ————————————————
// 参数与 `js/match.js` 的 `applyMatchRatings` 同值：
//   BASE 6.4、每球 0.95、每助攻 0.55、单场封顶 9.6、噪声幅 0.45（±0.225）。
const BASE = 6.4;
const PER_GOAL = 0.95;
const PER_ASSIST = 0.55;
const CAP_MATCH = 9.6;
const NOISE = 0.45;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260919);

function singleRating(goalRate, assistRate) {
  const goals = rnd() < goalRate ? (rnd() < 0.18 ? 2 : 1) : 0;
  const assists = rnd() < assistRate ? 1 : 0;
  let r = BASE + goals * PER_GOAL + assists * PER_ASSIST;
  r = Math.min(r, CAP_MATCH);
  r += (rnd() - 0.5) * NOISE;
  return Math.max(3.0, Math.min(10.0, Math.round(r * 10) / 10));
}
function seasonAvg(goalRate, assistRate, apps) {
  let sum = 0;
  for (let i = 0; i < apps; i++) sum += singleRating(goalRate, assistRate);
  return sum / apps;
}

// 一个联赛的样本池：18 队 × 3 角色 × 4 个出场档（含低出场的轮换/替补）。
const ROLES = [
  { goal: 0.45, assist: 0.2 }, // FWD
  { goal: 0.15, assist: 0.28 }, // MID
  { goal: 0.04, assist: 0.06 }, // DEF
];
const APPS_POOL = [3, 3, 5, 8, 10, 12, 15, 20, 24, 28, 30, 34];
const SIM = 400;

/** 跑一次榜单模拟，返回前 20 名中「出场 ≤5 场」的平均人数。 */
function lowAppsInTop20(minApps) {
  let total = 0;
  for (let s = 0; s < SIM; s++) {
    const pool = [];
    for (let c = 0; c < 18; c++) {
      for (const role of ROLES) {
        for (const offset of [0, 3, 6, 9]) {
          const apps = APPS_POOL[(c + offset) % APPS_POOL.length];
          pool.push({ apps, avg: seasonAvg(role.goal, role.assist, apps) });
        }
      }
    }
    const elig = pool.filter((x) => x.apps >= minApps);
    elig.sort((a, b) => b.avg - a.avg);
    total += elig.slice(0, 20).filter((x) => x.apps <= 5).length;
  }
  return total / SIM;
}

const atOldThreshold = lowAppsInTop20(3);
const atNewThreshold = lowAppsInTop20(LEAGUE_MIN_APPS);

// 旧门槛下必须**确实**存在问题（否则本审计的前提不成立，用户报的是幻觉）。
assert.ok(
  atOldThreshold > 5,
  `the old threshold (3) must reproduce the reported problem: expected >5 low-appearance ` +
  `players in the top 20, measured ${atOldThreshold.toFixed(2)}`
);
// 新门槛下必须**确实**解决（前 20 名里不再有 ≤5 场的人）。
assert.equal(
  atNewThreshold,
  0,
  `the new threshold (${LEAGUE_MIN_APPS}) must exclude all low-appearance players from the top 20, ` +
  `measured ${atNewThreshold.toFixed(2)}`
);

console.log("Ratings leaderboard audit passed");
console.log(
  `  league threshold ${LEAGUE_MIN_APPS} apps / competition threshold ${COMPETITION_MIN_APPS} apps`
);
console.log(
  `  top-20 low-appearance players: ${atOldThreshold.toFixed(2)} at the old threshold (3) ` +
  `→ ${atNewThreshold.toFixed(2)} at ${LEAGUE_MIN_APPS}`
);
