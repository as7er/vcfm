/**
 * 诊断：防守方在本方禁区附近触球后，球去了哪？（拦截 = 解围 / 封堵 / 门将托救 / 失控）
 *
 * 起因（2026-09-17）：`_box-entry-rate-probe.mjs` 18 场重测发现
 * 「防守方解围/回传滚入」这一进入机制由留档七的 9.3 次/场涨到 **33.6 次/场（3.6 倍）**，
 * 成为三大进入来源之一。该分类的判定是 `b.state === "pass" && b.kickTeam !== 进攻方`
 * ——即**防守方踢出的球又进了自家禁区**。
 *
 * ⚠️ 口径更正（2026-09-17 自查）：本脚本第一版把这些一律叫「解围」，**是错的**。
 * 读引擎后发现，从本方禁区起脚并置 `kickTeam = 防守方` 的路径主要是**防守性触球**：
 *   - 封堵（`_blockShotAt`，`engine.js` 约 5862）：`b.vy = bylineDir * (9..15)` —— 朝**自家底线**
 *   - 门将托救（`_thinkGK`，约 5797）：`b.vy = bylineDir * (10..16)` —— 同样朝自家底线
 *   - 门将扑救脱手（约 5610）：`b.vx = ±(8..14)`，朝边路
 *   - 失控（`_miscontrolBall`，约 1251）：4~9 m/s 的随机方向磕开
 * 而**普通传球**被 `if (d < 6 || d > 45) continue` 截断在 45 单位内，
 * 实测本方禁区内的传球**中位只有 14.18、没有一次超过 45**
 * （`_box-clearance-distpen-probe.mjs`）——所以这里量到的长距离位移不是传球。
 * ⇒ 正确读法：本脚本量的是**「防守方在自家禁区触球后，球被送到多远」**，
 * 而不是「解围质量」。落点近 = 防守性触球把球留在了危险区。
 *
 * 本脚本只量三件事，不做任何改动建议：
 *   1. 本方禁区内防守方触球后，球的落点相对本方禁区的分布、离本方球门多远。
 *   2. 落点纵向分区（本方禁区 / 本方半场深处 / 中场 / 对方半场）。
 *   3. 触球后 N 秒内球是否又回到本方禁区，以及耗时。
 *
 * 全程只读引擎公开状态，不消费随机数。种子与口径同 `_box-entry-rate-probe.mjs`：
 * 起点 372000、能力 15、标准档、`_inOwnFoulBox` 判禁区。
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

const median = (values) => {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return Number((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2));
};
const pct = (num, den) => Number(((num / Math.max(1, den)) * 100).toFixed(1));
const quantile = (values, q) => {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  return Number(s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(2));
};

const matchCount = Math.max(1, Number(process.argv[2]) || 6);
const seeds = Array.from({ length: matchCount }, (_, i) => 372000 + i);
const timeStep = SIM.DT;

let kicks = 0;                 // 从自家禁区附近起脚的触球次数
let landedOutside = 0;         // 落点在本方禁区外
let landedInside = 0;          // 落点仍在本方禁区内
const landingGoalDist = [];    // 落点离本方球门距离（场地单位）
const landingZone = new Map();
const returnDelays = [];       // 清球后球又回到本方禁区的耗时（秒）
let returned = 0;
const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

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

    // 追踪中的清球：起脚后等球落地/被接管，看落点。
    let pending = null; // { team, x, y, at, restarts }
    let lastKickTeam = null;
    let lastKickPos = null;
    // 回流追踪：清球成功后，若球在 RETURN_WINDOW 秒内又进本方禁区，记一次回流。
    let watch = null; // { team, at }

    const RETURN_WINDOW = 6;

    for (let step = 0; step < steps; step++) {
      const prevOwner = engine.ball.owner;
      const prevState = engine.ball.state;
      engine.step(timeStep);
      const b = engine.ball;
      const owner = b.owner ? engine.agentById(b.owner) : null;
      const t = engine.t;

      // —— 检测一次新的起脚 ——
      // 传球/清球：state=pass 且 owner 为空、有 kickTeam。
      const kicked =
        b.state === "pass" &&
        b.kickTeam &&
        Number.isFinite(b.kickX) &&
        b.kickY !== undefined &&
        (prevState !== "pass" || prevOwner);

      if (kicked) {
        const kickerTeam = b.kickTeam;
        const fromOwnBox = engine._inOwnFoulBox(kickerTeam, b.kickX, b.kickY);
        if (fromOwnBox) {
          // 起脚点在本方禁区内 → 记为一次清球候选，等落点
          pending = { team: kickerTeam, x: b.kickX, y: b.kickY, at: t };
        } else if (pending && pending.team === kickerTeam) {
          // 同一方在落点前又碰了一次，作废（不是干净的清球）
          pending = null;
        }
      }

      // —— 结算清球落点：球落地或易主 ——
      if (pending && (b.state !== "pass" || (owner && owner.team !== pending.team))) {
        kicks++;
        const stillInOwnBox = engine._inOwnFoulBox(pending.team, b.x, b.y);
        if (stillInOwnBox) landedInside++;
        else landedOutside++;
        // 本方球门位置：team 防守的那一端。约定 home 守 y 高、away 守 y 低。
        const goalY = pending.team === "home" ? 100 : 0;
        landingGoalDist.push(Math.hypot(b.x - 50, b.y - goalY) * 1.0);
        // 纵向分区（场地单位，100 长）：本方半场 = 靠近自家球门一侧
        const towardOwnGoal = pending.team === "home" ? b.y : 100 - b.y;
        if (stillInOwnBox) bump(landingZone, "本方禁区内");
        else if (towardOwnGoal > 62) bump(landingZone, "本方半场深处(禁区外)");
        else if (towardOwnGoal > 45) bump(landingZone, "本方半场中段");
        else bump(landingZone, "已过中线");
        // 开始回流观察
        watch = { team: pending.team, at: t, fired: false };
        pending = null;
      }

      // —— 回流观察：球是否在窗口内重新进入同一方的禁区 ——
      if (watch && !watch.fired) {
        if (t - watch.at > RETURN_WINDOW) {
          watch = null;
        } else if (engine._inOwnFoulBox(watch.team, b.x, b.y) && b.state !== "dead") {
          watch.fired = true;
          returned++;
          returnDelays.push(t - watch.at);
        }
      }
    }
  } finally {
    Math.random = original;
  }
}

const per = (value) => Number((value / seeds.length).toFixed(2));

console.log(`\n=== 防守方在本方禁区触球后球的去向（${seeds.length} 场，种子 ${seeds[0]}..${seeds[seeds.length - 1]}）===`);
console.log("\n[1] 球是否离开了本方禁区：");
console.log({
  "触球次数": kicks,
  "每场": per(kicks),
  "落点仍在禁区内": `${landedInside} (${pct(landedInside, kicks)}%)   ${per(landedInside)}/场`,
  "落点已出禁区": `${landedOutside} (${pct(landedOutside, kicks)}%)   ${per(landedOutside)}/场`,
});
console.log("\n[2] 落点离本方球门距离（场地单位，100=全场长）：");
console.log({
  n: landingGoalDist.length,
  中位: median(landingGoalDist),
  p25: quantile(landingGoalDist, 0.25),
  p75: quantile(landingGoalDist, 0.75),
  p90: quantile(landingGoalDist, 0.9),
});
console.log("\n[3] 落点纵向分区：");
for (const [zone, count] of [...landingZone.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${zone}: ${count} (${pct(count, kicks)}%)  ${per(count)}/场`);
}
console.log("\n[4] 清球后 6 秒内球又回到本方禁区：");
console.log({
  "回流次数": `${returned} (${pct(returned, kicks)}%)`,
  "每场": per(returned),
  "回流耗时中位(秒)": median(returnDelays),
  "p25": quantile(returnDelays, 0.25),
  "p75": quantile(returnDelays, 0.75),
});
console.log(
  "  ⚠️ 耗时中位为 0 说明：这些不是「清出去又回来」，而是**从未离开**\n" +
  "     （落点结算那一帧球已在禁区内，窗口内又立刻满足「在禁区内」）。\n" +
  "     与 [1] 的「落点仍在禁区内 24.6%」是同一批球，两个口径互相印证。"
);
