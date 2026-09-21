/**
 * 比赛模拟：情境修正、细事件、半场干预、赛后报告
 */

import {
  teamStrength,
  getLineupPlayers,
  autoLineup,
  ensureMatchLineup,
  ensureTactics,
  ensureLineupRoles,
  ensureCorePlayer,
  ensureCaptain,
  ensureSetPieceTakers,
  ensureLineupResponsibilities,
  getSetPieceTakerId,
  formatMoney,
  ensurePlayerHistory,
  ensureLeagueStats,
  ensureCompetitionStats,
  pushRecentRating,
  roleDefForPlayer,
  teamRoleMods,
} from "./models.js";
import {
  STYLE_MOD,
  FORMATION_MOD,
  styleMatchupMod,
  FORMATIONS,
  PLAYER_ROLES,
  TEAM_TALKS,
  DIVISIONS,
  teamTalkLabel,
  roleLabel,
} from "./data.js";
import { slotPositionCode } from "./player-positions.js";
import { normalizeDutyForRole, roleFitsPosition } from "./player-roles.js";
import {
  coachMatchMod,
  doctorInjuryMod,
  ensureStaff,
} from "./staff.js";
import { trainingInjuryMod, matchdayIncome, stadiumInfo } from "./facilities.js";
import { recordMatchdayFinance } from "./club-finance.js";
import { recordTransferAppearances } from "./finance-obligations.js";
import { ensureMatchSeed, matchRandom } from "./random.js";
import {
  applyMatchPrepBonus,
  resetMatchPrepCounter,
} from "./training-boost.js";
import { getFormBonus, getSeasonPhaseBonus } from "./matchday-income.js";
import {
  mediaAfterUserMatch,
  narrativeAfterUserMatch,
  pushMedia,
} from "./media.js";
import { grantHonor } from "./honors.js";
import {
  advanceCompetition,
  applyContinentalResult,
  findCompetition,
} from "./cup.js";
import { processClubMatchDiscipline } from "./discipline.js";
import { ensureManagerCareer, recordManagerMatch } from "./career.js";
import { noteUserMatchResult } from "./worldpulse.js";
import { relationMatchNudge, ensurePlayerRelation } from "./relations.js";
import {
  diagnoseInjury,
  squadInjuryRiskMultiplier,
} from "./injuries.js";
import {
  shouldUseSim,
  ensureSimEngine,
  resyncSimAfterHalfTime,
  runSimPeriodRaw,
  applySimPeriodStats,
  defaultFlavorText,
  buildHighlightWindows,
  buildHighlightSegments,
} from "./sim/adapt.js";
import { eligiblePlayerIds } from "./squad-registration.js";
import { deriveMatchAnalysis } from "./match-analysis.js";
import { recordMatchPlayingTime } from "./player-pathway.js";
import { processDevelopmentMatchesForDay } from "./development-football.js";
import {
  applyPreMatchDelegation,
  isFullyDelegated,
  shouldStaffHandleMatchday,
} from "./delegation.js";
import {
  applyCoachPhaseFormations,
  applyCoachTacticalIdentity,
  ensureCoachIdentity,
} from "./manager-ecosystem.js";

