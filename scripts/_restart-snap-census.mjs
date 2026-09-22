/**
 * 「死球 / 中场摆位」瞬移普查 —— 确定性、单进程、不依赖浏览器（2026-09-22）。
 *
 * 为什么需要它（`scripts/_restart-placement-probe.mjs` 不够用）：
 *   浏览器探针一次只能采一场的一小段（220 秒 ≈ 一小半上半场），
 *   而「角球恰好落在高光段首」这类组合很稀疏 —— 交接里正是卡在这里，
 *   只能写「本轮没抓到，所以还没定论」。本探针把**整场**（H1+H2）的
 *   录制帧流在 Node 里重放一遍，做三件浏览器探针做不到的事：
 *
 *   ① **全集**：每一次「超出物理上限的位移帧对」都被列出并标注语义
 *      （`ball.restartType` / `motionContext.discontinuity`）。
 *      这两项是 `matchview.relocate()` 能不能武装的**全部**依据
 *      （`restartFrame` 的定义，`matchview.js:486`）。
 *   ② **区分可见与不可见**：落在 play 段内的位移帧观众看得见；
 *      落在段首剪辑（`sceneCut`）上的位移帧观众看不到（被淡场吃掉）。
 *      只有分开计数才能回答「用户到底能看到几次瞬移」。
 *      这是交接 §4 卡住的那一步：`_segment-boundary-displacement.mjs`
 *      量到了「切段 27~65 m」，但没说明这些跳变是不是**都被**遮住了。
 *   ③ **事件覆盖**：角球 / 界外球 / 进球各多少次，其中多少次落进高光窗。
 *      直接回答用户新提的「界外球是不是被平淡过渡掉了」。
 *
 * ⚠ 本探针**不**重放 `matchview` 的缓动。那是一段约 40 行的表现层代码，
 *   重放会有漂移风险（判据写歪就会得出错误结论 —— 本仓库栽过几次）。
 *   这里只回答「引擎帧流里有哪些位移帧、带不带语义标记」；
 *   「画面上到底缓动了没有」由浏览器探针回答。两者互补：
 *   本探针给**全集**，浏览器探针给**画质**。
 *
 * ⚠ 判据用**位移 > 物理上限 × dt**，不是固定米数。
 *   理由见 `_restart-placement-probe.mjs` 的两个坑：固定 6 m 会漏掉
 *   缓动摊开的小步；固定速度门槛会被小 dt 噪声污染。物理上限取
 *   `matchview.RELOCATE_PLAYER_MAX_SPEED_MPS = 10`，dt 取相邻录制帧间隔。
 *
 * 用法：node scripts/_restart-snap-census.mjs [场数=2]
 * 证据归档：docs/measurements/restart-snap-census-2026-09-22.txt
 */
import { CLUB_TEMPLATES } from "../js/data.js";
import { createMatchSession } from "../js/match.js";
import { createWorld } from "../js/models.js";
import {
  buildHighlightSegments,
  buildHighlightWindows,
  ensureSimEngine,
  resyncSimAfterHalfTime,
  runSimPeriodRaw,
} from "../js/sim/adapt.js";
import { ensureWorldStaff } from "../js/staff.js";

/** 1 格场地单位 = 0.68 m（横）/ 1.05 m（纵），与 matchview.js:111-112 同源 */
const MX = 0.68;
const MY = 1.05;
/** 物理上限（m/s）：matchview 的 `RELOCATE_PLAYER_MAX_SPEED_MPS` */
const PHYS_MPS = 10;
/** 一帧内允许的最大位移（米） */
const limitFor = (dt) => PHYS_MPS * dt;

const metres = (a, b) => Math.hypot((b.x - a.x) * MX, (b.y - a.y) * MY);

/** 帧对里位移最大的球员 → { id, m, over2 } */
function worstPair(fa, fb) {
  if (!fa?.players?.length || !fb?.players?.length) return { maxM: 0, over2: 0, top: [] };
  const byId = new Map(fb.players.map((p) => [p.id, p]));
  const rows = [];
  for (const a of fa.players) {
    const b = byId.get(a.id);
    if (!b) continue;
    rows.push({ id: a.id, m: metres(a, b) });
  }
  rows.sort((x, y) => y.m - x.m);
  return {
    maxM: rows.length ? rows[0].m : 0,
    over2: rows.filter((r) => r.m > 2).length,
    top: rows.slice(0, 3).map((r) => `${r.id}:${r.m.toFixed(1)}`),
  };
}

