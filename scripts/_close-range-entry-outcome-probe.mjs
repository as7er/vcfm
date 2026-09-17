/**
 * 诊断：球进入「门前极近区」（dGoal ≤ 6 场地单位 ≈ 6.3 m）之后，发生了什么？
 *
 * 起因（2026-09-17）：射门距离分布（`_shot-distance-probe`）显示
 *   <6 单位仅 **2.4%（0.56 脚/场）**、中位射门距离 **13.3 单位**、
 *   **86% 的射门来自 9.5 单位以外**。
 * ⇒ 「站在空门前不射」这个假设**被否**：不是近门犹豫，而是**几乎不存在近门射门**。
 *
 * 于是换一个问法：**球到了 ≤6 之后去了哪？** 本探针逐帧追踪：
 *   1. 球首次进入 dGoal ≤ 6（进攻方控球/球在该区）的每一次「进入」；
 *   2. 随后 TRACK_WINDOW 秒内的结局：射门 / 传球出区 / 被防守方夺回 /
 *      被解围 / 出底线 / 死球 / 仍在区内；
 *   3. 进入时谁持球（角色）、是否有人处于射门冷却、当时 dGoal。
 *
 * ⚠️ 与 `_close-range-shot-decision-probe.mjs` 的口径区别（**这是关键**）：
 *   那个探针用运行时猴补丁包 `_decideOnBall`，只统计「球员持球且走到射门分支」
 *   的决策（2.17 次/场）；本探针用**球的位置**做真值，统计「球进入该区」的事件
 *   （含接球瞬间、解围、抢点等一切情形）。两者人群不同，**不可互相印证**。
 *
 * 全程只读引擎公开状态（`engine.ball` / `engine.agents` / `engine.events`），
 * 不包装任何方法、不消费随机数、不改引擎文件。
 * 用法：node scripts/_close-range-entry-outcome-probe.mjs [场数]
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
const TRACK_WINDOW = 6; // 秒：进入后追踪这么久
const ZONE = 6;         // 门前极近区半径（场地单位）

const stats = {
  entries: 0,           // 球进入 ≤6 的次数
  byTeam: new Map(),    // 哪一方「拥有」这次进入
  outcomes: new Map(),  // 结局分布
  dwell: [],            // 在区内停留时长（秒）
  entrySpeed: [],       // 进入时球速（场地单位/秒）
  whoHolds: new Map(),  // 进入时球的状态/持球人角色
  shotInZone: 0,        // 区内发生的射门
  entryDist: [],
};
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
    const goalY = { home: 0, away: 100 }; // home 攻 y=0 端

    let inside = false;
    let entry = null;
    let lastX = engine.ball.x;
    let lastY = engine.ball.y;
    let lastT = 0;

    // ⚠️ 进攻方的判定**不能**用「球离哪个门近」——球在本方门前时离本方门最近，
    // 那恰恰是**防守方**。正确做法：用球**朝哪个门移动**（最近的位移方向）。
    // 若球几乎静止，则退回用「持球方」或 kickTeam 判定。
    const attackerAt = (b, dx, dy, dt) => {
      const speed = Math.hypot(dx, dy) / Math.max(1e-6, dt);
      if (speed > 1.5) {
        // 朝 y=0 移动 → home 在进攻；朝 y=100 移动 → away 在进攻
        const toward = dy < 0 ? "home" : "away";
        return { team: toward, basis: "运动方向" };
      }
      if (b.kickTeam) return { team: b.kickTeam, basis: "kickTeam" };
      if (b.owner) {
        const ag = engine.agentById(b.owner);
        if (ag) return { team: ag.team, basis: "持球方" };
      }
      return { team: null, basis: "未知" };
    };

    for (let step = 0; step < steps; step++) {
      engine.step(timeStep);
      const b = engine.ball;
      const t = engine.t;
      if (b.state === "dead") continue;

      const dx = b.x - lastX;
      const dy = b.y - lastY;
      const dt = Math.max(1e-6, t - lastT);
      lastX = b.x;
      lastY = b.y;
      lastT = t;

      const att = attackerAt(b, dx, dy, dt);
      // 门前极近区：以「进攻方打的那个门」为参照
      const targetY = att.team ? goalY[att.team] : null;
      const dGoalHere =
        targetY === null ? Infinity : Math.hypot(b.x - 50, b.y - targetY);
      const nowInside = dGoalHere <= ZONE;

      if (nowInside && !inside && att.team) {
        inside = true;
        const who = b.owner ? engine.agentById(b.owner) : null;
        stats.entries++;
        bump(stats.byTeam, `${att.team}（${att.basis}）`);
        stats.entrySpeed.push(Math.hypot(dx, dy) / dt);
        stats.entryDist.push(dGoalHere);
        bump(
          stats.whoHolds,
          who
            ? `${who.team}/${who.role}持球`
            : `无主/${b.state}${b.kickTeam ? `(kick=${b.kickTeam})` : ""}`
        );
        entry = { at: t, team: att.team, dwell: 0, settled: false };
      } else if (!nowInside && inside) {
        inside = false;
      }

      if (entry && !entry.settled) {
        entry.dwell = t - entry.at;
        if (t - entry.at >= TRACK_WINDOW) {
          entry.settled = true;
        }
      }

      if (entry && entry.settled) {
        // ⚠️ 只在这里、且只记一次 dwell（修掉上一版双处结算的重复计入）
        stats.dwell.push(entry.dwell);
        const evs = (engine.events || []).filter(
          (e) => e.t >= entry.at && e.t <= entry.at + TRACK_WINDOW
        );
        const shot = evs.find((e) => e.type === "shot" && e.team === entry.team);
        const save = evs.find((e) => e.type === "save");
        const block = evs.find((e) => e.type === "block");
        const tackle = evs.find((e) => e.type === "tackle");
        const pass = evs.find((e) => e.type === "pass" && e.team === entry.team);
        let outcome;
        if (shot) outcome = "射门";
        else if (save) outcome = "门将扑救";
        else if (block) outcome = "被封堵";
        else if (tackle) outcome = "被抢断";
        else if (pass) outcome = "传球离开";
        else outcome = "无明显动作（球停在区内/乱球）";
        bump(stats.outcomes, outcome);
        if (shot) stats.shotInZone++;
        entry = null;
      }
    }
  } finally {
    Math.random = original;
  }
}

const per = (v) => Number((v / seeds.length).toFixed(2));
console.log(
  `\n=== 球进入门前极近区（dGoal ≤ ${ZONE} 单位 ≈ ${(ZONE * 1.05).toFixed(1)} m）后的结局` +
    `（${seeds.length} 场，种子 ${seeds[0]}..${seeds[seeds.length - 1]}）===`
);
console.log("\n[1] 进入次数：");
console.log({
  总进入: stats.entries,
  每场: per(stats.entries),
  进入时离门中位: median(stats.entryDist),
});
console.log("\n[2] 谁在进攻这一端（按球离哪个门近判定）：");
for (const [k, v] of [...stats.byTeam.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v} (${pct(v, stats.entries)}%)`);
}
console.log("\n[3] 进入时谁持球：");
for (const [k, v] of [...stats.whoHolds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${k}: ${v} (${pct(v, stats.entries)}%)`);
}
console.log("\n[4] ★ 结局分布（进入后 6 秒内）：");
for (const [k, v] of [...stats.outcomes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v} (${pct(v, stats.entries)}%)  ${per(v)}/场`);
}
console.log("\n[5] 区内停留时长（秒）：");
console.log({
  中位: median(stats.dwell),
  n: stats.dwell.length,
  超1秒: stats.dwell.filter((d) => d > 1).length,
  超3秒: stats.dwell.filter((d) => d > 3).length,
});
console.log("\n[6] 区内射门：");
console.log({
  "区内射门次数": stats.shotInZone,
  占进入: `${pct(stats.shotInZone, stats.entries)}%`,
  每场: per(stats.shotInZone),
});
