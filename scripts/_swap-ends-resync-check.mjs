// 换边第 2 步：`resyncSimAfterHalfTime` 阵型位映射验证
//
// 目标（两条，缺一不可）：
//   A. **不换边等价性**：`endsSwapped=false` 时，re-sync 后的 baseX/baseY
//      必须与改动前**逐位完全相同**（改动不能影响现有比赛）。
//   B. **换边正确性**：`endsSwapped=true` 时，镜像关系整体取反 ——
//      换边前主队 baseY 在中位以上（朝 +y 进攻 ⇒ 本队后场在 y 大侧），
//      换边后必须整体翻到 y 小侧；客队相反。
//
// 手法：直接调用 `resyncSimAfterHalfTime(state)`，state 用最小可用的
//   { simEng, home, away, sentOff } 结构（与 js/match.js 的 state 形状一致）。
//   baseY 是 re-sync 的唯一输出，我们逐槽对比。
//
// ⚠ 必须注入 opts.random（引擎不认 opts.seed）。
//
// 用法：node scripts/_swap-ends-resync-check.mjs

import { SimEngine } from "../js/sim/engine.js";
import { resyncSimAfterHalfTime } from "../js/sim/adapt.js";

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

// 刻意让主客队属性有差异，避免「两队完全同构」掩盖镜像 bug
function makeClub(name, bias) {
  const players = ROLES.map((role, i) => {
    const attrs = {};
    for (const k of NAMES) attrs[k] = 10 + bias + ((i * 3 + k.length) % 5);
    return {
      id: `${name}-${i}`,
      name: `${name} ${i}`,
      pos: role,
      role,
      number: i + 1,
      attrs,
      playingHabits: [],
      fitness: 100,
      injured: 0,
    };
  });
  return {
    id: name,
    name,
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((p) => p.id),
      pressing: 3,
      tempo: 3,
      defensiveLine: 3,
      width: 3,
      style: "balanced",
    },
  };
}

function makeState(endsSwapped) {
  const home = makeClub("H", 4);
  const away = makeClub("A", 1);
  const eng = new SimEngine(home, away, {
    random: mulberry32(733100),
    endsSwapped,
  });
  return {
    home,
    away,
    simEng: eng,
    sentOff: { home: new Set(), away: new Set() },
    simModifiers: null,
  };
}

function snapshot(state) {
  const eng = state.simEng;
  const out = [];
  for (const team of ["home", "away"]) {
    const list = eng.agents
      .filter((a) => a.team === team)
      .slice()
      .sort((a, b) => (a.slotY ?? 0) - (b.slotY ?? 0) || String(a.id).localeCompare(String(b.id)));
    for (const a of list) {
      out.push({
        team,
        id: a.id,
        slotX: a.slotX,
        slotY: a.slotY,
        baseX: a.baseX,
        baseY: a.baseY,
      });
    }
  }
  return out;
}

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const Q = (v) => Math.round((Number(v) || 0) * 1e6);

// ── A. 不换边：镜像公式必须与「旧的 !isHome」逐位等价 ──────────────
{
  const state = makeState(false);
  // 先记下 re-sync **之前**的 baseX/baseY（构造函数已经设过一次）
  const before = snapshot(state);
  // 手动按「旧公式」算一遍期望值：主队 slot 原样，客队 100-slot
  const expected = before.map((row) => {
    const mirrored = row.team !== "home"; // 旧的 !isHome
    return {
      ...row,
      baseX: mirrored ? 100 - row.slotX : row.slotX,
      baseY: mirrored ? 100 - row.slotY : row.slotY,
    };
  });

  resyncSimAfterHalfTime(state);
  const after = snapshot(state);

  let diff = [];
  for (let i = 0; i < after.length; i++) {
    if (Q(after[i].baseX) !== Q(expected[i].baseX) || Q(after[i].baseY) !== Q(expected[i].baseY)) {
      diff.push(
        `${after[i].team}/${after[i].id} slot(${after[i].slotX},${after[i].slotY}) ` +
          `期望(${expected[i].baseX},${expected[i].baseY}) 实得(${after[i].baseX},${after[i].baseY})`,
      );
    }
  }
  record(
    "不换边：resync 后 baseX/baseY 与旧公式逐位相同",
    diff.length === 0,
    diff.length ? `${diff.length} 处不符：\n      ` + diff.slice(0, 5).join("\n      ") : `${after.length} 槽全部一致`,
  );
}

