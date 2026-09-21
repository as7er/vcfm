/**
 * SimEngine → match.js 适配层（P5）
 *
 * 所有显式请求空间引擎的场次：空间模拟跑完全时段 → directResult 读取真实事件 →
 * 翻译成现有 {minute,type,text,playerId,...} 事件，继续走报告/评分/积分。
 */
import { SimEngine, SIM, motionContextOf, ballDeflectionOf } from "./engine.js";
import { simMinuteOf } from "../match-presentation.js";
import {
  getLineupPlayers,
  ensureTactics,
  ensureLineupRoles,
  ensureCorePlayer,
  assignPlayersToFormationSlots,
  getCorePlayerId,
  getSlotRole,
  getSlotDuty,
} from "../models.js";
import { FORMATIONS } from "../data.js";
import { positionCoverage } from "../player-positions.js";

/**
 * 比赛请求显式选择空间引擎；旧调用未声明时，用户参与比赛仍默认空间模拟。
 * 表现方式（直播、快速、纯战报、后台）不能改变这里的判断。
 * @param {object} state createMatchSession 返回值
 * @returns {boolean}
 */
export function shouldUseSim(state) {
  if (state?.engineMode === "spatial") return true;
  if (state?.engineMode === "probability") return false;
  return !!state?.userSide;
}

export const SIMULATION_PROFILES = Object.freeze({
  standard: Object.freeze({
    key: "standard",
    timeStep: SIM.DT,
    separationPasses: 8,
  }),
  background: Object.freeze({
    key: "background",
    // 无画面比赛仍逐步运行同一空间决策、球物理和裁判规则；仅降低时间分辨率。
    timeStep: 0.3,
    separationPasses: 4,
  }),
});

/**
 * 创建 / 复用绑定在 state 上的引擎
 * @param {object} state
 * @returns {SimEngine}
 */
export function ensureSimEngine(state) {
  if (state.simEng) {
    state.simEng.matchModifiers = state.simModifiers || state.simEng.matchModifiers || null;
    return state.simEng;
  }
  const profile =
    SIMULATION_PROFILES[state.simulationProfile] || SIMULATION_PROFILES.standard;
  state.simulationProfile = profile.key;
  state.simEng = new SimEngine(state.home, state.away, {
    random: state.random,
    modifiers: state.simModifiers || null,
    simulationProfile: profile.key,
    timeStep: profile.timeStep,
    separationPasses: profile.separationPasses,
  });
  state.simEng.matchModifiers = state.simModifiers || null;
  state.simEngineMeta = {
    version: 2,
    profile: profile.key,
    timeStep: profile.timeStep,
    separationPasses: profile.separationPasses,
    halves: [],
  };
  return state.simEng;
}

/**
 * 中场换人/换阵后，把首发变更同步到仍在跑的引擎（尽量保位置连续性）
 * @param {object} state
 */