let activeRandom = Math.random;
function rng() {
  return activeRandom();
}
function chance(p) {
  return rng() < p;
}
function clubById(world, id) {
  return world.clubs.find((c) => c.id === id);
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function effectivePhaseFormation(tactics, key) {
  const base = FORMATIONS[tactics?.formation] ? tactics.formation : "4-3-3";
  return FORMATIONS[tactics?.[key]] ? tactics[key] : base;
}

function phaseShapeReason(source, plan, minute, scoreGap, changed) {
  if (source === "player") return changed ? "manual-adjustment" : "manual-plan";
  if (Number(plan?.facts?.adaptability || 0) < 5) return "coach-stable";
  if (minute === 0 && plan?.selectionSuppressed) return "pre-match-guard";
  if (scoreGap < 0) return "chasing-game";
  if (scoreGap > 0) return "protecting-lead";
  return changed ? "structural-review" : "shape-maintained";
}

function phaseShapeDecision(club, opponent, plan, options = {}) {
  const tactics = club?.tactics || {};
  const baseFormation = FORMATIONS[plan?.baseFormation]
    ? plan.baseFormation
    : (FORMATIONS[tactics.formation] ? tactics.formation : "4-3-3");
  const possessionFormation = FORMATIONS[plan?.effectivePossessionFormation]
    ? plan.effectivePossessionFormation
    : effectivePhaseFormation(tactics, "possessionFormation");
  const outOfPossessionFormation = FORMATIONS[plan?.effectiveOutOfPossessionFormation]
    ? plan.effectiveOutOfPossessionFormation
    : effectivePhaseFormation(tactics, "outOfPossessionFormation");
  const minute = clamp(Math.round(Number(options.minute) || 0), 0, 90);
  const scoreGap = Number(options.scoreGap) || 0;
  const source = options.source === "player" ? "player" : "coach";
  const changed = !!plan?.changed || !!options.changed;
  return {
    minute,
    team: options.team || null,
    teamId: club?.id || null,
    trigger: options.trigger || (minute ? "review" : "pre-match"),
    source,
    reason: phaseShapeReason(source, plan, minute, scoreGap, changed),
    changed,
    selectionSuppressed: !!plan?.selectionSuppressed,
    baseFormation,
    possessionFormation,
    outOfPossessionFormation,
    scoreGap,
    coachId: source === "coach" ? club?.staff?.coach?.id || null : null,
    facts: plan?.facts || {
      opponent: {
        formation: opponent?.tactics?.formation || null,
        possessionFormation: opponent?.tactics?.possessionFormation || null,
        outOfPossessionFormation: opponent?.tactics?.outOfPossessionFormation || null,
        width: Number(opponent?.tactics?.width) || 3,
      },
    },
  };
}

function recordPhaseShapeDecision(state, club, opponent, plan, options = {}) {
  if (!state || !club) return null;
  if (!Array.isArray(state.phaseShapeTimeline)) state.phaseShapeTimeline = [];
  const entry = phaseShapeDecision(club, opponent, plan, {
    ...options,
    team: club === state.home ? "home" : "away",
  });
  state.phaseShapeTimeline.push(entry);
  return entry;
}

// ---------- 情境 ----------

export const WEATHERS = [
  { key: "clear", name: "晴朗", icon: "☀️", atk: 1, def: 1, pace: 1, error: 1, injury: 1 },
  { key: "rain", name: "雨战", icon: "🌧️", atk: 0.93, def: 1.05, pace: 0.9, error: 1.25, injury: 1.1 },
  { key: "wind", name: "大风", icon: "💨", atk: 0.96, def: 0.98, pace: 0.94, error: 1.15, injury: 1 },
  { key: "cold", name: "严寒", icon: "❄️", atk: 0.97, def: 1.02, pace: 0.95, error: 1.05, injury: 1.2 },
  { key: "heat", name: "酷热", icon: "🔥", atk: 0.98, def: 0.97, pace: 0.88, error: 1.08, injury: 1.15 },
];

export function pickWeather(random = rng) {
  const r = random();
  if (r < 0.42) return WEATHERS[0];
  if (r < 0.62) return WEATHERS[1];
  if (r < 0.76) return WEATHERS[2];
  if (r < 0.9) return WEATHERS[3];
  return WEATHERS[4];
}

/** 按 key 取天气；未知则重新抽取 */
export function weatherByKey(key, random = rng) {
  return WEATHERS.find((w) => w.key === key) || pickWeather(random);
}

function averageAttrs(player, keys) {
  const values = keys.map((key) => Number(player?.attrs?.[key])).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 10;
}

/** 球员属性对天气的适应度；不添加隐藏能力。 */
export function weatherPlayerScore(player, weatherKey) {
  if (weatherKey === "rain") {
    return averageAttrs(player, player?.pos === "GK"
      ? ["handling", "positioning", "kicking"]
      : ["dribbling", "passing", "positioning"]);
  }
  if (weatherKey === "wind") return averageAttrs(player, ["passing", "vision", "kicking", "strength"]);
  if (weatherKey === "cold") return averageAttrs(player, ["physical", "strength", "stamina"]);
  if (weatherKey === "heat") return averageAttrs(player, ["stamina", "physical", "positioning"]);
  return 11;
}

export function weatherTeamImpact(club, weather) {
  const players = getLineupPlayers(club);
  if (!players.length || !weather || weather.key === "clear") {
    return { score: 11, atk: 1, def: 1, fatigue: 1, injury: 1, best: null, risk: null };
  }
  const ranked = players
    .map((player) => ({ player, score: weatherPlayerScore(player, weather.key) }))
    .sort((a, b) => b.score - a.score);
  const score = ranked.reduce((sum, item) => sum + item.score, 0) / ranked.length;
  const delta = clamp((score - 11) / 9, -1, 1);
  return {
    score: Math.round(score * 10) / 10,
    atk: 1 + delta * 0.035,
    def: 1 + delta * 0.025,
    fatigue: 1 - delta * (weather.key === "heat" ? 0.12 : 0.06),
    injury: 1 - delta * (weather.key === "cold" || weather.key === "heat" ? 0.1 : 0.06),
    best: ranked[0]?.player || null,
    risk: ranked[ranked.length - 1]?.player || null,
  };
}

function fixtureImportance(world, fixture) {
  const type = fixture?.competitionType || (fixture?.competition === "cup" ? "domestic-cup" : "league");
  const round = String(fixture?.roundLabel || "");
  if (type === "continental-knockout" || round.includes("决赛") || round.includes("半决赛")) return 1;
  if (type === "continental-league-stage") return 0.88;
  if (type === "domestic-cup") return 0.78;
  const tableRow = world?.table?.[fixture?.home];
  const progress = tableRow?.played ? tableRow.played / 34 : 0;
  return progress >= 0.8 ? 0.86 : 0.62;
}

/**
 * 赛前锁定天气（简报与开赛一致）
 * @returns {typeof WEATHERS[0]}
 */
export function ensureFixtureWeather(fixture, random = rng) {
  // Consume one roll even when a previous preview already locked the weather,
  // keeping every replay's subsequent simulation rolls aligned.
  const roll = random();
  const select = () => {
    if (roll < 0.42) return WEATHERS[0];
    if (roll < 0.62) return WEATHERS[1];
    if (roll < 0.76) return WEATHERS[2];
    if (roll < 0.9) return WEATHERS[3];
    return WEATHERS[4];
  };
  if (!fixture) return select();
  if (fixture.preWeather && typeof fixture.preWeather === "object" && fixture.preWeather.key) {
    return weatherByKey(fixture.preWeather.key);
  }
  if (fixture.weather && typeof fixture.weather === "string") {
    const w = weatherByKey(fixture.weather);
    fixture.preWeather = { key: w.key, name: w.name, icon: w.icon };
    return w;
  }
  const w = select();
  fixture.preWeather = { key: w.key, name: w.name, icon: w.icon };
  return w;
}

/** 同级固定种子宿敌（约 1/7 对阵） */
export function isDerby(home, away) {
  if (!home || !away) return false;
  if ((home.division || 3) !== (away.division || 3)) return false;
  const key = [home.id, away.id].sort().join("|");
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return Math.abs(h) % 7 === 0;
}

export function isBigMatch(world, home, away, isCup) {
  if (isCup) {
    const dh = home.division || 3;
    const da = away.division || 3;
    if (dh !== da) return true; // 跨级杯赛
  }
  if (DIVISIONS[home.division || 3]?.tier === 1) {
    const ph = home.power || 50;
    const pa = away.power || 50;
    if (ph >= 72 && pa >= 72) return true;
  }
  return false;
}

/**
 * 综合战术修正：风格 + 压迫/节奏 + 宽度/防线 + 阵型 + 风格克制
 * @param {object} tactics 我方
 * @param {object} [oppTactics] 对方（用于克制）
 */
function applyStyle(strength, tactics, side, oppTactics = null) {
  const t = tactics || {};
  const mod = STYLE_MOD[t.style] || STYLE_MOD.balanced;
  const form = FORMATION_MOD[t.formation] || FORMATION_MOD["4-3-3"];
  const press = 1 + ((t.pressing || 3) - 3) * 0.035;
  const tempo = 1 + ((t.tempo || 3) - 3) * 0.03;
  // 宽度：偏宽利于进攻与边路，略损中路防守；偏窄反之
  const widthDelta = ((t.width || 3) - 3) * 0.025;
  // 防线：偏高压迫前场/易被打身后；偏低更稳
  const lineDelta = ((t.defensiveLine || 3) - 3) * 0.028;
  const mu = styleMatchupMod(t.style || "balanced", oppTactics?.style || "balanced");

  if (side === "atk") {
    let v = strength * mod.atk * form.atk * tempo;
    v *= 0.97 + press * 0.03;
    v *= 1 + widthDelta;
    v *= 1 + lineDelta * 0.6;
    v *= mu.atk;
    // 中场人数优势略提串联
    v *= 0.97 + (form.midfield || 1) * 0.03;
    return v;
  }
  let d = strength * mod.def * form.def * press;
  d *= 1 - widthDelta * 0.7;
  d *= 1 - lineDelta; // 高位防线防守更脆
  d *= mu.def;
  d *= 0.98 + (form.midfield || 1) * 0.02;
  return d;
}

/** 风格/压迫对控球 tick 的权重 */
function possessionWeight(tactics) {
  const mod = STYLE_MOD[tactics?.style] || STYLE_MOD.balanced;
  const press = 1 + ((tactics?.pressing || 3) - 3) * 0.04;
  const tempo = 1 + ((tactics?.tempo || 3) - 3) * 0.02;
  return (mod.possession || 1) * press * (2 - tempo * 0.15);
}

/** 犯规风险乘子 */
function foulRiskOf(tactics) {
  const mod = STYLE_MOD[tactics?.style] || STYLE_MOD.balanced;
  const press = 1 + Math.max(0, (tactics?.pressing || 3) - 3) * 0.12;
  const line = 1 + Math.max(0, (tactics?.defensiveLine || 3) - 3) * 0.06;
  return (mod.foulRisk || 1) * press * line;
}

/** 威胁频率乘子（节奏快/进攻型更多射门尝试） */
function chanceMultOf(tactics) {
  const mod = STYLE_MOD[tactics?.style] || STYLE_MOD.balanced;
  const tempo = 1 + ((tactics?.tempo || 3) - 3) * 0.05;
  return (mod.chance || 1) * tempo;
}

/** 体能消耗相关 */
function fitnessMultOf(tactics) {
  const mod = STYLE_MOD[tactics?.style] || STYLE_MOD.balanced;
  const press = 1 + Math.max(0, (tactics?.pressing || 3) - 3) * 0.08;
  const line = 1 + Math.max(0, (tactics?.defensiveLine || 3) - 3) * 0.04;
  return (mod.fitness || 1) * press * line;
}

/**
 * 结算一次「15 分钟整点」的体能消耗。
 *
 * 🔴 口径（2026-09-21 改）：**球队总量不变，按本窗口的跑动距离占比分摊到个人**。
 * 旧实现是「每人固定扣 `perPlayer`」⇒ 中场面板 11 人**完全同值**（实测全员 87），
 * 用户报的「各队员体能显示不对」就是这个。而引擎侧那份逐人体能几乎没有个体差异
 * （实测队内 spread 只有 0.39 / 总耗 4.84；`stamina` 被 `norm()` 压到 1.064×，
 * `pressing` 是球队级，`workRate` 只区分三个瞬时状态）⇒
 * **「读引擎 `agent.fitness` 回写」修不好它**，见
 * `docs/measurements/halftime-fitness-per-player-2026-09-21.txt`。
 *
 * 现在用**引擎每帧本来就有的真实位移**（`agent.runMetres`）作为个体负荷：
 * 实测队内 max/min 跑动比值 **3.889**（比赛级 SD 0.287，48 场标定），
 * 与现实足球一致（中场 ~10km / 中卫 ~9km / 门将 ~3km）。
 *
 * ⚠ 三条不变量：
 *  1. **球队总量精确守恒**：每人名义扣减 `perPlayer` × 人数 = 球队总量，
 *     用**最大余数法**取整分摊 ⇒ `Σ drain_i` **精确等于**球队总量
 *     ⇒ 未触 30 下限时，全队 `Σ fitness` 的轨迹与旧实现**逐位相同**。
 *  2. 只改**队内分布**，不改球队均值 ⇒ **零重标定**。
 *  3. 没有引擎数据 / 本窗口无人跑动（含读档后引擎重建）⇒ **回退到旧的等额扣减**。
 *
 * ⚠ 三处调用点的 `extra` 保持各自原语义（两个直播路径带 `weather.pace` 项、
 *   同步路径不带）。这个不一致是**既有的、未测量的**，本次不动它。
 */
function settleFitnessDrain(state, club, sk, extra = 0) {
  const fitW = state._fitW?.[sk] || fitnessMultOf(club.tactics);
  const perPlayer = Math.max(1, Math.round(fitW + extra));
  const xi = activeXi(state, club);
  if (!xi.length) return;
  const teamTotal = perPlayer * xi.length;

  // 每个球员的**本场累计跑动距离**（米），直接作为分摊权重。
  //
  // ⚠ 为什么不用「本窗口增量」：**引擎在分钟循环开始前就把整段跑完了**
  //   （`runSimPeriodRaw` 一次性推进到 `toMin`），所以 minute 15 那次结算读到的
  //   已经是整段的累计值，而 30/45 两次的增量恒为 **0** ⇒ 会退化成「等额扣减」。
  //   （实测日志：min15 work 有值、min30/45 全是 0。）
  //   ⇒ 改用累计值分摊。这是安全的：分摊只取决于**队内分布**，而分布在同一场里
  //     是稳定的（48 场标定 max/min 3.889，比赛级 SD 0.287）。
  //   附带好处：不需要任何额外状态 ⇒ 读档后引擎重建（`runMetres` 全 0）自动走回退。
  const agents = state.simEng?.agents;
  let work = null;
  if (Array.isArray(agents) && agents.length) {
    const runById = new Map();
    for (const a of agents) if (a && a.id != null) runById.set(a.id, Number(a.runMetres) || 0);
    if (xi.every((p) => runById.has(p.id))) work = xi.map((p) => runById.get(p.id));
  }
  const sumWork = work ? work.reduce((s, v) => s + v, 0) : 0;

  if (!work || sumWork <= 0) {
    for (const p of xi) p.fitness = Math.round(Math.max(30, (p.fitness || 100) - perPlayer));
    return;
  }

  // 🔴 分摊值**保留小数，不取整**。
  // 为什么：`perPlayer` 实测只有 **1 点**（`max(1, round(fitW))`，默认战术 fitW < 1.5），
  // 球队总量 11 摊到 11 人 ⇒ 平均每人 1 点。而队内跑动差异是 3.7×，
  // 落在整数上只有 {0,1,2} —— **实测取整后 11 人全是 1**，机制等于没生效
  // （连「最大余数法」也救不了：那是保总量，不是保分辨率）。
  // ⇒ 保留小数。`Σ drain` 仍精确等于 `teamTotal`（实数运算）⇒ 球队均值仍逐位不变，
  //   只是「队内分布」终于表达得出来。面板/提示读到的都是 `Math.round(...)`，
  //   所以显示不受影响，而 3 次结算累积后差异变成可见的 86~89。
  const exact = work.map((w) => (w / sumWork) * teamTotal);
  for (let i = 0; i < xi.length; i++) {
    const p = xi[i];
    p.fitness = Math.max(30, (p.fitness || 100) - exact[i]);
  }
}

function formScore(club, n = 5) {
  const f = club.form || [];
  const slice = f.slice(-n);
  let s = 0;
  for (const x of slice) {
    if (x === "W") s += 1;
    else if (x === "L") s -= 1;
  }
  return { score: s, len: slice.length };
}

function identityFormationForContext(identity, intent, fallback) {
  const candidates = (identity?.preferredFormations || []).filter((formation) => FORMATIONS[formation]);
  if (!candidates.length) return fallback;
  const shapeScore = (formation) => {
    const slots = FORMATIONS[formation]?.slots || [];
    const defenders = slots.filter((slot) => slot.pos === "DEF").length;
    const attackers = slots.filter((slot) => slot.pos === "ATT").length;
    if (intent === "defend") return defenders * 4 - attackers * 2;
    if (intent === "attack") return attackers * 4 - defenders;
    return 0;
  };
  return candidates.sort((a, b) => shapeScore(b) - shapeScore(a))[0] || fallback;
}

function aiTuneTactics(club, opponent, world) {
  if (!club?.tactics || club.id === world.userClubId) return;
  ensureStaff(club);
  ensureTactics(club);
  const coach = club.staff?.coach || null;
  const identity = ensureCoachIdentity(coach);
  if (identity) {
    if (
      club.tactics.coachIdentityId !== coach.id
      || club.tactics.coachIdentityVersion !== identity.version
      || !identity.preferredFormations.includes(club.tactics.formation)
    ) {
      applyCoachTacticalIdentity(club, coach, { force: true, rebuildLineup: false });
    } else {
      club.tactics.style = identity.style;
      club.tactics.pressing = identity.pressing;
      club.tactics.tempo = identity.tempo;
      club.tactics.width = identity.width;
      club.tactics.defensiveLine = identity.defensiveLine;
    }
  }
  const t = club.tactics;
  const fs = formScore(club, 5);
  const myP = club.power || 50;
  const opP = opponent?.power || 50;
  const diff = myP - opP;
  const oppStyle = opponent?.tactics?.style || "balanced";
  const adaptability = Number(identity?.adaptability || 3);

  if (fs.len >= 3 && fs.score <= -2 && adaptability >= 3) {
    t.style = identity?.style === "defend" ? "defend" : "counter";
    t.pressing = Math.max(1, (t.pressing || 3) - 1);
    t.tempo = Math.max(1, (t.tempo || 3) - 1);
    t.defensiveLine = Math.max(1, (t.defensiveLine || 3) - 1);
    t.width = Math.max(2, (t.width || 3) - 1);
    if (adaptability >= 4) {
      t.formation = identityFormationForContext(identity, "defend", t.formation);
    }
  } else if (fs.len >= 3 && fs.score >= 2 && adaptability >= 3) {
    t.pressing = Math.min(5, Math.max(3, (t.pressing || 3) + 1));
    t.tempo = Math.min(5, Math.max(3, (t.tempo || 3) + 1));
    t.defensiveLine = Math.min(5, (t.defensiveLine || 3) + 1);
    if (adaptability >= 4) {
      t.formation = identityFormationForContext(identity, "attack", t.formation);
    }
  } else if (diff <= -12 && adaptability >= 2) {
    t.style = identity?.style === "defend" ? "defend" : "counter";
    t.pressing = Math.min(t.pressing || 3, 2);
    t.tempo = Math.max(t.tempo || 3, 4);
    t.defensiveLine = Math.min(t.defensiveLine || 3, 2);
    t.width = Math.min(t.width || 3, 3);
    t.formation = identityFormationForContext(identity, "defend", t.formation);
  } else if (diff >= 12 && adaptability >= 2) {
    t.style = identity?.style === "possession" ? "possession" : "attack";
    t.pressing = Math.max(t.pressing || 3, 4);
    t.tempo = t.style === "possession" ? Math.min(t.tempo || 3, 3) : Math.max(t.tempo || 3, 4);
    t.defensiveLine = Math.max(t.defensiveLine || 3, 4);
    t.width = Math.max(t.width || 3, 4);
    t.formation = identityFormationForContext(identity, "attack", t.formation);
  } else if (adaptability >= 4) {
    // 对阵风格克制：对方猛攻 → 防反；对方龟缩 → 控球/高压
    if (oppStyle === "attack" && chance(0.55)) {
      t.style = "counter";
      t.defensiveLine = Math.min(t.defensiveLine || 3, 2);
      t.pressing = Math.min(t.pressing || 3, 2);
    } else if (oppStyle === "defend" && chance(0.5)) {
      t.style = identity?.style === "possession" ? "possession" : "attack";
      t.pressing = Math.max(t.pressing || 3, 4);
      t.defensiveLine = Math.max(t.defensiveLine || 3, 4);
    } else if (oppStyle === "possession" && chance(0.45)) {
      t.style = "counter";
      t.tempo = Math.max(t.tempo || 3, 4);
    }
  }
  ensureMatchLineup(club, {
    forceAuto: true,
    youthPriority: identity?.youthTrust >= 4 ? "high" : "normal",
    rotation: identity?.rotation >= 4
      ? "fitness"
      : identity?.rotation <= 2
        ? "strongest"
        : "balanced",
  });
}

function emptySideStats() {
  return {
    shots: 0,
    shotsOn: 0,
    xg: 0,
    corners: 0,
    fouls: 0,
    yellows: 0,
    reds: 0,
    possessionTicks: 0,
    saves: 0,
    woodwork: 0,
  };
}

function recomputeSides(state) {
  const { home, away, weather, derby, bigMatch, isCup } = state;
  ensureTactics(home);
  ensureTactics(away);
  ensureLineupRoles(home);
  ensureLineupRoles(away);
  const hs = teamStrength(home);
  const as = teamStrength(away);
  if (!state.preMatchStrength) state.preMatchStrength = { home: hs, away: as };
  let homeAtk = applyStyle(hs, home.tactics, "atk", away.tactics);
  let homeDef = applyStyle(hs, home.tactics, "def", away.tactics);
  let awayAtk = applyStyle(as, away.tactics, "atk", home.tactics);
  let awayDef = applyStyle(as, away.tactics, "def", home.tactics);

  // 槽位角色：整队微量攻防修正
  const hRole = teamRoleMods(home);
  const aRole = teamRoleMods(away);
  homeAtk *= hRole.atk;
  homeDef *= hRole.def;
  awayAtk *= aRole.atk;
  awayDef *= aRole.def;
  // 记录未应用比赛情境前的基线。空间引擎也要消费同一套赛前/天气/教练/讲话修正，
  // 否则用户场与后台概率场会对同一事实得出不同结果。
  const simBase = {
    home: { atk: homeAtk, def: homeDef },
    away: { atk: awayAtk, def: awayDef },
  };
  state._roleMods = { home: hRole, away: aRole };

  // 赛前准备加成
  const homePrep = applyMatchPrepBonus(home, away);
  const awayPrep = applyMatchPrepBonus(away, home);
  state._matchPrep = { home: homePrep, away: awayPrep };

  // 应用赛前准备效果：体能/士气为间接影响，攻防演练为直接影响
  // 训练模式的代价（体能 -2、士气 -1）同样计入，因此不做正数过滤
  const prepMods = (prep) => ({
    atk:
      (1 + prep.fitness * 0.005) *
      (1 + prep.morale * 0.008) *
      (1 + prep.attacking / 100),
    def: (1 + prep.fitness * 0.005) * (1 + prep.defending / 100),
  });
  const hPrepMod = prepMods(homePrep);
  const aPrepMod = prepMods(awayPrep);
  homeAtk *= hPrepMod.atk;
  homeDef *= hPrepMod.def;
  awayAtk *= aPrepMod.atk;
  awayDef *= aPrepMod.def;

  // 缓存控球/犯规/威胁权重供 tryAttack 使用
  state._possW = {
    home: possessionWeight(home.tactics) * hRole.poss,
    away: possessionWeight(away.tactics) * aRole.poss,
  };
  state._foulW = {
    home: foulRiskOf(home.tactics) * hRole.foul,
    away: foulRiskOf(away.tactics) * aRole.foul,
  };
  state._chanceW = {
    home: chanceMultOf(home.tactics) * hRole.chance,
    away: chanceMultOf(away.tactics) * aRole.chance,
  };
  state._fitW = {
    home: fitnessMultOf(home.tactics) * hRole.fit,
    away: fitnessMultOf(away.tactics) * aRole.fit,
  };

  const hCoach = coachMatchMod(home);
  const aCoach = coachMatchMod(away);
  homeAtk *= hCoach;
  homeDef *= hCoach;
  awayAtk *= aCoach;
  awayDef *= aCoach;

  // 1–20 总评会压缩顶层差距；温和放大双方实际首发（含体能/士气）的相对优势。
  // 只强化已有能力差，不读取俱乐部名望或现实映射档案，且上下限避免悬殊比分失控。
  const lineupEdge = clamp(Math.pow(hs / Math.max(as, 1), 0.65), 0.88, 1.14);
  homeAtk *= lineupEdge;
  homeDef *= lineupEdge;
  awayAtk /= lineupEdge;
  awayDef /= lineupEdge;

  // 主场
  homeAtk *= 1.06;
  homeDef *= 1.04;

  // 天气
  homeAtk *= weather.atk;
  awayAtk *= weather.atk;
  homeDef *= weather.def;
  awayDef *= weather.def;
  const hWeather = weatherTeamImpact(home, weather);
  const aWeather = weatherTeamImpact(away, weather);
  homeAtk *= hWeather.atk;
  homeDef *= hWeather.def;
  awayAtk *= aWeather.atk;
  awayDef *= aWeather.def;
  state._fitW.home *= hWeather.fatigue;
  state._fitW.away *= aWeather.fatigue;
  state._weatherImpact = { home: hWeather, away: aWeather };
  const pace = weather.pace;

  // 德比：更开放、更高犯规
  if (derby) {
    homeAtk *= 1.06;
    awayAtk *= 1.06;
    homeDef *= 0.97;
    awayDef *= 0.97;
  }
  // 焦点战
  if (bigMatch) {
    homeAtk *= 1.03;
    awayAtk *= 1.03;
  }
  // 杯赛弱队爆冷空间
  if (isCup) {
    const dh = home.division || 3;
    const da = away.division || 3;
    if (dh > da) {
      // 主队级别更低 → 略提士气
      homeAtk *= 1.04;
      homeDef *= 1.03;
    } else if (da > dh) {
      awayAtk *= 1.04;
      awayDef *= 1.03;
    }
  }

  // 红牌减员
  const hRed = state.sentOff.home.size;
  const aRed = state.sentOff.away.size;
  if (hRed) {
    homeAtk *= Math.pow(0.88, hRed);
    homeDef *= Math.pow(0.86, hRed);
  }
  if (aRed) {
    awayAtk *= Math.pow(0.88, aRed);
    awayDef *= Math.pow(0.86, aRed);
  }

  // 保留讲话前的比赛情境基线。空间引擎需要看到天气、教练、阵容、赛事
  // 情境和红牌，但不能让这些叠加项把不同讲话压到同一个上限，导致临场指令失去因果差异。
  const simContext = {
    home: { atk: homeAtk, def: homeDef },
    away: { atk: awayAtk, def: awayDef },
  };

  // 队内讲话（本半场）
  const talkH = state.teamTalkMods?.home;
  const talkA = state.teamTalkMods?.away;
  if (talkH) {
    homeAtk *= talkH.atk ?? 1;
    homeDef *= talkH.def ?? 1;
    if (state._possW) state._possW.home *= talkH.poss ?? 1;
    if (state._foulW) state._foulW.home *= talkH.foul ?? 1;
    if (state._chanceW) state._chanceW.home *= talkH.chance ?? 1;
  }
  if (talkA) {
    awayAtk *= talkA.atk ?? 1;
    awayDef *= talkA.def ?? 1;
    if (state._possW) state._possW.away *= talkA.poss ?? 1;
    if (state._foulW) state._foulW.away *= talkA.foul ?? 1;
    if (state._chanceW) state._chanceW.away *= talkA.chance ?? 1;
  }
  let paceTalk = pace;
  if (talkH?.pace) paceTalk *= talkH.pace;
  if (talkA?.pace) paceTalk *= talkA.pace;

  state.homeAtk = homeAtk;
  state.homeDef = homeDef;
  state.awayAtk = awayAtk;
  state.awayDef = awayDef;
  state.pace = paceTalk;
  state.homeXG = Math.max(0.15, (homeAtk / Math.max(awayDef, 1)) * 1.15 * paceTalk);
  state.awayXG = Math.max(0.12, (awayAtk / Math.max(homeDef, 1)) * 1.0 * paceTalk);

  // 只把“额外比赛情境”传给空间引擎；阵型、风格和球员能力本身已经由 SimEngine
  // 直接读取，避免重复叠加。该对象会在中场/临场调整后被重新计算并同步到引擎。
  const talkMods = state.teamTalkMods || {};
  const prepSetpiece = (prep) => 1 + (prep?.setpiece || 0) / 100;
  const simContextMod = (value, base) => clamp(value / Math.max(base, 0.01), 0.84, 1.16);
  state.simModifiers = {
    home: {
      atk: clamp(simContextMod(simContext.home.atk, simBase.home.atk) * (talkMods.home?.atk ?? 1), 0.75, 1.25),
      def: clamp(simContextMod(simContext.home.def, simBase.home.def) * (talkMods.home?.def ?? 1), 0.75, 1.25),
      chance: clamp(talkMods.home?.chance ?? 1, 0.82, 1.22),
      poss: clamp(talkMods.home?.poss ?? 1, 0.82, 1.22),
      foul: clamp(talkMods.home?.foul ?? 1, 0.82, 1.22),
      pace: clamp(talkMods.home?.pace ?? 1, 0.82, 1.22),
      fitness: clamp((state._fitW?.home || 1), 0.75, 1.25),
      setpiece: clamp(prepSetpiece(homePrep), 0.82, 1.22),
    },
    away: {
      atk: clamp(simContextMod(simContext.away.atk, simBase.away.atk) * (talkMods.away?.atk ?? 1), 0.75, 1.25),
      def: clamp(simContextMod(simContext.away.def, simBase.away.def) * (talkMods.away?.def ?? 1), 0.75, 1.25),
      chance: clamp(talkMods.away?.chance ?? 1, 0.82, 1.22),
      poss: clamp(talkMods.away?.poss ?? 1, 0.82, 1.22),
      foul: clamp(talkMods.away?.foul ?? 1, 0.82, 1.22),
      pace: clamp(talkMods.away?.pace ?? 1, 0.82, 1.22),
      fitness: clamp((state._fitW?.away || 1), 0.75, 1.25),
      setpiece: clamp(prepSetpiece(awayPrep), 0.82, 1.22),
    },
  };
  if (state.simEng) state.simEng.matchModifiers = state.simModifiers;
}

/**
 * 创建比赛会话（不写最终结果）
 */
export function createMatchSession(world, fixture, opts = {}) {
  const home = clubById(world, fixture.home);
  const away = clubById(world, fixture.away);
  if (!home || !away) throw new Error("invalid fixture clubs");

  ensureStaff(home);
  ensureStaff(away);
  ensureTactics(home);
  ensureTactics(away);
  const matchSeed = ensureMatchSeed(world, fixture);
  const previousRandom = activeRandom;
  const random = matchRandom(world, fixture);
  activeRandom = random;
  const importance = fixtureImportance(world, fixture);
  if (home.id !== world.userClubId) aiTuneTactics(home, away, world);
  if (away.id !== world.userClubId) aiTuneTactics(away, home, world);
  const homeEligibleIds = eligiblePlayerIds(world, home, fixture);
  const awayEligibleIds = eligiblePlayerIds(world, away, fixture);
  const userClub = home.id === world.userClubId ? home : away.id === world.userClubId ? away : null;
  if (userClub) {
    applyPreMatchDelegation(world, userClub, fixture, {
      importance,
      eligibleIds: userClub === home ? homeEligibleIds : awayEligibleIds,
    });
  }
  // 用户保留手动/上次首发；AI 强制重排
  ensureMatchLineup(home, { forceAuto: home.id !== world.userClubId, day: world.day, importance, eligibleIds: homeEligibleIds });
  ensureMatchLineup(away, { forceAuto: away.id !== world.userClubId, day: world.day, importance, eligibleIds: awayEligibleIds });
  const homeCoachShapes = home.id !== world.userClubId || isFullyDelegated(world, home, "tactics");
  const awayCoachShapes = away.id !== world.userClubId || isFullyDelegated(world, away, "tactics");
  const homeOpponentSnapshot = { id: away.id, power: away.power, tactics: { ...away.tactics } };
  const awayOpponentSnapshot = { id: home.id, power: home.power, tactics: { ...home.tactics } };
  const homePhasePlan = homeCoachShapes
    ? applyCoachPhaseFormations(home, home.staff?.coach, { opponent: homeOpponentSnapshot })
    : null;
  const awayPhasePlan = awayCoachShapes
    ? applyCoachPhaseFormations(away, away.staff?.coach, { opponent: awayOpponentSnapshot })
    : null;
  // 主客都保证有核心（用户已指定则保留；AI / 未指定则自动选进攻最强的）
  // 避免「只有用户队会回撤内切/绝对进攻权」的单方面表现
  ensureCorePlayer(home);
  ensureCorePlayer(away);
  ensureCaptain(home);
  ensureCaptain(away);
  ensureSetPieceTakers(home);
  ensureSetPieceTakers(away);

  const competitionType =
    fixture.competitionType || (fixture.competition === "cup" ? "domestic-cup" : "league");
  const isLeague = competitionType === "league";
  const isKnockout =
    competitionType === "domestic-cup" || competitionType === "continental-knockout";
  // 旧代码中的 isCup 表示“不计入国内联赛数据”。
  const isCup = !isLeague;
  // 与赛前简报同一天气（已锁定则复用）
  const weather = ensureFixtureWeather(fixture, random);
  const derby = isDerby(home, away);
  const bigMatch = isBigMatch(world, home, away, isCup);

  // 备份战术（半场改完可保留到终场）
  const userSide =
    home.id === world.userClubId ? "home" : away.id === world.userClubId ? "away" : null;
  const engineMode =
    opts.engineMode === "spatial"
      ? "spatial"
      : opts.engineMode === "probability"
        ? "probability"
        : userSide
          ? "spatial"
          : "probability";
  const simulationProfile =
    engineMode === "spatial" && opts.simulationProfile === "background"
      ? "background"
      : "standard";

  const state = {
    world,
    fixture,
    home,
    away,
    isCup,
    isLeague,
    isKnockout,
    competitionType,
    weather,
    matchSeed,
    previousRandom,
    random,
    importance,
    derby,
    bigMatch,
    events: [],
    stats: { home: emptySideStats(), away: emptySideStats() },
    hg: 0,
    ag: 0,
    phase: "pre",
    yellowCount: new Map(), // playerId -> n
    sentOff: { home: new Set(), away: new Set() }, // player ids
    injuredOut: new Set(),
    subsUsed: { home: 0, away: 0 },
    /** 正式比赛：每队最多 5 次换人（与当代足球/FMM 一致） */
    maxSubs: 5,
    eligiblePlayerIds: { home: homeEligibleIds, away: awayEligibleIds },
    userSide,
    userClub,
    /** 比赛事实引擎；表现模式不能再隐式决定比赛规律。 */
    engineMode,
    /** standard=直播同精度；background=同一空间因果的无画面性能档。 */
    simulationProfile,
    finished: false,
    report: null,
    /** 队内讲话侧修正 { home|away: mods } */
    teamTalkMods: { home: null, away: null },
    /** 已选讲话记录 { pre?, ht? } */
    teamTalks: {},
    startingLineups: {
      home: [...(home.tactics.lineup || [])],
      away: [...(away.tactics.lineup || [])],
    },
    phaseShapeTimeline: [
      phaseShapeDecision(home, awayOpponentSnapshot, homePhasePlan, {
        team: "home",
        minute: 0,
        trigger: "pre-match",
        source: homeCoachShapes ? "coach" : "player",
      }),
      phaseShapeDecision(away, homeOpponentSnapshot, awayPhasePlan, {
        team: "away",
        minute: 0,
        trigger: "pre-match",
        source: awayCoachShapes ? "coach" : "player",
      }),
    ],
  };

  recomputeSides(state);
  return state;
}

/**
 * 应用队内讲话：士气 + 本半场攻防修正 + 事件 + 媒体
 * @param {"pre"|"ht"} phase
 * @param {{ managed?: boolean }} [options]
 */
export function applyTeamTalk(state, talkId, phase = "pre", options = {}) {
  const club = state?.userClub;
  const talk = TEAM_TALKS[talkId];
  if (!club || !talk || !state.userSide) {
    return { ok: false, msg: "无法讲话" };
  }
  if (shouldStaffHandleMatchday(state.world, club) && !options.managed) {
    return { ok: false, msg: "队内讲话已委托主教练" };
  }
  if (!talk.phases.includes(phase)) {
    return { ok: false, msg: "该讲话不适用当前阶段" };
  }

  const sk = state.userSide;
  const minute = phase === "ht" ? 45 : 0;
  const mods = { ...(talk.mods || {}) };
  if (!state.teamTalkMods) state.teamTalkMods = { home: null, away: null };
  // 中场讲话覆盖赛前效果（本半场重新定调）
  state.teamTalkMods[sk] = mods;
  if (!state.teamTalks) state.teamTalks = {};
  state.teamTalks[phase] = talkId;

  // 首发士气
  const xi = getLineupPlayers(club);
  const dMorale = talk.morale || 0;
  for (const p of xi) {
    if (!p) continue;
    p.morale = clamp((p.morale ?? 70) + dMorale, 20, 100);
  }

  recomputeSides(state);

  const label = teamTalkLabel(talkId, "zh");
  const phaseLabel = phase === "ht" ? "中场讲话" : "赛前讲话";
  const quote = talk.quote || "";
  pushEv(
    state,
    minute,
    "coach",
    `💬 ${phaseLabel} · ${label}${quote ? `：${quote}` : ""}`,
    {
      teamId: club.id,
      teamTalk: talkId,
      phase,
      morale: dMorale,
    }
  );

  // 媒体引用（赛前/中场各一篇，不过度刷屏）
  if (state.world) {
    const tone = talk.mediaTone || "neutral";
    pushMedia(state.world, {
      outlet: "更衣室八卦",
      headline: talk.headline || `${club.name} 主帅发表${phaseLabel}`,
      body: `${club.short || club.name} 更衣室。${quote} 记者写道：这番讲话${
        dMorale > 0 ? "明显提振了士气" : dMorale < 0 ? "让部分球员表情凝重" : "偏战术布置，情绪波动不大"
      }。`,
      tone,
      category: "feature",
    });
  }

  return {
    ok: true,
    talkId,
    label,
    msg: `${phaseLabel}：${label}`,
    morale: dMorale,
  };
}

/** 俱乐部经营模式：按比分、阵型和球队状态由主教练选择讲话。 */
export function applyManagedTeamTalk(state, phase = "pre") {
  const club = state?.userClub;
  if (!club || !shouldStaffHandleMatchday(state.world, club)) {
    return { ok: false, msg: "当前不是主教练代管比赛" };
  }
  const t = club.tactics || {};
  const myGoals = club === state.home ? state.hg : state.ag;
  const oppGoals = club === state.home ? state.ag : state.hg;
  let talkId = "encourage";
  if (phase === "ht") {
    if (myGoals < oppGoals) talkId = "demand";
    else if (myGoals > oppGoals + 1) talkId = "solid";
    else if (myGoals > oppGoals) talkId = "control";
    else if (t.style === "defend") talkId = "solid";
    else if (t.style === "possession") talkId = "control";
  } else if (t.style === "defend") {
    talkId = "solid";
  } else if (t.style === "possession") {
    talkId = "control";
  } else if (t.style === "attack" || t.style === "counter") {
    talkId = "encourage";
  }
  return applyTeamTalk(state, talkId, phase, { managed: true });
}

/** 推荐中场讲话（按比分，仅 UI 提示） */
export function suggestHalfTimeTalk(state) {
  const club = state?.userClub;
  if (!club) return "encourage";
  const myG = club === state.home ? state.hg : state.ag;
  const opG = club === state.home ? state.ag : state.hg;
  if (myG < opG) return "demand"; // 落后加压
  if (myG > opG) return "solid"; // 领先守住
  return "encourage";
}

function pushEv(state, minute, type, text, extra = {}) {
  const ev = { minute, type, text, ...extra };
  state.events.push(ev);
  return ev;
}

function sideKey(state, club) {
  return club.id === state.home.id ? "home" : "away";
}

function activeXi(state, club) {
  const sk = sideKey(state, club);
  const sent = state.sentOff[sk];
  return getLineupPlayers(club).filter(
    (p) => p && !sent.has(p.id) && !state.injuredOut.has(p.id) && (p.injured || 0) <= 0
  );
}

function ensureStats(p) {
  ensurePlayerHistory(p);
  return p.stats;
}

function continentalStats(state, player, club) {
  if (!state.fixture?.competitionId || !String(state.competitionType || "").startsWith("continental")) {
    return null;
  }
  return ensureCompetitionStats(player, state.fixture.competitionId, club.id);
}

function weightedPick(pool, weightFn) {
  if (!pool.length) return null;
  let total = 0;
  const weights = pool.map((p) => {
    const w = Math.max(0.01, weightFn(p));
    total += w;
    return w;
  });
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/** 从 state + club 取球员角色加成（进球/助攻/抢断） */
function roleWeights(state, club, player) {
  if (!player) return { score: 0, assist: 0, tackle: 0 };
  const r = roleDefForPlayer(club, player.id);
  if (r) return { score: r.score || 0, assist: r.assist || 0, tackle: r.tackle || 0 };
  // 无角色时按位置兜底
  if (player.pos === "ATT") return { score: 2.5, assist: 1, tackle: 0.3 };
  if (player.pos === "MID") return { score: 1.2, assist: 2, tackle: 1.2 };
  if (player.pos === "DEF") return { score: 0.5, assist: 0.6, tackle: 1.8 };
  return { score: 0, assist: 0.2, tackle: 0.3 };
}

function pickScorer(xi, state, club) {
  const attackers = xi.filter((p) => p.pos === "ATT" || p.pos === "MID");
  const pool = attackers.length ? attackers : xi;
  return weightedPick(pool, (p) => {
    const rw = roleWeights(state, club, p);
    ensurePlayerRelation(p);
    return (
      ((p.attrs?.finishing || p.attrs?.shooting || 10) +
        (p.pos === "ATT" ? 4 : p.pos === "MID" ? 1.5 : 0) +
        rw.score * 1.8 +
        rng() * 3) *
      relationMatchNudge(p)
    );
  });
}

function pickPenaltyTaker(xi, club) {
  const assignedId = getSetPieceTakerId(club, "penalty");
  const assigned = assignedId ? xi.find((p) => p.id === assignedId && p.pos !== "GK") : null;
  if (assigned) return assigned;
  const pool = xi.filter((p) => p.pos !== "GK");
  return weightedPick(pool.length ? pool : xi, (p) => {
    const a = p.attrs || {};
    ensurePlayerRelation(p);
    return (
      ((a.finishing || 10) * 0.38 +
        (a.shooting || 10) * 0.26 +
        (a.decisions || 10) * 0.2 +
        (a.kicking || 10) * 0.1 +
        (p.ovr || 10) * 0.06 +
        rng() * 1.5) *
      relationMatchNudge(p)
    );
  });
}

function penaltyConversionChance(taker) {
  const a = taker?.attrs || {};
  const skill =
    (a.finishing || 10) * 0.38 +
    (a.shooting || 10) * 0.24 +
    (a.decisions || 10) * 0.22 +
    (a.kicking || 10) * 0.1 +
    (taker?.ovr || 10) * 0.06;
  return clamp(0.66 + (skill - 10) * 0.019, 0.66, 0.86);
}

function cornerThreatMod(club, xi) {
  const takerId = getSetPieceTakerId(club, "corner");
  const taker = takerId ? xi.find((p) => p.id === takerId) : null;
  const crosser = taker || xi.filter((p) => p.pos !== "GK").sort((a, b) => (b.attrs?.crossing || 10) - (a.attrs?.crossing || 10))[0];
  const targets = xi.filter((p) => p.pos !== "GK" && p.id !== crosser?.id);
  const aerial =
    targets.length
      ? targets
          .map((p) => (p.attrs?.heading || 10) * 0.44 + (p.attrs?.strength || 10) * 0.24 + ((p.heightCm || 180) - 180) * 0.11)
          .sort((a, b) => b - a)
          .slice(0, 4)
          .reduce((sum, value) => sum + value, 0) / Math.min(4, targets.length)
      : 10;
  const delivery = (crosser?.attrs?.crossing || 10) * 0.5 + (crosser?.attrs?.passing || 10) * 0.22 + (crosser?.attrs?.decisions || 10) * 0.12;
  return clamp(0.82 + ((delivery + aerial) / 2 - 10) * 0.035, 0.72, 1.24);
}

function pickAssister(xi, scorer, state, club) {
  const pool = xi.filter((p) => p.id !== scorer.id && p.pos !== "GK");
  if (!pool.length || chance(0.28)) return null;
  return weightedPick(pool, (p) => {
    const rw = roleWeights(state, club, p);
    return (
      (p.attrs?.passing || 10) +
      (p.attrs?.vision || 8) +
      (p.pos === "MID" ? 3 : p.pos === "ATT" ? 1.5 : 1) +
      rw.assist * 1.6 +
      rng() * 2
    );
  });
}

function pickDefender(xi, state, club) {
  const defs = xi.filter((p) => p.pos === "DEF" || p.pos === "MID");
  return weightedPick(defs.length ? defs : xi, (p) => {
    const rw = roleWeights(state, club, p);
    return (p.attrs?.tackling || p.attrs?.defending || 10) + rw.tackle * 1.5 + rng() * 2;
  });
}

function pickGk(xi) {
  return xi.find((p) => p.pos === "GK") || xi[0] || null;
}

function addGoal(state, minute, club, xi, { penalty = false, scorer: forcedScorer = null } = {}) {
  const sk = sideKey(state, club);
  const scorer = forcedScorer || (penalty ? pickPenaltyTaker(xi, club) : pickScorer(xi, state, club));
  if (!scorer) return;
  const assister = penalty ? null : pickAssister(xi, scorer, state, club);
  if (sk === "home") state.hg++;
  else state.ag++;
  // 国内联赛与洲际赛事分别记账；国内杯不进入球员榜。
  if (!state.isCup) {
    const scorerLeague = ensureLeagueStats(scorer, club.division, club.id);
    ensureStats(scorer).goals++;
    scorerLeague.goals++;
    if (assister) {
      ensureStats(assister).assists++;
      ensureLeagueStats(assister, club.division, club.id).assists++;
    }
  } else {
    const scorerCompetition = continentalStats(state, scorer, club);
    if (scorerCompetition) {
      scorerCompetition.goals++;
      if (assister) continentalStats(state, assister, club).assists++;
    }
  }
  const st = state.stats[sk];
  st.shots++;
  st.shotsOn++;
  const xgAdd = penalty ? 0.76 : 0.12 + rng() * 0.28;
  st.xg += xgAdd;

  const assistText = assister ? `（助攻：${assister.name}）` : "";
  const label = penalty ? "点球破门" : "破门";
  pushEv(
    state,
    minute,
    "goal",
    `⚽ ${minute}' ${club.short} ${scorer.name} ${label}！${assistText}`,
    {
      teamId: club.id,
      playerId: scorer.id,
      assistId: assister?.id || null,
      penalty,
    }
  );
}

/**
 * SimEngine 适配：记一粒已知射手的进球（不再随机抽人）。
 * 射门/xG 已在时段统计里加过，这里只改比分与射手数据。
 * 助攻/点球/乌龙必须与空间事件同源：无 assistId 不编造；点球/乌龙永不记助攻。
 * 乌龙：最后触球是失球方球员（封堵折射等）→ 比分仍给得分方，文案「乌龙」，
 * 不给触球者记进球（真实规则：OG 不进个人进球榜）。
 * 契约：比分绝不能丢——即便找不到球员也要涨分。
 */
function addSimGoal(state, minute, team, scorerId, assistId = null, opts = {}) {
  const club = team === "home" ? state.home : state.away;
  const opp = team === "home" ? state.away : state.home;
  const sk = team;
  const xi = activeXi(state, club);
  const penalty = !!opts.penalty;
  let ownGoal = !!opts.ownGoal && !penalty;

  // 1) 先在得分方找射手
  let scorer =
    (scorerId && xi.find((p) => p.id === scorerId)) ||
    (scorerId && club.players.find((p) => p.id === scorerId)) ||
    null;

  // 2) 得分方没有 → 对方最后触球 = 乌龙/折射（或引擎已标 ownGoal）
  let ogPlayer = null;
  if (!scorer && scorerId) {
    ogPlayer =
      opp.players.find((p) => p.id === scorerId) ||
      null;
    if (ogPlayer) ownGoal = !penalty;
  }
  if (ownGoal && scorer) {
    // 引擎标了乌龙但 id 误落在得分方：仍按正常进球处理（防脏标记）
    ownGoal = false;
  }

  // 只认引擎挂上的真实助攻；找不到 / 点球 / 乌龙 → 无助攻
  let assister = null;
  if (!penalty && !ownGoal && assistId && scorer && assistId !== scorer.id) {
    assister =
      xi.find((p) => p.id === assistId) ||
      club.players.find((p) => p.id === assistId) ||
      null;
  }

  // 比分始终记给得分方（与引擎 score / 门线归属一致）
  if (sk === "home") state.hg++;
  else state.ag++;

  // 个人数据：正常进球记射手；乌龙不记任何人进球
  if (scorer && !ownGoal) {
    if (!state.isCup) {
      const scorerLeague = ensureLeagueStats(scorer, club.division, club.id);
      ensureStats(scorer).goals++;
      scorerLeague.goals++;
      if (assister) {
        ensureStats(assister).assists++;
        ensureLeagueStats(assister, club.division, club.id).assists++;
      }
    } else {
      const scorerCompetition = continentalStats(state, scorer, club);
      if (scorerCompetition) {
        scorerCompetition.goals++;
        if (assister) continentalStats(state, assister, club).assists++;
      }
    }
  }

  let text;
  const extra = {
    teamId: club.id,
    penalty,
    ownGoal: !!ownGoal,
    fromSim: true,
  };
  if (ownGoal && ogPlayer) {
    text = `⚽ ${minute}' ${club.short || club.name} 受益！${opp.short || opp.name} ${ogPlayer.name} 乌龙！`;
    extra.playerId = ogPlayer.id;
    extra.ownGoalPlayerId = ogPlayer.id;
    extra.assistId = null;
  } else if (scorer) {
    const assistText = assister ? `（助攻：${assister.name}）` : "";
    const label = penalty ? "点球破门" : "破门";
    text = `⚽ ${minute}' ${club.short || club.name} ${scorer.name} ${label}！${assistText}`;
    extra.playerId = scorer.id;
    extra.assistId = assister?.id || null;
  } else {
    // 无 lastKicker / id 对不上：仍落账，避免「引擎进球、记分板不涨」
    if (scorerId) {
      console.warn("addSimGoal: unknown scorerId (score kept)", scorerId, "team", team, "min", minute);
    }
    text = `⚽ ${minute}' ${club.short || club.name} 破门！`;
    extra.playerId = null;
    extra.assistId = null;
  }
  return pushEv(state, minute, "goal", text, extra);
}

/**
 * 伤病空间化接线：把队医/训练/天气的易伤系数与「伤退→自动替补」回调注入引擎。
 * 引擎只负责涌现与热替换；名额/人选在回调里预占，事件与 lineup 在 cue 落账时生效
 * （pushSimFlavor 的 injury 分支）。用户队也自动补人：半场是预跑的，无法中途询问；
 * 换人事件对用户可见，中场仍可自由调整。
 */
/** 训练模式带来的受伤风险修正（1.0 = 无影响；体能储备为负、攻防演练为正） */
function prepInjuryMod(state, club) {
  const sk = club.id === state.home.id ? "home" : "away";
  return 1 + (state._matchPrep?.[sk]?.injury || 0);
}

function wireSimInjuries(state) {
  const eng = state.simEng;
  if (!eng) return;
  const wMul = state.weather?.injury || 1;
  eng.injuryMul = {
    home:
      wMul *
      (state._weatherImpact?.home?.injury || 1) *
      squadInjuryRiskMultiplier(getLineupPlayers(state.home)) *
      doctorInjuryMod(state.home) *
      trainingInjuryMod(state.home) *
      prepInjuryMod(state, state.home),
    away:
      wMul *
      (state._weatherImpact?.away?.injury || 1) *
      squadInjuryRiskMultiplier(getLineupPlayers(state.away)) *
      doctorInjuryMod(state.away) *
      trainingInjuryMod(state.away) *
      prepInjuryMod(state, state.away),
  };
  if (!state._simPendingSubs) state._simPendingSubs = [];
  eng.onInjurySub = (agent) => {
    const club = agent.team === "home" ? state.home : state.away;
    const sk = agent.team;
    const pending = state._simPendingSubs.filter((s) => s.team === sk);
    if (state.subsUsed[sk] + pending.length >= state.maxSubs) return null;
    const taken = new Set(pending.map((s) => s.inId));
    const outP = club.players.find((p) => p.id === agent.id);
    if (!outP) return null; // 占位 agent（无真实球员）不换
    const bench = aiBenchCandidates(state, club, outP).filter((p) => !taken.has(p.id));
    const inn = bench[0];
    if (!inn) return null;
    state._simPendingSubs.push({ team: sk, outId: agent.id, inId: inn.id });
    return inn;
  };
}

function pushSimFlavor(state, item) {
  const club = item.team === "home" ? state.home : state.away;
  if (!club) return null;
  const sk = item.team;
  const text = defaultFlavorText(state, item);

  // —— 纪律事件（黄/红/点球）：走既有 card/red 通道，喂 discipline.js 记停赛 ——
  if (item.type === "card") {
    state.stats[sk].yellows++;
    if (item.agentId) {
      const prev = state.yellowCount.get(item.agentId) || 0;
      state.yellowCount.set(item.agentId, prev + 1);
    }
    const extra = { teamId: club.id, fromSim: true };
    if (item.agentId) extra.playerId = item.agentId;
    return pushEv(state, item.minute, "card", text, extra);
  }
  if (item.type === "red") {
    state.stats[sk].reds++;
    if (item.agentId) {
      state.sentOff[sk].add(item.agentId);
      state.yellowCount.delete(item.agentId);
    }
    const extra = { teamId: club.id, fromSim: true };
    if (item.agentId) extra.playerId = item.agentId;
    if (item.secondYellow) extra.secondYellow = true;
    const ev = pushEv(state, item.minute, "red", text, extra);
    recomputeSides(state);
    return ev;
  }
  if (item.type === "penalty") {
    // 犯规数在 period 级已全量归账（含此点球犯规），此处只发通知事件，不重复计。
    return pushEv(state, item.minute, "penalty", text, { teamId: club.id, fromSim: true });
  }
  if (item.type === "injury") {
    // 空间涌现的伤退：引擎立刻让球员离场；热替换约 40s 后才进场。
    // 本层先结算伤情，换人记账延到 sub_on（与画面 id 对齐）。
    const p = club.players?.find((x) => x.id === item.agentId);
    if (!p) return null;
    const injury = diagnoseInjury(p, {
      cause: item.cause === "contact" ? "contact" : "fatigue",
      day: state.world.day,
      season: state.world.season,
      random: rng,
    });
    const days = injury.totalDays;
    p.fitness = Math.round(Math.min(p.fitness ?? 100, 45));
    state.injuredOut.add(p.id);
    const ev = pushEv(
      state,
      item.minute,
      "injury",
      `🏥 ${item.minute}' ${club.short} ${p.name} ${injury.label}（约 ${days} 天）`,
      { teamId: club.id, playerId: p.id, fromSim: true }
    );
    recomputeSides(state);
    return ev;
  }
  if (item.type === "sub_on") {
    // 引擎热替换真正进场：此刻才改 lineup / 发 sub 事件（DOM 与帧 id 同步）
    const outId = item.outId;
    const inId = item.inId;
    if (!outId || !inId) return null;
    const subIdx = (state._simPendingSubs || []).findIndex(
      (s) => s.team === sk && s.outId === outId && s.inId === inId
    );
    if (subIdx >= 0) state._simPendingSubs.splice(subIdx, 1);
    const silent = club.id !== state.world.userClubId;
    const res = applySubstitution(state, club, outId, inId, item.minute, silent);
    return res?.ok ? state.events[state.events.length - 1] : null;
  }

  const type =
    item.type === "corner"
      ? "corner"
      : item.type === "save"
        ? "save"
        : item.type === "offside"
          ? "chance"
          : item.type === "tackle" || item.type === "intercept"
            ? "chance"
            : "chance";
  if (item.type === "corner") state.stats[item.team].corners++;
  if (item.type === "save") state.stats[item.team].saves++;
  const extra = { teamId: club.id, fromSim: true };
  if (item.agentId) extra.playerId = item.agentId;
  return pushEv(state, item.minute, type, text, extra);
}

/**
 * 下半场开始时把「换边」开到引擎上，再做阵型重同步。
 *
 * 换边是**调用层**的职责（合同 A）：引擎自己不认比赛时长、不知道什么时候该换，
 * 只提供一个 `endsSwapped` 开关。所以必须由真正知道「现在是下半场」的这层来置位。
 *
 * ⚠ `resyncSimAfterHalfTime` 另有换人/换阵触发路径（`state._simNeedsResync`），
 *   那条路径**不能**顺带开换边 —— 否则用户在 60 分钟换个阵型，全队会当场换边。
 *   因此换边置位只认 `fromMin === 46`（两个入口都固定从 46 开始下半场）。
 *
 * ⚠ `simEng` **不进存档**（见 PREPARED_MATCH_STATE_FIELDS，引擎实例不在其中），
 *   读档续赛时 `ensureSimEngine` 会新建一个默认 `endsSwapped=false` 的引擎。
 *   所以「是否已换边」必须记在 **state** 上，并在这里回灌给引擎，否则从下半场
 *   读档继续的比赛会静默换回原半场。
 *
 * @param {object} state
 * @param {number} fromMin 本段起始分钟
 */
function applyHalfTimeSwap(state, fromMin) {
  const eng = state.simEng;
  if (!eng) return;
  if (fromMin === 46) state._endsSwappedApplied = true;
  // 幂等：以 state 为准回灌引擎（新建的引擎也能自愈）
  if (state._endsSwappedApplied) eng.endsSwapped = true;
  resyncSimAfterHalfTime(state);
  // 🔴 换边后**必须重新开球**（2026-09-20 修用户报的「门将换位太慢/被进空门」）。
  //
  // `resyncSimAfterHalfTime` 只改阵型锚点 `a.baseX/a.baseY`，**不吸附球员实际坐标
  // `a.x/a.y`**；而门将的目标位 `ty` 由 `clampGkY` 围绕 `ownGoalY(team)` 给出，
  // `ownGoalY` 随 `endsSwapped` **瞬间翻转**。⇒ 换边那一刻门将的目标跳到对面球门、
  // 身体却还在原地，只能自己跑过去。
  //
  // 实测（`scripts/_halftime-gk-swap-probe.mjs`，8 场，45 分钟处换边）：
  //   换边瞬间两名门将距**新**己方球门 **96.0~102.2m**（均值 97.7 / 99.0），
  //   要 **3.0~17.6s**（均值 13.4s）才回到门前 ≤15m。这段窗口球门是空的。
  //   观察窗内 4 次射门 0 进球 —— 样本小，但暴露是真实的。
  //
  // `_kickoff` 会把所有 agent 吸附到新的 `baseX/baseY`（`a.x = a.baseX` 等），
  // 正是开场/进球后用的那套已测代码；顺带把球放回中圈，符合「下半场从开球开始」
  // 的真实规则（上半场由主队开球 ⇒ 下半场客队开球，见 `_kickoff("home")` 的初值）。
  //
  // ⚠ 只在 `fromMin === 46` 这一条路径开球。另一条触发路径 `state._simNeedsResync`
  //   （换人/换阵）**不能**开球 —— 否则用户在 60 分钟换个阵型会当场重新开球。
  // ⚠ 顺序不能反：必须**先** `resyncSimAfterHalfTime` 把 baseX/baseY 镜像到新半场，
  //   `_kickoff` 吸附的才是换边后的位置。
  if (fromMin === 46) eng._kickoff("away");
}

/**
 * 用户场：SimEngine 跑完时段 → scaled 记账。
 * 直播：只细播「高光窗」（进球/扑救/威胁），其余 skip，整场观赛约 ≤10 分钟。
 * opts.playHighlightPlan 由 main 注入。
 */
async function simulatePeriodWithSim(state, fromMin, toMin, { onEvent, playHighlightPlan } = {}) {
  ensureSimEngine(state);
  wireSimInjuries(state);
  if (fromMin === 46 || state._simNeedsResync) {
    applyHalfTimeSwap(state, fromMin);
    state._simNeedsResync = false;
  }

  // 直播 / 快速模拟：有高光播放器则录帧并细播；一键完赛等无 playHighlightPlan 不录
  const highlightStream = !!(onEvent && typeof playHighlightPlan === "function");
  // 事件驱动密采（高光邻域 10Hz），平淡不落盘
  const period = runSimPeriodRaw(state.simEng, fromMin, toMin, {
    record: highlightStream,
    adaptive: highlightStream,
  });
  const { scaled, flavor, tStart, tEnd } = period;

  // 射门 / 射正 / xG / 控球：与空间事件同源（禁止掷骰）
  applySimPeriodStats(state, period);

  const lo = tStart <= 0 ? 1 : 46;
  const hi = tEnd <= 45 * 60 + 1 ? 45 : 90;

  /** 按模拟时间排序的事件线索 */
  const cues = [];
  for (const g of scaled.goals) {
    let minute = Math.max(lo, Math.min(hi, g.minute));
    if (minute < fromMin || minute > toMin) continue;
    const t = g.t != null ? g.t : minute * 60;
    cues.push({
      t,
      minute,
      kind: "goal",
      team: g.team,
      scorerId: g.scorerId,
      assistId: g.assistId || null,
      penalty: !!g.penalty,
      ownGoal: !!g.ownGoal,
    });
  }
  for (const f of flavor) {
    const minute = Math.max(fromMin, Math.min(toMin, f.minute));
    const t = f.t != null ? f.t : minute * 60;
    cues.push({ t, minute, kind: "flavor", item: f });
  }
  cues.sort((a, b) => a.t - b.t || a.minute - b.minute);

  const rawInPeriod = (state.simEng.events || []).filter(
    (e) => e.t > tStart && e.t <= tEnd
  );
  const hl = buildHighlightWindows({
    rawEvents: rawInPeriod,
    scaledGoals: scaled.goals,
    tStart,
    tEnd,
  });
  // 只保留最终高光窗内的帧（自适应录制会多记未入选的射门/扑救邻域）
  let recorded = period.frames || [];
  if (recorded.length && hl.windows?.length) {
    const wins = hl.windows;
    recorded = recorded.filter((f) => {
      const t = f.t ?? 0;
      return wins.some((w) => t >= w.t0 - 0.2 && t <= w.t1 + 0.2);
    });
  }
  const segments = buildHighlightSegments(recorded, hl.windows, tStart, tEnd);
  period.frames = null;

  if (state.simEngineMeta) {
    state.simEngineMeta.integration = state.simEng.integrationSummary();
    state.simEngineMeta.halves.push({
      tStart,
      tEnd,
      scaledScore: { ...scaled.score },
      scaledShots: { ...scaled.shots },
      goals: scaled.goals.length,
      frames: period.frameStats?.count || segments.reduce((n, s) => n + (s.frames?.length || 0), 0),
      frameStats: period.frameStats || null,
      highlightWindows: hl.windows.length,
      highlightPlaySec: Math.round(hl.playSec),
    });
  }

  // —— 直播/快速：高光细播 + 平淡跳过（快速同样走真帧，倍速由播放器读取）——
  if (highlightStream) {
    state._highlightStream = true;
    let cueIdx = 0;
    let lastMinDone = fromMin - 1;
    const minutesDone = new Set();

    const finishMinuteSideEffects = (minute, { silent } = {}) => {
      if (minutesDone.has(minute)) return;
      minutesDone.add(minute);
      state.minute = minute;
      const mark = state.events.length;
      // 用户场犯规/卡片/伤病均由空间引擎涌现（adapt.js 翻译 → pushSimFlavor 落账），不再概率掷骰。
      midMatchCoachPrompt(state, minute);
      if (minute % 15 === 0) {
        // 体能结算：球队总量不变，按本窗口跑动距离占比分摊（见 settleFitnessDrain）
        const wetExtra = state.weather.pace < 0.92 ? 0.5 : 0;
        settleFitnessDrain(state, state.home, "home", wetExtra);
        settleFitnessDrain(state, state.away, "away", wetExtra);
        recomputeSides(state);
      }
      if (onEvent) {
        // 跳过平淡时段时 silent=true，旧实现把这一分钟产生的事件全部咽掉——
        // 换人/黄红牌/伤停恰恰多半发生在平淡段里，于是整场看不到一次换人播报，
        // 球员却在场上悄悄换了。这类「必须让人知道」的事件即使在跳过段也要播，
        // 其余流水账（抢断/拦截等）继续静默。
        const ANNOUNCE_WHEN_SKIPPING = ["sub", "card", "red", "injury"];
        const fresh = state.events.slice(mark);
        const list = silent
          ? fresh.filter((ev) => ANNOUNCE_WHEN_SKIPPING.includes(ev.type))
          : fresh;
        if (list.length) {
          const snap = liveSnap(state, minute, null);
          // 分钟边界事件也要带模拟时刻，直播数据条才能按画面进度切片统计。
          snap.simT = minute * 60;
          for (const ev of list) {
            ev._simLive = true;
            onEvent(ev, snap);
          }
        }
      }
    };

    const advanceCuesTo = (t, { show } = { show: true }) => {
      while (cueIdx < cues.length && cues[cueIdx].t <= t + 0.05) {
        const c = cues[cueIdx++];
        const mark = state.events.length;
        if (c.kind === "goal")
          addSimGoal(state, c.minute, c.team, c.scorerId, c.assistId || null, {
            penalty: !!c.penalty,
            ownGoal: !!c.ownGoal,
          });
        else if (c.kind === "flavor") pushSimFlavor(state, c.item);
        if (show && onEvent) {
          const snap = liveSnap(state, c.minute, null);
          snap.simT = t;
          for (const ev of state.events.slice(mark)) {
            ev._simLive = true;
            onEvent(ev, snap);
          }
        }
      }
    };

    const advanceMinutesTo = (minute, { silent } = {}) => {
      while (lastMinDone < minute) {
        lastMinDone++;
        if (lastMinDone >= fromMin && lastMinDone <= toMin) {
          finishMinuteSideEffects(lastMinDone, { silent });
        }
      }
    };

    await playHighlightPlan({
      segments,
      fromMin,
      toMin,
      tStart,
      tEnd,
      highlightPlaySec: hl.playSec,
      // 高光播放中：按 simT 弹出线索
      onSimT: (t, minute) => {
        state.minute = minute;
        advanceMinutesTo(minute, { silent: false });
        advanceCuesTo(t, { show: true });
      },
      // 跳过时段：瞬间记账 + 时钟跳到终点
      onSkip: (seg) => {
        advanceMinutesTo(seg.toMin, { silent: true });
        advanceCuesTo(seg.t1, { show: false });
        // 跳过段里的进球仍要进日志（静默已 add），再补一条「快进」提示可选
        state.minute = seg.toMin;
      },
    });

    for (; cueIdx < cues.length; cueIdx++) {
      const c = cues[cueIdx];
      if (c.kind === "goal")
        addSimGoal(state, c.minute, c.team, c.scorerId, c.assistId || null, {
          penalty: !!c.penalty,
          ownGoal: !!c.ownGoal,
        });
      else pushSimFlavor(state, c.item);
    }
    for (let m = fromMin; m <= toMin; m++) finishMinuteSideEffects(m, { silent: true });
    return;
  }

  // —— 无高光播放器（一键完赛/后台）：按分钟记账，不驱动画面 ——
  /** @type {Record<number, Array>} */
  const byMin = {};
  for (let m = fromMin; m <= toMin; m++) byMin[m] = [];
  for (const c of cues) {
    byMin[c.minute].push(c);
  }

  for (let minute = fromMin; minute <= toMin; minute++) {
    state.minute = minute;
    const mark = state.events.length;

    for (const c of byMin[minute] || []) {
      if (c.kind === "goal")
        addSimGoal(state, minute, c.team, c.scorerId, c.assistId || null, {
          penalty: !!c.penalty,
          ownGoal: !!c.ownGoal,
        });
      else if (c.kind === "flavor") pushSimFlavor(state, c.item);
    }

    // 用户场犯规/卡片/伤病均由空间引擎涌现（pushSimFlavor 落账）。
    midMatchCoachPrompt(state, minute);

    if (minute % 15 === 0) {
      // 体能结算：球队总量不变，按本窗口跑动距离占比分摊（见 settleFitnessDrain）
      const wetExtra = state.weather.pace < 0.92 ? 0.5 : 0;
      settleFitnessDrain(state, state.home, "home", wetExtra);
      settleFitnessDrain(state, state.away, "away", wetExtra);
      recomputeSides(state);
    }

    if (onEvent) {
      const simFrame = state.simEng?.snapshot() || null;
      const snap = liveSnap(state, minute, simFrame);
      const recent = state.events.slice(mark);
      for (const ev of recent) {
        await onEvent(ev, snap);
      }
      if (!recent.length) {
        await onEvent({ minute, type: "tick", text: "" }, snap);
      }
    }
  }
}

/** 同步版时段模拟（instant / 快速完赛） */
function simulatePeriodWithSimSync(state, fromMin, toMin) {
  // 复用 async 逻辑但不 await onEvent：用空 opts 同步跑完
  // 因 simulatePeriodWithSim 内部无真正 await（onEvent 缺省），可直接调用并忽略 Promise
  // 为避免微任务时序问题，内联同步路径：
  ensureSimEngine(state);
  wireSimInjuries(state);
  if (fromMin >= 46) applyHalfTimeSwap(state, fromMin);

  const period = runSimPeriodRaw(state.simEng, fromMin, toMin);
  const { scaled, flavor, tStart, tEnd } = period;

  applySimPeriodStats(state, period);

  const lo = tStart <= 0 ? 1 : 46;
  const hi = tEnd <= 45 * 60 + 1 ? 45 : 90;
  const byMin = {};
  for (let m = fromMin; m <= toMin; m++) byMin[m] = [];
  for (const g of scaled.goals) {
    const minute = Math.max(lo, Math.min(hi, g.minute));
    if (minute < fromMin || minute > toMin) continue;
    byMin[minute].push({
      kind: "goal",
      team: g.team,
      scorerId: g.scorerId,
      assistId: g.assistId || null,
      penalty: !!g.penalty,
      ownGoal: !!g.ownGoal,
    });
  }
  for (const f of flavor) {
    const minute = Math.max(fromMin, Math.min(toMin, f.minute));
    byMin[minute].push({ kind: "flavor", ...f, minute });
  }
  if (state.simEngineMeta) {
    state.simEngineMeta.integration = state.simEng.integrationSummary();
    state.simEngineMeta.halves.push({
      tStart,
      tEnd,
      scaledScore: { ...scaled.score },
      scaledShots: { ...scaled.shots },
      goals: scaled.goals.length,
    });
  }

  for (let minute = fromMin; minute <= toMin; minute++) {
    state.minute = minute;
    for (const item of byMin[minute] || []) {
      if (item.kind === "goal")
        addSimGoal(state, minute, item.team, item.scorerId, item.assistId || null, {
          penalty: !!item.penalty,
          ownGoal: !!item.ownGoal,
        });
      else pushSimFlavor(state, item);
    }
    // 用户场犯规/卡片/伤病均由空间引擎涌现（pushSimFlavor 落账）。
    midMatchCoachPrompt(state, minute);
    if (minute % 15 === 0) {
      // 体能结算：球队总量不变，按本窗口跑动距离占比分摊（见 settleFitnessDrain）。
      // ⚠ 本路径（同步）**历来不带** `weather.pace` 项（两个直播路径带）——这是既有的
      //   不一致，本次保持原语义不动，避免引入未测量的行为变化。
      settleFitnessDrain(state, state.home, "home");
      settleFitnessDrain(state, state.away, "away");
      recomputeSides(state);
    }
  }
}

function tryAttack(state, minute, club, opp, atk, def, xgPer90) {
  const sk = sideKey(state, club);
  const oppSk = sk === "home" ? "away" : "home";
  const xi = activeXi(state, club);
  const oppXi = activeXi(state, opp);
  if (xi.length < 7) return;

  const st = state.stats[sk];
  const oppSt = state.stats[oppSk];
  // 控球：攻防比 × 风格 possession 权重
  const possW = state._possW?.[sk] || 1;
  const hold = Math.max(0.12, (atk * possW) / (atk * possW + def + 1));
  if (chance(hold * 0.55 + xgPer90 * 0.08)) {
    st.possessionTicks += 1 + (chance(hold) ? 1 : 0);
  }

  // 角球
  if (chance(0.035 * (state.derby ? 1.2 : 1))) {
    const cornerMod = cornerThreatMod(club, xi);
    st.corners++;
    // 角球侧别：本层是**统计事件**，并不模拟球从哪侧出底线，
    // 所以侧别在这里掷一次并写进事件，供表现层照用。
    // 坐标用引擎系：x 是球场宽度轴（边线 x=0 / x=100），
    // 角旗在 x=2（左）或 x=98（右）——与 engine.js `_restart("corner", ...)`
    // 的 `b.x < 50 ? 2 : 98` 同一约定。
    const cornerX = chance(0.5) ? 2 : 98;
    pushEv(state, minute, "corner", `🚩 ${minute}' ${club.short} 获得角球`, {
      teamId: club.id,
      cornerX,
    });
    if (chance(0.18 * cornerMod)) {
      // 角球转化威胁
      st.shots++;
      const xg = 0.08 + rng() * 0.12;
      st.xg += xg;
      if (chance(0.35 + atk / (atk + def) * 0.15 + (cornerMod - 1) * 0.1)) {
        addGoal(state, minute, club, xi);
        return;
      }
      if (chance(0.4)) {
        st.shotsOn++;
        const gk = pickGk(oppXi);
        if (gk) {
          oppSt.saves++;
          pushEv(state, minute, "save", `🧤 ${minute}' ${opp.short} ${gk.name} 扑出角球攻门`, {
            teamId: opp.id,
            playerId: gk.id,
          });
        }
      }
    }
    return;
  }

  const chanceW = state._chanceW?.[sk] || 1;
  const threatChance = (xgPer90 / 90) * 1.85 * (state.weather.error || 1) * chanceW;
  if (!chance(threatChance)) return;

  st.shots++;
  const quality = 0.42 + atk / (atk + def + 1) * 0.22;
  const xg = clamp(0.04 + quality * 0.35 * rng(), 0.03, 0.45);
  st.xg += xg;

  // 点球（罕见）
  if (chance(0.018 * (state.derby ? 1.3 : 1))) {
    const taker = pickPenaltyTaker(xi, club);
    st.fouls++;
    state.stats[oppSk].fouls++;
    pushEv(state, minute, "penalty", `❗ ${minute}' 点球！${club.short} 获得主罚机会`, {
      teamId: club.id,
      playerId: taker?.id || null,
    });
    if (chance(penaltyConversionChance(taker))) {
      addGoal(state, minute, club, xi, { penalty: true, scorer: taker });
    } else {
      st.shotsOn++;
      const gk = pickGk(oppXi);
      pushEv(
        state,
        minute,
        "pen_miss",
        `😮 ${minute}' 点球未进！${gk ? opp.short + " " + gk.name + " 神扑" : club.short + " 罚失"}`,
        { teamId: club.id }
      );
      if (gk) oppSt.saves++;
    }
    return;
  }

  // 进球 / 扑救 / 中柱 / 偏出
  if (chance(quality)) {
    addGoal(state, minute, club, xi);
  } else if (chance(0.28)) {
    st.shotsOn++;
    const gk = pickGk(oppXi);
    if (gk) {
      oppSt.saves++;
      pushEv(state, minute, "save", `🧤 ${minute}' ${opp.short} ${gk.name} 扑救成功`, {
        teamId: opp.id,
        playerId: gk.id,
      });
    } else {
      pushEv(state, minute, "chance", `${minute}' ${club.short} 射正被挡出`);
    }
  } else if (chance(0.08)) {
    st.woodwork++;
    st.shotsOn++;
    pushEv(state, minute, "woodwork", `🪵 ${minute}' ${club.short} 打中门框！`, { teamId: club.id });
  } else if (chance(0.2)) {
    pushEv(state, minute, "chance", `${minute}' ${club.short} 错失良机`, { teamId: club.id });
  }
}

function tryCardOrFoul(state, minute) {
  // 犯规倾向受双方压迫/风格影响（加权抽哪边犯规）
  const hw = state._foulW?.home || 1;
  const aw = state._foulW?.away || 1;
  const foulBase =
    0.04 * (state.derby ? 1.35 : 1) * (state.bigMatch ? 1.1 : 1) * ((hw + aw) / 2);
  if (!chance(foulBase)) return;

  const homeSide = chance(hw / (hw + aw));
  const club = homeSide ? state.home : state.away;
  const sk = homeSide ? "home" : "away";
  const foulW = state._foulW?.[sk] || 1;
  const xi = activeXi(state, club);
  const p = pickDefender(xi, state, club) || xi[0];
  if (!p) return;

  state.stats[sk].fouls++;

  // 黄牌 / 红牌：高压更容易吃牌
  const cardRoll = rng();
  const yellowRate = 0.35 * (state.derby ? 1.2 : 1) * Math.min(1.45, 0.85 + foulW * 0.2);
  if (cardRoll < 0.04) {
    // 直红
    state.sentOff[sk].add(p.id);
    state.stats[sk].reds++;
    state.yellowCount.delete(p.id);
    pushEv(state, minute, "red", `🟥 ${minute}' ${club.short} ${p.name} 被红牌罚下！`, {
      teamId: club.id,
      playerId: p.id,
    });
    recomputeSides(state);
  } else if (cardRoll < yellowRate) {
    const prev = state.yellowCount.get(p.id) || 0;
    const next = prev + 1;
    state.yellowCount.set(p.id, next);
    state.stats[sk].yellows++;
    if (next >= 2) {
      state.sentOff[sk].add(p.id);
      state.stats[sk].reds++;
      pushEv(
        state,
        minute,
        "red",
        `🟥 ${minute}' ${club.short} ${p.name} 两黄变一红被罚下！`,
        { teamId: club.id, playerId: p.id, secondYellow: true }
      );
      recomputeSides(state);
    } else {
      pushEv(state, minute, "card", `🟨 ${minute}' ${club.short} ${p.name} 吃到黄牌`, {
        teamId: club.id,
        playerId: p.id,
      });
    }
  }
}

function tryInjury(state, minute) {
  const club = chance(0.5) ? state.home : state.away;
  const injuryMod =
    doctorInjuryMod(club) * trainingInjuryMod(club) * prepInjuryMod(state, club);
  // injuryMod 越低（好队医/设施）越不易伤
  const sk = sideKey(state, club);
  const weatherRisk = state._weatherImpact?.[sk]?.injury || 1;
  const squadRisk = squadInjuryRiskMultiplier(activeXi(state, club));
  const base = 0.005 * (state.weather.injury || 1) * weatherRisk * squadRisk * injuryMod;
  if (!chance(base)) return;
  const xi = activeXi(state, club);
  if (!xi.length) return;
  const p = xi[Math.floor(rng() * xi.length)];
  if (!p) return;
  // 唯一门将略保护
  if (p.pos === "GK" && xi.filter((x) => x.pos === "GK").length <= 1 && chance(0.7)) return;

  const injury = diagnoseInjury(p, {
    cause: p.fitness < 62 ? "fatigue" : "contact",
    day: state.world.day,
    season: state.world.season,
    random: rng,
  });
  const days = injury.totalDays;
  p.fitness = Math.round(Math.min(p.fitness, 45));
  state.injuredOut.add(p.id);
  pushEv(state, minute, "injury", `🏥 ${minute}' ${club.short} ${p.name} ${injury.label}（约 ${days} 天）`, {
    teamId: club.id,
    playerId: p.id,
  });
  recomputeSides(state);

  // AI 自动用尽换人名额补人
  if (
    state.subsUsed[sk] < state.maxSubs &&
    (club.id !== state.world.userClubId || shouldStaffHandleMatchday(state.world, club, { emergency: true }))
  ) {
    aiAutoSub(state, club, p.id, minute);
  }
}

function aiBenchCandidates(state, club, outP = null) {
  const sk = sideKey(state, club);
  const xiIds = new Set(club.tactics.lineup);
  // Substitutes inherit the slot; keeper OVR must not qualify for an outfield job.
  const replacingKeeper = outP?.pos === "GK";
  const subbedOutIds = new Set(
    state.events
      .filter((event) => event.type === "sub" && event.teamId === club.id && event.outId)
      .map((event) => event.outId)
  );
  return club.players
    .filter(
      (p) =>
        !xiIds.has(p.id) &&
        !subbedOutIds.has(p.id) &&
        (!state.eligiblePlayerIds?.[sk] || state.eligiblePlayerIds[sk].has(p.id)) &&
        (p.injured || 0) <= 0 &&
        (p.suspendedMatches || 0) <= 0 &&
        !state.sentOff[sk].has(p.id) &&
        (p.fitness || 0) > 50 &&
        (replacingKeeper ? p.pos === "GK" : p.pos !== "GK")
    )
    .sort((a, b) => {
      const aScore = (a.ovr || 0) + (outP && a.pos === outP.pos ? 5 : 0) + (a.fitness || 0) * 0.01;
      const bScore = (b.ovr || 0) + (outP && b.pos === outP.pos ? 5 : 0) + (b.fitness || 0) * 0.01;
      return bScore - aScore || String(a.id).localeCompare(String(b.id));
    });
}

function aiAutoSub(state, club, outId, minute) {
  const sk = sideKey(state, club);
  if (state.subsUsed[sk] >= state.maxSubs) return { ok: false, msg: "换人次数已用尽" };
  const outP = club.players.find((p) => p.id === outId);
  const inn = aiBenchCandidates(state, club, outP)[0];
  if (!inn) return { ok: false, msg: "没有合格替补" };
  return applySubstitution(state, club, outId, inn.id, minute, true);
}

function aiSubTarget(state, club, minute, scoreGap) {
  const entered = new Set(
    state.events
      .filter((event) => event.type === "sub" && event.teamId === club.id && event.inId)
      .map((event) => event.inId)
  );
  const candidates = [];
  for (const player of activeXi(state, club)) {
    if (player.pos === "GK") continue;
    const replacement = aiBenchCandidates(state, club, player)[0];
    if (!replacement) continue;
    const fitness = player.fitness ?? 100;
    const booked = (state.yellowCount.get(player.id) || 0) > 0;
    const benchDelta = clamp((replacement.ovr || 0) - (player.ovr || 0), -3, 3);
    let priority = (100 - fitness) * 1.35 + benchDelta * 3;
    if (booked) priority += 18;
    if (replacement.pos !== player.pos) priority -= 12;
    if (scoreGap < 0) priority += player.pos === "ATT" ? 7 : player.pos === "MID" ? 4 : 0;
    if (scoreGap > 0) priority += player.pos === "ATT" ? 5 : player.pos === "MID" ? 3 : 1;
    if (minute >= 75) priority += player.pos === "MID" ? 3 : 2;
    if (entered.has(player.id)) priority -= 30;
    candidates.push({ player, priority, fitness, booked });
  }
  candidates.sort(
    (a, b) =>
      b.priority - a.priority ||
      a.fitness - b.fitness ||
      String(a.player.id).localeCompare(String(b.player.id))
  );
  return candidates[0] || null;
}

function aiSubTargetCount(state, club, minute, scoreGap) {
  const sk = sideKey(state, club);
  const xi = activeXi(state, club);
  const booked = xi.filter((player) => (state.yellowCount.get(player.id) || 0) > 0).length;
  const lowFitness = xi.filter((player) => (player.fitness ?? 100) < 70).length;
  let target = minute >= 75 ? 3 : 1;
  if (minute === 60 && (scoreGap <= -2 || booked >= 2 || lowFitness >= 2) && chance(0.55)) {
    target = 2;
  }
  if (minute >= 75 && (scoreGap !== 0 || lowFitness >= 2) && chance(0.55)) {
    target = 4;
  }
  return clamp(Math.max(state.subsUsed[sk], target), 0, state.maxSubs);
}

/**
 * 换人：更新 lineup
 */
export function applySubstitution(state, club, outId, inId, minute, silent = false) {
  const sk = sideKey(state, club);
  if (state.subsUsed[sk] >= state.maxSubs) {
    return { ok: false, msg: `换人次数已用尽（最多 ${state.maxSubs} 次）` };
  }
  const lineup = club.tactics.lineup || [];
  const idx = lineup.indexOf(outId);
  if (idx < 0) return { ok: false, msg: "下场球员不在首发" };
  if (lineup.includes(inId)) return { ok: false, msg: "上场球员已在场上" };
  const alreadyRemoved = state.events.some(
    (event) => event.type === "sub" && event.teamId === club.id && event.outId === inId
  );
  if (alreadyRemoved) return { ok: false, msg: "该球员本场已被换下，不能再次上场" };
  const inn = club.players.find((p) => p.id === inId);
  const outP = club.players.find((p) => p.id === outId);
  if (!inn || !outP) return { ok: false, msg: "球员无效" };
  if (outP.pos === "GK" && inn.pos !== "GK") {
    return { ok: false, msg: "门将只能由门将替换" };
  }
  if (outP.pos !== "GK" && inn.pos === "GK") {
    return { ok: false, msg: "外场位置不能换入门将" };
  }
  if (state.eligiblePlayerIds?.[sk] && !state.eligiblePlayerIds[sk].has(inId)) {
    return { ok: false, msg: "该球员未取得本赛事参赛资格" };
  }
  if ((inn.injured || 0) > 0) return { ok: false, msg: "替补受伤无法上场" };
  if (state.sentOff[sk].has(inId)) return { ok: false, msg: "该球员已被罚下" };

  lineup[idx] = inId;
  club.tactics.lineup = lineup;
  // 角色挂在槽位：换人继承该槽职责
  ensureLineupRoles(club);
  ensureLineupResponsibilities(club);
  state.subsUsed[sk]++;
  state.injuredOut.delete(outId); // 已换下
  if (state.simEng) state._simNeedsResync = true;
  recomputeSides(state);

  if (!silent) {
    pushEv(
      state,
      minute,
      "sub",
      `🔄 ${minute}' ${club.short} 换人：${outP.name} ↓ → ${inn.name} ↑（${state.subsUsed[sk]}/${state.maxSubs}）`,
      { teamId: club.id, outId, inId }
    );
  } else {
    pushEv(
      state,
      minute,
      "sub",
      `🔄 ${minute}' ${club.short} 换人：${outP.name} ↓ → ${inn.name} ↑`,
      { teamId: club.id, outId, inId }
    );
  }
  recomputeSides(state);
  return { ok: true, msg: "换人成功" };
}

/*
 * P6 清理：v1 异步逐分钟直播路径（simulateMinutes）已删除。
 * 用户场恒走 v2 空间模拟（simulatePeriodWithSim / simulatePeriodWithSimSync）；
 * v1 概率引擎仅保留同步版 runMinutesSync 供 AI 后台场（性能）。
 */

/** 开球 + 上半场 1–45 */
export async function playFirstHalf(state, opts = {}) {
  const { home, away, weather, derby, bigMatch, isCup, fixture } = state;
  pushEv(state, 0, "kickoff", "比赛开始！");
  const bits = [`${weather.icon} ${weather.name}`];
  if (derby) bits.push("🔥 德比大战");
  if (bigMatch) bits.push(isCup ? "🏆 焦点杯赛" : "⭐ 焦点战");
  pushEv(state, 0, "context", `情境：${bits.join(" · ")}`);
  // 用户场走 v2 空间模拟时给一条标记，方便战报/调试
  if (shouldUseSim(state)) {
    pushEv(
      state,
      0,
      "context",
      state._liveMode
        ? "⚙️ 空间模拟 v2 · 高光观赛（进球/扑救细看，平淡跳过）"
        : "⚙️ 比赛引擎：空间模拟 v2"
    );
  }
  if (opts.onEvent) {
    const snap0 = liveSnap(state, 0);
    for (const ev of state.events) {
      await opts.onEvent(ev, snap0);
    }
  }
  state.phase = "h1";
  if (shouldUseSim(state)) {
    await simulatePeriodWithSim(state, 1, 45, opts);
  } else {
    // 理论兜底：无用户参与的 state 走 AI 同步概率引擎（正常流程不会到这）
    runMinutesSync(state, 1, 45);
  }
  pushEv(state, 45, "ht", `中场休息 ${home.name} ${state.hg} - ${state.ag} ${away.name}`);
  if (opts.onEvent) {
    const ht = state.events[state.events.length - 1];
    await opts.onEvent(ht, liveSnap(state, 45));
  }
  state.phase = "ht";
  return state;
}

/** 赛中关键提示：60' / 75' 体能与比分建议（写入事件流） */
function midMatchCoachPrompt(state, minute) {
  if (minute !== 60 && minute !== 75) return;
  const club = state.userClub;
  if (!club) return;
  const myG = club === state.home ? state.hg : state.ag;
  const opG = club === state.home ? state.ag : state.hg;
  const xi = activeXi(state, club);
  const avgFit = xi.length
    ? Math.round(xi.reduce((s, p) => s + (p.fitness || 100), 0) / xi.length)
    : 80;
  const tired = xi.filter((p) => (p.fitness || 100) < 58).length;
  const tips = [];
  if (minute === 60) {
    if (myG < opG) tips.push("落后，可考虑加强压迫或换进攻点");
    else if (myG > opG) tips.push("领先，注意控场与体能分配");
    else tips.push("僵持中，可微调节奏寻找突破");
    if (avgFit < 68) tips.push(`首发平均体能 ${avgFit}%，考虑轮换`);
  } else {
    if (tired >= 2) tips.push(`${tired} 名主力体能告急，建议换人`);
    if (myG === opG) tips.push("比分胶着，最后 15 分钟是关键窗口");
    else if (myG === opG - 1) tips.push("仅落后 1 球，可冒险压上");
    else if (myG > opG) tips.push("守住优势，别急于冒进");
  }
  if (!tips.length) return;
  pushEv(state, minute, "coach", `💬 ${minute}' 教练席：${tips.join(" · ")}`);
}

/** AI 中场微调 + 可能换人 */
export function aiHalfTime(state) {
  for (const club of [state.home, state.away]) {
    if (club.id === state.world.userClubId && !shouldStaffHandleMatchday(state.world, club)) continue;
    const managedUser = club.id === state.world.userClubId;
    ensureTactics(club);
    const myG = club === state.home ? state.hg : state.ag;
    const opG = club === state.home ? state.ag : state.hg;
    const t = club.tactics;
    const before = {
      style: t.style,
      pressing: t.pressing,
      tempo: t.tempo,
      width: t.width,
      defensiveLine: t.defensiveLine,
      possessionFormation: t.possessionFormation ?? null,
      outOfPossessionFormation: t.outOfPossessionFormation ?? null,
    };
    let reason = "比分与场上结构稳定，保持原计划";
    if (myG < opG) {
      t.style = chance(0.5) ? "attack" : "balanced";
      t.pressing = Math.min(5, (t.pressing || 3) + 1);
      t.tempo = Math.min(5, (t.tempo || 3) + 1);
      t.defensiveLine = Math.min(5, (t.defensiveLine || 3) + 1);
      t.width = Math.min(5, (t.width || 3) + 1);
      reason = "半场落后，提高压迫、节奏和防线以争取扳平";
    } else if (myG > opG + 1) {
      t.style = chance(0.4) ? "defend" : "possession";
      t.pressing = Math.max(1, (t.pressing || 3) - 1);
      t.defensiveLine = Math.max(1, (t.defensiveLine || 3) - 1);
      t.tempo = Math.max(1, (t.tempo || 3) - 1);
      reason = "两球以上领先，降低比赛风险并保护体能";
    }
    const opponent = club === state.home ? state.away : state.home;
    const phasePlan = applyCoachPhaseFormations(club, club.staff?.coach, {
      opponent,
      scoreGap: myG - opG,
      minute: 45,
    });
    recordPhaseShapeDecision(state, club, opponent, phasePlan, {
      minute: 45,
      trigger: "half-time",
      source: "coach",
      scoreGap: myG - opG,
    });
    // 换下疲劳/受伤
    const sk = sideKey(state, club);
    const xi = activeXi(state, club);
    const tired = xi.filter((p) => (p.fitness || 100) < 62).sort((a, b) => a.fitness - b.fitness);
    if (tired[0] && state.subsUsed[sk] < state.maxSubs && chance(0.55)) {
      aiAutoSub(state, club, tired[0].id, 46);
    }
    if (managedUser) {
      const changed = Object.keys(before).some((key) => before[key] !== t[key]);
      pushEv(
        state,
        45,
        "coach",
        `🧠 主教练中场决定：${changed ? `${t.formation} · 持球 ${phasePlan.effectivePossessionFormation} · 无球 ${phasePlan.effectiveOutOfPossessionFormation} · ${styleLabel(t.style)} · 压迫 ${t.pressing} · 节奏 ${t.tempo}` : "维持现有战术"}。${reason}`,
        {
          teamId: club.id,
          managedDecision: true,
          phase: "ht",
          reason,
          tactics: { ...t },
          phaseShapes: {
            possession: phasePlan.effectivePossessionFormation,
            outOfPossession: phasePlan.effectiveOutOfPossessionFormation,
          },
        }
      );
    }
  }
  recomputeSides(state);
}

/** AI 与经营模式主教练在 60'/75' 读取同一场上事实并作出临场决定。 */
function coachInMatchReview(state, minute) {
  for (const club of [state.home, state.away]) {
    const isUserClub = club.id === state.world.userClubId;
    const managedUser = isUserClub && shouldStaffHandleMatchday(state.world, club);
    if (isUserClub && !managedUser) continue;
    const sk = sideKey(state, club);
    const myG = club === state.home ? state.hg : state.ag;
    const opG = club === state.home ? state.ag : state.hg;
    const scoreGap = myG - opG;
    const decisions = [];

    if (scoreGap < 0) {
      club.tactics.style = "attack";
      club.tactics.pressing = Math.min(5, (club.tactics.pressing || 3) + 1);
      club.tactics.tempo = Math.min(5, (club.tactics.tempo || 3) + 1);
      decisions.push("比分落后，增加压迫和进攻节奏");
    } else if (scoreGap > 0 && minute >= 75) {
      club.tactics.style = "defend";
      club.tactics.pressing = Math.max(1, (club.tactics.pressing || 3) - 1);
      club.tactics.tempo = Math.max(1, (club.tactics.tempo || 3) - 1);
      decisions.push("比分领先，降低风险并保护体能");
    }

    const opponent = club === state.home ? state.away : state.home;
    const phasePlan = applyCoachPhaseFormations(club, club.staff?.coach, {
      opponent,
      scoreGap,
      minute,
    });
    recordPhaseShapeDecision(state, club, opponent, phasePlan, {
      minute,
      trigger: "review",
      source: "coach",
      scoreGap,
    });
    if (phasePlan.changed) {
      decisions.push(`调整阶段阵型为持球 ${phasePlan.effectivePossessionFormation}、无球 ${phasePlan.effectiveOutOfPossessionFormation}`);
    }

    // 换人事件由 aiAutoSub 在循环里逐条 push，而「主教练评估」文案要等决定
    // 全部做完才能拼出来。按追加顺序写日志的话，读到的是「换人完成」在前、
    // 「教练决定换人」在后，因果颠倒。先记下插入点，最后把评估条插回这里。
    const reviewMark = state.events.length;
    const targetCount = aiSubTargetCount(state, club, minute, scoreGap);
    const replaced = [];
    while (state.subsUsed[sk] < targetCount) {
      const target = aiSubTarget(state, club, minute, scoreGap);
      if (!target) break;
      const result = aiAutoSub(state, club, target.player.id, minute);
      if (!result?.ok) break;
      const reason = target.booked
        ? "黄牌风险"
        : target.fitness < 72
          ? "体能下降"
          : scoreGap < 0
            ? "加强进攻"
            : scoreGap > 0
              ? "控制比赛"
              : "保持强度";
      replaced.push(`${target.player.name}（${reason}）`);
    }
    if (replaced.length) decisions.push(`轮换 ${replaced.join("、")}`);
    if (!decisions.length) decisions.push("维持场上阵容，继续观察");

    if (managedUser) {
      const reviewEv = pushEv(
        state,
        minute,
        "coach",
        `🧠 ${minute}' 主教练评估：${decisions.join("；")}`,
        { teamId: club.id, managedDecision: true, phase: "matchday", minute }
      );
      // 挪到本轮换人之前：先看到教练的决定，再看到换人落地。
      if (state.events[state.events.length - 1] === reviewEv) {
        state.events.pop();
        state.events.splice(reviewMark, 0, reviewEv);
      }
    }
    recomputeSides(state);
  }
}

async function runLiveCoachReview(state, minute, opts = {}) {
  const mark = state.events.length;
  coachInMatchReview(state, minute);
  if (!opts.onEvent) return;
  const snap = liveSnap(state, minute);
  for (const event of state.events.slice(mark)) {
    await opts.onEvent(event, snap);
  }
}

/**
 * 用户中场指令
 * orders: { style?, pressing?, tempo?, width?, defensiveLine?, formation?, roles?: string[], duties?: string[], subs?, teamTalk? }
 */
export function applyUserHalfTime(state, orders = {}) {
  const club = state.userClub;
  if (!club) return { ok: false, msg: "无用户球队" };
  if (shouldStaffHandleMatchday(state.world, club)) {
    return { ok: false, msg: "临场决策已委托主教练" };
  }
  ensureTactics(club);
  const t = club.tactics;
  const prevForm = t.formation;
  if (orders.style) t.style = orders.style;
  if (orders.pressing != null) t.pressing = clamp(+orders.pressing, 1, 5);
  if (orders.tempo != null) t.tempo = clamp(+orders.tempo, 1, 5);
  if (orders.width != null) t.width = clamp(+orders.width, 1, 5);
  if (orders.defensiveLine != null) t.defensiveLine = clamp(+orders.defensiveLine, 1, 5);
  let formChanged = false;
  if (orders.formation && FORMATIONS[orders.formation] && orders.formation !== prevForm) {
    t.formation = orders.formation;
    // 换阵型：重排首发 + 重置默认角色
    ensureMatchLineup(club, { eligibleIds: state.eligiblePlayerIds?.[state.userSide] });
    ensureLineupRoles(club, { reset: true });
    ensureLineupResponsibilities(club);
    formChanged = true;
  } else if (orders.formation && FORMATIONS[orders.formation]) {
    t.formation = orders.formation;
    ensureMatchLineup(club, { eligibleIds: state.eligiblePlayerIds?.[state.userSide] });
    ensureLineupRoles(club);
    ensureLineupResponsibilities(club);
  }

  // 应用中场角色指令（在换阵型之后）
  if (Array.isArray(orders.roles) && orders.roles.length) {
    ensureLineupRoles(club);
    const slots = (FORMATIONS[t.formation] || FORMATIONS["4-3-3"]).slots || [];
    for (let i = 0; i < Math.min(orders.roles.length, slots.length); i++) {
      const rid = orders.roles[i];
      const detailed = slotPositionCode(slots[i], i, slots);
      if (rid && PLAYER_ROLES[rid] && roleFitsPosition(rid, detailed)) {
        t.roles[i] = rid;
        t.duties[i] = normalizeDutyForRole(rid, orders.duties?.[i] || t.duties?.[i]);
      }
    }
  }
  // 角色/职责变更会改变空间 agent 的 roleId/dutyId（可能只有职责被改），必须标记重同步，
  // 否则下半场已创建的 agent 继续沿用上半场的旧角色/职责。
  if (
    state.simEng &&
    ((Array.isArray(orders.roles) && orders.roles.length) ||
      (Array.isArray(orders.duties) && orders.duties.length))
  ) {
    state._simNeedsResync = true;
  }

  const msgs = [];
  const tacTouched =
    orders.style ||
    orders.pressing != null ||
    orders.tempo != null ||
    orders.width != null ||
    orders.defensiveLine != null ||
    orders.formation ||
    (orders.roles && orders.roles.length) ||
    (orders.duties && orders.duties.length);
  if (tacTouched) {
    const roleBits = summarizeRolesShort(club);
    pushEv(
      state,
      45,
      "tactics",
      `📋 中场调整：${t.formation} · ${styleLabel(t.style)} · 压迫 ${t.pressing} · 节奏 ${t.tempo} · 宽度 ${t.width} · 防线 ${t.defensiveLine}${
        roleBits ? ` · 角色 ${roleBits}` : ""
      }${formChanged ? "（已换阵）" : ""}`,
      {
        teamId: club.id,
        style: t.style,
        pressing: t.pressing,
        tempo: t.tempo,
        width: t.width,
        defensiveLine: t.defensiveLine,
        formation: t.formation,
        roles: [...(t.roles || [])],
        duties: [...(t.duties || [])],
        formationChanged: formChanged,
      }
    );
    msgs.push(formChanged ? "阵型与战术已更新" : "战术已更新");
    const opponent = club === state.home ? state.away : state.home;
    recordPhaseShapeDecision(state, club, opponent, null, {
      minute: 45,
      trigger: "half-time",
      source: "player",
      changed: true,
      scoreGap: club === state.home ? state.hg - state.ag : state.ag - state.hg,
    });
  }
  for (const s of orders.subs || []) {
    const res = applySubstitution(state, club, s.outId, s.inId, 46);
    msgs.push(res.msg);
  }
  if (orders.teamTalk) {
    const talkRes = applyTeamTalk(state, orders.teamTalk, "ht");
    if (talkRes.ok) msgs.push(talkRes.msg);
  }
  recomputeSides(state);
  return { ok: true, msg: msgs.join("；") || "继续比赛" };
}

function summarizeRolesShort(club) {
  ensureLineupRoles(club);
  const counts = {};
  for (const rid of club.tactics.roles || []) {
    const r = PLAYER_ROLES[rid];
    if (!r || r.pos === "GK") continue;
    const lab = r.short || r.label;
    counts[lab] = (counts[lab] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, n]) => (n > 1 ? `${k}×${n}` : k))
    .join("·");
}

/**
 * 上半场/全场角色复盘（进球/助攻挂到槽位角色）
 * @param {{ untilMinute?: number }} [opts]
 */
export function buildRoleReview(state, opts = {}) {
  const club = state?.userClub;
  if (!club) return null;
  ensureTactics(club);
  ensureLineupRoles(club);
  const until = opts.untilMinute != null ? opts.untilMinute : 90;
  const lineup = club.tactics.lineup || [];
  const roles = club.tactics.roles || [];
  const formation = FORMATIONS[club.tactics.formation] || FORMATIONS["4-3-3"];
  const byId = new Map();
  for (let i = 0; i < lineup.length; i++) {
    const id = lineup[i];
    if (!id) continue;
    const p = club.players.find((x) => x.id === id);
    byId.set(id, {
      playerId: id,
      name: p?.name || id,
      pos: formation.slots[i]?.pos || p?.pos || "?",
      slot: i,
      roleId: roles[i] || null,
      roleLabel: roleLabel(roles[i] || "", "zh"),
      roleLabelEn: roleLabel(roles[i] || "", "en"),
      goals: 0,
      assists: 0,
    });
  }
  for (const ev of state.events || []) {
    if ((ev.minute || 0) > until) continue;
    if (ev.type !== "goal" && ev.type !== "pen") continue;
    // 仅统计本队事件
    if (ev.teamId && ev.teamId !== club.id) continue;
    if (ev.playerId && byId.has(ev.playerId)) byId.get(ev.playerId).goals++;
    if (ev.assistId && byId.has(ev.assistId)) byId.get(ev.assistId).assists++;
  }
  const rows = [...byId.values()].filter((r) => r.pos !== "GK" || r.goals || r.assists);
  const contributors = rows
    .filter((r) => r.goals || r.assists)
    .sort((a, b) => b.goals + b.assists - (a.goals + a.assists));
  const quietAttack = rows.filter(
    (r) => (r.pos === "ATT" || (PLAYER_ROLES[r.roleId]?.score || 0) >= 2) && !r.goals && !r.assists
  );
  const tips = [];
  if (contributors.length) {
    tips.push(
      `贡献突出：${contributors
        .slice(0, 3)
        .map((r) => `${r.name}（${r.roleLabel}${r.goals ? ` ${r.goals}球` : ""}${r.assists ? ` ${r.assists}助` : ""}）`)
        .join("、")}`
    );
  } else {
    tips.push("上半场进攻点未打开，可考虑改抢点/前腰或加强节奏");
  }
  if (quietAttack.length) {
    tips.push(
      `静默前场：${quietAttack
        .slice(0, 2)
        .map((r) => `${r.name}·${r.roleLabel}`)
        .join("、")} — 可换角色或换人`
    );
  }
  const myG = club === state.home ? state.hg : state.ag;
  const opG = club === state.home ? state.ag : state.hg;
  if (myG < opG) tips.push("落后：可加压前腰/套边，或换阵型增加进攻点");
  else if (myG > opG) tips.push("领先：可改盯人中卫/防守边卫稳住结构");

  return {
    untilMinute: until,
    formation: club.tactics.formation,
    rows: rows.sort((a, b) => a.slot - b.slot),
    contributors,
    tips,
    summary: tips[0] || "",
  };
}

/**
 * 赛中即时战术（下半场直播中改压迫/风格/节奏）
 * 写入 events 供画面反馈；立即 recomputeSides
 */
export function applyLiveTactics(state, orders = {}) {
  const club = state?.userClub;
  if (!club || !state || state.finished) return { ok: false, msg: "无法调整" };
  if (shouldStaffHandleMatchday(state.world, club)) {
    return { ok: false, msg: "临场战术已委托主教练" };
  }
  if (isFullyDelegated(state.world, club, "tactics")) {
    return { ok: false, msg: "战术已委托教练团队" };
  }
  ensureTactics(club);
  const t = club.tactics;
  let changed = false;
  let formChanged = false;
  if (orders.style && orders.style !== t.style) {
    t.style = orders.style;
    changed = true;
  }
  if (orders.pressing != null && +orders.pressing !== t.pressing) {
    t.pressing = clamp(+orders.pressing, 1, 5);
    changed = true;
  }
  if (orders.tempo != null && +orders.tempo !== t.tempo) {
    t.tempo = clamp(+orders.tempo, 1, 5);
    changed = true;
  }
  if (orders.width != null && +orders.width !== t.width) {
    t.width = clamp(+orders.width, 1, 5);
    changed = true;
  }
  if (orders.defensiveLine != null && +orders.defensiveLine !== t.defensiveLine) {
    t.defensiveLine = clamp(+orders.defensiveLine, 1, 5);
    changed = true;
  }
  if (orders.formation && FORMATIONS[orders.formation] && orders.formation !== t.formation) {
    t.formation = orders.formation;
    ensureMatchLineup(club, { eligibleIds: state.eligiblePlayerIds?.[state.userSide] });
    ensureLineupRoles(club, { reset: true });
    formChanged = true;
    if (state.simEng) state._simNeedsResync = true;
    changed = true;
  }
  if (!changed) return { ok: true, msg: "无变化", tactics: { ...t } };
  const minute = state.minute || 46;
  pushEv(
    state,
    minute,
    "tactics",
    `📋 ${minute}' 场边调整：${t.formation} · ${styleLabel(t.style)} · 压迫 ${t.pressing} · 节奏 ${t.tempo} · 宽度 ${t.width} · 防线 ${t.defensiveLine}${
      formChanged ? "（换阵）" : ""
    }`,
    {
      teamId: club.id,
      style: t.style,
      pressing: t.pressing,
      tempo: t.tempo,
      width: t.width,
      defensiveLine: t.defensiveLine,
      formation: t.formation,
      formationChanged: formChanged,
    }
  );
  const opponent = club === state.home ? state.away : state.home;
  recordPhaseShapeDecision(state, club, opponent, null, {
    minute,
    trigger: "live",
    source: "player",
    changed: true,
    scoreGap: club === state.home ? state.hg - state.ag : state.ag - state.hg,
  });
  recomputeSides(state);
  return {
    ok: true,
    msg: formChanged ? "阵型与战术已更新" : "战术已更新",
    tactics: {
      style: t.style,
      pressing: t.pressing,
      tempo: t.tempo,
      width: t.width,
      defensiveLine: t.defensiveLine,
      formation: t.formation,
    },
    event: state.events[state.events.length - 1],
  };
}

/** 中场休息提示：体能告急 / 黄牌边缘（给 UI） */
export function getHalfTimeTips(state) {
  const club = state?.userClub;
  if (!club) return { fitness: [], yellows: [], scoreTip: "" };
  const sk = state.userSide;
  const sent = state.sentOff?.[sk] || new Set();
  const xi = getLineupPlayers(club).filter((p) => !sent.has(p.id));
  const fitness = xi
    .filter((p) => (p.fitness ?? 100) < 62)
    .sort((a, b) => (a.fitness ?? 100) - (b.fitness ?? 100))
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      name: p.name,
      pos: p.pos,
      fitness: Math.round(p.fitness ?? 100),
    }));
  // 本场已吃黄（从事件推）+ 赛季累计边缘
  const booked = new Set(
    (state.events || [])
      .filter((e) => (e.type === "card" || e.type === "red") && e.playerId)
      .map((e) => e.playerId)
  );
  const yellows = xi
    .filter((p) => (p.yellowsSeason || 0) >= 4 || booked.has(p.id))
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      name: p.name,
      pos: p.pos,
      yellows: p.yellowsSeason || 0,
      booked: booked.has(p.id),
    }));
  const myG = club === state.home ? state.hg : state.ag;
  const opG = club === state.home ? state.ag : state.hg;
  let scoreTip = "";
  if (myG < opG) scoreTip = "落后：可加强压迫或换进攻点";
  else if (myG > opG) scoreTip = "领先：注意控场与体能";
  else scoreTip = "平局：可微调节奏寻找突破";
  const avgFit = xi.length
    ? Math.round(xi.reduce((s, p) => s + (p.fitness || 100), 0) / xi.length)
    : 80;
  return { fitness, yellows, scoreTip, avgFit, myG, opG };
}