// ── B. 换边：镜像关系必须整体取反 ────────────────────────────────
{
  const normal = makeState(false);
  const swapped = makeState(true);
  resyncSimAfterHalfTime(normal);
  resyncSimAfterHalfTime(swapped);

  const nSnap = snapshot(normal);
  const sSnap = snapshot(swapped);

  // 同名槽位对齐（两队球员 id 与 slot 顺序相同）
  const key = (r) => `${r.team}/${r.id}`;
  const nMap = new Map(nSnap.map((r) => [key(r), r]));
  const sMap = new Map(sSnap.map((r) => [key(r), r]));

  let mirrorDiff = [];
  for (const [k, n] of nMap) {
    const s = sMap.get(k);
    if (!s) {
      mirrorDiff.push(`${k} 缺失`);
      continue;
    }
    if (Q(s.baseX) !== Q(100 - n.baseX) || Q(s.baseY) !== Q(100 - n.baseY)) {
      mirrorDiff.push(
        `${k} 不换边(${n.baseX},${n.baseY}) ⇒ 期望(${100 - n.baseX},${100 - n.baseY}) 实得(${s.baseX},${s.baseY})`,
      );
    }
  }
  record(
    "换边：每个槽位 baseX/baseY 都是不换边版的 100-base",
    mirrorDiff.length === 0,
    mirrorDiff.length
      ? `${mirrorDiff.length} 处不符：\n      ` + mirrorDiff.slice(0, 5).join("\n      ")
      : `${nMap.size} 槽全部取反`,
  );

  // 只靠「中位数过没过 50」太弱：4-3-3 槽位本就在中线附近来回，
  // 差值可能只有几点，侥幸也能过。改用**位置上必须成立**的判据。
  //
  // ⚠ 阵型槽约定（js/data.js:770）：`y=0 己方球门`，GK slot.y = 92。
  //   所以「靠己方门」= baseY 大的一侧（对 home），而不是小的一侧。
  //   主队不镜像、客队镜像；换边后两者互换。
  const gkChecks = [];
  for (const [label, snap, sw] of [["不换边", nSnap, false], ["换边", sSnap, true]]) {
    for (const team of ["home", "away"]) {
      const squad = snap.filter((r) => r.team === team);
      // GK = slotY 最大的那个槽（约定 y 大 = 己方门）
      const gk = squad.reduce((m, r) => (r.slotY > m.slotY ? r : m), squad[0]);
      // 被测队「己方门」在哪一侧：home 不换边在 y 大侧，换边后翻到 y 小侧
      const ownSideHigh = team === "home" ? !sw : sw;
      const gkHigh = gk.baseY > 50;
      const extreme = ownSideHigh
        ? gk.baseY === Math.max(...squad.map((s) => s.baseY))
        : gk.baseY === Math.min(...squad.map((s) => s.baseY));
      gkChecks.push({
        label: `${label}/${team}`,
        ok: gkHigh === ownSideHigh && extreme,
        detail: `GK(slotY=${gk.slotY}) baseY=${gk.baseY.toFixed(1)} 应在 ${ownSideHigh ? "y大" : "y小"} 侧且为全队极值（队内 y∈[${Math.min(...squad.map((s) => s.baseY)).toFixed(1)}, ${Math.max(...squad.map((s) => s.baseY)).toFixed(1)}]）`,
      });
    }
  }
  record(
    "换边：各队门将始终位于己方门那一侧（4 组全成立）",
    gkChecks.every((c) => c.ok),
    gkChecks.filter((c) => !c.ok).map((c) => `${c.label} ${c.detail}`).join(" │ ") || "4/4 成立",
  );

  // 主队换边后整体压到 y<50 侧（因为换边前主队后场在 y 大侧）
  const nHome = nSnap.filter((r) => r.team === "home").map((r) => r.baseY);
  const sHome = sSnap.filter((r) => r.team === "home").map((r) => r.baseY);
  const nHomeMid = nHome.slice().sort((a, b) => a - b)[Math.floor(nHome.length / 2)];
  const sHomeMid = sHome.slice().sort((a, b) => a - b)[Math.floor(sHome.length / 2)];
  record(
    "换边：主队阵型整体翻到对面半场",
    nHomeMid > 50 && sHomeMid < 50,
    `不换边中位 ${nHomeMid.toFixed(1)} → 换边后中位 ${sHomeMid.toFixed(1)}`,
  );

  const nAwayMid = nSnap
    .filter((r) => r.team === "away")
    .map((r) => r.baseY)
    .sort((a, b) => a - b)
    .at(Math.floor(nSnap.filter((r) => r.team === "away").length / 2));
  const sAwayMid = sSnap
    .filter((r) => r.team === "away")
    .map((r) => r.baseY)
    .sort((a, b) => a - b)
    .at(Math.floor(sSnap.filter((r) => r.team === "away").length / 2));
  record(
    "换边：客队阵型整体翻到对面半场",
    nAwayMid < 50 && sAwayMid > 50,
    `不换边中位 ${nAwayMid.toFixed(1)} → 换边后中位 ${sAwayMid.toFixed(1)}`,
  );

  // 越位/不越位无关，但 baseY 必须仍在合法区间
  const inRange = sSnap.every((r) => r.baseY >= -1e-9 && r.baseY <= 100 + 1e-9);
  record("换边：baseY 全部落在 [0,100]", inRange);

  // ★ 最高层不变量（与阵型无关，任何 formation 下都必须成立）：
  //   「同一名球员相对己方门的**纵深**」换边前后应该不变。
  //   纵深 depth = |baseY - ownGoalY|。
  //   这条比「整体翻到对面半场」强得多：它逐人成立，且能抓出
  //   「整体看起来翻了、但某个位置的纵深被压缩/拉伸」这类错误。
  let depthDiff = [];
  for (const [k, n] of nMap) {
    const s = sMap.get(k);
    if (!s) continue;
    const team = n.team;
    // 不换边时己方门：home 在 100、away 在 0
    const nOwn = team === "home" ? 100 : 0;
    // 换边后整体镜像 ⇒ 己方门也翻到对面
    const sOwn = 100 - nOwn;
    const nDepth = Math.abs(n.baseY - nOwn);
    const sDepth = Math.abs(s.baseY - sOwn);
    if (Q(nDepth) !== Q(sDepth)) {
      depthDiff.push(`${k} 纵深 ${nDepth.toFixed(1)} → ${sDepth.toFixed(1)}`);
    }
  }
  record(
    "★ 换边：每名球员相对己方门的纵深不变（逐人成立）",
    depthDiff.length === 0,
    depthDiff.length ? `${depthDiff.length} 处不符：${depthDiff.slice(0, 4).join(" │ ")}` : `${nMap.size} 人全部保持不变`,
  );
}

// ── C. 换边后引擎仍能正常跑完整场（不炸） ──────────────────────────
{
  const state = makeState(true);
  const eng = state.simEng;
  let steps = 0;
  let err = null;
  try {
    for (let t = 0; t < 600; t++) {
      eng.step(0.1);
      steps++;
      if (t === 300) resyncSimAfterHalfTime(state); // 中场换边重同步
    }
  } catch (e) {
    err = e;
  }
  record(
    "换边后连续 600 步（含中途 resync）无异常",
    !err,
    err ? `${err && err.message}` : `${steps} 步，比分 ${eng.score ? `${eng.score.home}-${eng.score.away}` : "n/a"}`,
  );

  const allFinite = eng.agents.every(
    (a) => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.baseX) && Number.isFinite(a.baseY),
  );
  record("换边后所有 agent 坐标有限", allFinite);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n📊 Results: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
if (failed.length) process.exit(1);
