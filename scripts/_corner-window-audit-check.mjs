/**
 * 诊断：`match-realism-audit.mjs` 的 `cornerShots` / `cornerGoals` 是否真的按
 * 「角球后 18 秒内」统计——还是被跨场残留的 `recentCorners` 污染成「≥18 秒前的角球」。
 *
 * 静态事实（先读代码得到，不依赖本探针）：
 *   match-realism-audit.mjs:251  `const recentCorners = { home: -Infinity, away: -Infinity }`
 *   match-realism-audit.mjs:300  `recentCorners[event.team] = event.t;`
 *   `event.t` 是**每场从 0 重新计**的比赛秒（`engine.js:5034`），
 *   但 `recentCorners` 在 `for (match)` 循环**外**声明 → 第二场起，它仍持有上一场
 *   最后一次角球的 t（例如 2700），而本场所有事件 t ∈ [0, 2700]。
 *   于是 `event.t - recentCorners[team] <= 18` 对**几乎每一条事件**为真（左边是负数），
 *   事件被判成「角球后」。
 *
 * 本探针不做统计模型，直接放两个计数器并排对比：
 *   A. 审计原样逻辑（跨场残留，不重置）
 *   B. 正确逻辑（每场重置 + 用「最近一次**之前**的角球」的通常语义）
 *
 * 若 A ≈ 全部射门/进球，B ≈ 真实角球后 18 秒内的射门/进球，则缺陷成立且量级确定。
 *
 * 用法：node scripts/_corner-window-audit-check.mjs [--matches 24] [--standard]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? Number(v) : true;
};
const MATCHES = Number(flag("matches", 24)) || 24;
const PROFILE = flag("profile", "background");
const simulationProfile = PROFILE === "standard" ? "standard" : "background";
const timeStep = simulationProfile === "background" ? 0.3 : SIM.DT;
const separationPasses = simulationProfile === "background" ? 4 : 8;

// —— 与 match-realism-audit.mjs 逐字相同的引擎构造（种子、能力、阵型、步长）——
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
    return {
      id, name: id, pos, number: index + 1, fitness: 100,
      attrs: {
        pace: rating, shooting: rating, passing: rating, dribbling: rating,
        defending: rating, physical: rating, finishing: rating, tackling: rating,
        marking: rating, strength: rating, stamina: rating, vision: rating,
        reflexes: rating, handling: rating, positioning: rating, kicking: rating,
      },
    };
  });
  return {
    id: name, name, players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((player) => player.id),
      pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced",
    },
  };
}

function runMatch(seed) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(
      makeClub(`home-${seed}`, 13),
      makeClub(`away-${seed}`, 13),
      { simulationProfile, timeStep, separationPasses }
    );
    const steps = Math.round((90 * 60) / timeStep);
    for (let step = 0; step < steps; step++) engine.step(timeStep);
    return engine;
  } finally {
    Math.random = originalRandom;
  }
}

const CORNER_WINDOW = 18;

let totShots = 0;
let totGoals = 0;

// A：审计原样逻辑 —— recentCorners 在循环外，跨场不重置
const auditState = { home: -Infinity, away: -Infinity };
let auditCornerShots = 0;
let auditCornerGoals = 0;
let auditCorners = 0;

// B：正确逻辑 —— 每场重置，且只用「本场某一时刻之前最近一次角球」
let goodCornerShots = 0;
let goodCornerGoals = 0;
let goodCorners = 0;

// C：另一个诊断量 —— 审计口径下「事件在角球之前」的比例（跨场污染的指纹）
let auditAfterCount = 0;
let auditTotalCount = 0;

const perMatchAudit = [];

for (let match = 0; match < MATCHES; match++) {
  const seed = 165000 + match;
  const engine = runMatch(seed);

  // —— A 路：逐字复刻审计的顺序与判据（含跨场残留）——
  let mA = { shots: 0, goals: 0, corners: 0 };

  // —— B 路：每场一份干净状态 ——
  const goodState = { home: -Infinity, away: -Infinity };
  let mB = { shots: 0, goals: 0, corners: 0 };

  for (const event of engine.events) {
    if (event.type === "corner") {
      auditCorners++;
      mA.corners++;
      auditState[event.team] = event.t;

      goodCorners++;
      mB.corners++;
      goodState[event.team] = event.t;
      continue;
    }
    if (event.type === "shot") {
      totShots++;
      auditTotalCount++;
      if (event.t - auditState[event.team] <= CORNER_WINDOW) {
        auditCornerShots++;
        mA.shots++;
        if (event.t < auditState[event.team]) auditAfterCount++;
      }
      if (event.t - goodState[event.team] <= CORNER_WINDOW) {
        goodCornerShots++;
        mB.shots++;
      }
      continue;
    }
    if (event.type === "goal") {
      totGoals++;
      if (event.t - auditState[event.team] <= CORNER_WINDOW) {
        auditCornerGoals++;
        mA.goals++;
      }
      if (event.t - goodState[event.team] <= CORNER_WINDOW) {
        goodCornerGoals++;
        mB.goals++;
      }
      continue;
    }
  }

  perMatchAudit.push({ seed, ...mA });
}

const F = (x) => Number(x).toFixed(2);
const rows = [
  ["场数", MATCHES],
  ["总射门（双方合计）", totShots],
  ["总进球（双方合计）", totGoals],
  ["角球总数", auditCorners],
  ["", ""],
  ["A 审计原样 cornerShots", auditCornerShots],
  ["  每场", F(auditCornerShots / MATCHES)],
  ["  占全部射门", `${F((auditCornerShots / totShots) * 100)}%`],
  ["A 审计原样 cornerGoals", auditCornerGoals],
  ["  每场", F(auditCornerGoals / MATCHES)],
  ["  占全部进球", `${F((auditCornerGoals / totGoals) * 100)}%`],
  ["", ""],
  ["B 每场重置 cornerShots", goodCornerShots],
  ["  每场", F(goodCornerShots / MATCHES)],
  ["  占全部射门", `${F((goodCornerShots / totShots) * 100)}%`],
  ["B 每场重置 cornerGoals", goodCornerGoals],
  ["  每场", F(goodCornerGoals / MATCHES)],
  ["  占全部进球", `${F((goodCornerGoals / totGoals) * 100)}%`],
  ["", ""],
  ["每队每场角球", F(auditCorners / MATCHES / 2)],
  ["A/B cornerShots 倍率", F(auditCornerShots / Math.max(1, goodCornerShots))],
  ["", ""],
  ["审计口径下「事件早于最近记录角球」的射门数", auditAfterCount],
  ["  ...占审计判为角球后射门的比例", `${F((auditAfterCount / Math.max(1, auditCornerShots)) * 100)}%`],
];

console.log(`== _corner-window-audit-check（${simulationProfile} 档，${MATCHES} 场，种子 165000..）==\n`);
for (const [k, v] of rows) {
  if (k === "" && v === "") { console.log(""); continue; }
  console.log(`${String(k).padEnd(44, " ")} ${v}`);
}

console.log("\n== 逐场（A 路审计原样口径）==");
for (const r of perMatchAudit) {
  console.log(
    `seed ${r.seed}  corners ${String(r.corners).padStart(2)}  cornerShots ${String(r.shots).padStart(2)}  cornerGoals ${r.goals}`
  );
}