function styleLabel(s) {
  return (
    {
      balanced: "均衡",
      attack: "进攻",
      defend: "防守",
      possession: "控球",
      counter: "反击",
    }[s] || s
  );
}

/** 下半场 46–90 + 收尾事件（不含 finalize） */
export async function playSecondHalf(state, opts = {}) {
  aiHalfTime(state);
  if (state.userClub && shouldStaffHandleMatchday(state.world, state.userClub)) {
    applyManagedTeamTalk(state, "ht");
  }
  state.phase = "h2";
  if (shouldUseSim(state)) {
    // 所有直播比赛按指挥窗口分段。玩家在 46–60' 高光播放时做出的场边调整，
    // 会在尚未计算的 61–75' 生效；不再出现整半场预跑后的“假即时控制”。
    await simulatePeriodWithSim(state, 46, 60, opts);
    await runLiveCoachReview(state, 60, opts);
    await simulatePeriodWithSim(state, 61, 75, opts);
    await runLiveCoachReview(state, 75, opts);
    await simulatePeriodWithSim(state, 76, 90, opts);
  } else {
    runMinutesSync(state, 46, 60);
    await runLiveCoachReview(state, 60, opts);
    runMinutesSync(state, 61, 75);
    await runLiveCoachReview(state, 75, opts);
    runMinutesSync(state, 76, 90);
  }
  pushEv(
    state,
    90,
    "ft",
    `全场结束 ${state.home.name} ${state.hg} - ${state.ag} ${state.away.name}`
  );
  if (opts.onEvent) {
    const ft = state.events[state.events.length - 1];
    await opts.onEvent(ft, liveSnap(state, 90));
  }
  state.phase = "ft";
  return state;
}

