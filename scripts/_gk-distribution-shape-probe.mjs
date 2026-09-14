/**
 * 门将出球形状诊断 —— 回答「短传/长传的比例」与「出球方向」是否合理。
 *
 * 与 `_gk-kick-and-ball-jump-probe.mjs` 的分工：那个探针解决的是
 * 「球瞬移」与「大脚出界」两个具体缺陷，顺带记了短/长计数；
 * 本探针只做**出球决策本身**的拆解，补上它没测的三件事：
 *
 *   1. **按重启语境分开统计**。门球（`restartType === "goalkick"`）时对手本该在
 *      禁区外，门将的出球选择与「扑救后抱球」完全不同；混在一起算会把两种场景
 *      的平均值当成一种行为。
 *   2. **横向通道**。旧缺陷是「100% 落在中场中路」，现在落点分布是否还挤在中央
 *      （x∈[30,70]）？真实门将会瞄边路的边卫/边锋，而不是永远砸中路。
 *   3. **短传分支逐道门的失败原因**。`recvOk` 有两个子条件
 *      （不许太深 / 不许 ≤8 格），探针只报「不合格」不报是哪一条。
 *
 * 纯测量：只包装 `_gkDistribute` 与 `_pass`，只读状态、只打标记，
 * **不消费随机数**（否则会改变比赛轨迹、测的就不是引擎本身了）。
 * 口径与既有探针一致：标准档、`SIM.DT`、能力 15、4-3-3。
 *
 * 用法：node scripts/_gk-distribution-shape-probe.mjs [场数] [种子基]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const MATCHES = Number(process.argv[2] || 8);
const SEED_BASE = Number(process.argv[3] || 880000);

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
    id: name, name, players,
    tactics: {
      formation: "4-3-3", lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced",
    },
  };
}

// —— 挂钩（只读）——
const ORIG = {
  gk: SimEngine.prototype._gkDistribute,
  pass: SimEngine.prototype._pass,
  candidates: SimEngine.prototype._passCandidates,
};
const records = [];
let inGk = false;
let currentGk = null;        // 本次出球的门将（`recvOk` 复算需要它）
let shortTaken = false;      // 本次出球是否走了短传分支
let candidatesCalled = false;
let candList = null;         // `_passCandidates` 返回的整张列表（已按 value 降序）

// 单层包装：记录 `_passCandidates` 是否被调用、以及整张候选列表（value + 接球人位置
// + 是否满足 recvOk 的两条判据）。**只读，不消费随机数、不改任何决策输入。**
// ⚠ 挂钩 `_passCandidates` 而不是 `_bestPass`：两者在门将分支里**都**会用到
//   （`_bestPass` 只是 `_passCandidates(a)[0]`），但只有 `_passCandidates` 能拿到
//   **整张**候选表。2026-09-14 的候选改动曾把门将分支改成在整张表上逐个筛合格者，
//   挂钩 `_bestPass` 就会报「未被调用 100%」——那是挂钩失效，不是引擎行为。
//   该候选已因跌破进球护栏回退，本探针与两种实现都兼容。
SimEngine.prototype._passCandidates = function _probeCandidates(a) {
  const out = ORIG.candidates.call(this, a);
  if (inGk && !candidatesCalled) {
    candidatesCalled = true;
    const gk = currentGk;
    candList = out.map((option) => {
      const recv = option.agent;
      const pastLine = recv ? (gk.team === "home" ? recv.y < 82 : recv.y > 18) : false;
      const farEnough = recv ? Math.hypot(recv.x - gk.x, recv.y - gk.y) > 8 : false;
      return {
        value: option.value,
        role: recv ? recv.role : null,
        y: recv ? Number(recv.y.toFixed(1)) : null,
        dist: recv ? Number(Math.hypot(recv.x - gk.x, recv.y - gk.y).toFixed(1)) : null,
        eligible: pastLine && farEnough,
        tooDeep: !pastLine,
      };
    });
  }
  return out;
};

SimEngine.prototype._pass = function _probePass(a, option) {
  if (inGk) shortTaken = true;
  return ORIG.pass.call(this, a, option);
};

SimEngine.prototype._gkDistribute = function _probeGk(a) {
  inGk = true;
  currentGk = a;
  shortTaken = false;
  candidatesCalled = false;
  candList = null;

  // 出球瞬间的逼抢实况（与 `engine.js` 的 `underHeavyPressure` 同量同阈值）
  let nearestOpp = 99;
  let within9 = 0;
  for (const o of this.agents) {
    if (o.team === a.team || o.role === "GK" || o.sentOff) continue;
    const d = Math.hypot(o.x - a.x, o.y - a.y);
    if (d < nearestOpp) nearestOpp = d;
    if (d < 9) within9++;
  }
  const gkAt = { x: a.x, y: a.y };
  const restartType = this.ball?.restartType || null;

  // 复算引擎**真实**的短传门槛（`engine.js:_gkDistribute`）：
  //   shortThreshold = (prefersShort ? 0.15 : 0.22) - _roleBehavior(a,"shortDistribution") * 0.04
  // 两个输入都是纯读函数（不消费随机数）。若这里硬写 0.15，就会把
  // 「偏好短传且职责有折扣」的门将（门槛可低到 ~0.11）误判成「本可以传却开大脚」。
  const prefersShort =
    this._hasHabit(a, "distributes_short") || this._roleBehavior(a, "shortDistribution") > 0.15;
  const shortThreshold =
    (prefersShort ? 0.15 : 0.22) - this._roleBehavior(a, "shortDistribution") * 0.04;

  // 出球瞬间**本方外场球员**距己方门线的深度（米），用来验证
  // 「短传被 `recv.y < 82` 拒掉」到底是不是因为全队都还在自家禁区附近。
  const ownGoalY = a.team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
  const matesDepth = this.agents
    .filter((o) => o.team === a.team && o.role !== "GK" && !o.sentOff)
    .map((o) => Math.abs(o.y - ownGoalY) * (SIM.PITCH_H_METRES / SIM.FIELD_H));
  // 引擎的 `recv.y < 82`（home）换算成深度：距门线要 > 18 格 = 18.9 m
  const matesPastBoxLine = matesDepth.filter((d) => d > 18.9).length;
  // **关键**：出球瞬间到底有没有「合格的短传对象」？
  // 用与引擎 `recvOk` 完全相同的两条判据复算，只是这里对**所有人**算一遍，
  // 而不是只看 `_bestPass` 挑中的那一个。若这里 >0 而引擎仍然开大脚，
  // 说明缺陷是「选中者不合格时没有退而求其次」，不是「无人可选」。
  const eligibleMates = this.agents.filter((o) => {
    if (o.team !== a.team || o.role === "GK" || o.sentOff) return false;
    const pastLine = a.team === "home" ? o.y < 82 : o.y > 18;
    const farEnough = Math.hypot(o.x - a.x, o.y - a.y) > 8;
    return pastLine && farEnough;
  }).length;

  try {
    return ORIG.gk.call(this, a);
  } finally {
    inGk = false;
    currentGk = null;
    const b = this.ball;
    records.push({
      team: a.team,
      restartType,
      short: shortTaken,
      targetX: Number(b.targetX),
      targetY: Number(b.targetY),
      aimed: !!b.receiverId,
      gkAt,
      nearestOpp: Number(nearestOpp.toFixed(1)),
      within9,
      candidatesCalled,
      candList,
      shortThreshold,
      ballState: b.state,
      matesMedianDepth: median(matesDepth),
      matesMaxDepth: Math.max(...matesDepth),
      matesPastBoxLine,
      matesCount: matesDepth.length,
      eligibleMates,
    });
  }
};

/** 落点朝进攻方向的推进量（场地格，正 = 更靠近对方球门） */
const forwardOf = (team, y) => (team === "home" ? 50 - y : y - 50);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-");
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const pct = (n, d) => (d ? `${n}/${d}（${((100 * n) / d).toFixed(1)}%）` : "0/0");

