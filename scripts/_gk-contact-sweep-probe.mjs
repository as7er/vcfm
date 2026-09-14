/**
 * 门将相对接触 —— **几何扫描**探针（只读）。
 *
 * 背景：`goalkeeper-relative-contact-audit.mjs` 证明引擎的扫描扑救把门将当成
 * 「整步都停在**步末**位置」（`js/sim/engine.js:5655-5661`：`offset` 与 `dPath`
 * 都用 `gk.x/gk.y`，即步末坐标），而球的接触点 `(cx,cy)` 可以落在步中。
 * 正确模型是**同一时刻**比较：取相对路径 `B(t) − G(t)` 在步内的最小距离。
 *
 * ⚠ 但那个审计的 32 个场景**只覆盖了一个方向**：
 *     `keeper.x = 50 + side*2/mx`、`vx = side*3/mx` —— 门将永远朝**远离球**的一侧移动。
 *   所以它证明「引擎与同一时刻模型不一致」，却**不能**回答
 *   「修了以后扑救变多还是变少」——而那正是主线关心的问题（进球偏低）。
 *
 * 本探针把几何**双向**扫开：横向偏移 offX ∈ [−4, 4] m（正 = 门将在球路的一侧）、
 * 门将横向速度 latMps ∈ [−4, 4] m/s（正 = 朝 +x）。对每个组合同时记录：
 *   · `dPath`    —— 引擎实际用的距离（门将步末位置）
 *   · `sameGap`  —— 同一时刻模型的最小距离（相对路径最近接近点）
 *   · `cover`    —— 引擎的覆盖度 `clamp(1 − dPath/reach, 0, 1)`
 * 并给出「按同一时刻模型重算后 cover 会变成多少」，从而得到**误差符号的几何地图**。
 *
 * 只读：不消费随机数、不改引擎状态（`_think` 被禁用，只有门将和射手脚还在场）。
 * 用法：node scripts/_gk-contact-sweep-probe.mjs
 */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
const key = Symbol.for("vcfm.gk-contact-sweep-probe");
let observe;
globalThis[key] = (engine, row) => observe?.(engine, row);
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== engineURL) return result;
    const source = String(result.source);
    const marker = "        if (dPath > reach) continue;";
    assert.equal(source.split(marker).length, 2);
    return {
      ...result,
      source: source.replace(
        marker,
        `        globalThis[Symbol.for("vcfm.gk-contact-sweep-probe")](this, { gk, tt, cx, cy, dPath, lateral, dt, reach, cover: clamp(1 - dPath / reach, 0, 1) });\n` + marker
      ),
    };
  },
});

const { SimEngine, SIM } = await import("../js/sim/engine.js");
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W; // 0.68
const my = SIM.PITCH_H_METRES / SIM.FIELD_H; // 1.05

const KEYS = ["pace", "acceleration", "agility", "passing", "vision", "shooting", "finishing",
  "dribbling", "tackling", "marking", "strength", "stamina", "positioning", "decisions",
  "reflexes", "handling", "kicking"];
function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({
      id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(KEYS.map((name) => [name, 15])),
    }));
  return { id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}

const DT = Number(process.argv[2] || 0.1);
const BALL_SPEED_MPS = 35;
const rows = [];