function possessionPct(state) {
  const h = state.stats.home.possessionTicks;
  const a = state.stats.away.possessionTicks;
  const t = h + a || 1;
  const hp = Math.round((h / t) * 100);
  return { home: hp, away: 100 - hp };
}

/** 直播/回放用的实时数据快照（xG、控球、射门；可选 sim 真投影帧） */
function liveSnap(state, minute, simFrame = null) {
  const poss = possessionPct(state);
  const hs = state.stats.home;
  const as = state.stats.away;
  return {
    homeGoals: state.hg,
    awayGoals: state.ag,
    minute: minute ?? state.minute ?? 0,
    home: {
      xg: Math.round(hs.xg * 100) / 100,
      shots: hs.shots,
      shotsOn: hs.shotsOn,
      possession: poss.home,
    },
    away: {
      xg: Math.round(as.xg * 100) / 100,
      shots: as.shots,
      shotsOn: as.shotsOn,
      possession: poss.away,
    },
    /** 空间模拟压缩帧：matchview.applySimSnapshot 直接画 */
    sim: simFrame || null,
    engine: state.simEng ? "v2" : "v1",
  };
}

/**
 * 赛后文字复盘（3–5 句，经理可读）
 * 基于比分、xG、控球、关键事件，不改结果
 */
function buildMatchNarrative(state) {
  const lines = [];
  const h = state.home;
  const a = state.away;
  const hg = state.hg;
  const ag = state.ag;
  const poss = possessionPct(state);
  const hs = state.stats.home;
  const as = state.stats.away;
  const hx = Math.round(hs.xg * 100) / 100;
  const ax = Math.round(as.xg * 100) / 100;
  const goals = state.events.filter((e) => e.type === "goal");
  const reds = state.events.filter((e) => e.type === "red");
  const wood = (hs.woodwork || 0) + (as.woodwork || 0);

  // 1) 结果总览
  if (hg > ag) {
    lines.push(`${h.short || h.name} 主场 ${hg}-${ag} 击败 ${a.short || a.name}。`);
  } else if (ag > hg) {
    lines.push(`${a.short || a.name} 客场 ${ag}-${hg} 取胜，${h.short || h.name} 未能守住主场。`);
  } else {
    lines.push(`${h.short || h.name} 与 ${a.short || a.name} ${hg}-${ag} 握手言和。`);
  }

  // 2) xG / 控球读数
  const xgDiff = hx - ax;
  if (Math.abs(xgDiff) >= 0.35) {
    const better = xgDiff > 0 ? h.short || h.name : a.short || a.name;
    const worse = xgDiff > 0 ? a.short || a.name : h.short || h.name;
    if ((xgDiff > 0 && hg < ag) || (xgDiff < 0 && ag < hg)) {
      lines.push(
        `场面与结果背离：${better} 期望进球更高（${Math.max(hx, ax).toFixed(2)} vs ${Math.min(hx, ax).toFixed(2)}），却未能兑现。`
      );
    } else if ((xgDiff > 0 && hg > ag) || (xgDiff < 0 && ag > hg)) {
      lines.push(
        `${better} 创造了更多威胁（xG ${Math.max(hx, ax).toFixed(2)}-${Math.min(hx, ax).toFixed(2)}），比分与场面大体一致。`
      );
    } else {
      lines.push(
        `双方期望进球 ${hx.toFixed(2)}-${ax.toFixed(2)}；${better} 稍占上风，${worse} 防守顶住了压力。`
      );
    }
  } else if (Math.abs(poss.home - 50) >= 8) {
    const ballSide = poss.home >= poss.away ? h.short || h.name : a.short || a.name;
    lines.push(
      `${ballSide} 控球占优（${Math.max(poss.home, poss.away)}%-${Math.min(poss.home, poss.away)}%），但转化效率决定了最终比分。`
    );
  } else {
    lines.push(
      `控球与 xG 都接近（${poss.home}%-${poss.away}% · ${hx.toFixed(2)}-${ax.toFixed(2)}），是一场拉锯战。`
    );
  }

  // 3) 进球时间线
  if (goals.length === 1) {
    const g = goals[0];
    const club = g.teamId === h.id ? h : a;
    lines.push(`唯一进球出现在 ${g.minute}'，${club.short || club.name} 一球定胜负。`);
  } else if (goals.length >= 2) {
    const first = goals[0];
    const last = goals[goals.length - 1];
    const late = goals.filter((g) => g.minute >= 75);
    if (late.length) {
      lines.push(`比赛后段仍有进球：最后一球在 ${last.minute}'，${late.length} 粒进球来自 75' 之后。`);
    } else {
      lines.push(
        `共 ${goals.length} 粒进球，首开纪录于 ${first.minute}'，终场前一球在 ${last.minute}'。`
      );
    }
  } else {
    lines.push(`全场零封，双方门将与防线是本场主角之一。`);
  }

  // 4) 牌 / 门框等调味
  if (reds.length) {
    const r = reds[0];
    const club = r.teamId === h.id ? h : a;
    lines.push(`${r.minute}' ${club.short || club.name} 被罚下，人数劣势改写了后段走势。`);
  } else if (wood >= 2) {
    lines.push(`门框作响 ${wood} 次，运气也站在了比分一边。`);
  } else if (state.derby) {
    lines.push(`德比火药味足，拼抢与犯规都高于平常。`);
  } else if (state.bigMatch) {
    lines.push(`焦点战节奏紧，双方都不敢轻易压上。`);
  }

  if (state.weather?.key !== "clear" && state._weatherImpact) {
    const homeWeather = state._weatherImpact.home;
    const awayWeather = state._weatherImpact.away;
    const better = homeWeather.score >= awayWeather.score ? h : a;
    const impact = homeWeather.score >= awayWeather.score ? homeWeather : awayWeather;
    lines.push(`天气适应：${better.short || better.name} 的首发适应分 ${impact.score}/20，${impact.best?.name || "—"} 最为适应。`);
  }

  // 5) MOTM（若已生成评分）
  const motm = state.matchRatings?.motm;
  if (motm?.name) {
    const bits = [];
    if (motm.goals) bits.push(`${motm.goals}球`);
    if (motm.assists) bits.push(`${motm.assists}助`);
    if (motm.saves) bits.push(`${motm.saves}扑`);
    const extra = bits.length ? `（${bits.join(" · ")}）` : "";
    lines.push(`本场最佳：${motm.name}${extra}，评分 ${motm.rating}。`);
  }

  return lines.slice(0, 6);
}

