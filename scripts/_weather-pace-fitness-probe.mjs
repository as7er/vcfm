/**
 * 同步路径缺 `weather.pace` 项 —— 只测量、不改引擎。
 *
 * 直播路径：`wetExtra = state.weather.pace < 0.92 ? 0.5 : 0`
 *   rain 0.90 / heat 0.88 → extra 0.5
 *   clear 1.00 / wind 0.94 / cold 0.95 → extra 0
 * 同步路径：历来不带 extra。
 *
 * ⚠ 算术预期「默认战术 fitW=1.0 ⇒ extra 0.5 把 perPlayer 从 1 推到 2」
 *   是**阈值判断**，不是线性增量。必须打印实际 fitW：
 *   `perPlayer = max(1, round(fitW + extra))`
 *   只有 fitW + extra ≥ 1.5 才会从 1 变成 2。
 *
 * ⚠ 同步路径 `simulateMatchSync` 完赛时还会再走一次 `drainFitness`
 *   （每人再扣 4~9 点，与 15 分钟结算是另一笔）。所以 sync90 的 meanD
 *   **不能**直接拿来和 live45 的 −3/−6 比；雨−晴 的差才隔离天气项。
 *
 * 用法：node scripts/_weather-pace-fitness-probe.mjs
 */
import { defaultTactics, getLineupPlayers, ensureFootballProfile, teamRoleMods } from "../js/models.js";
import { generatePlayerAttributes } from "../js/player-attributes.js";
import { STYLE_MOD } from "../js/data.js";
import {
  playFirstHalf,
  simulateMatchSync,
  WEATHERS,
  createMatchSession,
  weatherTeamImpact,
} from "../js/match.js";

function player(id, pos, ovr, fitness = 90) {
  return {
    id, name: id, pos, ovr, potential: ovr + 1, age: 27,
    fitness, morale: 70, injured: 0, suspendedMatches: 0, attrs: {},
  };
}

function squad() {
  const players = [player("gk", "GK", 14), player("gk2", "GK", 13)];
  for (let i = 0; i < 7; i++) players.push(player(`d${i}`, "DEF", +(16 - i * 0.3).toFixed(2)));
  for (let i = 0; i < 8; i++) players.push(player(`m${i}`, "MID", +(16 - i * 0.25).toFixed(2)));
  for (let i = 0; i < 6; i++) players.push(player(`a${i}`, "ATT", +(16 - i * 0.4).toFixed(2)));
  for (const p of players) {
    generatePlayerAttributes(p, p.ovr);
    ensureFootballProfile(p);
  }
  return players;
}