function runMatch(seed) {
  const restore = Math.random;
  Math.random = seededRandom(seed);
  try {
    const eng = new SimEngine(club(`h${seed}`, 15), club(`a${seed}`, 15), {
      simulationProfile: "standard",
      timeStep: SIM.DT,
      separationPasses: 8,
    });
    const steps = Math.round((90 * 60) / SIM.DT);
    for (let s = 0; s < steps; s++) eng.step(SIM.DT);
  } finally {
    Math.random = restore;
  }
}

for (let m = 0; m < MATCHES; m++) runMatch(SEED_BASE + m);

console.log(`\n=== 门将出球形状诊断（${MATCHES} 场，种子 ${SEED_BASE}..${SEED_BASE + MATCHES - 1}，standard 档）===`);
console.log(`共 ${records.length} 次门将出球。落点/推进量单位为场地格（纵向 1 格 = ${(SIM.PITCH_H_METRES / SIM.FIELD_H).toFixed(2)} m）。\n`);

const short = records.filter((r) => r.short);
const long = records.filter((r) => !r.short);

console.log("--- 1. 短传 / 大脚 ---");
console.log(`  短传（传给队友）  ${pct(short.length, records.length)}`);
console.log(`  大脚（踢向通道）  ${pct(long.length, records.length)}`);