/**
 * ⚠ 复现性（AGENTS.md 的铁律：做任何测量实验前，先证明模拟可复现）。
 *
 * `createWorld(userClubId, managerName)` **不接种子** ⇒ 世界内容逐次不同。
 * 第一次跑出来的是两场 `fx_7286_svl85` / `fx_7295_lgaue`，第二次是
 * `fx_7286_r8sor` / `fx_7295_7wdgj` —— **不同的比赛**，读数完全不可比。
 * （本探针第一版就踩了这个坑，读数从此只当「这一版世界」看。）
 *
 * 这里把 `Math.random` 换成确定性 PRNG：世界生成、以及任何
 * 「没传 `opts.random` 就回退 `Math.random`」的地方都会变确定。
 * 另外 §自检 会把每场跑两遍比对指纹 —— 同进程内的强证据，
 * 不依赖「换一次进程再对一次」。
 */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = makeRng(0x5f3a71c9);

/** 指纹：同输入必须逐位相同 */
function fingerprint(r) {
  return [
    r.goals,
    r.acc.pairs,
    r.acc.snaps.length,
    r.acc.cuts.length,
    r.acc.playSegs,
    r.acc.snaps.map((s) => `${s.t.toFixed(1)}:${s.m.toFixed(1)}`).join(","),
  ].join("|");
}

/** 帧对是否带「重启/不连续」语义 —— 与 matchview 的 restartFrame/restartPair 逐字一致 */
const restartFlag = (f) => !!(f?.ball?.restartType || f?.motionContext?.discontinuity);

/** 跑一个半场并切出高光段 */
function playHalf(eng, fromMin, toMin) {
  const { scaled, flavor, tStart, tEnd, frames } = runSimPeriodRaw(eng, fromMin, toMin, {
    record: true,
    adaptive: true,
  });
  const rawInPeriod = (eng.events || []).filter((e) => e.t > tStart && e.t <= tEnd);
  const hl = buildHighlightWindows({
    rawEvents: rawInPeriod,
    scaledGoals: scaled.goals,
    tStart,
    tEnd,
  });
  // 与 match.js:1563-1572 一致：只留最终高光窗内的帧，再切段
  let recorded = frames || [];
  if (recorded.length && hl.windows?.length) {
    const wins = hl.windows;
    recorded = recorded.filter((f) => {
      const t = f.t ?? 0;
      return wins.some((w) => t >= w.t0 - 0.2 && t <= w.t1 + 0.2);
    });
  }
  const segments = buildHighlightSegments(recorded, hl.windows, tStart, tEnd);
  return { tStart, tEnd, events: rawInPeriod, windows: hl.windows, segments, recorded };
}

/** 半场里的位移帧普查 */
function censusHalf(half, acc) {
  const { segments, tStart, tEnd, events, windows } = half;
  const play = segments.filter((s) => s.kind === "play");
  const skip = segments.filter((s) => s.kind === "skip");

  acc.simSec += tEnd - tStart;
  acc.playSegs += play.length;
  acc.skipSegs += skip.length;
  acc.playSimSec += play.reduce((n, s) => n + (s.t1 - s.t0), 0);
  acc.windows.push(...windows);

  // —— 事件覆盖 ——
  for (const e of events) {
    const inWin = windows.some((w) => e.t >= w.t0 - 1e-9 && e.t <= w.t1 + 1e-9);
    const bucket = acc.events[e.type] || (acc.events[e.type] = { n: 0, inWin: 0, atSegStart: 0 });
    bucket.n += 1;
    if (inWin) bucket.inWin += 1;
    const seg = play.find((s) => e.t >= s.t0 - 1e-9 && e.t <= s.t1 + 1e-9);
    if (seg && seg.frames?.length && Math.abs((seg.frames[0].t ?? 0) - e.t) < 1e-6) {
      bucket.atSegStart += 1;
    }
  }

  // —— 段内位移帧 ——
  for (const seg of play) {
    const fr = seg.frames || [];
    for (let i = 0; i < fr.length - 1; i += 1) {
      const fa = fr[i];
      const fb = fr[i + 1];
      const dt = (fb.t ?? 0) - (fa.t ?? 0);
      if (!(dt > 0)) continue;
      const w = worstPair(fa, fb);
      const over = w.maxM > limitFor(dt) + 1e-8;
      acc.pairs += 1;
      if (!over) continue;
      const flagged = restartFlag(fb);
      acc.snaps.push({
        seg: seg.label || "play",
        segFirstPair: i === 0,
        t: fb.t,
        dt,
        m: w.maxM,
        mps: w.maxM / dt,
        over2: w.over2,
        restart: fb.ball?.restartType || null,
        disc: !!fb.motionContext?.discontinuity,
        flagged,
        top: w.top,
        visible: true,
      });
      if (!flagged) acc.unflaggedSnaps += 1;
    }
  }
  // 段首第一帧：观众看到的是「上一段最后一帧 → 本段第一帧」的跳变
  for (let k = 0; k < play.length; k += 1) {
    const first = play[k].frames?.[0];
    const prev = k > 0 ? play[k - 1].frames?.[play[k - 1].frames.length - 1] : acc.lastFrame;
    if (!first || !prev) continue;
    const w = worstPair(prev, first);
    acc.cuts.push({
      gapSec: (first.t ?? 0) - (prev.t ?? 0),
      m: w.maxM,
      over2: w.over2,
      label: play[k].label || "play",
      t: first.t,
    });
  }
  const last = play.length ? play[play.length - 1].frames : null;
  if (last?.length) acc.lastFrame = last[last.length - 1];
  acc.firstFrames.push(...play.map((s) => s.frames?.[0]).filter(Boolean));
}

