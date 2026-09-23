/**
 * 「开角球的攻方**总是**能获得射门机会」—— 带对照组的整场普查（2026-09-23，v289）。
 *
 * 用户原话：「观看比赛直播的时候我发现一个现象，开角球的攻方总是可以获得射门机会。」
 * 上一轮 agent（Codex）写了 `scripts/_corner-shot-probe.mjs` 做裸统计，
 * 但**没有对照组** ⇒ 无法判断那 38.9% 算高还是算正常。本探针把对照组补上，
 * 并直接量「观众为什么会觉得『总是』」那个机制。
 *
 * 量四件事：
 *   ① **角球后**：角球开出后 N 秒内，**开球方**自己射门的比例（N = 12 / 14）。
 *   ② **对照组**：同一场里随机抽同样多个同长度窗口，同一支球队射门的比例。
 *      ① ≫ ② 才说明「角球确实制造了额外射门」。
 *   ③ **观察者偏差的量化**：全场**全部**射门里，有多大比例正好落在角球的
 *      高光窗内（`buildHighlightWindows` 的角球窗是 `t0 = e.t, t1 = e.t + 12`）。
 *      直播只播高光段、其余 skip ⇒ 这个比例高，观众就会「总在角球后看见射门」，
 *      哪怕角球本身只解释了很小一部分射门。
 *   ④ **球权归属**：角球后 N 秒内球在**开球方**脚下的时间占比（对照全场均值）。
 *      角球后球权明显偏攻方才是「攻方被特殊照顾」的机制性证据。
 *
 * ⚠ 纪律（本仓库反复踩过的坑）：
 *   · 引擎**不认 `opts.seed`**，必须传 `opts.random`（确定性 PRNG）。
 *   · 走**产品路径**（`createMatchSession` + `ensureSimEngine`）；裸 `new SimEngine`
 *     实测能差一个量级（v287 的教训）。
 *   · 世界只 `createWorld` **一次**并冻结（它带不受 `Math.random` 替换影响的熵），
 *     逐场 `structuredClone`。
 *   · 同进程双跑指纹自检。
 *   · 事件收集的游标必须与「已收集条数」分开维护 —— 第一版把它们混用
 *     （`events.length + cursor < total`）导致**只收到约一半事件**，
 *     角球 4.7/场 被读成 1.8/场。故判据里带「角球/场」总数自检。
 *
 * 用法：node scripts/_corner-shot-census.mjs [场数=8]
 */
import { CLUB_TEMPLATES } from "../js/data.js";
import { createMatchSession } from "../js/match.js";
import { createWorld } from "../js/models.js";
import { ensureSimEngine, resyncSimAfterHalfTime } from "../js/sim/adapt.js";
import { ensureWorldStaff } from "../js/staff.js";

const MATCHES = Math.max(2, Number(process.argv[2]) || 8);
/** 角球后观察窗（秒）；两个都报，`12` 与高光窗一致 */
const WINDOWS = [12, 14];
/** 每个长度抽多少个对照窗口 */
const CONTROL_WINDOWS = 1200;
/** 高光窗里角球窗的长度（`js/sim/adapt.js` 的 `t1 = t0 + 12`） */
const HIGHLIGHT_CORNER_WINDOW = 12;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 跑满一场，返回事件流（t/type/team）与控球采样 */
function runMatch(baseWorld, fixtureId, seed) {
  const world = structuredClone(baseWorld);
  const fixture = world.fixtures.find((f) => f.id === fixtureId);
  const state = createMatchSession(world, fixture);
  const eng = ensureSimEngine(state);
  eng.random = mulberry32(seed);

  const events = [];
  const poss = [];
  const dt = 0.2;
  let cursor = 0;
  const collect = () => {
    while (cursor < eng.events.length) {
      const e = eng.events[cursor];
      events.push({ t: e.t, type: e.type, team: e.team || null });
      cursor += 1;
    }
  };
  const half = () => {
    const steps = Math.round((45 * 60) / dt);
    for (let i = 0; i < steps; i += 1) {
      eng.step(dt);
      collect();
      poss.push({ t: eng.t, side: eng.possession || null });
    }
  };
  half();
  eng.endsSwapped = true;
  resyncSimAfterHalfTime(state);
  eng._kickoff("away");
  half();
  collect();
  return { events, poss, totalEvents: eng.events.length };
}