function buildReport(state, { compactAnalysis = false } = {}) {
  const poss = possessionPct(state);
  const hs = state.stats.home;
  const as = state.stats.away;
  // 评分应在 finalize 里先算；若提前 buildReport 则 narrative 不含 MOTM
  const narrative = buildMatchNarrative(state);
  const analysis = state.simEng
    ? state.preparedAnalysis || deriveMatchAnalysis(state.simEng.events, {
        home: state.home,
        away: state.away,
        compact: compactAnalysis,
      })
    : null;
  const spatialShapeEvidence = state.spatialShapeEvidence
    || (typeof state.simEng?.tacticalShapeEvidence === "function"
      ? state.simEng.tacticalShapeEvidence({ compact: compactAnalysis })
      : null);
  return {
    matchSeed: state.matchSeed,
    engine: state.simEng ? "spatial-v2" : "probability-v1",
    simulationProfile: state.simEng ? state.simulationProfile || "standard" : "legacy",
    simulationMeta: state.simEngineMeta || null,
    score: `${state.hg} - ${state.ag}`,
    homeGoals: state.hg,
    awayGoals: state.ag,
    weather: { key: state.weather.key, name: state.weather.name, icon: state.weather.icon },
    weatherImpact: state.weather.key === "clear" ? null : {
      home: {
        score: state._weatherImpact?.home?.score ?? 11,
        best: state._weatherImpact?.home?.best?.name || null,
        risk: state._weatherImpact?.home?.risk?.name || null,
      },
      away: {
        score: state._weatherImpact?.away?.score ?? 11,
        best: state._weatherImpact?.away?.best?.name || null,
        risk: state._weatherImpact?.away?.risk?.name || null,
      },
    },
    derby: state.derby,
    bigMatch: state.bigMatch,
    home: {
      name: state.home.name,
      short: state.home.short,
      shots: hs.shots,
      shotsOn: hs.shotsOn,
      xg: Math.round(hs.xg * 100) / 100,
      possession: poss.home,
      corners: hs.corners,
      fouls: hs.fouls,
      yellows: hs.yellows,
      reds: hs.reds,
      saves: hs.saves,
      woodwork: hs.woodwork,
    },
    away: {
      name: state.away.name,
      short: state.away.short,
      shots: as.shots,
      shotsOn: as.shotsOn,
      xg: Math.round(as.xg * 100) / 100,
      possession: poss.away,
      corners: as.corners,
      fouls: as.fouls,
      yellows: as.yellows,
      reds: as.reds,
      saves: as.saves,
      woodwork: as.woodwork,
    },
    scorers: state.events
      .filter((e) => e.type === "goal")
      .map((e) => ({
        minute: e.minute,
        teamId: e.teamId,
        playerId: e.playerId,
        text: e.text,
        penalty: !!e.penalty,
        ownGoal: !!e.ownGoal,
      })),
    ratings: state.matchRatings || null,
    analysis,
    phaseShapes: {
      version: 1,
      timeline: Array.isArray(state.phaseShapeTimeline) ? state.phaseShapeTimeline : [],
      usage: spatialShapeEvidence,
    },
    narrative,
    ticketIncome: state.ticketIncome != null ? state.ticketIncome : null,
    matchdayRetailIncome: state.matchdayRetailIncome || 0,
    matchdayHospitalityIncome: state.matchdayHospitalityIncome || 0,
    matchdayTotalIncome: state.matchdayTotalIncome != null ? state.matchdayTotalIncome : null,
    ticketStadium: state.ticketStadium || null,
    ticketCapacity: state.ticketCapacity || null,
    ticketAttendance: state.ticketAttendance != null ? state.ticketAttendance : null,
    ticketFillPct: state.ticketFillPct != null ? state.ticketFillPct : null,
    ticketFactors: Array.isArray(state.ticketFactors) ? state.ticketFactors : [],
  };
}

