// 统一镜像入口的**数学正确性**验证
//
// 换边第 3 步新增了 `_sign` / `_ownGoalSideY` / `_onOwnSide` /
// `_ownGoalSideYClamped` 四个入口，用来收敛约 30 处「场地坐标推断」。
// 这批替换最大的风险不是逻辑写错，而是**符号约定读反**（哪个是
// 「朝己方底线」、哪个是「距己方门」）—— 参考点一错，测试全绿但行为反了。
//
// 所以本脚本不测「调用点是否改对」，只钉死**入口本身的数学**：
//
//   A. `_sign` 与 `attackDir` 恒等，且换边后取反
//   B. `_ownGoalSideY(team, d)` 必须落在己方门那一侧、距门恰为 d
//   C. `_onOwnSide(y, team, d)` 与 `y` 到己方门的距离判定**互相一致**
//      （这是最关键的一条：两个入口必须描述同一条线）
//   D. `_ownGoalSideYClamped` 把 y 夹到 [minDist, maxDist] 带内，
//      且换边后仍是同一带（只是镜像）
//
// 用法：node scripts/_swap-ends-mirror-entry-check.mjs

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
    return {
      id: `${name}-${i}`, name: `${name} ${i}`, pos: role, role, number: i + 1,
      attrs, playingHabits: [], fitness: 100, injured: 0,
    };
  });
  return {
    id: name, name, players,
    tactics: {
      formation: "4-3-3", lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, width: 3, style: "balanced",
    },
  };
}
function mk(sw) {
  return new SimEngine(makeClub("H", 4), makeClub("A", 1), {
    random: mulberry32(999100), endsSwapped: sw,
  });
}

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const Q = (v) => Math.round(Number(v) * 1e6);

const ENGS = [["不换边", mk(false)], ["换  边", mk(true)]];

// ── A. `_sign` 恒等于 `attackDir` ────────────────────────────────
{
  let bad = [];
  for (const [label, e] of ENGS) {
    for (const t of ["home", "away"]) {
      if (e._sign(t) !== e.attackDir(t)) bad.push(`${label}/${t}: ${e._sign(t)} vs ${e.attackDir(t)}`);
    }
  }
  record("A1 `_sign` 与 `attackDir` 恒等", bad.length === 0, bad.join(" │ ") || "4/4 一致");

  // 换边后必须取反
  const n = mk(false), s = mk(true);
  const flipped = ["home", "away"].every((t) => s._sign(t) === -n._sign(t));
  record("A2 `_sign` 换边后取反", flipped, `home ${n._sign("home")}→${s._sign("home")} / away ${n._sign("away")}→${s._sign("away")}`);
}

// ── B. `_ownGoalSideY` 落点正确 ──────────────────────────────────
{
  let bad = [];
  const dists = [0, 6, 12, 14, 16, 18, 34, 66, 84, 100];
  for (const [label, e] of ENGS) {
    for (const t of ["home", "away"]) {
      const own = e.ownGoalY(t);
      for (const d of dists) {
        const y = e._ownGoalSideY(t, d);
        // 距己方门的距离必须恰好是 d
        if (Q(Math.abs(y - own)) !== Q(d)) {
          bad.push(`${label}/${t}/d=${d}: y=${y} own=${own} 实距 ${Math.abs(y - own)}`);
        }
      }
    }
  }
  record("B1 `_ownGoalSideY(t,d)` 距己方门恰为 d", bad.length === 0, bad.length ? bad.slice(0, 4).join(" │ ") : `${ENGS.length * 2 * dists.length} 组全部精确`);

  // d 在合法范围内时，y 必须落在 [0,100]
  let oob = [];
  for (const [label, e] of ENGS) {
    for (const t of ["home", "away"]) {
      for (const d of [0, 6, 12, 16, 34, 66, 84]) {
        const y = e._ownGoalSideY(t, d);
        if (!(y >= -1e-9 && y <= 100 + 1e-9)) oob.push(`${label}/${t}/d=${d} → ${y}`);
      }
    }
  }
  record("B2 `_ownGoalSideY` 结果落在 [0,100]", oob.length === 0, oob.join(" │ ") || "全部在界内");

  // 换边后必须镜像：_ownGoalSideY(t,d) 在 swapped 下 = 100 - 原值
  let mirrorBad = [];
  const n = mk(false), s = mk(true);
  for (const t of ["home", "away"]) {
    for (const d of [0, 6, 12, 16, 34, 66, 84]) {
      const a = n._ownGoalSideY(t, d), b = s._ownGoalSideY(t, d);
      if (Q(b) !== Q(100 - a)) mirrorBad.push(`${t}/d=${d}: ${a} → ${b}（期望 ${100 - a}）`);
    }
  }
  record("B3 换边后 `_ownGoalSideY` 镜像（100-原值）", mirrorBad.length === 0, mirrorBad.slice(0, 3).join(" │ ") || "14 组全部镜像");
}