export function resyncSimAfterHalfTime(state) {
  const eng = state.simEng;
  if (!eng) return;
  const priorFitness = new Map(eng.agents.map((agent) => [agent.id, agent.fitness]));
  // ⚠ 累计跑动距离也必须按 **id** 搬过去：下面按**槽位序号**重新绑定 `a.id = p.id`，
  //   若不搬，接替同一槽位的另一名球员会继承前者的跑动距离
  //   ⇒ 体能分摊会算到错的人头上。
  const priorRun = new Map(eng.agents.map((agent) => [agent.id, Number(agent.runMetres) || 0]));
  for (const isHome of [true, false]) {
    const club = isHome ? state.home : state.away;
    ensureTactics(club);
    ensureLineupRoles(club);
    ensureCorePlayer(club); // 主客都保证有核心
    const form = FORMATIONS[club.tactics?.formation] || FORMATIONS["4-3-3"];
    const slots = form.slots || [];
    const xi = getLineupPlayers(club) || [];
    const assigned = assignPlayersToFormationSlots(xi, slots);
    const team = isHome ? "home" : "away";
    const agents = eng.agents.filter((a) => a.team === team);
    for (let i = 0; i < Math.min(agents.length, slots.length); i++) {
      const a = agents[i];
      const slot = slots[i];
      const p = assigned[i] || null;
      if (!p) continue;
      const coverage = positionCoverage(p, slot, slots);
      a.id = p.id;
      a.player = p;
      a.num = p.number ?? a.num;
      // 离场状态跟随「现在这个槽位的球员」：红牌者仍被罚下；
      // 伤员被中场换下后，接替者必须恢复在场（否则替补被卡在场外）
      a.sentOff = state.sentOff[team].has(p.id) || (p.injured || 0) > 0;
      a.injuredOff = (p.injured || 0) > 0;
      // 角色以阵型槽为准，GK 槽永远是门将 AI
      a.role = slot.pos || p.pos || a.role;
      a.detailedPosition = coverage.target;
      a.positionRating = coverage.rating;
      a.naturalPosition = coverage.natural;
      try {
        a.roleId = getSlotRole(club, i) || null;
      } catch {
        a.roleId = a.roleId || null;
      }
      try {
        a.dutyId = getSlotDuty(club, i) || null;
      } catch {
        a.dutyId = a.dutyId || null;
      }
      a.habits = new Set(p?.playingHabits || []);
      a.fitness = priorFitness.has(p.id) ? priorFitness.get(p.id) : p.fitness ?? 100;
      // 同上：按 id 取回，新人（priorRun 里没有）从 0 起算
      a.runMetres = priorRun.has(p.id) ? priorRun.get(p.id) : 0;
      const attrs = p.attrs || {};
      const n = (v) => {
        const raw = Math.max(0.05, Math.min(1, (v ?? 10) / 20));
        return Math.max(0.3, Math.min(0.92, 0.28 + raw * 0.64));
      };
      a.attr = {
        pace: n(attrs.pace),
        accel: n(attrs.pace) * 0.6 + n(attrs.strength) * 0.4,
        passing: n(attrs.passing),
        vision: n(attrs.vision),
        shooting: n(attrs.shooting),
        finishing: n(attrs.finishing),
        dribbling: n(attrs.dribbling),
        tackling: n(attrs.tackling),
        marking: n(attrs.marking),
        strength: n(attrs.strength),
        stamina: n(attrs.stamina),
        positioning: n(attrs.positioning),
        reflexes: n(attrs.reflexes),
        handling: n(attrs.handling),
        kicking: n(attrs.kicking),
      };
      let bx = slot.x;
      let by = slot.y;
      // 阵型槽坐标是「以本队进攻方向为基准」的：槽 y 小 = 靠己方后场。
      // 主队原始朝向是 +y（主队门在 y=100），因此不换边时主队**不镜像**、
      // 客队镜像；一旦 endsSwapped 打开，两队朝向互换，镜像关系也必须
      // 整体取反，否则换边后阵型仍摆回原来那半场。
      // 用引擎自己的 endsSwapped 作准，避免调用层传参与引擎状态脱节。
      const mirrored = isHome ? !!eng.endsSwapped : !eng.endsSwapped;
      if (mirrored) {
        bx = 100 - bx;
        by = 100 - by;
      }
      a.baseX = bx;
      a.baseY = by;
      a.slotX = slot.x ?? 50;
      a.slotY = slot.y ?? 50;
      a.isCore = false;
    }
    const coreId = getCorePlayerId(club);
    if (coreId) {
      const core = agents.find((x) => x.id === coreId);
      if (core) core.isCore = true;
    }
  }
  if (eng.ball.owner && !eng.agentById(eng.ball.owner)) {
    eng.ball.owner = null;
  }
}

/**
 * 模拟秒 → 比赛分钟（1..90）
 * 与进球、播放帧顶栏共用 simMinuteOf，避免同一时刻算出不同分钟。
 */
const simTToMinute = simMinuteOf;

/**
 * 直播帧录制策略（单遍、事件驱动）：
 * - 环形缓冲保留最近 ~20s 的 10Hz 帧（覆盖高光窗 lead）
 * - 进球/扑救/威胁射/角球/开球等触发后：回灌 ring + 继续密采 trail
 * - 平淡时段不落盘 → 半场从 ~2.7 万帧降到通常 1–3 千级
 * 与 buildHighlightWindows 的 lead/trail 对齐，保证 play 段仍可 60fps 插值。
 */
const LIVE_RING_SEC = 20;
const LIVE_DENSE = {
  goal: { lead: 12, trail: 8 },
  save: { lead: 14, trail: 8 },
  shot: { lead: 16, trail: 6 },
  corner: { lead: 2, trail: 13 },
  kickoff: { lead: 0, trail: 14 },
  // 伤退热替换：短窗够看清换人，不进高光预算
  injury: { lead: 4, trail: 6 },
  sub_on: { lead: 2, trail: 6 },
};

function pushLiveFrame(frames, f) {
  if (!frames || !f) return;
  const last = frames[frames.length - 1];
  if (last && Math.abs((last.t ?? 0) - (f.t ?? 0)) < 1e-9) {
    frames[frames.length - 1] = f; // 同刻以新帧为准（netHit 脉冲）
    return;
  }
  if (last && (f.t ?? 0) < (last.t ?? 0) - 1e-9) return;
  frames.push(f);
}