// 按重启语境分开
const contexts = [
  ["门球 goalkick", (r) => r.restartType === "goalkick"],
  ["非门球（抱球/回传等）", (r) => r.restartType !== "goalkick"],
];
console.log("\n--- 1b. 按重启语境拆开（两种场景的决策完全不同）---");
for (const [label, pred] of contexts) {
  const set = records.filter(pred);
  const s = set.filter((r) => r.short).length;
  console.log(`  ${label.padEnd(22)} 共 ${String(set.length).padStart(4)} 次 → 短传 ${pct(s, set.length)}`);
}

console.log("\n--- 2. 短传分支为什么走不通（仅「未走短传」的样本）---");
const noShort = long;
const notCalled = noShort.filter((r) => !r.candidatesCalled).length;
console.log("  " + "`_passCandidates` 未被调用（贴身压迫或反击习惯短路）".padEnd(44) + pct(notCalled, noShort.length));
const calledHas = noShort.filter((r) => r.candidatesCalled && r.candList && r.candList.length);
console.log(`  有候选                                      ${calledHas.length} 次`);
if (calledHas.length) {
  const topVals = calledHas.map((r) => r.candList[0].value);
  const topEligible = calledHas.filter((r) => r.candList[0].eligible).length;
  const roleTop = {};
  for (const r of calledHas) roleTop[r.candList[0].role] = (roleTop[r.candList[0].role] || 0) + 1;
  console.log(`  第 1 名候选：value 中位 ${fmt(median(topVals), 3)} | 合格的 ${pct(topEligible, calledHas.length)}`);
  console.log(`  第 1 名候选的角色 ${JSON.stringify(roleTop)} | y 中位 ${fmt(median(calledHas.map((r) => r.candList[0].y)))}`);
  console.log(`  候选总数 中位 ${fmt(median(calledHas.map((r) => r.candList.length)), 0)} | 其中合格 中位 ${fmt(median(calledHas.map((r) => r.candList.filter((c) => c.eligible).length)), 0)}`);
  // 用**每一条样本自己的真实门槛**判：合格候选里是否有 value 过门槛的？
  // 若为 0%，说明每一脚大脚都不存在「合格且过门槛」的更好选择——短传分支的
  // 短路是门槛本身的结论，不是 `recvOk` 筛掉的。
  const rows = calledHas
    .map((r) => ({
      best: Math.max(...r.candList.filter((c) => c.eligible).map((c) => c.value), -Infinity),
      thr: r.shortThreshold,
    }))
    .filter((row) => Number.isFinite(row.best));
  if (rows.length) {
    const overThr = rows.filter((row) => row.best > row.thr).length;
    const over015 = rows.filter((row) => row.best > 0.15).length;
    const over022 = rows.filter((row) => row.best > 0.22).length;
    console.log(
      `  本组真实门槛 中位 ${fmt(median(rows.map((r) => r.thr)), 3)}（偏好短传 0.15 / 否则 0.22，再减职责折扣 0.04×n）`
    );
    console.log(`  合格候选里的最高 value：过**本条真实门槛**的 ${pct(overThr, rows.length)}`);
    console.log(
      `  参考口径（固定阈值）：> 0.15 的 ${pct(over015, rows.length)}，> 0.22 的 ${pct(over022, rows.length)}`
    );
    console.log("  → 第一行即「仍有合格且过门槛的更好选择却开了大脚」的比例；");
    console.log("    在事后否决版下这就是缺陷规模，在逐项筛选版下就是剩余可优化空间。");
  }
}

