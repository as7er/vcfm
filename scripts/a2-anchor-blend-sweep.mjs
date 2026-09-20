/**
 * A2_ANCHOR_BLEND 扫描：在「削大跳」与「保 beat」之间找平衡点。
 *
 * 用法：
 *   node scripts/a2-anchor-blend-sweep.mjs [场数=16] [起始种子=383000] ["1.0,0.85,0.75,0.65"]
 *
 * 例：node scripts/a2-anchor-blend-sweep.mjs 40 372000 "1.0,0.75,0.65"
 *
 * ## 为什么要用这个脚本（而不是两个探针）
 *
 * A2 是**标准档行为改动**，改动点由常量 `SIM.A2_ANCHOR_BLEND` 控制
 * （1.0 = 原行为、0.65 = A2），所以可以在**同一份引擎代码**上跑多档
 * ⇒ 差异 100% 来自这一个旋钮，不掺「引擎文件版本不同」的干扰。
 * 比 `git stash` 前后跑更干净。
 *
 * ## ⚠ 口径（这是本脚本最要紧的一行）
 *
 * `SECONDS = 5400`（90 分钟）——**必须与 beat 护栏 band [2.68, 5.18] /
 * 基线 3.93 同口径**（那两处都在 `beat-guardrail-audit.mjs:134` 与
 * `_beat-noise-calibration-probe.mjs:149` 标定为 5400s）。
 *
 * 实测代价：同一份引擎、同一个 blend=1.0，2700s ⇒ 1.625~1.650 beat/场，
 * 5400s ⇒ 3.750 beat/场，差 2.3×。若拿 2700s 读数比 5400s 的 band，
 * 会得出「beat 崩到带外」的**假警报**（本项目真实踩过，见归档
 * `docs/measurements/probe-offball-a2-anchor-blend-2026-09-20.txt` [4]）。
 *
 * ⚠ 但**不是所有探针都要 5400s**：只做**同口径前后配对**的指标
 * （如 `_offball-a2-ab-probe.mjs` 的跳变侧、`_offball-a2-structure-probe.mjs`
 * 的结构侧进球/射门/越位）用 2700s 没问题 —— 时长只影响量级、不影响相对变化。
 * **判据：这个数要不要跟一个「别处标定好的 band」直接比？要 ⇒ 用那个 band 的时长。**
 *
 * ## 随机源
 *
 * 用 LCG（`value * 1664525 + 1013904223`）并覆写全局 `Math.random`
 * （`try/finally` 还原）——引擎内只有两处引用 `Math.random`
 * （`engine.js:454` 的 `weightedPick` 默认参数、`engine.js:530` 的
 * `this.random = opts.random ?? Math.random`），覆写即可全量控制随机源，
 * 保证同种子可复现。
 *
 * ## 结果解读
 *
 * 本脚本只给「读数表」，**不做判决**。判决要另行：
 *  · 跳变侧配对显著性 ⇒ `_offball-a2-ab-probe.mjs`
 *  · 结构侧配对显著性 ⇒ `_offball-a2-structure-probe.mjs`
 *  · beat 是否在带内     ⇒ `beat-guardrail-audit.mjs`
 */
import { SimEngine, SIM } from '../js/sim/engine.js';

const DT = SIM.DT;
const SECONDS = 5400;
const MATCHES = +(process.argv[2] || 16);
const SEED0 = +(process.argv[3] || 383000);
const BLENDS = (process.argv[4] || '1.0,0.85,0.75,0.65').split(',').map(Number);

function makeClub(name, ability) {
  const roles = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'ATT', 'ATT', 'ATT'];
  const players = roles.map((pos, index) => {
    const variance = ((index * 7 + ability) % 5) - 2;
    const rating = Math.max(1, Math.min(20, ability + variance));
    const id = name + '-p' + index;
    const attrs = {};
    for (const key of [
      'pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'finishing',
      'tackling', 'marking', 'strength', 'stamina', 'vision', 'reflexes', 'handling',
      'positioning', 'kicking', 'decisions', 'crossing',
    ]) attrs[key] = rating;
    return { id, name: id, pos, number: index + 1, fitness: 100, attrs };
  });
  return {
    id: name, name, players,
    tactics: {
      formation: '4-3-3', lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, style: 'balanced',
    },
  };
}