function flushRingToFrames(ring, frames, t0, t1) {
  if (!ring?.length || !frames) return;
  for (const f of ring) {
    const t = f.t ?? 0;
    if (t + 1e-9 < t0) continue;
    if (t > t1 + 1e-9) break;
    pushLiveFrame(frames, f);
  }
}

function liveInterestOfEvent(e, tStart) {
  if (!e) return null;
  if (e.type === "goal") return LIVE_DENSE.goal;
  if (e.type === "save") return LIVE_DENSE.save;
  if (e.type === "shot") return LIVE_DENSE.shot;
  if (e.type === "corner") return LIVE_DENSE.corner;
  if (e.type === "injury") return LIVE_DENSE.injury;
  if (e.type === "sub_on") return LIVE_DENSE.sub_on;
  // 半场开球瞬间（引擎 kickoff 事件）
  if (e.type === "kickoff") return LIVE_DENSE.kickoff;
  return null;
}

/**
 * 跑完一个时段（上/下半场），产出结果 + 风味事件。
 * @param {SimEngine} eng
 * @param {number} fromMin 含（1 或 46）
 * @param {number} toMin 含（45 或 90）
 * @param {{ record?: boolean, sampleEvery?: number, adaptive?: boolean }} [opts]
 *   record=true 录帧；adaptive=true（默认当 record）事件驱动密采，否则均匀 sampleEvery
 */
export function runSimPeriodRaw(eng, fromMin, toMin, opts = {}) {
  const tStart = (fromMin - 1) * 60; // 1'→0s，46'→45*60
  const tEnd = toMin * 60;
  const record = !!opts.record;
  const adaptive = record && opts.adaptive !== false;
  const stepDt = Math.max(
    SIM.DT,
    Math.min(0.5, Number(opts.timeStep ?? eng?.timeStep ?? SIM.DT) || SIM.DT)
  );
  const sampleEvery = Math.max(1, opts.sampleEvery ?? (adaptive ? 1 : 5));
  const frames = record ? [] : null;
  const ringMax = Math.ceil(LIVE_RING_SEC / stepDt) + 2;
  const ring = record && adaptive ? [] : null;
  // 开球段强制密采（与 buildHighlightWindows kickoff 窗一致）
  let denseUntil = record && adaptive ? Math.min(tEnd, tStart + LIVE_DENSE.kickoff.trail) : -Infinity;
  let eventCursor = eng.events?.length || 0;
  // 时段控球秒数差分（引擎 stats.poss 是累计）
  const poss0 = {
    home: eng.stats?.home?.poss || 0,
    away: eng.stats?.away?.poss || 0,
  };
  const guardMax = Math.ceil((tEnd - eng.t) / stepDt + 50);
  let guard = 0;
  while (eng.t + 1e-9 < tEnd && guard < guardMax) {
    eng.step(Math.min(stepDt, tEnd - eng.t));
    guard++;
    if (!frames) continue;

    if (adaptive) {
      // 1) 消化本步新事件 → 回灌 ring + 延长密采
      const evs = eng.events || [];
      while (eventCursor < evs.length) {
        const e = evs[eventCursor++];
        if (e.t <= tStart || e.t > tEnd) continue;
        const win = liveInterestOfEvent(e, tStart);
        if (!win) continue;
        const t0 = Math.max(tStart, e.t - win.lead);
        const t1 = Math.min(tEnd, e.t + win.trail);
        flushRingToFrames(ring, frames, t0, t1);
        denseUntil = Math.max(denseUntil, t1);
      }
      // 2) 本步帧进 ring；密采窗内落盘
      const fr = compactSimFrame(eng);
      ring.push(fr);
      if (ring.length > ringMax) ring.shift();
      if (eng.t <= denseUntil + 1e-9) {
        pushLiveFrame(frames, fr);
      }
    } else if (guard % sampleEvery === 0) {
      frames.push(compactSimFrame(eng));
    }
  }
  // 半场末强制一帧（边界/插值兜底）
  if (frames && (!frames.length || frames[frames.length - 1].t < eng.t - 1e-6)) {
    pushLiveFrame(frames, compactSimFrame(eng));
  }

  // 原始模拟已经校准到可观看量级；比分和高光必须来自同一批空间事件。
  // 变量名 scaled 暂留以兼容 match.js 既有接口，内容已是 direct result。
  const scaled = eng.directResult({ tMin: tStart, tMax: tEnd });
  const poss1 = {
    home: eng.stats?.home?.poss || 0,
    away: eng.stats?.away?.poss || 0,
  };
  scaled.possessionSec = {
    home: Math.max(0, poss1.home - poss0.home),
    away: Math.max(0, poss1.away - poss0.away),
  };
  const raw = eng.events.filter((e) => e.t > tStart && e.t <= tEnd);
  const flavor = pickFlavorEvents(raw, fromMin, toMin);
  // 全量犯规计数（含未吃牌者），按犯规方归账供统计栏显示。
  const fouls = { home: 0, away: 0 };
  for (const e of raw) {
    if (e.type === "foul" && (e.team === "home" || e.team === "away")) fouls[e.team]++;
  }
  return {
    scaled,
    flavor,
    tStart,
    tEnd,
    steps: guard,
    frames,
    fouls,
    frameStats: frames
      ? { count: frames.length, adaptive, denseUntil, ringSec: LIVE_RING_SEC }
      : null,
  };
}

