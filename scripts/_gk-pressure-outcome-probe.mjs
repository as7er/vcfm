/**
 * 门将**被逼抢时**的出球，到底发生了什么？（2026-09-23）
 *
 * 用户观察：「每次守门员被对方前锋逼抢的时候，他的传球都被拦截下来了。」
 *
 * 读代码的两条已知事实（本探针把它们变成数据）：
 *   ① `_gkDistribute`（`js/sim/engine.js:2485`）里
 *      `underHeavyPressure = nearestOpp < 4 || pressureNear >= 2`，
 *      而 `passTo = underHeavyPressure || bypassBuildUp ? null : _bestPass(a)`
 *      ⇒ **受压时门将必然走大脚**（短传分支被短路）。这本身是合理的取舍。
 *   ② 大脚落点横向被夹在 `x∈[30,70]`（`clamp(m.x + inward*6, 30, 70)`）= **中场中路**；
 *      而接应人必须「已过中线（纵深 ≥ 45）且比门将靠前 ≥ 14 格」
 *      ⇒ 球队退守时**常常没有接应人**（`receiver = null`）⇒ 球落地后本方无人去争。
 *
 * 量四件事，全部按「是否受压」分组：
 *   ① 受压/宽松各自走大脚（>25 m）的比例；
 *   ② 落点离**最近对手** vs **最近队友**哪个更近（系统性更近对手 = 往对手堆里踢）；
 *   ③ 出球后**第一个控住球的是哪一队**（用户「被拦截」的直接对应量）；
 *   ④ 出球后 8 s 内有没有**对手的 intercept / tackle 事件**。
 *
 * ⚠ 字段名必须照 `_emit` 的**实际**内容（第一版猜错过，害得落点全空）：
 *   `_emit("pass", a, { loft, cross, corner, through, toId, toX, toY })`
 *   ⇒ 落点是 `toX`/`toY`，接应人是 `toId`，**不是** `x`/`y`/`receiverId`。
 *
 * ⚠ 纪律：引擎不认 `opts.seed`，必须传 `opts.random`；走产品路径
 *   （`createMatchSession` + `ensureSimEngine`）；世界只建一次并冻结；双跑指纹自检。
 *
 * 用法：node scripts/_gk-pressure-outcome-probe.mjs [场数=8]
 */
import { CLUB_TEMPLATES } from "../js/data.js";
import { createMatchSession } from "../js/match.js";
import { createWorld } from "../js/models.js";
import { ensureSimEngine, resyncSimAfterHalfTime } from "../js/sim/adapt.js";
import { ensureWorldStaff } from "../js/staff.js";

const MATCHES = Math.max(2, Number(process.argv[2]) || 8);
const WATCH_SECONDS = 8;

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

const MX = 0.68;
const MY = 1.05;
const metres = (ax, ay, bx, by) => Math.hypot((bx - ax) * MX, (by - ay) * MY);

/** 包装 `_gkDistribute`：只读记录每次出球（不消费随机数 ⇒ 不改轨迹） */
function instrument(engine, rows) {
  const orig = engine._gkDistribute.bind(engine);
  engine._gkDistribute = function traced(a) {
    let nearestOpp = 99;
    let pressureNear = 0;
    for (const o of engine.agents) {
      if (o.team === a.team || o.role === "GK" || o.sentOff) continue;
      const d = metres(a.x, a.y, o.x, o.y);
      if (d < nearestOpp) nearestOpp = d;
      if (d < 9) pressureNear += 1;
    }
    const eventsBefore = engine.events.length;
    const gkPos = { x: a.x, y: a.y };
    const ret = orig(a);
    const passEv = engine.events.slice(eventsBefore).find((e) => e.type === "pass") || null;
    // ⚠ 大脚分支**不调 `_pass`**（它直接写 `b.vx/b.vy` + `b.targetX/targetY`），
    //   所以「受压时没有 `pass` 事件」本身就是「受压时 100% 走大脚」的证据。
    //   落点必须从 `ball.targetX/targetY` 读，接应人从 `ball.receiverId` 读。
    const longBall = passEv == null;
    const tx = passEv ? (passEv.toX ?? null) : (engine.ball.targetX ?? null);
    const ty = passEv ? (passEv.toY ?? null) : (engine.ball.targetY ?? null);
    const row = {
      t: engine.t,
      team: a.team,
      pressed: nearestOpp < 4 || pressureNear >= 2,
      nearestOpp,
      pressureNear,
      longBall,
      tx,
      ty,
      toId: passEv ? (passEv.toId ?? null) : (engine.ball.receiverId ?? null),
      loft: !!passEv?.loft,
      kickMetres: null,
      nearestOppToLanding: null,
      nearestMateToLanding: null,
      firstControlTeam: null,
      firstControlAt: null,
      oppIntercept: false,
      oppTackle: false,
      resolved: false,
    };
    if (row.tx != null) {
      row.kickMetres = metres(gkPos.x, gkPos.y, row.tx, row.ty);
      for (const o of engine.agents) {
        if (o.sentOff || o.id === a.id) continue;
        const d = metres(o.x, o.y, row.tx, row.ty);
        if (o.team === a.team) {
          if (row.nearestMateToLanding == null || d < row.nearestMateToLanding) row.nearestMateToLanding = d;
        } else if (row.nearestOppToLanding == null || d < row.nearestOppToLanding) {
          row.nearestOppToLanding = d;
        }
      }
    }
    rows.push(row);
    return ret;
  };
}