console.log("\n--- 2b. 出球瞬间队友在哪（验证「接球人太深」的成因）---");
console.log("  引擎的 `recvOk` 要求接球人越过禁区线：home 要 `recv.y < 82`、away 要 `recv.y > 18`，");
console.log("  换算成距己方门线的深度就是**必须 > 18.9 m**。");
for (const [label, pred] of [
  ["全部出球", () => true],
  ["门球", (r) => r.restartType === "goalkick"],
  ["非门球", (r) => r.restartType !== "goalkick"],
]) {
  const set = records.filter(pred);
  if (!set.length) continue;
  const passed = set.map((r) => r.matesPastBoxLine);
  const zero = set.filter((r) => r.matesPastBoxLine === 0).length;
  console.log(
    `  ${label.padEnd(10)} 外场球员深度中位 ${fmt(median(set.map((r) => r.matesMedianDepth)))} m` +
    ` | 最深者中位 ${fmt(median(set.map((r) => r.matesMaxDepth)))} m` +
    ` | 越过 18.9 m 的人数中位 ${fmt(median(passed))}/${fmt(median(set.map((r) => r.matesCount)), 0)}` +
    ` | **一个都没有的占比 ${pct(zero, set.length)}**`
  );
}

console.log("\n--- 2b2. 第 1 名候选到底在哪（按队拆开，避免主客混淆）---");
for (const team of ["home", "away"]) {
  const set = long.filter((r) => r.team === team && r.candList && r.candList.length);
  if (!set.length) continue;
  const top = set.map((r) => r.candList[0]);
  const ys = top.map((c) => c.y);
  const deep = top.filter((c) => c.tooDeep).length;
  const line = team === "home" ? "< 82" : "> 18";
  const roles = {};
  for (const c of top) roles[c.role] = (roles[c.role] || 0) + 1;
  console.log(
    `  ${team.padEnd(5)} ${String(set.length).padStart(3)} 次 | 第 1 名 y 中位 ${fmt(median(ys))}` +
    ` | 最小/最大 ${fmt(Math.min(...ys))}/${fmt(Math.max(...ys))}` +
    ` | 违反 y ${line} 的 ${pct(deep, set.length)}`
  );
  console.log(`        角色 ${JSON.stringify(roles)} | 距门将 中位 ${fmt(median(top.map((c) => c.dist)))} 格`);
}

console.log("\n--- 2c. 关键：那一刻**到底有没有**合格的短传对象？---");
console.log("  用与引擎 `recvOk` 完全相同的两条判据，对**所有**外场球员各算一遍。");
console.log("  ⚠ 读法取决于门将分支用的是哪一版实现：");
console.log("    · **事后否决版**（`passTo = _bestPass(a)` 再单独查 `recvOk`，即当前正式源码）——");
console.log("      「有 ≥1 个合格对象却仍然开大脚」就是缺陷证据：选中者不合格时没有退而求其次。");
console.log("      实测 389/389 = 100%（2026-09-14，docs/gk-distribution-choice-2026-09-14.md §3.3）。");
console.log("    · **逐项筛选版**（在整张候选表上找第一个「过门槛且合格」者；该候选已因跌破");
console.log("      进球护栏而回退）——此时合格对象数 >0 是**正常**的，真正该看的是第 2 节的");
console.log("      「合格候选最高 value 是否过门槛」；若那里是 0%，说明每一脚大脚都没有");
console.log("      「合格且过门槛」的更好选择。");
const noShortRec = records.filter((r) => !r.short);
const zeroEligible = noShortRec.filter((r) => r.eligibleMates === 0).length;
console.log(`  未走短传的 ${noShortRec.length} 次里，合格对象数 = 0 的：${pct(zeroEligible, noShortRec.length)}`);
console.log(`  合格对象数 中位/最大：${fmt(median(noShortRec.map((r) => r.eligibleMates)), 0)} / ${Math.max(...noShortRec.map((r) => r.eligibleMates))}`);
const hadChoice = noShortRec.filter((r) => r.eligibleMates > 0);
console.log(`  有 ≥1 个合格对象却仍然开大脚：${pct(hadChoice.length, noShortRec.length)}`);
if (hadChoice.length) {
  const chosenY = hadChoice.filter((r) => r.recvInfo).map((r) => r.recvInfo.receiverY);
  if (chosenY.length) {
    console.log(`     这批里 _bestPass 挑中的接球人 y 中位 ${fmt(median(chosenY))}（home 需 <82 / away 需 >18）`);
  }
}
const byCtx = [
  ["门球", (r) => r.restartType === "goalkick"],
  ["非门球", (r) => r.restartType !== "goalkick"],
];
for (const [label, pred] of byCtx) {
  const set = noShortRec.filter(pred);
  if (!set.length) continue;
  console.log(`     ${label}：合格对象数=0 的占 ${pct(set.filter((r) => r.eligibleMates === 0).length, set.length)}，中位合格对象数 ${fmt(median(set.map((r) => r.eligibleMates)), 0)}`);
}