// ── C. `_onOwnSide` 与「距己方门」互相一致（最关键） ─────────────
{
  let bad = [];
  for (const [label, e] of ENGS) {
    for (const t of ["home", "away"]) {
      for (const d of [6, 12, 16, 34, 50]) {
        // 扫 y，逐点比对两个入口
        //
        // ⚠ 这个「独立算法」我写错过**三次**，三次都是**测试错、代码对**：
        //   ① 只算距离 `|y-own| >= d` —— 漏方向，home 的 y=0（对面底线）被判 true。
        //   ② 加「同半场 y>=50」—— y=50 那条中线属于哪半分没有精确定义，又错。
        //   ③ 取区间 `[line, 对面底线]` —— **方向反了**：`_onOwnSide` 问的是
        //      「y 是否在**己方门那一侧**」，即 `[line, 己方门]` 这一段，
        //      不是 `[line, 对面底线]`。
        //
        //   教训（值得记进 skill）：写「独立表述」时,**先写出参考点和方向,
        //   再写区间**。`_onOwnSide` 的语义一句话是：「y 已跨过参考线、
        //   朝己方门又走了 d 格之后的那一段」。方向搞反时测试会稳定地
        //   报同一个错，而代码一直是对的 —— 连续两轮「修测试」都还在
        //   同一类错误里，说明该回去读实现语义，而不是继续猜。
        for (let y = 0; y <= 100; y += 0.5) {
          const viaEntry = e._onOwnSide(y, t, d);
          const own = e.ownGoalY(t);
          const walkIn = own > 50 ? -1 : 1;      // 从己方门朝场内走
          const line = own + walkIn * d;          // 参考线
          // 「己方门那一侧」= 从参考线到己方门这一段
          const lo = Math.min(line, own);
          const hi = Math.max(line, own);
          const viaDistance = y >= lo - 1e-9 && y <= hi + 1e-9;
          if (viaEntry !== viaDistance) {
            bad.push(`${label}/${t}/d=${d}/y=${y}: 入口=${viaEntry} 区间法=${viaDistance}`);
            break;
          }
        }
      }
    }
  }
  record(
    "C1 `_onOwnSide` 与「参考线到己方门这一段」逐点一致",
    bad.length === 0,
    bad.length ? bad.slice(0, 3).join(" │ ") : `${ENGS.length * 2 * 5 * 201} 个采样点全部一致`,
  );

  // 边界点必须恰好落在线上（≥ 语义，不是 >）
  let edgeBad = [];
  for (const [label, e] of ENGS) {
    for (const t of ["home", "away"]) {
      for (const d of [6, 16, 34]) {
        const line = e._ownGoalSideY(t, d);
        if (!e._onOwnSide(line, t, d)) edgeBad.push(`${label}/${t}/d=${d}: 线上 y=${line} 判为 false`);
        // 往门内挪一点点必须翻成 false
        const inside = e.ownGoalY(t) > 50 ? line - 0.5 : line + 0.5;
        if (e._onOwnSide(inside, t, d)) edgeBad.push(`${label}/${t}/d=${d}: 门内侧 y=${inside} 判为 true`);
      }
    }
  }
  record("C2 `_onOwnSide` 边界是闭区间且门内侧为 false", edgeBad.length === 0, edgeBad.slice(0, 3).join(" │ ") || "12 个边界点全对");

  // 己方门线上必然「在门那一侧」
  let ownLineBad = [];
  for (const [label, e] of ENGS) {
    for (const t of ["home", "away"]) {
      if (!e._onOwnSide(e.ownGoalY(t), t, 1)) ownLineBad.push(`${label}/${t}`);
    }
  }
  record("C3 己方门线上 `_onOwnSide` 必为 true", ownLineBad.length === 0, ownLineBad.join(" │ ") || "4/4");
}

// ── D. `_ownGoalSideYClamped` 夹取正确 ──────────────────────────
{
  let bad = [];
  for (const [label, e] of ENGS) {
    for (const t of ["home", "away"]) {
      const minD = 6, maxD = 18;
      const near = e._ownGoalSideY(t, minD);
      const far = e._ownGoalSideY(t, maxD);
      const lo = Math.min(near, far), hi = Math.max(near, far);
      // 带内点原样返回
      const inside = (lo + hi) / 2;
      if (Q(e._ownGoalSideYClamped(inside, t, minD, maxD)) !== Q(inside)) {
        bad.push(`${label}/${t}: 带内 ${inside} 被改动`);
      }
      // 带外点被夹到边界
      const below = lo - 20, above = hi + 20;
      if (Q(e._ownGoalSideYClamped(below, t, minD, maxD)) !== Q(lo)) {
        bad.push(`${label}/${t}: ${below} 未夹到 ${lo}`);
      }
      if (Q(e._ownGoalSideYClamped(above, t, minD, maxD)) !== Q(hi)) {
        bad.push(`${label}/${t}: ${above} 未夹到 ${hi}`);
      }
    }
  }
  record("D1 `_ownGoalSideYClamped` 夹取到 [minDist,maxDist] 带", bad.length === 0, bad.slice(0, 3).join(" │ ") || "12 组全部正确");

  // 换边后仍是「同一带」（镜像到对面）
  let bandBad = [];
  const n = mk(false), s = mk(true);
  for (const t of ["home", "away"]) {
    const nb = n._ownGoalSideYClamped(50, t, 6, 18);
    const sb = s._ownGoalSideYClamped(50, t, 6, 18);
    if (Q(sb) !== Q(100 - nb)) bandBad.push(`${t}: 不换边 ${nb} → 换边 ${sb}（期望 ${100 - nb}）`);
  }
  record("D2 换边后夹取带镜像到对面", bandBad.length === 0, bandBad.join(" │ ") || "2/2");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n📊 Results: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
if (failed.length) process.exit(1);