/** 压缩快照：直播投影够用，体积小于完整 snapshot */
export function compactSimFrame(eng) {
  const b = eng.ball;
  // 入网脉冲只发一帧，立即清掉，避免后续帧/跳段在错误位置重放网效
  const netHit = !!b._netHitPulse;
  if (netHit) b._netHitPulse = false;
  // Reading a recorded frame must not consume evidence needed by live views.
  const deflect = ballDeflectionOf(eng);
  // 定位球阶段直接随帧传给表现层，不能等事件文案临时摆拍。
  const setPiece =
    b.state === "penalty"
      ? "penalty"
      : b.state === "corner" ||
    (eng.deadBallUntil &&
      eng.t < eng.deadBallUntil &&
      (b.state === "corner" ||
        (b.kickX != null &&
          (b.kickX < 8 || b.kickX > 92) &&
          (b.kickY < 8 || b.kickY > 92) &&
          b.owner)))
      ? b.state === "corner"
        ? "corner"
        : null
      : null;
  return {
    t: eng.t,
    // 与 snapshot() 同源：画面侧队名标签 / 边裁半场钳位靠它感知换边。
    // 直播走 compact 帧，不走 snapshot()；漏掉的话 MatchView 会一直以为没换边。
    endsSwapped: !!eng.endsSwapped,
    // 与 snapshot() 同源的不连续窗口标记：直播帧流（高光插值播放）靠它区分
    // 「重启单 tick 搬位」与真实瞬移——监视器豁免 + 表现层缓动都认这个字段。
    // 以前只有 snapshot() 带，compactSimFrame 丢掉后一次角球布阵能刷 20+ 条
    // player-teleport 事故（.tmp-video/live 2635.64s 实测）。
    motionContext: motionContextOf(eng),
    ball: {
      x: b.x,
      y: b.y,
      // 高空球高度（米级 0..~8），直播投影阴影/缩放用
      z: Number.isFinite(b.z) ? b.z : 0,
      owner: b.owner,
      state: b.state || null,
      restartType: b.restartType || null,
      netHit,
      deflect,
      setPiece:
        setPiece ||
        (b.state === "corner" ? "corner" : b.state === "penalty" ? "penalty" : null),
    },
    players: eng.agents.map((a) => {
      const poseOn = a.pose && eng.t < (a.poseUntil || 0);
      return {
        id: a.id,
        team: a.team,
        x: a.x,
        y: a.y,
        heading: a.heading,
        hasBall: b.owner === a.id,
        role: a.role,
        num: a.num,
        pose: poseOn ? a.pose : null,
        poseDir: poseOn ? a.poseDir || 0 : 0,
      };
    }),
  };
}

/** 从分钟帧列表均匀抽 k 帧（保证首尾） */
export function subsampleFrames(list, k = 10) {
  if (!list?.length) return [];
  if (list.length <= k) return list.slice();
  const out = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.round((i * (list.length - 1)) / (k - 1));
    out.push(list[idx]);
  }
  return out;
}

/**
 * 高光观赛计划（FMM 向）
 *
 * 关键：引擎 raw 射门/扑救极多，若都开窗再 12s 合并，会铺满整半场 → 看起来「从不跳过」。
 * 策略：
 *  - 进球必播、窗略长
 *  - 扑救/威胁严格限量，且必须与已有窗拉开距离
 *  - 合并间隔收紧，保证 skip 段落真实存在
 *  - 半场高光总时长封顶（约 2.5 分钟模拟 ≈ ×1 墙钟 2.5 分钟/半场）
 */
