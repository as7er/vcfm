/**
 * 定位球瞬移探针：按**定位球类型**分层量「球被搬运的位移」，并判定 matchview
 * 的缓动条件会不会漏掉这一类。
 *
 * 缘起（用户 2026-09-16 现场反馈）：
 *   「播放进球集锦时，**球**还是会出现瞬移的情况，尤其是**角球**的时候。
 *    还有别的类似定位球的场景，如**边线球、点球、任意球**，也会出现吗？」
 *
 * 已知的修复与其盲区：
 *   `js/matchview.js` 在 `_applySimSnapshot` 里有 relocate 缓动，武装条件（:451-473）：
 *     const adjacent = simT > lastSimT && simT - lastSimT <= 0.35;
 *     if (adjacent && restartFrame && !entity._relocAt && distance > jumpLimit) { ...缓动... }
 *   ⇒ **缓动只在「相邻 sim 帧」时才武装**。
 *   在**高光集锦**里，段与段之间存在剪辑跳帧（simT 跳跃 > 0.55s ⇒ sceneCut），
 *   此时 `adjacent === false`，于是即使 `restartFrame`（角球）为真也**不缓动**，
 *   球被硬切到角旗点 —— 正是用户看到的「角球瞬移」。
 *
 * 本探针回答：
 *   [A] 每类定位球的搬运位移有多大？（引擎侧真值，逐 tick 采样）
 *   [B] 这些搬运发生时，前后 tick 的 `simT` 间隔是多少？→ 判断是否落在 adjacent 档
 *   [C] 角球搬运还伴随多少球员位移（整队瞬移的规模）
 *
 * 口径：只读引擎状态，不包装、不消费随机数。标准档、0.1s 步长、能力 15。
 * 用法：node scripts/_restart-teleport-probe.mjs [场数] [种子基]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

function seededRandom(seed) {
  let v = seed >>> 0;
  return () => {
    v += 0x6d2b79f5;
    let n = v;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
const ATTRS = [
  "pace", "shooting", "passing", "dribbling", "defending", "physical",
  "finishing", "tackling", "marking", "strength", "stamina", "vision",
  "reflexes", "handling", "positioning", "kicking", "decisions", "crossing",
];
function club(name, ability) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, i) => {
    const rating = Math.max(1, Math.min(20, ability + (((i * 7 + ability) % 5) - 2)));
    const attrs = {};
    for (const k of ATTRS) attrs[k] = rating;
    return { id: `${name}-p${i}`, name: `${name}-p${i}`, pos, number: i + 1, fitness: 100, attrs };
  });
  return {
    id: name,
    name,
    players,
    tactics: { formation: "4-3-3", lineup: players.map((p) => p.id), pressing: 3, tempo: 3, defensiveLine: 3 },
  };
}

const matches = Math.max(1, Number(process.argv[2]) || 18);
const seedBase = Number(process.argv[3]) || 372000;
/** 球在一 tick（0.1s）里物理上的位移上限：30 m/s ≈ 4.4 场地单位（纵向）；取 6 留余量 */
const JUMP_UNITS = 6;