/** 某队射门（含进球）事件 */
const shotsOf = (events, team) =>
  events.filter((e) => e.team === team && (e.type === "shot" || e.type === "goal"));

/** 以 starts 为窗口起点，返回「至少在窗口内射门一次」的窗口数 */
function windowsWithShot(shots, starts, windowSec) {
  let hit = 0;
  for (const t0 of starts) {
    if (shots.some((s) => s.t > t0 && s.t <= t0 + windowSec)) hit += 1;
  }
  return hit;
}

// ————————————————————————————————————————————————————————————
console.log(`=== 角球后射门率普查（${MATCHES} 场，窗口 ${WINDOWS.join("/")}s）===\n`);
const WORLD_SEED = 0x5f3a71c9;
const originalRandom = Math.random;

function snapshotWorld() {
  Math.random = mulberry32(WORLD_SEED);
  try {
    const startClub = CLUB_TEMPLATES.find((c) => c.division === 3);
    const world = createWorld(startClub.id, "Corner Shot Census");
    ensureWorldStaff(world);
    return world;
  } finally {
    Math.random = originalRandom;
  }
}
const BASE_WORLD = snapshotWorld();
const FIXTURES = BASE_WORLD.fixtures
  .filter((f) => f.home === BASE_WORLD.userClubId || f.away === BASE_WORLD.userClubId)
  .slice(0, MATCHES);

function measure() {
  return FIXTURES.map((fx, i) => {
    const seed = 0xb000 + i * 7919;
    const { events, poss, totalEvents } = runMatch(BASE_WORLD, fx.id, seed);
    const tEnd = 90 * 60;
    const corners = events.filter((e) => e.type === "corner");
    const allShots = events.filter((e) => e.type === "shot" || e.type === "goal");
    const allGoals = events.filter((e) => e.type === "goal");

    const perWindow = {};
    for (const w of WINDOWS) {
      let hit = 0;
      for (const c of corners) {
        if (windowsWithShot(shotsOf(events, c.team), [c.t], w) > 0) hit += 1;
      }
      perWindow[w] = { hit, rate: corners.length ? hit / corners.length : null };
    }

    // 对照组：随机窗口 + 随机队别
    const rng = mulberry32(seed ^ 0x5a5a);
    const control = {};
    for (const w of WINDOWS) {
      let hit = 0;
      let n = 0;
      for (let k = 0; k < CONTROL_WINDOWS; k += 1) {
        const t0 = rng() * (tEnd - w);
        const team = rng() < 0.5 ? "home" : "away";
        n += 1;
        if (windowsWithShot(shotsOf(events, team), [t0], w) > 0) hit += 1;
      }
      control[w] = { hit, n, rate: hit / n };
    }

    // ③ 全场射门/进球里，落在「角球高光窗」内的比例
    const inCornerWindow = (e) =>
      corners.some((c) => e.t > c.t && e.t <= c.t + HIGHLIGHT_CORNER_WINDOW);
    const shotsInWindows = allShots.filter(inCornerWindow).length;
    const goalsInWindows = allGoals.filter(inCornerWindow).length;
    // 角球窗占全场时长的比例（作为基准：若无偏好，射门落进去的比例应≈这个数）
    const windowSeconds = corners.reduce(
      (n, c) => n + Math.max(0, Math.min(tEnd, c.t + HIGHLIGHT_CORNER_WINDOW) - c.t),
      0
    );

    // ④ 角球后开球方控球占比
    let own = 0;
    let pn = 0;
    for (const c of corners) {
      for (const p of poss) {
        if (p.t <= c.t || p.t > c.t + WINDOWS[0]) continue;
        pn += 1;
        if (p.side === c.team) own += 1;
      }
    }
    const homeTicks = poss.filter((p) => p.side === "home").length;

    return {
      fixtureId: fx.id,
      corners: corners.length,
      totalEvents,
      perWindow,
      control,
      allShots: allShots.length,
      shotsInWindows,
      allGoals: allGoals.length,
      goalsInWindows,
      windowShare: windowSeconds / tEnd,
      shareAfterCorner: pn ? own / pn : null,
      homeShare: poss.length ? homeTicks / poss.length : null,
      fingerprint: `${corners.length}:${allShots.length}:${totalEvents}:${perWindow[WINDOWS[0]].hit}`,
    };
  });
}