function applyResult(world, f) {
  const ht = world.table[f.home];
  const at = world.table[f.away];
  if (!ht || !at) return;
  ht.played++;
  at.played++;
  ht.gf += f.homeGoals;
  ht.ga += f.awayGoals;
  at.gf += f.awayGoals;
  at.ga += f.homeGoals;

  if (f.homeGoals > f.awayGoals) {
    ht.w++;
    ht.pts += 3;
    at.l++;
    clubById(world, f.home).form.push("W");
    clubById(world, f.away).form.push("L");
  } else if (f.homeGoals < f.awayGoals) {
    at.w++;
    at.pts += 3;
    ht.l++;
    clubById(world, f.home).form.push("L");
    clubById(world, f.away).form.push("W");
  } else {
    ht.d++;
    at.d++;
    ht.pts++;
    at.pts++;
    clubById(world, f.home).form.push("D");
    clubById(world, f.away).form.push("D");
  }
  for (const c of world.clubs) {
    if (c.form.length > 5) c.form = c.form.slice(-5);
  }
}

function drainFitness(club, isHome, state) {
  const sk = club.id === state.home.id ? "home" : "away";
  const sent = state.sentOff[sk];
  const fitW = state._fitW?.[sk] || fitnessMultOf(club.tactics);
  for (const p of getLineupPlayers(club)) {
    if (sent.has(p.id)) continue;
    const drain = 4 + Math.floor(rng() * 6) + Math.round((fitW - 1) * 4);
    p.fitness = Math.round(Math.max(35, p.fitness - drain));
  }
  const xi = new Set(club.tactics.lineup);
  for (const p of club.players) {
    if (!xi.has(p.id)) {
      p.fitness = Math.round(Math.min(100, p.fitness + 3));
    }
  }
}