/** 跑满一场，返回分派记录（含每脚的后果） */
function runMatch(baseWorld, fixtureId, seed) {
  const world = structuredClone(baseWorld);
  const fixture = world.fixtures.find((f) => f.id === fixtureId);
  const state = createMatchSession(world, fixture);
  const eng = ensureSimEngine(state);
  eng.random = mulberry32(seed);

  const rows = [];
  instrument(eng, rows);
  const dt = 0.1;
  const stepsPerHalf = Math.round((45 * 60) / dt);
  let eventCursor = 0;

  const advance = (steps) => {
    for (let i = 0; i < steps; i += 1) {
      eng.step(dt);
      // 后果一：第一个控住球的队（出球 0.15s 之后才算，避免把门将自己算进去）
      const owner = eng.ball.owner ? eng.agentById(eng.ball.owner) : null;
      if (owner) {
        for (const r of rows) {
          if (r.resolved || r.tx == null) continue;
          const dtAfter = eng.t - r.t;
          if (dtAfter <= 0.15) continue;
          if (dtAfter > WATCH_SECONDS) continue;
          r.resolved = true;
          r.firstControlTeam = owner.team;
          r.firstControlAt = dtAfter;
        }
      }
      // 后果二：对手的 intercept / tackle
      while (eventCursor < eng.events.length) {
        const e = eng.events[eventCursor];
        // 该事件是否属于「某次门将出球之后 8s 内、且是对手做的」
        eventCursor += 1;
        if (e.type !== "intercept" && e.type !== "tackle") continue;
        for (const r of rows) {
          if (r.tx == null) continue;
          if (e.t <= r.t || e.t - r.t > WATCH_SECONDS) continue;
          if (e.team && e.team !== r.team) {
            if (e.type === "intercept") r.oppIntercept = true;
            else r.oppTackle = true;
          }
        }
      }
    }
  };

  advance(stepsPerHalf);
  eng.endsSwapped = true;
  resyncSimAfterHalfTime(state);
  eng._kickoff("away");
  advance(stepsPerHalf);
  return rows;
}

// ————————————————————————————————————————————————————————————
console.log(`=== 门将受压时出球后果普查（${MATCHES} 场，观察窗 ${WATCH_SECONDS}s）===\n`);
const WORLD_SEED = 0x5f3a71c9;
const originalRandom = Math.random;

