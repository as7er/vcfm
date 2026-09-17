/**
 * 诊断：近门区（dGoal ≤ 6 单位）为什么以**传球**为主而不是**射门**？
 *
 * 起因（2026-09-17）：`_box-origin-depth-probe.mjs` 量出约 **42%** 的本方禁区触球
 * 发生在门线前 6 单位以内，且分带内以 `pass`（约 36%）为主、`loose` 仅约 7%。
 * 结合「进入的结束方式：射门仅 7.2%」，指向老症状「站在空门前不射」。
 *
 * 判据来自 `_decideOnBall`（`engine.js:2268`）的近门分支（`:2433-2560`）：
 *
 *   inShootZone = dGoal < SHOOT_ZONE && angF > 0.1x
 *   canShoot    = shotCdUntil 已过
 *                 && (clearOpenGoal || !cdBlocked || dGoal < 9.5 || setPieceChance || closeWindow)
 *                 && (clearOpenGoal || attackAge >= 3.5 || dGoal < 9.5)
 *   若 canShoot：
 *     · clearOpenGoal → 掷 openGoalDecisionP（0.72~0.98）
 *     · 否则若 (clearCloseChance || (shootQuality > shootThresh && shootQuality >= passQuality*k))
 *        → 掷 shootDecisionP
 *   takeShot=false 之后：
 *     · clearOpenGoal → 再调整一步（dribble）
 *     · passQuality > 0.3~0.42 → **传球** ←←← 疑似「不射」的出口
 *     · 泄压阀（全队冷却 + 压力>0.55）→ 传中/回做
 *
 * 本探针**不改引擎文件**，而是在运行时包装 `_decideOnBall`：
 *   进入前快照 `t`，调用原方法，然后观察 ball.state 是否变成 "shot"；
 *   对「进入时 dGoal ≤ 6 且本方持球」的每次决策，记录：
 *     · 是否射门（ball.state === "shot" 且 kickTeam 为本方）
 *     · 决策后的球状态与意图类型
 *   并在同一时刻**复算**引擎的那些判据量（只读调用 `_goalOpportunity` /
 *   `_pressureOn` / `_bestPass`），以分解「没射」卡在哪一环。
 *
 * ⚠️ 复算量只用于**归类**，不作为引擎行为的证据；引擎是否射门以
 *    `ball.state === "shot"` 为准（真值）。
 *
 * 全程只读、不消费额外随机数（包装层不调 random）。
 * 用法：node scripts/_close-range-shot-decision-probe.mjs [场数]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function makeClub(name, ability) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, index) => {
    const variance = ((index * 7 + ability) % 5) - 2;
    const rating = Math.max(1, Math.min(20, ability + variance));
    const id = `${name}-p${index}`;
    const attrs = {};
    for (const key of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
      "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling",
      "positioning", "kicking", "decisions", "crossing",
    ]) {
      attrs[key] = rating;
    }
    return { id, name: id, pos, number: index + 1, fitness: 100, attrs };
  });
  return {
    id: name,
    name,
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((player) => player.id),
      pressing: 3,
      tempo: 3,
      defensiveLine: 3,
      style: "balanced",
    },
  };
}

const pct = (num, den) => Number(((num / Math.max(1, den)) * 100).toFixed(1));
const median = (values) => {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return Number((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2));
};

const matchCount = Math.max(1, Number(process.argv[2]) || 18);
const seeds = Array.from({ length: matchCount }, (_, i) => 372000 + i);
const timeStep = SIM.DT;

// 统计容器
const close = {
  decisions: 0,          // 近门区决策次数
  shot: 0,               // 其中真的射门
  openGoalBranch: 0,     // clearOpenGoal 分支命中
  openGoalShot: 0,
  qualityBranch: 0,      // 走了质量门槛分支
  qualityShot: 0,
  passOut: 0,            // 走 2550 的传球出口
  dribbleOut: 0,         // 空门再调整/其他盘带
  pressureValve: 0,      // 泄压阀出球
  blockedByCd: 0,        // 因全队/个人冷却直接不可能射
  blockedByAge: 0,       // 因 attackAge < 3.5 且非近门豁免
  cdGap: [],             // 射门时距个人冷结束的时间
};
const dGoalAtDecision = [];
const passQatDecision = [];
const shootQatDecision = [];
const outKind = new Map(); // 决策后球状态/意图分布
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

for (const seed of seeds) {
  const original = Math.random;
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(
      makeClub(`home-${seed}`, 15),
      makeClub(`away-${seed}`, 15),
      { simulationProfile: "standard", timeStep, separationPasses: 8 }
    );
    const steps = Math.round((90 * 60) / timeStep);

    // —— 包装 _decideOnBall（实例级猴子补丁，只读；不改文件）——
    const proto = Object.getPrototypeOf(engine);
    const originalDecide = proto._decideOnBall;
    let patched = false;
    // 直接在实例上挂一个包装，避免动 prototype
    engine._decideOnBall = function (a) {
      const b = this.ball;
      const wasOwner = b.owner === a.id && b.kickTeam === a.team;
      let dGoal = null;
      let passQ = null;
      let shootQ = null;
      let oppSnapshot = null;
      if (wasOwner) {
        try {
          const opp = this._goalOpportunity(a);
          dGoal = opp.dGoal;
          oppSnapshot = opp;
        } catch {
          dGoal = null;
        }
      }
      const before = b.state;
      const result = originalDecide.call(this, a);
      // —— 观测：近门区（≤6）且本方持球时的决策结果 ——
      if (wasOwner && dGoal !== null && dGoal <= 6) {
        close.decisions++;
        dGoalAtDecision.push(dGoal);
        const firedShot = b.state === "shot" && b.kickTeam === a.team;
        if (firedShot) {
          close.shot++;
          if (oppSnapshot && oppSnapshot.clearOpenGoal) close.openGoalShot++;
          else close.qualityShot++;
        } else {
          // 分类「没射」出口
          if (oppSnapshot && oppSnapshot.clearOpenGoal) {
            close.openGoalBranch++;
            if (a.intent && a.intent.type === "dribble") close.dribbleOut++;
          } else if (b.state === "pass" && b.kickTeam === a.team) {
            close.passOut++;
          } else if (a.intent && a.intent.type === "dribble") {
            close.dribbleOut++;
          }
        }
        bump(outKind, `${before}→${b.state}` + (a.intent ? `/${a.intent.type}` : ""));
      }
      return result;
    };
    void patched;

    for (let step = 0; step < steps; step++) {
      engine.step(timeStep);
    }
  } finally {
    Math.random = original;
  }
}

const per = (v) => Number((v / seeds.length).toFixed(2));
console.log(
  `\n=== 近门区（dGoal ≤ 6）射门决策分解（${seeds.length} 场，种子 ${seeds[0]}..${seeds[seeds.length - 1]}）===`
);
console.log("\n[1] 近门区持球决策总览：");
console.log({
  "决策次数": close.decisions,
  "每场": per(close.decisions),
  "真的射门": `${close.shot} (${pct(close.shot, close.decisions)}%)  ${per(close.shot)}/场`,
  "没射": `${close.decisions - close.shot} (${pct(close.decisions - close.shot, close.decisions)}%)`,
});
console.log("\n[2] 没射时的出口分布：");
console.log({
  "走传球出口 (passQuality>阈值)": `${close.passOut} (${pct(close.passOut, close.decisions)}%)`,
  "空门分支 / 再调整盘带": `${close.openGoalBranch} / ${close.dribbleOut}`,
  "决策后球状态变化 top": "",
});
for (const [k, v] of [...outKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`    ${k}: ${v} (${pct(v, close.decisions)}%)  ${per(v)}/场`);
}
console.log("\n[3] 射门时 dGoal 分布（近门区）：");
console.log({
  n: dGoalAtDecision.length,
  中位: median(dGoalAtDecision),
  "≤3": dGoalAtDecision.filter((d) => d <= 3).length,
  "3~6": dGoalAtDecision.filter((d) => d > 3).length,
});
console.log(
  "\n⚠️ 读法：本探针的「真的射门」以 ball.state === 'shot' 为真值；\n" +
    "   出口分类依赖复算的 opportunity/intent，仅用于**归类**，不作为引擎证据。"
);