function runMatch(source, fixture) {
  const world = structuredClone(source);
  const state = createMatchSession(world, world.fixtures.find((f) => f.id === fixture.id));
  const eng = ensureSimEngine(state);

  const acc = {
    simSec: 0, pairs: 0, playSegs: 0, skipSegs: 0, playSimSec: 0,
    windows: [], events: {}, snaps: [], cuts: [], unflaggedSnaps: 0,
    lastFrame: null, firstFrames: [],
  };
  const h1 = playHalf(eng, 1, 45);
  censusHalf(h1, acc);
  // 与 match.js:1510-1513 的 applyHalfTimeSwap(state, 46) 等价：
  // 换边 → 重同步阵型锚点 → 开球（**注意它在 runSimPeriodRaw 之前**）
  eng.endsSwapped = true;
  resyncSimAfterHalfTime(state);
  eng._kickoff("away");
  const h2 = playHalf(eng, 46, 90);
  // 中场边界：H1 最后一帧 → H2 第一帧（硬摆就发生在这一段空档里）
  const h2f0 = h2.segments.find((s) => s.kind === "play")?.frames?.[0];
  const h1last = acc.lastFrame;
  let halfTime = null;
  if (h1last && h2f0) {
    const w = worstPair(h1last, h2f0);
    halfTime = {
      gapSec: (h2f0.t ?? 0) - (h1last.t ?? 0),
      m: w.maxM, over2: w.over2, top: w.top,
      restart: h2f0.ball?.restartType || null,
      disc: !!h2f0.motionContext?.discontinuity,
    };
  }
  censusHalf(h2, acc);

  const goals = eng.events.filter((e) => e.type === "goal").length;
  const h1f0 = h1.segments.find((s) => s.kind === "play")?.frames?.[0] || null;
  return { acc, goals, seed: state.matchSeed, h1f0, halfTime };
}

// ————————————————————————————————————————————————

const n = Math.max(1, Number(process.argv[2]) || 2);
const startClub = CLUB_TEMPLATES.find((c) => c.division === 3);
const source = createWorld(startClub.id, "Restart Snap Census");
ensureWorldStaff(source);
const fixtures = source.fixtures
  .filter((f) => f.home === source.userClubId || f.away === source.userClubId)
  .slice(0, n);

console.log(`=== 摆位瞬移普查（确定性，整场）｜ ${fixtures.length} 场 ===\n`);

const totals = { snaps: 0, unflagged: 0, flagged: 0, cuts: 0, bigCuts: 0, playSimSec: 0, simSec: 0 };
const agg = {};
const allSnaps = [];
let reproOk = true;
const reproRows = [];

