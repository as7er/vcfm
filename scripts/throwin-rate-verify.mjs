/**
 * 界外球（throw-in）—— 回归检查（2026-09-22，v287）。
 *
 * 用户原话：「观看比赛中就没见过边线球的出现，是平淡过渡了还是设计里就没有？」
 * 查证结论（`docs/measurements/restart-placement-root-cause-2026-09-22.txt` §5②）：
 *   引擎里界外球**代码齐全**（`_resolveBounds` 有 `b.x <= 0 || b.x >= 100`
 *   ⇒ `_restart("throwin", …)`，摆位/事件/越位豁免也都写了），但实测
 *   **17 场 × 90 分钟 = 0 次** —— 那条判定**不可达**。
 *   根因是 2026-09 的一次「过度矫正」：旧实现门将大脚瞄 x=22/78、力量 30~44，
 *   落地仍带 ~20 速度 ⇒ **经常**滚出边线（用户当时能看见「门将开大脚出界」，
 *   见 `_gkDistribute` 头注释），于是被夹进 `x∈[30,70]` 并压低残速 ⇒ 从「经常」变「从不」。
 *   v287 恢复**一小部分**「被迫 / 失准」的解围：大脚有 5.5%（受压 11%）斜向飞出边线。
 *
 * 本检查守：
 *   ① **真的会发生**：真实路径多场实测，每场界外球 ≥ 0.4 次
 *      —— 对「整场 0 次」那个回归的直接护栏。
 *   ② **不过量**：每场 ≤ 15 次（拦「有人把出界概率拧爆」）。
 *   ③ **规则正确**（Law 15）：界外球判给**最后触球方的对手**。
 *   ④ **摆位正确**：球摆在边线上（x=1 或 99）、y ∈ [8, 92]。
 *   ⑤ **可复现**：同种子双跑指纹逐位相同。
 *
 * ⚠ **两个必须遵守的探针纪律**（本脚本第一版两条都违反了，读数因此不可信）：
 *   ① 引擎**不认 `opts.seed`**，必须传 `opts.random`。
 *   ② 必须走**产品路径**（`createMatchSession` + `ensureSimEngine`）。
 *      只 `new SimEngine(home, away)` 会跳过 AI 战术调整与阵容收敛，
 *      实测界外球率差一个量级（0.25/场 vs 2.5/场）—— 那是探针产物。
 *   ③ `createWorld` 不接种子，且带**不受 `Math.random` 替换影响的熵**：
 *      每轮各自 `createWorld` ⇒ 两轮是两批不同的比赛（实测每轮 11~12/34 组对阵不同）。
 *      ⇒ 世界只建一次并冻结，逐场/逐轮都用它的深拷贝。
 *
 * ⚠ 已知限制（不是本检查能覆盖的）：本引擎的界外球总数仍**低于现实一个量级**
 *   （实测 ≈2.5/场 vs 现实 ≈45/场；角球 ≈4.7/场 vs 现实 ≈10/场）。
 *   要补到现实水平需要让「传丢的球 / 被压迫的解围」按现实比例出界，
 *   那属于**传球与出球模型**的改动（会牵动 `passCompletionPct` 等标定），需单独立项。
 *
 * 用法：node scripts/throwin-rate-verify.mjs [场数=4]   （约 40~70 秒）
 */
import { readFileSync } from "node:fs";

import { CLUB_TEMPLATES } from "../js/data.js";
import { createMatchSession } from "../js/match.js";
import { createWorld } from "../js/models.js";
import { ensureSimEngine, resyncSimAfterHalfTime, runSimPeriodRaw } from "../js/sim/adapt.js";
import { ensureWorldStaff } from "../js/staff.js";

const MATCHES = Math.max(2, Number(process.argv[2]) || 4);
/** 每场下限 / 上限（见文件头 ①②） */
const MIN_PER_MATCH = 0.4;
const MAX_PER_MATCH = 15;

let failed = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failed += 1;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 跑满一场（H1 + 换边 + H2）—— 走产品路径，返回该场的界外球审计结果 */
function runMatch(baseWorld, fixtureId, seed) {
  const world = structuredClone(baseWorld);
  const fixture = world.fixtures.find((f) => f.id === fixtureId);
  const state = createMatchSession(world, fixture);
  const eng = ensureSimEngine(state);
  eng.random = mulberry32(seed); // 引擎不认 opts.seed ⇒ 只能替换随机源

  const marks = [];
  const watch = (phase) => marks.push({ phase, before: eng.events.length });

  watch("H1");
  runSimPeriodRaw(eng, 1, 45, { record: false });
  // 下半场换边：与 `js/match.js:1510` 的 `applyHalfTimeSwap` 同序（换边 → 重同步 → 开球）
  eng.endsSwapped = true;
  resyncSimAfterHalfTime(state);
  eng._kickoff("away");
  watch("H2");
  runSimPeriodRaw(eng, 46, 90, { record: false });

  const rows = [];
  for (let i = 0; i < eng.events.length; i += 1) {
    const e = eng.events[i];
    if (e.type !== "throwin") continue;
    rows.push({
      phase: marks.filter((m) => m.before <= i).pop()?.phase || "?",
      t: e.t,
      /** 获得界外球的一方（Law 15 的被判给方） */
      team: e.team,
      x: e.x,
      y: e.y,
      setPiece: e.setPiece || null,
      /** 最后触球方 —— Law 15 下应等于 `team` 的对手 */
      lastKickTeam: e.kickTeam || null,
    });
  }
  return { rows };
}