const pct = (n, d) => Number(((n / Math.max(1, d)) * 100).toFixed(1));
const median = (vs) => {
  if (!vs.length) return 0;
  const s = [...vs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return Number((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2));
};

/** 按 restartType 累积；键 = 类型名，含 "none"（无标记） */
const byType = new Map();
const jumpsAll = [];

function bucket(key) {
  if (!byType.has(key)) {
    byType.set(key, {
      n: 0,
      ballD: [],
      ballDMax: 0,
      playersMoved: [],
      playerD: [],
      fromStates: new Map(),
      toStates: new Map(),
      // 位移落在哪些档
      over6: 0,
      over15: 0,
      over30: 0,
      // 前后 tick 的 simT 间隔（引擎侧恒为 DT，这里留字段以便日后接画面帧）
      dtSamples: [],
      teamHome: 0,
      teamAway: 0,
    });
  }
  return byType.get(key);
}

for (let m = 0; m < matches; m++) {
  const seed = seedBase + m;
  const restore = Math.random;
  Math.random = seededRandom(seed);
  try {
    const eng = new SimEngine(club(`h${seed}`, 15), club(`a${seed}`, 15), {
      simulationProfile: "standard",
      timeStep: SIM.DT,
      separationPasses: 8,
    });
    const steps = Math.round((90 * 60) / SIM.DT);
    // 上一 tick 快照
    let prevBall = { x: eng.ball.x, y: eng.ball.y, state: eng.ball.state, restart: eng.ball.restartType || null };
    let prevPlayers = eng.agents.map((a) => ({ id: a.id, x: a.x, y: a.y }));

    for (let s = 0; s < steps; s++) {
      eng.step(SIM.DT);
      const b = eng.ball;
      const moved = Math.hypot(b.x - prevBall.x, b.y - prevBall.y);
      const restart = b.restartType || prevBall.restart || null;

      // 位移超物理上限才算「搬运/瞬移」；或 restartType 发生变化的那一 tick
      const restartChanged = (b.restartType || null) !== (prevBall.restart || null);
      if (moved > JUMP_UNITS || restartChanged) {
        const key = b.restartType || prevBall.restart || "none";
        const bk = bucket(key);
        bk.n++;
        bk.ballD.push(moved);
        if (moved > bk.ballDMax) bk.ballDMax = Number(moved.toFixed(1));
        if (moved > 6) bk.over6++;
        if (moved > 15) bk.over15++;
        if (moved > 30) bk.over30++;
        bk.fromStates.set(prevBall.state, (bk.fromStates.get(prevBall.state) || 0) + 1);
        bk.toStates.set(b.state, (bk.toStates.get(b.state) || 0) + 1);
        bk.dtSamples.push(1);
        if (b.kickTeam === "home") bk.teamHome++;
        else if (b.kickTeam === "away") bk.teamAway++;

        // 球员位移规模
        let maxPD = 0;
        let cnt = 0;
        for (let i = 0; i < eng.agents.length; i++) {
          const a = eng.agents[i];
          const p = prevPlayers[i];
          const d = Math.hypot(a.x - p.x, a.y - p.y);
          if (d > 6) cnt++;
          if (d > maxPD) maxPD = d;
        }
        bk.playersMoved.push(cnt);
        bk.playerD.push(Number(maxPD.toFixed(1)));

        jumpsAll.push({
          match: m,
          t: Number(eng.t.toFixed(1)),
          key,
          ballD: Number(moved.toFixed(1)),
          fromState: prevBall.state,
          toState: b.state,
          players: cnt,
          maxPD: Number(maxPD.toFixed(1)),
        });
      }
      prevBall = { x: b.x, y: b.y, state: b.state, restart: b.restartType || null };
      prevPlayers = eng.agents.map((a) => ({ id: a.id, x: a.x, y: a.y }));
    }
  } finally {
    Math.random = restore;
  }
}

const per = (n) => Number((n / matches).toFixed(2));

console.log(`\n=== 定位球瞬移探针  ${matches} 场  种子 ${seedBase}..${seedBase + matches - 1} ===`);
console.log(`（判据：单 tick 球位移 > ${JUMP_UNITS} 单位，或 restartType 发生变化）`);

console.log(`\n[A] 按定位球类型分层`);
const order = ["corner", "throwin", "penalty", "freekick", "goalkick", "kickoff", "none"];
const keys = [...byType.keys()].sort((a, b) => {
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});
console.log(
  "  " +
    "类型".padEnd(10) +
    "次数/场".padEnd(10) +
    "位移中位".padEnd(10) +
    "位移max".padEnd(10) +
    ">6".padEnd(6) +
    ">15".padEnd(6) +
    ">30".padEnd(6) +
    "受影响球员中位".padEnd(14) +
    "最大球员位移"
);
for (const k of keys) {
  const bk = byType.get(k);
  console.log(
    "  " +
      String(k).padEnd(10) +
      String(per(bk.n)).padEnd(10) +
      String(median(bk.ballD)).padEnd(10) +
      String(bk.ballDMax).padEnd(10) +
      String(bk.over6).padEnd(6) +
      String(bk.over15).padEnd(6) +
      String(bk.over30).padEnd(6) +
      String(median(bk.playersMoved)).padEnd(14) +
      String(median(bk.playerD))
  );
}

console.log(`\n[B] 状态跃迁（from → to），看球是从什么状态被搬到什么状态`);
for (const k of keys) {
  const bk = byType.get(k);
  if (bk.n === 0) continue;
  const fromTop = [...bk.fromStates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const toTop = [...bk.toStates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`  ${k} (n=${bk.n}):`);
  console.log(`    from: ${fromTop.map(([s, c]) => `${s}×${c}`).join(", ")}`);
  console.log(`    to  : ${toTop.map(([s, c]) => `${s}×${c}`).join(", ")}`);
}

console.log(`\n[C] 全部「搬运」事件合计`);
console.log(`  总数 ${jumpsAll.length}  (${per(jumpsAll.length)}/场)`);
const big = jumpsAll.filter((j) => j.ballD > 30);
console.log(`  其中球位移 >30 单位: ${big.length} (${per(big.length)}/场)`);
const withPlayers = jumpsAll.filter((j) => j.players >= 3);
console.log(`  其中同时有 ≥3 名球员位移 >6: ${withPlayers.length} (${per(withPlayers.length)}/场)`);

console.log(`\n[D] 角球细分（用户点名的那一类）`);
const ck = byType.get("corner");
if (ck) {
  console.log(`  角球搬运 ${ck.n} 次 (${per(ck.n)}/场)`);
  console.log(`  球位移：中位 ${median(ck.ballD)}  最大 ${ck.ballDMax}`);
  console.log(`  受影响球员数：中位 ${median(ck.playersMoved)}`);
  console.log(`  最大球员位移：中位 ${median(ck.playerD)}`);
}

console.log(`\n--- 自检 ---`);
const totalByType = [...byType.values()].reduce((s, v) => s + v.n, 0);
console.log(`  ⚠️ 恒等式：各类型之和(${totalByType}) == 全部搬运(${jumpsAll.length})` +
  ` → ${totalByType === jumpsAll.length ? "✅ 相等" : "❌ 不等"}`);
const anyOver = [...byType.values()].some((v) => v.over6 !== v.n);
console.log(`  ⚠️ 每类 over6 应等于该类 n（判据含 restartChanged 会引入少量 <6 的样本）→ ` +
  (anyOver ? "⚠️ 有 <6 单位样本（restartType 变化但位移小），属预期" : "✅ 全 >6"));
console.log("  ⚠️ 说明：本探针量的是**引擎侧**位移。");
console.log("     引擎 _restart 是单 tick 硬置（b.x=x; b.y=y），所以引擎侧永远是瞬移；");
console.log("     画面是否瞬移取决于 matchview 的 relocate 缓动能否武装");
console.log("     （武装条件 adjacent = simT-lastSimT ∈ (0, 0.35]）。");
console.log("     ⇒ 高光段之间的剪辑跳帧必然 adjacent=false ⇒ 搬运不缓动 ⇒ 球硬切。");