export function buildHighlightWindows(opts = {}) {
  const tStart = opts.tStart ?? 0;
  const tEnd = opts.tEnd ?? 90 * 60;
  const raw = opts.rawEvents || [];
  const goals = opts.scaledGoals || [];
  const windows = [];

  // 进球：只保留最后一段组织 + 入网 + 庆祝起步。
  // 旧窗口最长 44s，叠加自动重播后单球会占约 100s 墙钟。
  for (const g of goals) {
    const t = g.t != null ? g.t : (g.minute || 1) * 60;
    const lead = g.assistId ? 10 : 8;
    windows.push({
      t0: Math.max(tStart, t - lead),
      // 庆祝结束前切出，避免把引擎规则层的瞬时开球复位展示给观众。
      t1: Math.min(tEnd, t + 6),
      priority: 100,
      label: "goal",
      at: t,
      assistId: g.assistId || null,
      scorerId: g.scorerId || null,
    });
  }

  const farFromExisting = (t, minDist) =>
    !windows.some((w) => t >= w.t0 - minDist && t <= w.t1 + minDist);

  // 扑救：半场最多 3 次，且远离进球窗
  const saves = raw.filter((e) => e.type === "save").sort((a, b) => a.t - b.t);
  let saveN = 0;
  for (let i = 0; i < saves.length && saveN < 3; i++) {
    const e = saves[i];
    if (!farFromExisting(e.t, 25)) continue;
    // 均匀挑：跳过过密
    if (saveN > 0 && e.t - windows.filter((w) => w.label === "save").slice(-1)[0]?.at < 90) continue;
    windows.push({
      t0: Math.max(tStart, e.t - 12),
      t1: Math.min(tEnd, e.t + 7),
      priority: 50,
      label: "save",
      at: e.t,
    });
    saveN++;
  }

  // 威胁射门：按同源空间信息排序，避免固定步长反复选中普通超远射。
  const shotThreat = (e) => {
    if (e.penalty) return 1;
    const d = Number.isFinite(Number(e.distance)) ? Number(e.distance) : e.long ? 28 : 16;
    let threat = 0.55 * Math.exp(-d / 14);
    if (e.openGoal) threat = Math.max(threat, 0.55);
    if (e.offTarget) threat *= 0.25;
    if (e.long) threat *= 0.78;
    return threat;
  };
  const shots = raw
    .filter((e) => e.type === "shot")
    .sort((a, b) => shotThreat(b) - shotThreat(a) || a.t - b.t);
  let shotN = 0;
  for (let i = 0; i < shots.length && shotN < 2; i++) {
    const e = shots[i];
    if (!farFromExisting(e.t, 30)) continue;
    windows.push({
      t0: Math.max(tStart, e.t - 14),
      t1: Math.min(tEnd, e.t + 5),
      priority: 30,
      label: "chance",
      at: e.t,
    });
    shotN++;
  }

  // 角球：半场最多 3 次（用户反馈「从没见过角球画面」——旧版高光窗根本不含角球）
  const corners = raw.filter((e) => e.type === "corner").sort((a, b) => a.t - b.t);
  let cornerN = 0;
  for (let i = 0; i < corners.length && cornerN < 3; i++) {
    const e = corners[i];
    if (!farFromExisting(e.t, 22)) continue;
    if (
      cornerN > 0 &&
      e.t - (windows.filter((w) => w.label === "corner").slice(-1)[0]?.at ?? 0) < 70
    ) {
      continue;
    }
    windows.push({
      // 从摆位完成的事件帧开始，避免把规则层瞬时重排展示成全队跳位。
      t0: Math.max(tStart, e.t),
      // 摆位顿 + 开出 + 禁区争夺
      t1: Math.min(tEnd, e.t + 12),
      priority: 42,
      label: "corner",
      at: e.t,
    });
    cornerN++;
  }

  // 开球一小段
  if (tEnd - tStart > 60) {
    windows.push({
      t0: tStart,
      t1: Math.min(tEnd, tStart + 14),
      priority: 10,
      label: "kickoff",
      at: tStart,
    });
  }

  // 只合并真正重叠或极近（< 4s）的窗，避免「整半场糊成一段」
  windows.sort((a, b) => a.t0 - b.t0 || b.priority - a.priority);
  const merged = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.t0 <= last.t1 + 4) {
      last.t1 = Math.max(last.t1, w.t1);
      // 高潮时刻保留更高优先级事件（进球 > 扑救 > 机会）
      if (w.priority >= last.priority) {
        last.priority = w.priority;
        last.label = w.label;
        if (w.at != null) last.at = w.at;
        if (w.assistId) last.assistId = w.assistId;
        if (w.scorerId) last.scorerId = w.scorerId;
      }
    } else {
      merged.push({ ...w });
    }
  }

  // 半场高光总时长封顶 ~150s 模拟（×1 ≈ 2.5 分钟/半场细播）
  const MAX_PLAY = 150;
  let budget = 0;
  const capped = [];
  // 进球优先
  const ordered = merged.slice().sort((a, b) => b.priority - a.priority || a.t0 - b.t0);
  for (const w of ordered) {
    const dur = w.t1 - w.t0;
    if (w.label === "goal" || w.label === "kickoff") {
      capped.push(w);
      budget += dur;
      continue;
    }
    if (budget + dur > MAX_PLAY) continue;
    capped.push(w);
    budget += dur;
  }
  capped.sort((a, b) => a.t0 - b.t0);

  let playSec = 0;
  for (const w of capped) playSec += w.t1 - w.t0;
  playSec += Math.max(0, capped.length) * 0.15;
  return { windows: capped, playSec };
}