for (const offX of [-4, -3, -2, -1, 0, 1, 2, 3, 4]) {
  for (const latMps of [-4, -3, -2, -1, 0, 1, 2, 3, 4]) {
    const e = new SimEngine(club("home"), club("away"), { random: () => 0.999, timeStep: DT });
    const team = "home", other = "away", dir = e.attackDir(team);
    const keeper = e.agentById(`${other}-0`), shooter = e.agentById(`${team}-8`);
    for (const a of e.agents) a.sentOff = a !== keeper && a !== shooter;
    e.t = 100; e.deadBallUntil = 0; e._fatigueCheckT = Infinity;

    const vx = latMps / mx;
    Object.assign(keeper, {
      x: 50 + offX / mx, y: e.targetGoalY(team) - dir * 5 / my,
      vx, vy: 0, heading: Math.atan2(0, vx || 1e-9),
    });
    keeper.tx = keeper.x + vx * 3; keeper.ty = keeper.y;
    Object.assign(shooter, { x: 50, y: e.targetGoalY(team) - dir * 20 / my });
    shooter.tx = shooter.x; shooter.ty = shooter.y;
    Object.assign(e.ball, {
      state: "shot", owner: null, x: 50, y: e.targetGoalY(team) - dir * 8 / my,
      z: 1, vz: 0, vx: 0, vy: dir * BALL_SPEED_MPS / my,
      shotAt: 99.8, shotFlightTime: 0.6, shotDistance: 20,
      kickTeam: team, lastKicker: shooter.id, _saveChecked: false,
      _openGoalShot: false, settleUntil: 0, restartType: null,
    });
    e._think = () => {};

    const integrate = e._integrate;
    let motionStart;
    e._integrate = function (a, stepDt) {
      if (a === keeper && motionStart?.at !== this.t) motionStart = { at: this.t, x: a.x, y: a.y };
      return integrate.call(this, a, stepDt);
    };

    let captured = null;
    observe = (engine, actual) => {
      assert.equal(engine, e);
      assert.equal(actual.gk, keeper);
      const b = e.ball;
      // 相对路径：起点 = 球步初 − 门将步初；终点 = 球步末 − 门将步末
      const sx = (b._prevX - motionStart.x) * mx, sy = (b._prevY - motionStart.y) * my;
      const ex = (b.x - keeper.x) * mx, ey = (b.y - keeper.y) * my;
      const dx = ex - sx, dy = ey - sy;
      const alpha = Math.max(0, Math.min(1, -(sx * dx + sy * dy) / (dx * dx + dy * dy || 1e-9)));
      const sameGap = Math.hypot(sx + dx * alpha, sy + dy * alpha);
      captured = {
        offX, latMps,
        keeperTravel: Math.hypot((keeper.x - motionStart.x) * mx, (keeper.y - motionStart.y) * my),
        dPath: actual.dPath, sameGap, alpha, engineAlpha: actual.tt,
        reach: actual.reach, coverEngine: actual.cover,
        coverSame: Math.max(0, Math.min(1, 1 - sameGap / actual.reach)),
        lateral: actual.lateral,
      };
    };
    e.step(DT);
    if (captured) rows.push(captured);
  }
}
delete globalThis[key];

const fmt = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "-");
const err = (r) => r.dPath - r.sameGap; // 正 = 引擎认为球更远（偏保守，少扑）

console.log(`\n=== 门将相对接触几何扫描（${rows.length} 个组合，dt=${DT}，球 ${BALL_SPEED_MPS} m/s 沿球门方向）===`);
console.log("正 offX = 门将站在球路 +x 一侧；正 latMps = 门将朝 +x 移动（offX>0 时即**远离球**）。\n");

