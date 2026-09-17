/**
 * 诊断：角球后 18 秒窗口内，射门事件与进球事件的归属是否一致。
 *
 * 背景（`docs/corner-window-audit-defect-2026-09-17.md` §5）：
 *   修好窗口口径后，后台 24 场读出
 *     每角球**射门率** = 1.97%（真实 38.5% 的 5.1%）
 *     每角球**进球率** = 2.63%（真实 4.1% 的 64%）
 *   进球率 64% 而射门率 5.1%——**不可能同时成立**。
 *
 * 本探针把「角球后窗口」的**逐事件序列**打出来，并做两件独立的事：
 *   A. **归属对账**：每个角球后窗口内的进球，其 `team` 与最近一次角球的受益方是否一致；
 *      以及该进球对应的射门（`t` 差 ≤8s）是否落在同一个窗口里。
 *   B. **双向检查**：分别用 (i) 「角球方自己」和 (ii) 「两支球队都算」两种归属口径
 *      统计射门/进球，看矛盾是否来自 team 归属。
 *
 * 关键假设（要先证实或证伪）：`match-realism-audit.mjs` 是按 `event.team` 取
 * `recentCorners[event.team]`，而**角球事件的 `team` 是「开角球的那一方」**；
 * 但角球后的射门**绝大多数是开球方打的**——所以 team 归属本身是对的。
 * 真正可疑的是：**进球事件与它的射门事件之间可能有 `_emitTimeOffset` 造成的时序错位**。
 *
 * 用法：node scripts/_corner-window-event-trace.mjs [--matches 24] [--profile background] [--corner-limit 6]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) return true;
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
};
const MATCHES = Number(flag("matches", 24)) || 24;
const PROFILE = String(flag("profile", "background"));
const CORNER_LIMIT = Number(flag("corner-limit", 6)) || 6;
const WINDOW = 18;
const SHOT_GOAL_LINK = 8; // 与审计里「进球找 ≤8s 前的射门」同口径

const simulationProfile = PROFILE === "standard" ? "standard" : "background";
const timeStep = simulationProfile === "background" ? 0.3 : SIM.DT;
const separationPasses = simulationProfile === "background" ? 4 : 8;

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
      lineup: players.map((p) => p.id),
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

// ——— 统计口径（全部按「事件与角球同队」判定，复刻审计语义）———
const tot = {
  corners: 0,
  shots: 0, goals: 0,
  shotsAfterCorner: 0, goalsAfterCorner: 0,
  // 归属对账
  goalsAfterCornerNoMatchingShot: 0,   // 窗口内进球但找不到窗口内对应射门
  shotsAfterCornerNotScored: 0,
};

// 「球队归属」对照：不按 team 取角球，而是**任意一支球队**的角球之后
let anyTeamShotsAfter = 0;
let anyTeamGoalsAfter = 0;

// 时序指纹：进球 t 与其对应射门 t 的差
const shotGoalDeltas = [];
// 角球后进球距角球的时间
const goalToCorner = [];
const shotToCorner = [];

const samples = [];

for (let match = 0; match < MATCHES; match++) {
  const seed = 165000 + match;
  const engine = runMatch(seed);

  const recentShots = [];
  let lastCorner = { home: -Infinity, away: -Infinity };
  let lastCornerAny = -Infinity;
  // 最近一次角球后的射门（供进球对账）
  let shotsSinceCorner = { home: [], away: [] };

  for (const event of engine.events) {
    if (event.type === "corner") {
      tot.corners++;
      lastCorner[event.team] = event.t;
      lastCornerAny = event.t;
      shotsSinceCorner = { home: [], away: [] };
      continue;
    }

    if (event.type === "shot") {
      tot.shots++;
      recentShots.push({ seed, team: event.team, t: event.t, distance: Number(event.distance) || 18 });
      shotsSinceCorner[event.team].push(event.t);
      const d = event.t - lastCorner[event.team];
      if (d >= 0 && d <= WINDOW) {
        tot.shotsAfterCorner++;
        shotToCorner.push(d);
      }
      if (lastCornerAny >= 0 && event.t - lastCornerAny >= 0 && event.t - lastCornerAny <= WINDOW) {
        anyTeamShotsAfter++;
      }
      continue;
    }

    if (event.type === "goal") {
      tot.goals++;
      const shot = recentShots
        .slice().reverse()
        .find((s) => s.team === event.team && event.t - s.t <= SHOT_GOAL_LINK);
      if (shot) shotGoalDeltas.push(Number((event.t - shot.t).toFixed(2)));

      const d = event.t - lastCorner[event.team];
      if (d >= 0 && d <= WINDOW) {
        tot.goalsAfterCorner++;
        goalToCorner.push(d);
        // 该进球是否能在「本队角球后的射门列表」里找到对应？
        const hit = shotsSinceCorner[event.team].some((st) => event.t - st >= 0 && event.t - st <= SHOT_GOAL_LINK);
        if (!hit) tot.goalsAfterCornerNoMatchingShot++;
        if (samples.length < 400) {
          samples.push({
            seed, team: event.team, goalT: Number(event.t.toFixed(2)),
            cornerT: Number(lastCorner[event.team].toFixed(2)),
            delta: Number(d.toFixed(2)),
            shotFound: !!shot, shotT: shot ? Number(shot.t.toFixed(2)) : null,
            matchingWindowShot: hit,
          });
        }
      }
      if (lastCornerAny >= 0 && event.t - lastCornerAny >= 0 && event.t - lastCornerAny <= WINDOW) {
        anyTeamGoalsAfter++;
      }
      continue;
    }
  }
}

const F = (x, n = 2) => (Number.isFinite(x) ? Number(x).toFixed(n) : String(x));
const quant = (arr, q) => {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * q))];
};
const perMatch = (x) => x / MATCHES;
const cornersPerMatchBoth = tot.corners / MATCHES;      // 双方合计
const cornersPerTeamMatch = cornersPerMatchBoth / 2;    // 每队每场

const lines = [
  `== _corner-window-event-trace（${simulationProfile} 档，${MATCHES} 场，种子 165000..）==`,
  "",
  `角球总数                     ${tot.corners}`,
  `  双方合计/场                ${F(cornersPerMatchBoth)}`,
  `  每队/场                    ${F(cornersPerTeamMatch)}`,
  `总射门                       ${tot.shots}（${F(perMatch(tot.shots))}/场）`,
  `总进球                       ${tot.goals}（${F(perMatch(tot.goals))}/场）`,
  "",
  "—— A. 审计同口径（按 event.team 取角球）——",
  `角球后 18s 内射门            ${tot.shotsAfterCorner}（${F(perMatch(tot.shotsAfterCorner))}/场）`,
  `  每个角球产生射门           ${F((tot.shotsAfterCorner / tot.corners) * 100, 2)}%`,
  `角球后 18s 内进球            ${tot.goalsAfterCorner}（${F(perMatch(tot.goalsAfterCorner))}/场）`,
  `  每个角球产生进球           ${F((tot.goalsAfterCorner / tot.corners) * 100, 2)}%`,
  `  占全部进球                 ${F((tot.goalsAfterCorner / tot.goals) * 100, 2)}%`,
  "",
  "—— B. 不按归属（任意一队的角球之后 18s）——",
  `射门                         ${anyTeamShotsAfter}（${F(perMatch(anyTeamShotsAfter))}/场）`,
  `  每个角球产生射门           ${F((anyTeamShotsAfter / tot.corners) * 100, 2)}%`,
  `进球                         ${anyTeamGoalsAfter}（${F(perMatch(anyTeamGoalsAfter))}/场）`,
  `  每个角球产生进球           ${F((anyTeamGoalsAfter / tot.corners) * 100, 2)}%`,
  "",
  "—— C. 归属对账（窗口内进球能否找到窗口内对应射门）——",
  `窗口内进球但无同窗口射门      ${tot.goalsAfterCornerNoMatchingShot} / ${tot.goalsAfterCorner}`,
  `  占比                       ${F((tot.goalsAfterCornerNoMatchingShot / Math.max(1, tot.goalsAfterCorner)) * 100, 2)}%`,
  "",
  "—— D. 时序指纹 ——",
  `进球相对其对应射门的 t 差    n=${shotGoalDeltas.length}`,
  `  中位 ${F(quant(shotGoalDeltas, 0.5))}  最小 ${F(shotGoalDeltas.length ? Math.min(...shotGoalDeltas) : NaN)}  最大 ${F(shotGoalDeltas.length ? Math.max(...shotGoalDeltas) : NaN)}`,
  `  负值个数（进球早于射门）    ${shotGoalDeltas.filter((d) => d < 0).length}`,
  `角球后进球距角球时间         n=${goalToCorner.length}`,
  `  中位 ${F(quant(goalToCorner, 0.5))}  p90 ${F(quant(goalToCorner, 0.9))}  最大 ${F(goalToCorner.length ? Math.max(...goalToCorner) : NaN)}`,
  `角球后射门距角球时间         n=${shotToCorner.length}`,
  `  中位 ${F(quant(shotToCorner, 0.5))}  p90 ${F(quant(shotToCorner, 0.9))}  最大 ${F(shotToCorner.length ? Math.max(...shotToCorner) : NaN)}`,
];

console.log(lines.join("\n"));

console.log(`\n== E. 窗口内进球样本（前 ${CORNER_LIMIT} 条 / 共 ${samples.length}）==`);
for (const s of samples.slice(0, CORNER_LIMIT)) {
  console.log(
    `seed ${s.seed} ${s.team}  goal@${s.goalT}  corner@${s.cornerT}  Δ${s.delta}s  ` +
    `对应射门=${s.shotFound ? s.shotT : "未找到"}  窗口内射门=${s.matchingWindowShot ? "有" : "无"}`
  );
}