/** 截取 [t0,t1] 内的帧（含边界） */
export function sliceFrames(frames, t0, t1) {
  if (!frames?.length) return [];
  const out = [];
  for (const f of frames) {
    const t = f.t ?? 0;
    if (t < t0 - 1e-6) continue;
    if (t > t1 + 1e-6) break;
    out.push(f);
  }
  // 保证至少 2 帧才能插值
  if (out.length === 1) {
    const i = frames.indexOf(out[0]);
    if (i > 0) out.unshift(frames[i - 1]);
    else if (i < frames.length - 1) out.push(frames[i + 1]);
  }
  return out;
}

/**
 * 把高光窗 + 全时段 编成播放段落：play | skip
 * @returns {Array<{kind:'play'|'skip', t0, t1, frames?, fromMin, toMin}>}
 */
export function buildHighlightSegments(frames, windows, tStart, tEnd) {
  const segs = [];
  let cursor = tStart;
  const wins = (windows || []).slice().sort((a, b) => a.t0 - b.t0);

  const minOf = simMinuteOf;

  for (const w of wins) {
    const a = Math.max(tStart, w.t0);
    const b = Math.min(tEnd, w.t1);
    if (b <= a) continue;
    if (a > cursor + 0.5) {
      segs.push({
        kind: "skip",
        t0: cursor,
        t1: a,
        fromMin: minOf(cursor),
        toMin: minOf(a),
      });
    }
    const fr = sliceFrames(frames, a, b);
    if (fr.length >= 2) {
      segs.push({
        kind: "play",
        t0: a,
        t1: b,
        frames: fr,
        label: w.label,
        // 高潮时刻（进球/扑救/射门），导演镜头与慢镜对齐
        at: w.at != null ? w.at : (a + b) / 2,
        assistId: w.assistId || null,
        scorerId: w.scorerId || null,
        fromMin: minOf(a),
        toMin: minOf(b),
      });
    }
    cursor = Math.max(cursor, b);
  }
  if (cursor < tEnd - 0.5) {
    segs.push({
      kind: "skip",
      t0: cursor,
      t1: tEnd,
      fromMin: minOf(cursor),
      toMin: minOf(tEnd),
    });
  }
  return segs;
}

