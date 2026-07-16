/**
 * SimEngine → match.js 适配层（P5）
 *
 * 用户场次：空间模拟跑完全时段 → scaledResult 映射真实量级 →
 * 翻译成现有 {minute,type,text,playerId,...} 事件，继续走报告/评分/积分。
 *
 * AI 后台场次仍用 match.js 概率引擎（性能）。
 */
import { SimEngine, SIM } from "./engine.js";
import {
  getLineupPlayers,
  ensureTactics,
  ensureLineupRoles,
  ensureCorePlayer,
  assignPlayersToFormationSlots,
  getCorePlayerId,
  getSlotRole,
} from "../models.js";
import { FORMATIONS } from "../data.js";

/** 总开关：用户场是否走 v2 空间模拟 */
export const USE_SIM_ENGINE = true;

/**
 * @param {object} state createMatchSession 返回值
 * @returns {boolean}
 */
export function shouldUseSim(state) {
  if (!USE_SIM_ENGINE) return false;
  // 仅用户参与的比赛（后台 AI 场 userSide=null）
  return !!state?.userSide;
}

/**
 * 创建 / 复用绑定在 state 上的引擎
 * @param {object} state
 * @returns {SimEngine}
 */
export function ensureSimEngine(state) {
  if (state.simEng) return state.simEng;
  state.simEng = new SimEngine(state.home, state.away);
  state.simEngineMeta = { version: 2, halves: [] };
  return state.simEng;
}

/**
 * 中场换人/换阵后，把首发变更同步到仍在跑的引擎（尽量保位置连续性）
 * @param {object} state
 */
export function resyncSimAfterHalfTime(state) {
  const eng = state.simEng;
  if (!eng) return;
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
      a.id = p.id;
      a.player = p;
      a.num = p.number ?? a.num;
      // 角色以阵型槽为准，GK 槽永远是门将 AI
      a.role = slot.pos || p.pos || a.role;
      try {
        a.roleId = getSlotRole(club, i) || null;
      } catch {
        a.roleId = a.roleId || null;
      }
      a.fitness = p.fitness ?? 100;
      const attrs = p.attrs || {};
      const n = (v) => Math.max(0.05, Math.min(1, (v ?? 10) / 20));
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
      if (!isHome) {
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

/** 模拟秒 → 比赛分钟（1..90） */
function simTToMinute(tSec) {
  return Math.max(1, Math.min(90, Math.round((tSec / (90 * 60)) * 90) || 1));
}

/**
 * 跑完一个时段（上/下半场），产出缩放结果 + 风味事件。
 * @param {SimEngine} eng
 * @param {number} fromMin 含（1 或 46）
 * @param {number} toMin 含（45 或 90）
 * @param {{ record?: boolean, sampleEvery?: number }} [opts]
 *   record=true 时按 sampleEvery 步采一帧（供直播真空间投影）
 */
export function runSimPeriodRaw(eng, fromMin, toMin, opts = {}) {
  const tStart = (fromMin - 1) * 60; // 1'→0s，46'→45*60
  const tEnd = toMin * 60;
  const record = !!opts.record;
  const sampleEvery = Math.max(1, opts.sampleEvery ?? 5); // 默认 0.5s 一帧
  const frames = record ? [] : null;
  const guardMax = Math.ceil((tEnd - eng.t) / SIM.DT + 50);
  let guard = 0;
  while (eng.t + 1e-9 < tEnd && guard < guardMax) {
    eng.step();
    guard++;
    if (frames && guard % sampleEvery === 0) {
      frames.push(compactSimFrame(eng));
    }
  }
  // 半场末强制一帧
  if (frames && (!frames.length || frames[frames.length - 1].t < eng.t - 1e-6)) {
    frames.push(compactSimFrame(eng));
  }

  const scaled = eng.scaledResult({ tMin: tStart, tMax: tEnd });
  const raw = eng.events.filter((e) => e.t > tStart && e.t <= tEnd);
  const flavor = pickFlavorEvents(raw, fromMin, toMin);
  return { scaled, flavor, tStart, tEnd, steps: guard, frames };
}

/** 压缩快照：直播投影够用，体积小于完整 snapshot */
export function compactSimFrame(eng) {
  const b = eng.ball;
  // 入网脉冲只发一帧，立即清掉，避免后续帧/跳段在错误位置重放网效
  const netHit = !!b._netHitPulse;
  if (netHit) b._netHitPulse = false;
  // 角球等定位球：死球窗内标 setPiece，表现层可打角球徽章
  const setPiece =
    b.state === "corner" ||
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
    ball: {
      x: b.x,
      y: b.y,
      // 高空球高度（米级 0..~8），直播投影阴影/缩放用
      z: Number.isFinite(b.z) ? b.z : 0,
      owner: b.owner,
      state: b.state || null,
      netHit,
      setPiece: setPiece || (b.state === "corner" ? "corner" : null),
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

  // 进球：更长推进窗（助攻起脚 ~6s + 射门 + 庆祝聚拢 + 中圈开球）
  for (const g of goals) {
    const t = g.t != null ? g.t : (g.minute || 1) * 60;
    // 有助攻时再多留 6s 起脚/传球，回放叙事更完整
    const lead = g.assistId ? 28 : 22;
    windows.push({
      t0: Math.max(tStart, t - lead),
      t1: Math.min(tEnd, t + 16),
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

  // 威胁射门：半场最多 2 次（略加长推镜窗）
  const shots = raw.filter((e) => e.type === "shot").sort((a, b) => a.t - b.t);
  let shotN = 0;
  const shotStride = Math.max(1, Math.floor(shots.length / 4));
  for (let i = 0; i < shots.length && shotN < 2; i += shotStride) {
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
      t0: Math.max(tStart, e.t - 2),
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

  const minOf = (t) => Math.max(1, Math.min(90, Math.ceil(t / 60) || 1));

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
  const caps = { corner: 5, save: 6, tackle: 4, offside: 3, intercept: 2 };
  const counts = { corner: 0, save: 0, tackle: 0, offside: 0, intercept: 0 };
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
      out.push({ minute, type, team: e.team, agentId: e.agentId, t: e.t });
      counts[type]++;
    }
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
export function translatePeriodToMatch(state, period, helpers) {
  const { scaled, flavor, tStart, tEnd } = period;
  const { registerGoal, pushFlavor } = helpers;
  const timeline = [];

  for (const team of ["home", "away"]) {
    const n = scaled.shots[team] || 0;
    const st = state.stats[team];
    st.shots += n;
    const on = Math.round(n * (0.34 + Math.random() * 0.08));
    st.shotsOn += on;
    st.xg += n * (0.09 + Math.random() * 0.04);
    const totalShots = Math.max(1, (scaled.shots.home || 0) + (scaled.shots.away || 0));
    const share = n / totalShots;
    st.possessionTicks += Math.round(40 + share * 80 + Math.random() * 15);
  }

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
        item.assistId || null
      );
      if (ev) emitted.push(ev);
    } else {
      const ev = pushFlavor(state, item);
      if (ev) emitted.push(ev);
    }
  }

  if (state.simEngineMeta) {
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
      return `🧤 ${minute}' ${who} 扑救成功`;
    case "tackle":
      return `🛡️ ${minute}' ${who} 抢断成功`;
    case "offside":
      return `🚫 ${minute}' ${short} 越位`;
    case "intercept":
      return `拦截 ${minute}' ${who} 断下传球`;
    default:
      return `${minute}' ${short}`;
  }
}
