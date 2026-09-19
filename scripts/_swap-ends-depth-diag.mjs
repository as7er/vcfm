// 诊断：换边后**每队球员**的实际活动纵深分布，以及射门位置分布。
// 目的：区分「球队整体攻不上去」与「能攻上去、只是射门点分布较宽」。
// 用法：node scripts/_swap-ends-depth-diag.mjs [场数=3]
import { SimEngine } from "../js/sim/engine.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ROLES = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
const NAMES = [
  "pace", "shooting", "passing", "dribbling", "defending", "physical",
  "finishing", "tackling", "marking", "strength", "stamina", "vision",
  "reflexes", "handling", "positioning", "kicking", "decisions",
];
function makeClub(name, bias) {
  const players = ROLES.map((role, i) => {
    const attrs = {};
    for (const k of NAMES) attrs[k] = 10 + bias + ((i * 3 + k.length) % 5);
    return { id: `${name}-${i}`, name: `${name} ${i}`, pos: role, role, number: i + 1,
      attrs, playingHabits: [], fitness: 100, injured: 0 };
  });
  return { id: name, name, players, tactics: {
    formation: "4-3-3", lineup: players.map((p) => p.id),
    pressing: 3, tempo: 3, defensiveLine: 3, width: 3, style: "balanced" } };
}

const MATCHES = Math.max(1, Number(process.argv[2]) || 3);
const DT = 0.1, SECONDS = 5400, SWAP_AT = 2700;
const SEED0 = 611000;

// 「纵深」= 该队自己球门线起算的距离（0=己方门，100=对方门）
function depthOf(y, team, swapped) {
  // 换边后两队守的门互换
  const own = team === "home" ? (swapped ? 0 : 100) : (swapped ? 100 : 0);
  return own > 50 ? 100 - y : y;
}

function runMatch(seed, swapped) {
  const eng = new SimEngine(makeClub("H", 4), makeClub("A", 1), { random: mulberry32(seed) });
  const steps = Math.round(SECONDS / DT);
  const swapStep = Math.round(SWAP_AT / DT);
  const h2 = { home: [], away: [] };      // 下半场：各队 11 人的纵深样本
  const h2BallOwner = { home: [], away: [] };
  const shots = { home: [], away: [] };
  const seen = new Set();
  if (swapped) {
    // 上半场保持原状，45 分钟处换边
  }
  for (let i = 0; i < steps; i++) {
    if (swapped && i === swapStep) { eng.endsSwapped = true; eng._kickoff("away"); }
    eng.step(DT);
    for (const e of eng.events || []) {
      const key = `${e.t}|${e.type}|${e.team}|${e.agentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (e.type === "shot" && i >= swapStep) shots[e.team].push(depthOf(e.y, e.team, swapped));
    }
    if (i >= swapStep && i % 10 === 0) {
      for (const a of eng.agents) {
        if (a.sentOff) continue;
        h2[a.team].push(depthOf(a.y, a.team, swapped));
      }
      const o = eng.ball.owner;
      if (o) h2BallOwner[o.team]?.push(depthOf(eng.ball.y, o.team, swapped));
    }
  }
  const avg = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN);
  return { seed, h2: { home: avg(h2.home), away: avg(h2.away) },
    own: { home: avg(h2BallOwner.home), away: avg(h2BallOwner.away) },
    shots: { home: avg(shots.home), away: avg(shots.away) },
    shotN: { home: shots.home.length, away: shots.away.length } };
}

console.log("换边后（下半场）各队「距己方门纵深」均值 —— 50 = 中线\n");
console.log("对照组 A = 不换边；组 B = 换边。两组的「射门位纵深」都应在 80+ 侧。\n");
console.log("  组  seed     │ 全队平均纵深        │ 射门位纵深（距己方门）");
console.log("               │  主队    客队       │  主队    客队");
for (let m = 0; m < MATCHES; m++) {
  const seed = SEED0 + m;
  const f = (v) => (Number.isFinite(v) ? v.toFixed(1).padStart(6) : "   n/a");
  for (const sw of [false, true]) {
    const s = runMatch(seed, sw);
    console.log(
      `  ${sw ? "B" : "A"}  ${seed}  │${f(s.h2.home)} ${f(s.h2.away)}      │${f(s.shots.home)} ${f(s.shots.away)}   (n=${s.shotN.home}/${s.shotN.away})`
    );
  }
  console.log("");
}
console.log("判据：换边组（B）两队「射门位纵深」都应 > 75（射门确实发生在对方门前），");
console.log("      且与不换边组（A）同量级 —— 说明换边没有破坏进攻组织。");