function pickFlavorEvents(raw, fromMin, toMin) {
  const out = [];
  const caps = {
    corner: 5,
    save: 6,
    tackle: 4,
    offside: 3,
    intercept: 2,
    backpass: 2,
    advantage_played: 3,
    handball: 3,
    var_decision: 4,
  };
  const counts = {
    corner: 0,
    save: 0,
    tackle: 0,
    offside: 0,
    intercept: 0,
    backpass: 0,
    advantage_played: 0,
    handball: 0,
    var_decision: 0,
  };
  const byType = {};
  for (const e of raw) {
    if (!caps[e.type]) continue;
    (byType[e.type] || (byType[e.type] = [])).push(e);
  }
  for (const type of Object.keys(caps)) {
    const list = byType[type] || [];
    if (!list.length) continue;
    const step = Math.max(1, Math.floor(list.length / caps[type]));
    for (let i = 0; i < list.length && counts[type] < caps[type]; i += step) {
      const e = list[i];
      let minute = simTToMinute(e.t);
      minute = Math.max(fromMin, Math.min(toMin, minute));
      out.push({
        minute,
        type,
        team: e.team,
        agentId: e.agentId,
        t: e.t,
        penalty: !!e.penalty,
        incident: e.incident || null,
        decision: e.decision || null,
        finalDecision: e.finalDecision || null,
        reason: e.reason || null,
        // 这里是白名单，字段不在列上就被丢掉。`hold` 就是这么丢的：引擎发了，
        // 文案想读，中间这一层没带——和 `deflect` 被 `interpolateSimBall` 丢掉是同一个形状。
        hold: !!e.hold,
      });
      counts[type]++;
    }
  }

  // —— 纪律事件（不采样、不封顶）：每张卡/每个点球都必须落地 ——
  // discipline.js 按 card/red 事件记停赛，漏一张就错账，故全量翻译。
  for (const e of raw) {
    if (e.type !== "foul") continue;
    const minute = Math.max(fromMin, Math.min(toMin, simTToMinute(e.t)));
    if (e.card === "yellow") {
      out.push({ minute, type: "card", team: e.team, agentId: e.agentId, t: e.t });
    } else if (e.card === "red" || e.card === "red2") {
      out.push({
        minute,
        type: "red",
        team: e.team,
        agentId: e.agentId,
        secondYellow: e.card === "red2",
        t: e.t,
      });
    }
    if (e.penalty) {
      // 点球判给被侵犯方（fouler 的对手），故翻转 team。
      const wonBy = e.team === "home" ? "away" : "home";
      out.push({ minute, type: "penalty", team: wonBy, foulTeam: e.team, t: e.t });
    }
  }

  // —— 伤病（不采样）：引擎已让球员真实退场/热替换，漏翻译会错账 ——
  for (const e of raw) {
    if (e.type !== "injury") continue;
    const minute = Math.max(fromMin, Math.min(toMin, simTToMinute(e.t)));
    out.push({
      minute,
      type: "injury",
      team: e.team,
      agentId: e.agentId,
      cause: e.cause,
      t: e.t,
    });
  }

  // —— 伤退热替换真正进场（~伤后 40s）：与引擎 id 切换对齐，避免画面先换人、帧还是旧 id ——
  for (const e of raw) {
    if (e.type !== "sub_on") continue;
    const minute = Math.max(fromMin, Math.min(toMin, simTToMinute(e.t)));
    out.push({
      minute,
      type: "sub_on",
      team: e.team,
      agentId: e.inId || e.agentId,
      outId: e.outId,
      inId: e.inId,
      t: e.t,
    });
  }

  out.sort((a, b) => a.minute - b.minute || a.t - b.t);
  return out;
}

/**
 * 将时段结果写入 match state，返回本时段新增的 match 事件列表。
 * helpers 由 match.js 注入，避免循环依赖。
 *
 * @param {object} state
 * @param {object} period
 * @param {{ registerGoal: Function, pushFlavor: Function }} helpers
 */
/**
 * 将时段结果写入 match state。
 * 注意：当前 match.js 主路径内联记账，本函数保留给探针/外部调用；
 * 必须与 simulatePeriodWithSim 同源（含 penalty / 真实 shotsOn·xG·控球）。
 */
export function translatePeriodToMatch(state, period, helpers) {
  const { scaled, flavor, tStart, tEnd } = period;
  const { registerGoal, pushFlavor } = helpers;
  const timeline = [];

  applySimPeriodStats(state, period);

  const lo = tStart <= 0 ? 1 : 46;
  const hi = tEnd <= 45 * 60 + 1 ? 45 : 90;

  for (const g of scaled.goals) {
    const minute = Math.max(lo, Math.min(hi, g.minute));
    timeline.push({
      kind: "goal",
      minute,
      team: g.team,
      scorerId: g.scorerId,
      assistId: g.assistId || null,
      penalty: !!g.penalty,
      ownGoal: !!g.ownGoal,
      t: g.t,
    });
  }
  for (const f of flavor) {
    timeline.push({ kind: "flavor", ...f });
  }
  timeline.sort((a, b) => a.minute - b.minute || (a.t || 0) - (b.t || 0));

  const emitted = [];
  for (const item of timeline) {
    if (item.kind === "goal") {
      const ev = registerGoal(
        state,
        item.minute,
        item.team,
        item.scorerId,
        item.assistId || null,
        { penalty: !!item.penalty, ownGoal: !!item.ownGoal }
      );
      if (ev) emitted.push(ev);
    } else {
      const ev = pushFlavor(state, item);
      if (ev) emitted.push(ev);
    }
  }

  if (state.simEngineMeta) {
    state.simEngineMeta.integration = eng.integrationSummary();
    state.simEngineMeta.halves.push({
      tStart,
      tEnd,
      scaledScore: { ...scaled.score },
      scaledShots: { ...scaled.shots },
      goals: scaled.goals.length,
    });
  }
  return emitted;
}