function updateMorale(club, gf, ga) {
  let delta = 0;
  if (gf > ga) delta = 6;
  else if (gf < ga) delta = -5;
  else delta = 1;
  for (const p of club.players) {
    p.morale = Math.max(20, Math.min(100, p.morale + delta + Math.floor(rng() * 3 - 1)));
  }
}

function appearedPlayerIds(state, club) {
  const sk = sideKey(state, club);
  const ids = new Set(state.startingLineups?.[sk] || []);
  for (const event of state.events || []) {
    if (event.type === "sub" && event.teamId === club.id && event.inId) ids.add(event.inId);
  }
  return ids;
}

function appearedPlayers(state, club) {
  const ids = appearedPlayerIds(state, club);
  return (club.players || []).filter((player) => ids.has(player.id));
}

/**
 * 根据本场事件与比分，给出场球员打 1–10 评分（FM 风格）
 * @returns {{ home: object[], away: object[], motm: object|null }}
 */
function applyMatchRatings(state) {
  const { home, away, hg, ag, events } = state;
  /** @type {Map<string, { goals: number, assists: number, saves: number, yellow: number, red: number, wood: number }>} */
  const bag = new Map();
  const bump = (id, key, n = 1) => {
    if (!id) return;
    if (!bag.has(id)) {
      bag.set(id, { goals: 0, assists: 0, saves: 0, yellow: 0, red: 0, wood: 0 });
    }
    bag.get(id)[key] += n;
  };
  for (const e of events || []) {
    if (e.type === "goal") {
      bump(e.playerId, "goals");
      if (e.assistId) bump(e.assistId, "assists");
    } else if (e.type === "save" || e.type === "pen_miss") {
      // pen_miss 的 playerId 可能是主罚方；仅 save 记扑救
      if (e.type === "save") bump(e.playerId, "saves");
    } else if (e.type === "card") {
      bump(e.playerId, "yellow");
    } else if (e.type === "red") {
      bump(e.playerId, "red");
    } else if (e.type === "woodwork") {
      bump(e.playerId, "wood");
    }
  }

  const rateSide = (club, gf, ga, won, drew) => {
    const list = [];
    const xi = appearedPlayers(state, club);
    const starters = new Set(state.startingLineups?.[sideKey(state, club)] || []);
    for (const p of xi) {
      if (!p) continue;
      const st = ensureStats(p);
      const m = bag.get(p.id) || {
        goals: 0,
        assists: 0,
        saves: 0,
        yellow: 0,
        red: 0,
        wood: 0,
      };
      let r = 6.4;
      // 能力微调
      r += ((p.ovr || 12) - 12) * 0.04;
      // 体能/士气
      r += ((p.fitness || 80) - 75) * 0.008;
      r += ((p.morale || 70) - 70) * 0.006;

      if (p.pos === "GK") {
        r += m.saves * 0.22;
        if (ga === 0) r += 0.55;
        else r -= Math.min(1.4, ga * 0.28);
        r += m.goals * 0.8; // 门将进球极罕见
      } else {
        r += m.goals * 0.95;
        r += m.assists * 0.55;
        r += m.wood * 0.15;
        // 前场贡献封顶防刷分
        r = Math.min(r, 6.4 + 3.2);
      }

      r += m.yellow * -0.35;
      r += m.red * -1.6;
      if (won) r += 0.28;
      else if (drew) r += 0.05;
      else r -= 0.22;

      // 噪声
      r += (rng() - 0.5) * 0.45;
      r = clamp(Math.round(r * 10) / 10, 3.0, 10.0);

      // 滚动状态：联赛/杯赛/洲际凡出场均计入（手感跨赛事）
      pushRecentRating(p, r);

      // 场均/最近评分只累计联赛；洲际写入 competitionStats；国内杯仅本场报告
      if (!state.isCup) {
        st.ratingSum = (st.ratingSum || 0) + r;
        st.lastRating = r;
        const leagueStats = ensureLeagueStats(p, club.division, club.id);
        leagueStats.ratingSum = (leagueStats.ratingSum || 0) + r;
        leagueStats.lastRating = r;
      } else {
        const competitionStats = continentalStats(state, p, club);
        if (competitionStats) {
          competitionStats.ratingSum = (competitionStats.ratingSum || 0) + r;
          competitionStats.lastRating = r;
        }
      }
      list.push({
        playerId: p.id,
        name: p.name,
        pos: p.pos,
        number: p.number,
        started: starters.has(p.id),
        rating: r,
        goals: m.goals,
        assists: m.assists,
        saves: m.saves,
      });
    }
    list.sort((a, b) => b.rating - a.rating);
    return list;
  };

  const homeWon = hg > ag;
  const awayWon = ag > hg;
  const drew = hg === ag;
  const homeList = rateSide(home, hg, ag, homeWon, drew);
  const awayList = rateSide(away, ag, hg, awayWon, drew);

  let motm = null;
  const all = [
    ...homeList.map((x) => ({ ...x, teamId: home.id, side: "home" })),
    ...awayList.map((x) => ({ ...x, teamId: away.id, side: "away" })),
  ];
  if (all.length) {
    all.sort((a, b) => b.rating - a.rating);
    motm = all[0];
  }
  return { home: homeList, away: awayList, motm };
}

/**
 * 写入比分、积分、新闻、报告
 */
export function finalizeMatch(state) {
  if (state.finished) return state.report;
  const { world, fixture, home, away, isCup, isLeague, isKnockout, hg, ag, events } = state;

  // 记录真实首发负荷，供后续密集赛程轮换；替补只记出场，不计首发。
  for (const [side, club] of [["home", home], ["away", away]]) {
    const started = new Set(state.startingLineups?.[side] || []);
    for (const player of club.players || []) {
      if (started.has(player.id)) {
        player.lastStartedDay = world.day;
        player.recentStartDays = Array.isArray(player.recentStartDays)
          ? player.recentStartDays.filter((day) => world.day - Number(day) <= 14)
          : [];
        player.recentStartDays.push(world.day);
        if (player.recentStartDays.length > 6) player.recentStartDays = player.recentStartDays.slice(-6);
      }
      if (started.has(player.id) || (club.tactics.lineup || []).includes(player.id)) {
        player.lastPlayedDay = world.day;
      }
    }
    recordMatchPlayingTime(world, club, {
      fixture,
      startedIds: started,
      events,
      eligibleIds: state.eligiblePlayerIds?.[side],
      historyLimit: club.id === world.userClubId ? 72 : 12,
      isCup,
    });
  }

  // 上座与票价只能由开赛前已知的信息决定。这里先锁定上下文，稍后再做账，
  // 避免 applyResult 把本场赛果和更新后的积分榜倒灌进门票收入。
  let homeWinStreak = 0;
  const recentHomeForm = (home.form || []).slice(-5);
  for (let i = recentHomeForm.length - 1; i >= 0 && recentHomeForm[i] === "W"; i--) {
    homeWinStreak++;
  }
  const homeGateContext = {
    isCup,
    isDerby: state.derby,
    isRelegationBattle: checkRelegationBattle(world, home),
    isTitleRace: checkTitleRace(world, home),
    cupStage: fixture.roundLabel === "决赛" ? "final" :
              fixture.roundLabel === "半决赛" ? "semi" :
              fixture.roundLabel === "1/4决赛" ? "quarter" : null,
    winStreak: homeWinStreak,
    clubStrength: state.preMatchStrength?.home || teamStrength(home),
    opponentStrength: state.preMatchStrength?.away || teamStrength(away),
    formBonus: getFormBonus(world, home.id),
    seasonPhaseBonus: getSeasonPhaseBonus(world),
  };

  // 国内联赛和洲际赛事分别记账；国内杯暂不设球员榜。
  if (!isCup) {
    const countApps = (club) => {
      for (const p of appearedPlayers(state, club)) {
        ensureStats(p).apps++;
        ensureLeagueStats(p, club.division, club.id).apps++;
      }
    };
    countApps(home);
    countApps(away);

    const homeGk = pickGk(getLineupPlayers(home));
    const awayGk = pickGk(getLineupPlayers(away));
    if (homeGk) {
      ensureStats(homeGk).goalsConceded += ag;
      if (ag === 0) ensureStats(homeGk).cleanSheets++;
      const leagueStats = ensureLeagueStats(homeGk, home.division, home.id);
      leagueStats.goalsConceded += ag;
      if (ag === 0) leagueStats.cleanSheets++;
    }
    if (awayGk) {
      ensureStats(awayGk).goalsConceded += hg;
      if (hg === 0) ensureStats(awayGk).cleanSheets++;
      const leagueStats = ensureLeagueStats(awayGk, away.division, away.id);
      leagueStats.goalsConceded += hg;
      if (hg === 0) leagueStats.cleanSheets++;
    }
  } else if (String(state.competitionType || "").startsWith("continental")) {
    const countApps = (club) => {
      for (const p of appearedPlayers(state, club)) continentalStats(state, p, club).apps++;
    };
    countApps(home);
    countApps(away);

    const homeGk = pickGk(getLineupPlayers(home));
    const awayGk = pickGk(getLineupPlayers(away));
    if (homeGk) {
      const stats = continentalStats(state, homeGk, home);
      stats.goalsConceded += ag;
      if (ag === 0) stats.cleanSheets++;
    }
    if (awayGk) {
      const stats = continentalStats(state, awayGk, away);
      stats.goalsConceded += hg;
      if (hg === 0) stats.cleanSheets++;
    }
  }

  // 赛后评分始终生成；联赛与洲际赛事写入各自分账。
  // 须先于 buildReport，以便 narrative 写入 MOTM
  const ratings = applyMatchRatings(state);
  state.matchRatings = ratings;

  fixture.homeGoals = hg;
  fixture.awayGoals = ag;
  fixture.played = true;
  fixture.events = events;
  fixture.weather = state.weather.key;
  fixture.derby = state.derby;
  fixture.matchEngine = state.simEng ? "spatial-v2" : "probability-v1";
  fixture.simulationProfile = state.simEng ? state.simulationProfile || "standard" : "legacy";

  recordTransferAppearances(world, home.id, appearedPlayers(state, home).map((player) => player.id));
  recordTransferAppearances(world, away.id, appearedPlayers(state, away).map((player) => player.id));

  if (isLeague) {
    applyResult(world, fixture);
  } else if (fixture.competitionType === "continental-league-stage") {
    applyContinentalResult(world, fixture);
  } else if (isKnockout && hg === ag) {
    const penHome = chance(0.5);
    fixture.winner = penHome ? home.id : away.id;
    fixture.penalties = true;
    events.push({
      minute: 90,
      type: "ft",
      text: `点球大战！${penHome ? home.name : away.name} 晋级（原 90 分钟 ${hg}-${ag}）`,
    });
  } else if (isKnockout) {
    fixture.winner = hg > ag ? home.id : away.id;
  }

  // 主场收入属于实际主队，AI 与用户使用相同球场、上座和比赛情境数据。
  const gate = matchdayIncome(home, { ...homeGateContext, detail: true, random: rng });
  const gateSettlement = recordMatchdayFinance(home, gate, world.day, world.season);
  if (fixture.home === world.userClubId) {
    state.ticketIncome = gateSettlement.ticket;
    state.matchdayRetailIncome = gateSettlement.retail;
    state.matchdayHospitalityIncome = gateSettlement.hospitality;
    state.matchdayTotalIncome = gateSettlement.total;
    state.ticketStadium = stadiumInfo(home).name;
    state.ticketCapacity = gate.capacity;
    state.ticketAttendance = gate.attendance;
    state.ticketFillPct = gate.fill;
    state.ticketFactors = Array.isArray(gate.factors) ? gate.factors : [];
  }

  drainFitness(home, true, state);
  drainFitness(away, false, state);
  if (!isKnockout) {
    updateMorale(home, hg, ag);
    updateMorale(away, ag, hg);
  } else {
    const winId = fixture.winner;
    for (const c of [home, away]) {
      const won = c.id === winId;
      for (const p of c.players) {
        p.morale = Math.max(20, Math.min(100, p.morale + (won ? 4 : -2)));
      }
    }
  }

  const backgroundAiMatch =
    state.simulationProfile === "background" &&
    fixture.home !== world.userClubId &&
    fixture.away !== world.userClubId;
  const report = backgroundAiMatch
    ? compactBackgroundReport(buildReport(state, { compactAnalysis: true }))
    : buildReport(state);
  if (backgroundAiMatch) fixture.events = compactBackgroundEvents(events);
  fixture.matchReport = report;
  state.report = report;
  state.finished = true;

  // 纪律：黄牌累计 / 红牌停赛 / 停赛天数 -1（双方都处理）
  for (const club of [home, away]) {
    const { news: discNews } = processClubMatchDiscipline(club, events, { random: rng });
    for (const text of discNews) {
      if (club.id === world.userClubId) {
        world.news.unshift({ day: world.day, text });
      }
    }
  }

  // 重置赛前准备计数器（每场比赛后）
  resetMatchPrepCounter(home);
  resetMatchPrepCounter(away);

  // 用户场次新闻 / 收入 / 媒体
  const userId = world.userClubId;
  if (fixture.home === userId || fixture.away === userId) {
    const isHome = fixture.home === userId;
    const myG = isHome ? hg : ag;
    const opG = isHome ? ag : hg;
    const opp = isHome ? away : home;
    const me = isHome ? home : away;
    // 经理生涯场次（杯赛点球按晋级/出局的比分已在 hg/ag）
    try {
      ensureManagerCareer(world);
      let careerGf = myG;
      let careerGa = opG;
      if (isKnockout && fixture.penalties) {
        // 点球：按胜负记 W/L，比分仍用 90 分钟
        if (fixture.winner === userId) {
          if (myG <= opG) careerGf = opG + 1;
        } else if (myG >= opG) {
          careerGa = myG + 1;
        }
      }
      recordManagerMatch(world, careerGf, careerGa, isCup);
      noteUserMatchResult(world, careerGf, careerGa);
    } catch (_) {
      /* ignore */
    }
    let result = "战平";
    if (isKnockout) {
      const won = fixture.winner === userId;
      result = won ? (fixture.penalties ? "点球晋级" : "晋级") : fixture.penalties ? "点球出局" : "出局";
    } else {
      if (myG > opG) result = "获胜";
      else if (myG < opG) result = "落败";
    }
    const tag = isLeague ? `第 ${fixture.round} 轮` : `🏆 ${fixture.roundLabel || fixture.competitionName || "杯赛"}`;
    const ctx = [];
    if (state.derby) ctx.push("德比");
    if (state.weather.key !== "clear") ctx.push(state.weather.name);
    world.news.unshift({
      day: world.day,
      text: `${tag}：对阵 ${opp.name} ${myG}-${opG} ${result}${ctx.length ? `（${ctx.join("·")}）` : ""}`,
    });
    if (isHome) {
      const income = state.ticketIncome || 0;
      const attendance = state.ticketAttendance;
      const capacity = state.ticketCapacity || stadiumInfo(me).capacity;
      const fillPct = state.ticketFillPct;
      const stInfo = stadiumInfo(me);
      const crowdTxt =
        attendance != null && capacity
          ? `上座 ${attendance.toLocaleString()}/${capacity.toLocaleString()}${fillPct != null ? `（${fillPct}%）` : ""}`
          : `容量约 ${(capacity || 0).toLocaleString()}`;
      world.news.unshift({
        day: world.day,
        text: `比赛日收入 ${formatMoney(state.matchdayTotalIncome || income)}（门票 ${formatMoney(income)} · 餐饮零售 ${formatMoney(state.matchdayRetailIncome || 0)} · 商务接待 ${formatMoney(state.matchdayHospitalityIncome || 0)} · ${stInfo.name} · ${crowdTxt}）`,
      });
    }
    if (isLeague) {
      mediaAfterUserMatch(world, fixture, me, opp, myG, opG);
      narrativeAfterUserMatch(world, me, opp, myG, opG, false);
    } else {
      pushMedia(world, {
        outlet: "VCFM体育",
        headline: `${tag}：${me.name} ${myG}-${opG} ${opp.name}，${result}`,
        body: fixture.penalties
          ? "90 分钟难解难分，最终在点球大战中分出胜负。淘汰赛的压力在最后一刻达到顶峰。"
          : fixture.competitionType === "continental-league-stage"
            ? "各国强队在大陆赛场相遇，积分与净胜球都可能决定晋级命运。"
            : `一场跨级别的较量吸引了媒体目光。${result.includes("晋级") ? "赢家笑到最后。" : "球队只能专注联赛。"}`,
        tone: result.includes("晋级") ? "positive" : "negative",
        category: "cup",
      });
    }
  }

  if (!isLeague) {
    advanceCompetition(world, fixture);
    const tournament = findCompetition(world, fixture);
    if (tournament?.stage === "done" && tournament.champion) {
      const champ = clubById(world, tournament.champion);
      if (champ) {
        for (const p of champ.players) {
          grantHonor(p, {
            season: world.season,
            type: "competition_winner",
            title: `${tournament.name}冠军`,
            detail: champ.name,
            clubId: champ.id,
            clubName: champ.name,
            division: champ.division,
          });
        }
        if (champ.id === world.userClubId) {
          pushMedia(world, {
            outlet: "联赛日报",
            headline: `金杯！${champ.name} 问鼎${tournament.name}`,
            body: `${tournament.name}的舞台上，他们站到了最高领奖台。`,
            tone: "positive",
            category: "cup",
          });
        }
      }
    }
  }

  // 用户正式比赛结算后才运行当天发展队比赛，保证球员不会同时被两类比赛使用。
  if (fixture.home === world.userClubId || fixture.away === world.userClubId) {
    const developmentMatches = processDevelopmentMatchesForDay(world);
    const userDevelopment = developmentMatches.filter(
      (match) => match.home === world.userClubId || match.away === world.userClubId
    );
    if (userDevelopment.length) {
      const match = userDevelopment[0];
      const userHome = match.home === world.userClubId;
      const opponentId = userHome ? match.away : match.home;
      const opponent = clubById(world, opponentId);
      const myGoals = userHome ? match.score.home : match.score.away;
      const opponentGoals = userHome ? match.score.away : match.score.home;
      world.news.unshift({
        day: world.day,
        text: `发展队：${userHome ? home.name : away.name} ${myGoals}-${opponentGoals} ${opponent?.name || "对手发展队"}`,
      });
    }
  }

  const result = {
    homeGoals: hg,
    awayGoals: ag,
    events,
    report,
  };
  activeRandom = state.previousRandom || Math.random;
  return result;
}