/**
 * ⚠ 随机源必须与 `beat-guardrail-audit.mjs` **逐字同款**（LCG，且覆写 Math.random），
 * 否则同 seed 产出不同比赛，读数无法与已标定的 beat band 对照。
 * （教训：mulberry32 与 LCG 是两个不同序列 ⇒ 同批种子曾得出相反结论。）
 */
function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

const MX = (SIM.PITCH_W_METRES ?? 68) / (SIM.FIELD_W ?? 100);
const MY = (SIM.PITCH_H_METRES ?? 105) / (SIM.FIELD_H ?? 100);
const metres = (dx, dy) => Math.hypot(dx * MX, dy * MY);

function run(seed, blend) {
  const prev = SIM.A2_ANCHOR_BLEND;
  SIM.A2_ANCHOR_BLEND = blend;
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const eng = new SimEngine(makeClub('h' + seed, 15), makeClub('a' + seed, 15), {
      timeStep: DT, separationPasses: 8, simulationProfile: 'standard',
      // 🔑 beat 原语默认关闭 ⇒ 不显式打开时 beat/场 恒为 0（与 beat-guardrail-audit 同）
      beatPrimitive: true,
    });
    let beats = 0, big15 = 0, goals = 0, shots = 0;
    const prevT = new Map();
    const steps = Math.round(SECONDS / DT);
    for (let s = 0; s < steps; s++) {
      eng.step(DT);
      const ev = eng.events || [];
      for (const e of ev) {
        if (e.type === 'beat') beats++;
        else if (e.type === 'goal') goals++;
        else if (e.type === 'shot') shots++;
      }
      if (ev.length) ev.length = 0;
      const b = eng.ball;
      for (const a of eng.agents) {
        if (a.sentOff || a.role === 'GK') continue;
        if (!b || b.owner === a.id) continue;
        const t = a.offBallTarget;
        if (!t) continue;
        const p = prevT.get(a.id);
        if (p && metres(b.x - p.bx, b.y - p.by) < 2) {
          if (metres(t.x - p.x, t.y - p.y) >= 15) big15++;
        }
        prevT.set(a.id, { x: t.x, y: t.y, bx: b.x, by: b.y });
      }
    }
    return { beats, big15, goals, shots };
  } finally {
    SIM.A2_ANCHOR_BLEND = prev;
    Math.random = originalRandom;
  }
}

const rows = BLENDS.map((bl) => ({ bl, data: [] }));
for (let i = 0; i < MATCHES; i++) {
  const seed = SEED0 + i;
  for (const r of rows) r.data.push(run(seed, r.bl));
  process.stderr.write('  ... ' + (i + 1) + '/' + MATCHES + '\n');
}

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
console.log('');
console.log('=== A2_ANCHOR_BLEND 扫描（' + MATCHES + ' 场/档，种子 ' + SEED0 + '..' + (SEED0 + MATCHES - 1) + '）===');
console.log('  blend   beat/场   大跳>=15m/场   进球/场   射门/场');
for (const r of rows) {
  console.log('  ' + String(r.bl).padEnd(7)
    + mean(r.data.map((d) => d.beats)).toFixed(3).padStart(8)
    + mean(r.data.map((d) => d.big15)).toFixed(1).padStart(13)
    + mean(r.data.map((d) => d.goals)).toFixed(3).padStart(10)
    + mean(r.data.map((d) => d.shots)).toFixed(2).padStart(10));
}
console.log('');
console.log('  参照：beat 护栏 band [2.68, 5.18]，基线 3.93');