/** 把 directResult 的射门/射正/xG/控球写入 match state.stats（无掷骰） */
export function applySimPeriodStats(state, period) {
  const scaled = period?.scaled || {};
  for (const team of ["home", "away"]) {
    const st = state.stats[team];
    const n = scaled.shots?.[team] || 0;
    const on = scaled.shotsOn?.[team] || 0;
    const xg = scaled.xg?.[team] || 0;
    st.shots += n;
    st.shotsOn += on;
    st.xg += xg;
    // possessionTicks 用控球秒×10，与旧 UI 百分比公式兼容
    const sec = scaled.possessionSec?.[team];
    if (sec != null && Number.isFinite(sec)) {
      st.possessionTicks += Math.max(0, Math.round(sec * 10));
    } else {
      // 兜底：无 poss 积分时仍避免纯随机，按射门份额近似
      const totalShots = Math.max(1, (scaled.shots?.home || 0) + (scaled.shots?.away || 0));
      st.possessionTicks += Math.round(40 + (n / totalShots) * 80);
    }
    if (period?.fouls) st.fouls += period.fouls[team] || 0;
  }
}

/** 风味事件默认文案 */
export function defaultFlavorText(state, item) {
  const minute = item.minute;
  const club = item.team === "home" ? state.home : state.away;
  const short = club.short || club.name;
  let pname = "";
  if (item.agentId) {
    const p = club.players?.find((x) => x.id === item.agentId);
    if (p) pname = p.name;
  }
  const who = pname ? `${short} ${pname}` : short;
  switch (item.type) {
    case "corner":
      return `🚩 ${minute}' ${short} 获得角球`;
    case "save":
      // 引擎的 save 事件带 `hold`（true = 干净抱住，约占 29.5%）。以前这里不看它，
      // 所有扑救一律说「扑救成功」，于是画面上「从来没有接住过」。
      return item.hold
        ? `🧤 ${minute}' ${who} 稳稳没收`
        : `🧤 ${minute}' ${who} 把球扑出`;
    case "tackle":
      return `🛡️ ${minute}' ${who} 抢断成功`;
    case "offside":
      return `🚫 ${minute}' ${short} 越位`;
    case "intercept":
      return `拦截 ${minute}' ${who} 断下传球`;
    case "backpass":
      return `↩️ ${minute}' ${who} 回传门将违例，对手获得间接任意球`;
    case "advantage_played":
      return `▶️ ${minute}' 裁判示意有利，${short} 继续进攻`;
    case "handball":
      return item.penalty
        ? `✋ ${minute}' ${who} 禁区内手球，判罚点球`
        : `✋ ${minute}' ${who} 手球犯规`;
    case "var_decision":
      if (item.decision === "overturned") {
        return `VAR ${minute}' 复核完成，原判被推翻`;
      }
      return item.incident === "goal"
        ? `VAR ${minute}' 复核完成，进球有效`
        : `VAR ${minute}' 复核完成，点球判罚成立`;
    case "card":
      return `🟨 ${minute}' ${who} 吃到黄牌`;
    // 犯规携带的红牌（`foul` 事件的 `card` 字段，见 `match.js` 的 `pushSimFlavor`）。
    // 引擎在 `_rollFoulCard` 里直接罚下，但**只把红牌挂在 `foul` 事件上**，
    // 不另发 `red` 事件 ⇒ 这里必须给 `foul` 补文案，否则红牌卡片会显示
    // `default` 分支的「45' 球队名」这种无意义文字。
    case "foul":
      if (item.card === "red2") return `🟥 ${minute}' ${who} 两黄变一红被罚下！`;
      if (item.card === "red") return `🟥 ${minute}' ${who} 犯规被红牌罚下！`;
      if (item.card === "yellow") return `🟨 ${minute}' ${who} 犯规吃到黄牌`;
      return `⚠️ ${minute}' ${who} 犯规`;
    case "red":
      return item.secondYellow
        ? `🟥 ${minute}' ${who} 两黄变一红被罚下！`
        : `🟥 ${minute}' ${who} 被红牌罚下！`;
    case "penalty":
      return `❗ ${minute}' ${short} 获得点球`;
    case "injury":
      return `🏥 ${minute}' ${who} 受伤倒地`;
    default:
      return `${minute}' ${short}`;
  }
}