// ————————————————————————————————————————————————————————————
console.log("=== 界外球回归检查 ===\n");
const WORLD_SEED = 0x5f3a71c9;
const originalRandom = Math.random;

/** 世界只建一次（见文件头纪律 ③） */
function snapshotWorld() {
  Math.random = mulberry32(WORLD_SEED);
  try {
    const startClub = CLUB_TEMPLATES.find((c) => c.division === 3);
    const world = createWorld(startClub.id, "Throw-in Rate Verify");
    ensureWorldStaff(world);
    return world;
  } finally {
    Math.random = originalRandom;
  }
}
const BASE_WORLD = snapshotWorld();
const FIXTURES = BASE_WORLD.fixtures
  .filter((f) => f.home === BASE_WORLD.userClubId || f.away === BASE_WORLD.userClubId)
  .slice(0, MATCHES);

const measure = () =>
  FIXTURES.map((fx, i) => ({ fixtureId: fx.id, ...runMatch(BASE_WORLD, fx.id, 0x9000 + i * 7919) }));

const pass1 = measure();
const pass2 = measure();
const fp = (runs) =>
  runs
    .map((r) => `${r.fixtureId}:${r.rows.length}:${r.rows.map((x) => x.t.toFixed(1)).join(",")}`)
    .join("|");
check(fp(pass1) === fp(pass2), "双跑指纹逐位相同（可复现）", `${pass1.length} 场`);

const total = pass1.reduce((n, r) => n + r.rows.length, 0);
const perMatch = total / pass1.length;
console.log(
  `  ${pass1.length} 场（H1+H2 各 90 分钟）：界外球共 ${total} 次 ⇒ **${perMatch.toFixed(2)} 次/场**`
);
for (const r of pass1) {
  console.log(
    `    ${r.fixtureId}  ${r.rows.length} 次` +
      (r.rows.length ? `（${r.rows.map((x) => `${x.phase}@${x.t.toFixed(0)}s`).join(" ")}）` : "")
  );
}

check(perMatch >= MIN_PER_MATCH, `每场界外球 ≥ ${MIN_PER_MATCH}（对「整场 0 次」的回归护栏）`,
  `${perMatch.toFixed(2)}/场`);
check(perMatch <= MAX_PER_MATCH, `每场界外球 ≤ ${MAX_PER_MATCH}（拦截「把出界概率拧爆」）`,
  `${perMatch.toFixed(2)}/场`);

// —— 规则与摆位不变量 ——
const all = pass1.flatMap((r) => r.rows);
/** 违例时打印前 3 条；无违例时打印样本量（避免「n/a」这种看不出规模的输出） */
const detail = (rows) => (rows.length ? JSON.stringify(rows.slice(0, 3)) : `n=${all.length}，无违例`);

check(all.length > 0, "至少出现一次界外球（否则后面几条不变量都是空集）", `n=${all.length}`);
const badSide = all.filter((r) => r.x !== 1 && r.x !== 99);
check(badSide.length === 0, "球摆在边线上（x=1 或 99）", detail(badSide));
const badY = all.filter((r) => !(r.y >= 8 - 1e-9 && r.y <= 92 + 1e-9));
check(badY.length === 0, "y ∈ [8, 92]（摆位落在合法边线段内）", detail(badY));
const badPiece = all.filter((r) => r.setPiece !== "throwin");
check(badPiece.length === 0, "事件携带 setPiece=\"throwin\"（消费者据此识别）", detail(badPiece));
// Law 15：界外球判给最后触球方的**对手**
const wrongAward = all.filter((r) => r.lastKickTeam && r.lastKickTeam === r.team);
check(wrongAward.length === 0, "Law 15：界外球判给最后触球方的对手", detail(wrongAward));

// —— 表现层接力（静态）：`_restart` 是**所有**重启类型的统一路径，
//    它写 `b.restartType = type` ⇒ 画面层据此武装「整队摆位走剪辑」（v286）。
const src = readFileSync(new URL("../js/sim/engine.js", import.meta.url), "utf8");
check(/b\.restartType = type;/.test(src),
  "重启路径统一写 `b.restartType = type`（表现层据此识别死球）");
check(/_resolveBounds/.test(src) && /"throwin"/.test(src),
  "边线判定仍在（`_resolveBounds` → `_restart(\"throwin\")`）");

// ————————————————————————————————————————————————————————————
console.log(
  `\n${failed === 0 ? "throwin-rate-verify: ok" : `throwin-rate-verify: FAILED (${failed})`}`
);
process.exitCode = failed === 0 ? 0 : 1;