console.log("--- 1. 误差符号地图：dPath − sameGap（单位 m；正 = 引擎偏保守 → 少扑）---");
console.log("   offX\\latMps " + [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((v) => String(v).padStart(7)).join(""));
for (const offX of [-4, -3, -2, -1, 0, 1, 2, 3, 4]) {
  const cells = [];
  for (const latMps of [-4, -3, -2, -1, 0, 1, 2, 3, 4]) {
    const r = rows.find((x) => x.offX === offX && x.latMps === latMps);
    cells.push((r ? fmt(err(r), 4) : "-").padStart(7));
  }
  console.log(`   ${String(offX).padStart(9)} ` + cells.join(""));
}

console.log("\n--- 2. 「朝球移动」与「远离球」两类各自的误差 ---");
const toward = rows.filter((r) => r.offX !== 0 && Math.sign(r.latMps) === -Math.sign(r.offX) && r.latMps !== 0);
const away = rows.filter((r) => r.offX !== 0 && Math.sign(r.latMps) === Math.sign(r.offX) && r.latMps !== 0);
const stationary = rows.filter((r) => r.latMps === 0);
const radialOnly = rows.filter((r) => r.offX === 0 && r.latMps !== 0);
const summarize = (label, set) => {
  if (!set.length) return;
  const es = set.map(err).sort((a, b) => a - b);
  const coverDelta = set.map((r) => r.coverSame - r.coverEngine).sort((a, b) => a - b);
  console.log(
    `  ${label.padEnd(16)} n=${String(set.length).padStart(2)}  误差 中位 ${fmt(es[Math.floor(es.length / 2)], 4)} ` +
    `[${fmt(es[0], 4)}, ${fmt(es[es.length - 1], 4)}]   cover 变化 中位 ${fmt(coverDelta[Math.floor(coverDelta.length / 2)], 4)} ` +
    `[${fmt(coverDelta[0], 4)}, ${fmt(coverDelta[coverDelta.length - 1], 4)}]`
  );
};
summarize("门将静止", stationary);
summarize("横向朝球移动", toward);
summarize("横向远离球", away);
summarize("纯径向（offX=0）", radialOnly);

console.log("\n--- 3. 会翻转 `dPath > reach` 判定的组合（决定「扑/不扑」）---");
const flips = rows.filter((r) => (r.dPath > r.reach) !== (r.sameGap > r.reach));
console.log(`  共 ${flips.length} / ${rows.length} 个组合翻转`);
for (const r of flips) {
  console.log(`    offX ${String(r.offX).padStart(3)} latMps ${String(r.latMps).padStart(3)}  dPath ${fmt(r.dPath)} vs reach ${fmt(r.reach)}  |  sameGap ${fmt(r.sameGap)}  → 引擎「${r.dPath > r.reach ? "不扑" : "扑"}」，正确应为「${r.sameGap > r.reach ? "不扑" : "扑"}」`);
}

console.log("\n--- 4. cover（覆盖度）变化最大的 8 个组合 ---");
const byCover = [...rows].sort((a, b) => Math.abs(b.coverSame - b.coverEngine) - Math.abs(a.coverSame - a.coverEngine));
console.log("   offX latMps  dPath  sameGap  reach   cover引擎  cover同一时刻  Δ");
for (const r of byCover.slice(0, 8)) {
  console.log(`   ${String(r.offX).padStart(4)} ${String(r.latMps).padStart(5)} ${fmt(r.dPath)} ${fmt(r.sameGap).padStart(8)} ${fmt(r.reach)} ${fmt(r.coverEngine, 4).padStart(10)} ${fmt(r.coverSame, 4).padStart(13)} ${fmt(r.coverSame - r.coverEngine, 4).padStart(8)}`);
}

console.log("\n--- 5. 对扑救概率的影响（`pSave` 的 cover 项是 `0.28 * cover`，末尾再乘 `0.94`）---");
const dp = rows.map((r) => 0.28 * (r.coverSame - r.coverEngine) * 0.94);
const dps = [...dp].sort((a, b) => a - b);
console.log(`  ΔpSave 中位 ${fmt(dps[Math.floor(dps.length / 2)], 5)}  范围 [${fmt(dps[0], 5)}, ${fmt(dps[dps.length - 1], 5)}]（绝对值最大 ${fmt(Math.max(...dps.map(Math.abs)), 5)}）`);
console.log(`  即约 ±${fmt(100 * Math.max(...dps.map(Math.abs)), 2)} 个百分点；对照：进球 gate 的下限到基线余量约 0.38 球/场`);
console.log("  ⚠ 这是**单脚射门**的概率偏移，不是每场进球偏移；只有门将在步内横向移动且球在可扑范围内时才发生。");

console.log("\n--- 读法 ---");
console.log("· 若「横向朝球移动」的误差为**负**（引擎认为球更近 → 多扑），");
console.log("  而「横向远离球」为正，说明修复会**双向**改变扑救率，不能只按一个方向推断。");
console.log("· 第 3 节的翻转组合才是真正改变「扑/不扑」判定的场景；若为空，");
console.log("  说明该缺陷只影响扑救**质量**（cover），不影响是否进入判定。");
console.log("· 第 5 节给出量级：若 ΔpSave 远小于进球 gate 的余量，则这个缺陷");
console.log("  **不可能**是进球偏低的主因，不该为它单独烧一轮完整验收。");