function snapshotWorld() {
  Math.random = mulberry32(WORLD_SEED);
  try {
    const startClub = CLUB_TEMPLATES.find((c) => c.division === 3);
    const world = createWorld(startClub.id, "GK Pressure Outcome");
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

const measure = () =>
  FIXTURES.map((fx, i) => ({ fixtureId: fx.id, rows: runMatch(BASE_WORLD, fx.id, 0xc000 + i * 7919) }));

const pass1 = measure();
const pass2 = measure();
const fp = (r) => r.map((x) => `${x.fixtureId}:${x.rows.length}:${x.rows.filter((y) => y.tx != null).length}`).join("|");
console.log(`复现自检：${fp(pass1) === fp(pass2) ? "✅ 双跑一致" : "❌ 有分叉"}\n  ${fp(pass1)}\n`);

const all = pass1.flatMap((r) => r.rows);
const pressed = all.filter((r) => r.pressed);
const calm = all.filter((r) => !r.pressed);
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "n/a");
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

console.log(`门将出球总数 ${all.length}（${(all.length / pass1.length).toFixed(1)} 次/场）`);
console.log(`  受压（最近对手 <4 m 或 9 m 内 ≥2 人）${pressed.length}｜宽松 ${calm.length}\n`);

for (const [label, group] of [["受压", pressed], ["宽松", calm]]) {
  if (!group.length) {
    console.log(`【${label}】无样本\n`);
    continue;
  }
  const withKick = group.filter((r) => r.tx != null);
  const longBalls = group.filter((r) => r.longBall);
  const lofted = withKick.filter((r) => r.loft);
  const resolved = group.filter((r) => r.resolved);
  const oppControl = resolved.filter((r) => r.firstControlTeam !== r.team);
  const mateControl = resolved.filter((r) => r.firstControlTeam === r.team);
  const closerOpp = withKick.filter(
    (r) =>
      r.nearestOppToLanding != null &&
      r.nearestMateToLanding != null &&
      r.nearestOppToLanding < r.nearestMateToLanding
  );
  const oppInter = group.filter((r) => r.oppIntercept);
  const oppTack = group.filter((r) => r.oppTackle);
  console.log(`【${label}】${group.length} 次`);
  console.log(
    `  · 有落点 ${withKick.length}｜>25 m 的大脚 ${longBalls.length}（${pct(longBalls.length, withKick.length)}）` +
      `｜高球(loft) ${lofted.length}（${pct(lofted.length, withKick.length)}）`
  );
  console.log(`  · 指定了接应人（toId 非空）${withKick.filter((r) => r.toId).length}（${pct(withKick.filter((r) => r.toId).length, withKick.length)}）`);
  console.log(`  · 落点离**对手**比离队友更近 ${closerOpp.length}（${pct(closerOpp.length, withKick.length)}）`);
  console.log(
    `  · 出球后 ${WATCH_SECONDS}s 内第一个控住球的：**对手 ${oppControl.length}**（${pct(oppControl.length, resolved.length)}）` +
      `｜本方 ${mateControl.length}（${pct(mateControl.length, resolved.length)}）｜未结算 ${group.length - resolved.length}`
  );
  console.log(
    `  · 出球后 ${WATCH_SECONDS}s 内对手 intercept ${oppInter.length}（${pct(oppInter.length, group.length)}）` +
      `｜对手 tackle ${oppTack.length}（${pct(oppTack.length, group.length)}）`
  );
  const dOpp = withKick.map((r) => r.nearestOppToLanding).filter((v) => v != null);
  const dMate = withKick.map((r) => r.nearestMateToLanding).filter((v) => v != null);
  const km = withKick.map((r) => r.kickMetres).filter((v) => v != null);
  console.log(
    `  · 落点到最近对手/队友距离中位：${median(dOpp)?.toFixed(1) ?? "n/a"} m / ${median(dMate)?.toFixed(1) ?? "n/a"} m` +
      `｜踢球距离中位 ${median(km)?.toFixed(1) ?? "n/a"} m`
  );
  console.log("");
}

console.log("=== 判定 ===");
const pKick = pressed;
const pLong = pKick.filter((r) => r.longBall);
const pRes = pressed.filter((r) => r.resolved);
const pOpp = pRes.filter((r) => r.firstControlTeam !== r.team);
const cKick = calm;
const cLong = cKick.filter((r) => r.longBall);
const cRes = calm.filter((r) => r.resolved);
const cOpp = cRes.filter((r) => r.firstControlTeam !== r.team);
console.log(`受压走大脚 ${pct(pLong.length, pKick.length)}（${pLong.length}/${pKick.length}）｜宽松 ${pct(cLong.length, cKick.length)}（${cLong.length}/${cKick.length}）`);
console.log(`受压出球后第一控球方=对手 ${pct(pOpp.length, pRes.length)}｜宽松 ${pct(cOpp.length, cRes.length)}（对照）`);