for (const fx of fixtures) {
  const first = runMatch(source, fx);
  // §自检：同输入跑两遍，指纹必须逐位相同 —— 否则本探针的读数一律不可信
  const fp1 = fingerprint(first);
  const fp2 = fingerprint(runMatch(source, fx));
  if (fp1 !== fp2) reproOk = false;
  reproRows.push(`  ${fx.id} ${fp1 === fp2 ? "✅ 可复现" : "❌ 分叉"}`);
  const { acc, goals, seed, halfTime } = first;

  const unflag = acc.snaps.filter((s) => !s.flagged);
  totals.snaps += acc.snaps.length;
  totals.unflagged += unflag.length;
  totals.flagged += acc.snaps.length - unflag.length;
  totals.cuts += acc.cuts.length;
  totals.bigCuts += acc.cuts.filter((c) => c.m > 2).length;
  totals.playSimSec += acc.playSimSec;
  totals.simSec += acc.simSec;
  allSnaps.push(...acc.snaps.map((s) => ({ ...s, fx: fx.id })));

  for (const [type, b] of Object.entries(acc.events)) {
    const a = agg[type] || (agg[type] = { n: 0, inWin: 0, atSegStart: 0 });
    a.n += b.n; a.inWin += b.inWin; a.atSegStart += b.atSegStart;
  }

  console.log(`—— ${fx.id}（seed=${seed}）——`);
  console.log(`  模拟 ${acc.simSec}s ｜ play 段 ${acc.playSegs} / skip 段 ${acc.skipSegs} ｜ ` +
    `细播 ${acc.playSimSec.toFixed(0)}s（占 ${((acc.playSimSec / acc.simSec) * 100).toFixed(1)}%）`);
  console.log(`  录制帧对 ${acc.pairs} ｜ 超物理上限的位移帧对（段内、可见）${acc.snaps.length} ` +
    `（其中【无 restart/discontinuity 标记】${unflag.length}）`);
  for (const s of acc.snaps.slice(0, 12)) {
    console.log(
      `    t=${s.t.toFixed(1)} ${s.seg}${s.segFirstPair ? "(首对)" : ""} dt=${s.dt.toFixed(2)} ` +
        `${s.m.toFixed(1)}m ${s.mps.toFixed(0)}m/s >2m的=${s.over2} ` +
        `restart=${s.restart} disc=${s.disc} ${s.flagged ? "" : "🔴无标记"}  top ${s.top.join(" ")}`
    );
  }
  if (acc.snaps.length > 12) console.log(`    …还有 ${acc.snaps.length - 12} 次`);
  const bigCuts = acc.cuts.filter((c) => c.m > 2);
  console.log(`  段首剪辑 ${acc.cuts.length} 次，其中位移 >2m 的 ${bigCuts.length} 次` +
    `（中位 ${bigCuts.length ? bigCuts.map((c) => c.m).sort((a, b) => a - b)[Math.floor(bigCuts.length / 2)].toFixed(1) : "n/a"}m）`);
  if (halfTime) {
    console.log(
      `  中场边界：H1 末帧 → H2 首帧 隔 ${halfTime.gapSec.toFixed(1)}s，` +
        `最大位移 ${halfTime.m.toFixed(1)}m >2m的=${halfTime.over2} ` +
        `restart=${halfTime.restart} disc=${halfTime.disc} top ${halfTime.top.join(" ")}`
    );
  }
  console.log("");
}

console.log("=== 事件覆盖（全场地合计）===");
for (const [type, a] of Object.entries(agg).sort((x, y) => y[1].n - x[1].n)) {
  console.log(
    `  ${type.padEnd(12)} 共 ${String(a.n).padStart(4)} 次 ｜ ` +
      `落进高光窗 ${String(a.inWin).padStart(4)} (${((a.inWin / a.n) * 100).toFixed(1)}%) ｜ ` +
      `落在段首帧 ${a.atSegStart}`
  );
}

console.log("\n=== 汇总 ===");
console.log(`  细播占比 ${((totals.playSimSec / totals.simSec) * 100).toFixed(1)}%`);
console.log(`  段内超物理位移帧对（可见）${totals.snaps} 次 ｜ 其中无标记 ${totals.unflagged} / 有标记 ${totals.flagged}`);
console.log(`  段首剪辑 ${totals.cuts} 次 ｜ 位移 >2m 的 ${totals.bigCuts} 次`);
console.log("");
console.log("=== 复现性自检（同输入跑两遍，指纹必须逐位相同）===");
if (!reproRows.length) reproRows.push("  (无场次)");
for (const row of reproRows) console.log(row);
console.log(reproOk ? "  ✅ 全部可复现 —— 本次读数可信" : "  ❌ 有分叉 —— 读数不可信，先修复现性");

// 用户新提的「没见过边线球」：把 0 也明确打出来（它在上面那张表里根本不出现）
const ti = agg.throwin || { n: 0, inWin: 0, atSegStart: 0 };
console.log("");
console.log("=== 用户问题②「界外球」===");
console.log(
  `  throwin 事件 ${ti.n} 次 ｜ 落进高光窗 ${ti.inWin} 次\n` +
    `  ⇒ ${ti.n === 0 ? "引擎整场没有产生过界外球（不是「被平淡过渡掉了」）" : "见上方覆盖率"}`
);
console.log(`  对照：角球 ${(agg.corner || {}).n || 0} 次 / 进球 ${(agg.goal || {}).n || 0} 次`);