console.log("\n--- 3. 大脚的落点方向 ---");
const fwd = long.map((r) => forwardOf(r.team, r.targetY));
console.log(`  朝进攻方向推进 中位/最小/最大   ${fmt(median(fwd))} / ${fmt(Math.min(...fwd))} / ${fmt(Math.max(...fwd))} 格`);
console.log(`  推进量 ≤ 0（仍在本方半场）      ${pct(fwd.filter((v) => v <= 0).length, fwd.length)}`);
console.log(`  推进量 < 5 格（几乎没往前）     ${pct(fwd.filter((v) => v < 5).length, fwd.length)}`);
const box = long.filter((r) => r.targetX >= 30 && r.targetX <= 70 && forwardOf(r.team, r.targetY) >= -12 && forwardOf(r.team, r.targetY) <= 12);
console.log(`  落在「中路盒」x∈[30,70] 且推进 ∈[−12,12] 格   ${pct(box.length, long.length)}`);
const channels = { 左边路: 0, 中路: 0, 右边路: 0 };
for (const r of long) {
  if (r.targetX < 38) channels.左边路++;
  else if (r.targetX > 62) channels.右边路++;
  else channels.中路++;
}
console.log(`  横向通道（x<38 左 / 38–62 中 / >62 右）        ${JSON.stringify(channels)}`);
console.log(`  瞄了具体接应人                  ${pct(long.filter((r) => r.aimed).length, long.length)}`);

console.log("\n--- 4. 出球瞬间的逼抢实况 ---");
console.log(`  最近对手距离 中位/最小/最大     ${fmt(median(records.map((r) => r.nearestOpp)))} / ${fmt(Math.min(...records.map((r) => r.nearestOpp)))} / ${fmt(Math.max(...records.map((r) => r.nearestOpp)))} 格`);
const heavy = records.filter((r) => r.nearestOpp < 4 || r.within9 >= 2);
console.log(`  判为贴身压迫（<4 格 或 9 格内 ≥2 人）  ${pct(heavy.length, records.length)}`);
const gkOnly = records.filter((r) => r.restartType === "goalkick");
if (gkOnly.length) {
  console.log(`  其中门球样本的最近对手距离 中位         ${fmt(median(gkOnly.map((r) => r.nearestOpp)))} 格（门球时对手本该在禁区外）`);
  console.log(`  门球被误判为贴身压迫                    ${pct(gkOnly.filter((r) => r.nearestOpp < 4 || r.within9 >= 2).length, gkOnly.length)}`);
}

console.log("\n--- 5. 读法 ---");
console.log("· 短传比例偏低时，先看第 2 节：若「第 1 道未被调用」占比高，说明短传分支");
console.log("  根本没机会跑，问题在 `underHeavyPressure` / 反击习惯的短路，不在传球评估。");
console.log("· 落点若高度集中在「中路盒」，说明门将几乎不做横向选择，");
console.log("  对手只要站在中路就能稳定拿到二点球。");
console.log("· 门球样本被误判为贴身压迫 = 对手在禁区外高位逼抢被当成了「扑到门将脚下」。");