function blankTableRow() {
  return { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
}

function makeClub(id, name, power) {
  return {
    id,
    name,
    power,
    players: squad(),
    tactics: defaultTactics(),
    staff: {},
    form: [],
    division: 3,
  };
}

function makeWorld() {
  const club = makeClub("user", "User", 70);
  const opponent = makeClub("opp", "Opponent", 65);
  return {
    clubs: [club, opponent],
    userClubId: "user",
    season: 2026,
    day: 5,
    news: [],
    media: [],
    inbox: [],
    fixtures: [],
    table: {
      user: blankTableRow(),
      opp: blankTableRow(),
    },
  };
}

function fitnessMultOf(tactics) {
  const mod = STYLE_MOD[tactics?.style] || STYLE_MOD.balanced;
  const press = 1 + Math.max(0, (tactics?.pressing || 3) - 3) * 0.08;
  const line = 1 + Math.max(0, (tactics?.defensiveLine || 3) - 3) * 0.04;
  return (mod.fitness || 1) * press * line;
}

function perPlayerOf(fitW, extra) {
  return Math.max(1, Math.round(fitW + extra));
}

function inspectFitW(state, weatherKey) {
  const club = state.home;
  const tactics = club.tactics;
  const styleFit = fitnessMultOf(tactics);
  const roleFit = teamRoleMods(club).fit;
  const impact = weatherTeamImpact(club, state.weather);
  const fitW = state._fitW?.home;
  const extra = (state.weather?.pace ?? 1) < 0.92 ? 0.5 : 0;
  return {
    weather: weatherKey,
    actualWeather: state.weather?.key,
    actualPace: state.weather?.pace,
    style: tactics?.style,
    pressing: tactics?.pressing,
    defensiveLine: tactics?.defensiveLine,
    styleFit: +styleFit.toFixed(4),
    roleFit: +roleFit.toFixed(4),
    weatherFatigue: +impact.fatigue.toFixed(4),
    weatherScore: impact.score,
    fitW: fitW == null ? null : +Number(fitW).toFixed(4),
    extraIfLive: extra,
    perPlayerLive: perPlayerOf(fitW ?? 1, extra),
    perPlayerSync: perPlayerOf(fitW ?? 1, 0),
    crossesLiveRound15: (fitW ?? 1) + extra >= 1.5,
  };
}

function summarize(club, before, label, meta) {
  const xi = getLineupPlayers(club);
  const rows = xi.map((p) => {
    const b = before.get(p.id) ?? 90;
    const now = p.fitness ?? 90;
    return { id: p.id, pos: p.pos, before: b, now, d: now - b };
  });
  const uniq = [...new Set(rows.map((r) => +Number(r.now).toFixed(2)))].sort((a, b) => a - b);
  const meanNow = rows.reduce((s, r) => s + r.now, 0) / (rows.length || 1);
  const meanD = rows.reduce((s, r) => s + r.d, 0) / (rows.length || 1);
  return {
    label,
    ...meta,
    n: rows.length,
    uniq,
    meanNow: +meanNow.toFixed(2),
    meanD: +meanD.toFixed(2),
    minD: +Math.min(...rows.map((r) => r.d)).toFixed(2),
    maxD: +Math.max(...rows.map((r) => r.d)).toFixed(2),
    sample: rows.slice(0, 4).map((r) => `${r.id}:${r.before}→${+Number(r.now).toFixed(2)}`).join(" "),
  };
}

function weatherMeta(key) {
  const w = WEATHERS.find((x) => x.key === key);
  return {
    weather: w.key,
    pace: w.pace,
    wetWouldTrigger: w.pace < 0.92,
  };
}

async function runLive(weatherKey) {
  const world = makeWorld();
  const club = world.clubs[0];
  const fixture = {
    id: `pace-live-${weatherKey}`,
    day: 5,
    home: "user",
    away: "opp",
    played: false,
    weather: weatherKey,
    competition: "league",
    matchSeed: 424242,
  };
  const state = createMatchSession(world, fixture);
  const fit = inspectFitW(state, weatherKey);
  const before = new Map(getLineupPlayers(club).map((p) => [p.id, p.fitness]));
  await playFirstHalf(state, {});
  return summarize(club, before, `live45/${weatherKey}`, {
    ...weatherMeta(weatherKey),
    path: "live(playFirstHalf 45')",
    ...fit,
  });
}

function runSync(weatherKey) {
  const world = makeWorld();
  const club = world.clubs[0];
  const fixture = {
    id: `pace-sync-${weatherKey}`,
    day: 5,
    home: "user",
    away: "opp",
    played: false,
    weather: weatherKey,
    competition: "league",
    matchSeed: 424242,
  };
  const state = createMatchSession(world, fixture);
  const fit = inspectFitW(state, weatherKey);
  const before = new Map(getLineupPlayers(club).map((p) => [p.id, p.fitness]));
  simulateMatchSync(world, fixture);
  return summarize(club, before, `sync90/${weatherKey}`, {
    ...weatherMeta(weatherKey),
    path: "sync(simulateMatchSync 90' + finalize drainFitness)",
    ...fit,
  });
}

const keys = ["clear", "rain", "heat"];
console.log("=== 算术预期（默认战术 fitW=1.0 的阈值故事）===");
console.log("  extra 0 → perPlayer=1；45' 三次结算 −3；90' 六次 −6");
console.log("  extra 0.5 → perPlayer=2；45' −6；90' −12");
console.log("  触发 extra：rain(0.90) heat(0.88)；clear 不触发");
console.log("  ⚠ 这是 round() 阈值，不是线性。fitW+extra < 1.5 则雨/热仍是 −3");
console.log("  另有 weatherTeamImpact.fatigue 间接项（雨/热会再乘 _fitW）");
console.log("  ⚠ sync 完赛另有 drainFitness（4~9 点），不能和 live45 的 −3/−6 直接比");

console.log("\n=== 直播路径 playFirstHalf（上半场，无 finalize）===");
const live = [];
for (const k of keys) {
  const r = await runLive(k);
  live.push(r);
  console.log(JSON.stringify(r));
}

console.log("\n=== 同步路径 simulateMatchSync（整场 90' + finalize drainFitness）===");
const sync = [];
for (const k of keys) {
  const r = runSync(k);
  sync.push(r);
  console.log(JSON.stringify(r));
}

const liveClear = live.find((r) => r.weather === "clear");
const liveRain = live.find((r) => r.weather === "rain");
const liveHeat = live.find((r) => r.weather === "heat");
const syncClear = sync.find((r) => r.weather === "clear");
const syncRain = sync.find((r) => r.weather === "rain");
const syncHeat = sync.find((r) => r.weather === "heat");

console.log("\n=== fitW 分解（直播会话，开赛后、结算前）===");
for (const r of live) {
  console.log(JSON.stringify({
    weather: r.weather,
    styleFit: r.styleFit,
    roleFit: r.roleFit,
    weatherFatigue: r.weatherFatigue,
    fitW: r.fitW,
    extraIfLive: r.extraIfLive,
    perPlayerLive: r.perPlayerLive,
    perPlayerSync: r.perPlayerSync,
    crossesLiveRound15: r.crossesLiveRound15,
  }));
}

console.log("\n=== 对照 ===");
console.log(`live45  晴 meanD=${liveClear?.meanD} 雨 ${liveRain?.meanD} 热 ${liveHeat?.meanD}`);
console.log(`sync90  晴 meanD=${syncClear?.meanD} 雨 ${syncRain?.meanD} 热 ${syncHeat?.meanD}`);
console.log(
  "live 雨−晴 =",
  +((liveRain?.meanD ?? 0) - (liveClear?.meanD ?? 0)).toFixed(2),
  liveRain?.crossesLiveRound15 ? "（跨过 1.5 ⇒ extra 应再扣 ~3）" : "（没跨过 1.5 ⇒ extra 被 round 吃掉，差应≈0）"
);
console.log(
  "live 热−晴 =",
  +((liveHeat?.meanD ?? 0) - (liveClear?.meanD ?? 0)).toFixed(2),
  liveHeat?.crossesLiveRound15 ? "（跨过 1.5 ⇒ extra 应再扣 ~3）" : "（没跨过 1.5 ⇒ extra 被 round 吃掉）"
);
console.log(
  "sync 雨−晴 =",
  +((syncRain?.meanD ?? 0) - (syncClear?.meanD ?? 0)).toFixed(2),
  "（缺 extra；差只来自 fatigue × fitW 以及 finalize drainFitness）"
);
console.log(
  "sync 热−晴 =",
  +((syncHeat?.meanD ?? 0) - (syncClear?.meanD ?? 0)).toFixed(2),
  "（缺 extra；热的 fatigue 更大）"
);
console.log(
  "判决：live 雨/热是否把 perPlayer 从 1 推到 2 =",
  liveRain?.perPlayerLive === 2 || liveHeat?.perPlayerLive === 2 ? "是" : "否"
);