/*
 * P6 清理：simulateMatchFull（v1 异步整场入口）已删除。
 * 用户场入口是 main.js 直调 playFirstHalf / continueSecondHalf；
 * AI 后台/快速模拟入口是 simulateMatchSync / simulateMatch。
 */

function runMinutesSync(state, fromMin, toMin) {
  for (let minute = fromMin; minute <= toMin; minute++) {
    tryAttack(state, minute, state.home, state.away, state.homeAtk, state.awayDef, state.homeXG);
    tryAttack(state, minute, state.away, state.home, state.awayAtk, state.homeDef, state.awayXG);
    tryCardOrFoul(state, minute);
    tryInjury(state, minute);
    midMatchCoachPrompt(state, minute);
    if (minute % 15 === 0) {
      // 概率引擎路径（非空间模拟）：没有 `state.simEng` ⇒ settleFitnessDrain
      // 内部自动回退到等额扣减 ⇒ **行为与旧实现逐位相同**，这里只是统一入口。
      settleFitnessDrain(state, state.home, "home");
      settleFitnessDrain(state, state.away, "away");
      recomputeSides(state);
    }
  }
}

const PREPARED_MATCH_STATE_FIELDS = Object.freeze([
  "isCup",
  "isLeague",
  "isKnockout",
  "competitionType",
  "weather",
  "matchSeed",
  "derby",
  "bigMatch",
  "events",
  "stats",
  "hg",
  "ag",
  "phase",
  "yellowCount",
  "sentOff",
  "injuredOut",
  "subsUsed",
  "maxSubs",
  "eligiblePlayerIds",
  "userSide",
  "engineMode",
  "simulationProfile",
  "teamTalkMods",
  "teamTalks",
  "startingLineups",
  "phaseShapeTimeline",
  "spatialShapeEvidence",
  "minute",
  "preMatchStrength",
  "homeAtk",
  "homeDef",
  "awayAtk",
  "awayDef",
  "homeXG",
  "awayXG",
  "pace",
  "simModifiers",
  "simEngineMeta",
  "_roleMods",
  "_matchPrep",
  "_possW",
  "_foulW",
  "_chanceW",
  "_fitW",
  "_weatherImpact",
  "_simNeedsResync",
  "_simPendingSubs",
  // 下半场是否已换边。simEng 本身不入档，读档后引擎会重建为
  // endsSwapped=false，必须靠这个 state 字段在下一段模拟开始时回灌。
  "_endsSwappedApplied",
]);

function beginMatchSimulation(state, opts = {}) {
  const { home, away, weather, derby, bigMatch, isCup } = state;
  const staffManaged = state.userClub && shouldStaffHandleMatchday(state.world, state.userClub);
  if (staffManaged) {
    applyManagedTeamTalk(state, "pre");
  } else if (opts.teamTalkId && state.userClub) {
    applyTeamTalk(state, opts.teamTalkId, "pre");
  }
  pushEv(state, 0, "kickoff", "比赛开始！");
  const bits = [`${weather.icon} ${weather.name}`];
  if (derby) bits.push("🔥 德比大战");
  if (bigMatch) bits.push(isCup ? "🏆 焦点杯赛" : "⭐ 焦点战");
  pushEv(state, 0, "context", `情境：${bits.join(" · ")}`);
}

function runMatchSimulationSync(state, opts = {}) {
  const { home, away } = state;
  const staffManaged = state.userClub && shouldStaffHandleMatchday(state.world, state.userClub);
  // 引擎由比赛请求显式决定；直播、快速和后台不再各自暗选足球规律。
  if (shouldUseSim(state)) {
    pushEv(
      state,
      0,
      "context",
      state.simulationProfile === "background"
        ? "⚙️ 比赛引擎：空间模拟 v2 · 无画面后台档"
        : "⚙️ 比赛引擎：空间模拟 v2"
    );
    simulatePeriodWithSimSync(state, 1, 45);
    pushEv(state, 45, "ht", `中场休息 ${home.name} ${state.hg} - ${state.ag} ${away.name}`);
    aiHalfTime(state);
    if (staffManaged) {
      applyManagedTeamTalk(state, "ht");
    } else if (opts.htTalkId && state.userClub) {
      applyTeamTalk(state, opts.htTalkId, "ht");
    }
    simulatePeriodWithSimSync(state, 46, 60);
    coachInMatchReview(state, 60);
    simulatePeriodWithSimSync(state, 61, 75);
    coachInMatchReview(state, 75);
    simulatePeriodWithSimSync(state, 76, 90);
  } else {
    runMinutesSync(state, 1, 45);
    pushEv(state, 45, "ht", `中场休息 ${home.name} ${state.hg} - ${state.ag} ${away.name}`);
    aiHalfTime(state);
    if (staffManaged) {
      applyManagedTeamTalk(state, "ht");
    } else if (opts.htTalkId && state.userClub) {
      applyTeamTalk(state, opts.htTalkId, "ht");
    }
    runMinutesSync(state, 46, 60);
    coachInMatchReview(state, 60);
    runMinutesSync(state, 61, 75);
    coachInMatchReview(state, 75);
    runMinutesSync(state, 76, 90);
  }
  pushEv(state, 90, "ft", `全场结束 ${home.name} ${state.hg} - ${state.ag} ${away.name}`);
  return state;
}

function serializePreparedMatch(state, { completed = false } = {}) {
  if (completed && typeof state.simEng?.tacticalShapeEvidence === "function") {
    state.spatialShapeEvidence = state.simEng.tacticalShapeEvidence({
      compact: state.simulationProfile === "background",
    });
  }
  const fields = {};
  for (const key of PREPARED_MATCH_STATE_FIELDS) {
    if (state[key] !== undefined) fields[key] = state[key];
  }
  const compactAnalysis =
    completed && state.simulationProfile === "background" && state.simEng?.events
      ? deriveMatchAnalysis(state.simEng.events, {
          home: state.home,
          away: state.away,
          compact: true,
        })
      : null;
  return {
    version: 1,
    fixtureId: state.fixture.id,
    worldContext: {
      day: state.world.day,
      season: state.world.season,
      userClubId: state.world.userClubId,
      managementMode: state.world.managementMode,
    },
    fixture: state.fixture,
    home: state.home,
    away: state.away,
    fields,
    randomState: state.random?.getState?.() ?? state.matchSeed,
    simEvents: compactAnalysis ? null : state.simEng?.events || null,
    analysis: compactAnalysis,
  };
}

function compactBackgroundAnalysis(analysis) {
  if (!analysis) return null;
  const compactSide = (side) => ({
    xg: side?.xg || 0,
    openPlayXg: side?.openPlayXg || 0,
    shots: side?.shots || [],
    progression: side?.progression || null,
    pressing: side?.pressing || null,
    shape: side?.shape || null,
  });
  return {
    version: analysis.version || 1,
    source: analysis.source || "sim-events",
    compact: true,
    home: compactSide(analysis.home),
    away: compactSide(analysis.away),
  };
}

function compactBackgroundReport(report) {
  if (!report) return report;
  report.analysis = compactBackgroundAnalysis(report.analysis);
  if (report.phaseShapes) {
    report.phaseShapes.timeline = (report.phaseShapes.timeline || []).map((entry) => ({
      minute: entry.minute,
      team: entry.team,
      trigger: entry.trigger,
      source: entry.source,
      reason: entry.reason,
      changed: !!entry.changed,
      selectionSuppressed: !!entry.selectionSuppressed,
      baseFormation: entry.baseFormation,
      possessionFormation: entry.possessionFormation,
      outOfPossessionFormation: entry.outOfPossessionFormation,
      scoreGap: entry.scoreGap || 0,
    }));
    for (const side of [report.phaseShapes.usage?.home, report.phaseShapes.usage?.away]) {
      if (side) delete side.averagePositions;
    }
    if (report.phaseShapes.usage) report.phaseShapes.usage.compact = true;
  }
  if (report.ratings) {
    report.ratings = { motm: report.ratings.motm || null, compact: true };
  }
  return report;
}

function compactBackgroundEvents(events) {
  const keep = new Set([
    "kickoff", "goal", "penalty", "pen_miss", "woodwork", "card", "red",
    "injury", "sub", "ht", "ft",
  ]);
  return (events || []).filter((event) => keep.has(event.type));
}

function restorePreparedMatch(prepared, world, fixture, home, away) {
  const random = matchRandom(world, fixture, prepared.randomState);
  const state = {
    ...prepared.fields,
    world,
    fixture,
    home,
    away,
    userClub:
      home.id === world.userClubId ? home : away.id === world.userClubId ? away : null,
    random,
    previousRandom: activeRandom,
    finished: false,
    report: null,
  };
  if (prepared.simEvents || prepared.analysis) {
    state.simEng = { events: prepared.simEvents || [] };
    state.preparedAnalysis = prepared.analysis || null;
  }
  activeRandom = random;
  return state;
}

function replaceObjectState(target, source) {
  for (const key of Object.keys(target)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) delete target[key];
  }
  for (const [key, value] of Object.entries(source)) target[key] = value;
  return target;
}

function mergeSimulatedClubState(target, source) {
  target.players = source.players;
  target.tactics = source.tactics;
  if (source.trainingBoost) target.trainingBoost = source.trainingBoost;
  return target;
}

/** Prepare deterministic match context without running the expensive spatial clock. */
export function prepareMatchSimulation(world, fixture, opts = {}) {
  const previousRandom = activeRandom;
  try {
    const state = createMatchSession(world, fixture, opts);
    beginMatchSimulation(state, opts);
    return serializePreparedMatch(state);
  } finally {
    activeRandom = previousRandom;
  }
}

/** Run only the match clock. The returned payload contains no functions or world snapshot. */
export function runPreparedMatchSimulation(prepared, opts = {}) {
  const previousRandom = activeRandom;
  try {
    const world = {
      ...prepared.worldContext,
      clubs: [prepared.home, prepared.away],
    };
    const state = restorePreparedMatch(
      prepared,
      world,
      prepared.fixture,
      prepared.home,
      prepared.away
    );
    runMatchSimulationSync(state, opts);
    return serializePreparedMatch(state, { completed: true });
  } finally {
    activeRandom = previousRandom;
  }
}

/** Commit a prepared spatial result through the existing authoritative finalizer. */
export function commitPreparedMatch(world, fixture, prepared) {
  const home = clubById(world, prepared.home.id);
  const away = clubById(world, prepared.away.id);
  if (!home || !away || fixture.id !== prepared.fixtureId) {
    throw new Error(`prepared match no longer matches fixture ${prepared.fixtureId}`);
  }
  // Only the match clock owns these fields. Full-club replacement could erase
  // a third-party transfer installment or competition payment committed while
  // another independent fixture in the same batch was finishing.
  mergeSimulatedClubState(home, prepared.home);
  mergeSimulatedClubState(away, prepared.away);
  replaceObjectState(fixture, prepared.fixture);
  const state = restorePreparedMatch(prepared, world, fixture, home, away);
  return finalizeMatch(state);
}

/** 同步完整模拟（AI 场次 / 快速无暂停） */
export function simulateMatchSync(world, fixture, opts = {}) {
  const state = createMatchSession(world, fixture, opts);
  beginMatchSimulation(state, opts);
  runMatchSimulationSync(state, opts);
  return finalizeMatch(state);
}

/** 兼容旧 API：同步完整模拟 */
export function simulateMatch(world, fixture, opts = {}) {
  return simulateMatchSync(world, fixture, opts);
}

/** 下半场继续（用户中场指令后） */
export async function continueSecondHalf(state, orders = {}, opts = {}) {
  if (state.phase !== "ht" && state.phase !== "h1") {
    // allow if already at ht
  }
  const evBefore = state.events.length;
  const hasOrders =
    orders &&
    (orders.style ||
      orders.pressing != null ||
      orders.tempo != null ||
      orders.width != null ||
      orders.defensiveLine != null ||
      orders.formation ||
      orders.teamTalk ||
      (orders.roles && orders.roles.length) ||
      (orders.subs && orders.subs.length));
  const staffManaged = state.userClub && shouldStaffHandleMatchday(state.world, state.userClub);
  if (state.userSide && hasOrders && !staffManaged) {
    applyUserHalfTime(state, orders);
  }
  // 中场调整事件立刻走 onEvent（直播横幅/评论/换人动画），不要等完场再刷日志
  if (opts.onEvent) {
    const snap = liveSnap(state, 45);
    for (const ev of state.events.slice(evBefore)) {
      await opts.onEvent(ev, snap);
    }
  }
  await playSecondHalf(state, opts);
  return finalizeMatch(state);
}

export function getBenchPlayers(club, state) {
  const xi = new Set(club.tactics.lineup || []);
  const sk = sideKey(state, club);
  return club.players
    .filter(
      (p) =>
        !xi.has(p.id) &&
        (!state.eligiblePlayerIds?.[sk] || state.eligiblePlayerIds[sk].has(p.id)) &&
        (p.injured || 0) <= 0 &&
        (p.suspendedMatches || 0) <= 0 &&
        !state.sentOff[sk].has(p.id)
    )
    .sort((a, b) => b.ovr - a.ovr);
}

export function getOnFieldPlayers(club, state) {
  return activeXi(state, club);
}

/**
 * 判断是否保级大战（需要排名数据）
 */
function checkRelegationBattle(world, club) {
  const divisionInfo = DIVISIONS[club?.division];
  const relegate = divisionInfo?.relegate || 0;
  if (!world?.table || relegate <= 0) return false;
  const table = Object.entries(world.table)
    .filter(([id, row]) => {
      const c = world.clubs.find(cl => cl.id === id);
      return c && c.division === club.division;
    })
    .map(([id, row]) => ({ id, ...row }))
    .sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga));

  const myPos = table.findIndex((r) => r.id === club.id) + 1;
  if (myPos === 0) return false;
  const total = table.length;
  const dangerStart = Math.max(1, total - relegate); // 降级区外再包含一个危险位

  // 位于倒数4名（降级区或危险区）
  return myPos >= dangerStart;
}

/**
 * 判断是否争冠关键战
 */
function checkTitleRace(world, club) {
  if (!world?.table || DIVISIONS[club?.division]?.tier !== 1) return false;
  const table = Object.entries(world.table)
    .filter(([id, row]) => {
      const c = world.clubs.find(cl => cl.id === id);
      return c && c.division === club.division;
    })
    .map(([id, row]) => ({ id, ...row }))
    .sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga));

  const myPos = table.findIndex((r) => r.id === club.id) + 1;
  if (myPos === 0) return false;

  // 前4名 + 赛季后半段（>20轮）
  return myPos <= 4 && (table[0]?.played || 0) > 20;
}

export { styleLabel };