const pass1 = measure();
const pass2 = measure();
const fp = (r) => r.map((x) => `${x.fixtureId}:${x.fingerprint}`).join("|");
console.log(`复现自检：${fp(pass1) === fp(pass2) ? "✅ 双跑逐位相同" : "❌ 有分叉，读数不可信"}`);
console.log(`  ${fp(pass1)}\n`);

const sum = (key) => pass1.reduce((n, r) => n + r[key], 0);
console.log("场次            角球  射门  角球后命中(12s)  命中率    对照率    倍数");
for (const r of pass1) {
  const w = WINDOWS[0];
  const b = r.control[w].rate;
  console.log(
    `  ${r.fixtureId}  ${String(r.corners).padStart(4)}  ${String(r.allShots).padStart(4)}` +
      `  ${String(r.perWindow[w].hit).padStart(14)}` +
      `  ${(r.perWindow[w].rate * 100).toFixed(1).padStart(6)}%` +
      `  ${(b * 100).toFixed(1).padStart(6)}%` +
      `  ${b > 0 ? (r.perWindow[w].rate / b).toFixed(2).padStart(6) : "    n/a"}×`
  );
}

console.log("");
for (const w of WINDOWS) {
  const cHit = pass1.reduce((n, r) => n + r.perWindow[w].hit, 0);
  const cN = sum("corners");
  const kHit = pass1.reduce((n, r) => n + r.control[w].hit, 0);
  const kN = pass1.reduce((n, r) => n + r.control[w].n, 0);
  const cr = cHit / cN;
  const br = kHit / kN;
  console.log(
    `窗口 ${String(w).padStart(2)}s：角球后射门率 ${(cr * 100).toFixed(1)}%（${cHit}/${cN}）｜` +
      `普通窗口 ${(br * 100).toFixed(2)}%（${kHit}/${kN}）｜**${(cr / br).toFixed(2)}×**`
  );
}
console.log(
  `\n角球/场 = ${(sum("corners") / pass1.length).toFixed(2)}（自检：应在 3~6 之间；` +
    `本探针第一版因游标 bug 只收到约一半事件，得 1.8 ⇒ 若读数明显偏低先查这里。）`
);
console.log(`射门/场 = ${(sum("allShots") / pass1.length).toFixed(2)}｜进球/场 = ${(sum("allGoals") / pass1.length).toFixed(2)}`);

const shots = sum("allShots");
const shotsIn = sum("shotsInWindows");
const goals = sum("allGoals");
const goalsIn = sum("goalsInWindows");
const winShare = pass1.reduce((n, r) => n + r.windowShare, 0) / pass1.length;
console.log(`\n③ 观察者偏差：全场射门里落在角球高光窗内的 ${shotsIn}/${shots} = ${((shotsIn / shots) * 100).toFixed(1)}%`);
console.log(`   进球里落在角球窗内的 ${goalsIn}/${goals} = ${((goalsIn / goals) * 100).toFixed(1)}%`);
console.log(`   角球窗占全场时长 ${(winShare * 100).toFixed(1)}% ⇒ 若无偏好，射门落进去应≈这个数`);
console.log(
  `   ⇒ 富集倍数 ${((shotsIn / shots) / winShare).toFixed(2)}×（1.0 = 无偏好；>1 = 角球后确实更容易射门）`
);

const shareAfter = pass1.reduce((n, r) => n + (r.shareAfterCorner || 0), 0) / pass1.length;
const homeShare = pass1.reduce((n, r) => n + (r.homeShare || 0), 0) / pass1.length;
console.log(`\n④ 角球后开球方控球占比 ${(shareAfter * 100).toFixed(1)}%（基准见下行）`);
console.log(`   全场主队控球占比 ${(homeShare * 100).toFixed(1)}%（≈50% = 均势；角球后若明显高于 50% 才算偏攻方）`);
