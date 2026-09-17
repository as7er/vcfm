/**
 * 测量（动手前的影响面）：把「本方禁区内不惩罚长传」作为候选改动，
 * 会波及多少传球？——留档四的教训是「先量受影响比例，再谈改值」。
 *
 * 候选式（只在**起脚点在本方禁区内**时放宽距离惩罚）：
 *   distPen = inOwnBox ? clamp(1 - d / BOX_REACH, 0.2, 1) : clamp(1 - d / 55, 0.2, 1)
 * 并通过候选截断上界一并放宽（否则放宽 distPen 也没有长选项可选）。
 *
 * 数据来源用引擎的 `pass` 事件（带 `toId`/`toX`/`toY`），比逐帧猜状态可靠：
 * 逐帧判 `state === "pass"` 会漏掉起脚那一帧（状态在 step 内部已推进）。
 *
 * 本脚本只读不写引擎：复算「真实发生过的传球」的起脚点与传球距离，
 * 数一数候选截断放宽后有多少传球会**新解锁**，以及非本方禁区是否被波及（应为 0）。
 *
 * 口径同 `_box-entry-rate-probe.mjs`：种子 372000、能力 15、标准档。
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function makeClub(name, ability) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, index) => {
    const variance = ((index * 7 + ability) % 5) - 2;
    const rating = Math.max(1, Math.min(20, ability + variance));
    const id = `${name}-p${index}`;
    const attrs = {};
    for (const key of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
      "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling",
      "positioning", "kicking", "decisions", "crossing",
    ]) {
      attrs[key] = rating;
    }
    return { id, name: id, pos, number: index + 1, fitness: 100, attrs };
  });
  return {
    id: name,
    name,
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((player) => player.id),
      pressing: 3,
      tempo: 3,
      defensiveLine: 3,
      style: "balanced",
    },
  };
}

const matchCount = Math.max(1, Number(process.argv[2]) || 6);
const seeds = Array.from({ length: matchCount }, (_, i) => 372000 + i);
const timeStep = SIM.DT;

const BOX_REACH = Number(process.argv[3]) || 90; // 本方禁区内长传的等效「55」
const BOX_CAP = Number(process.argv[4]) || 70;   // 本方禁区内候选截断上界

let passEvents = 0;
let inOwnBox = 0;
let elsewhere = 0;
let newUnlocked = 0;
const distIn = [];
const distOut = [];
const distInFar = [];

for (const seed of seeds) {
  const original = Math.random;
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(
      makeClub(`home-${seed}`, 15),
      makeClub(`away-${seed}`, 15),
      { simulationProfile: "standard", timeStep, separationPasses: 8 }
    );
    const steps = Math.round((90 * 60) / timeStep);
    let drained = 0;

    for (let step = 0; step < steps; step++) {
      engine.step(timeStep);
      const evs = engine.events;
      for (; drained < evs.length; drained++) {
        const ev = evs[drained];
        if (ev.type !== "pass") continue;
        passEvents++;
        const from = ev.from || ev.agent;
        const fromX = ev.x ?? from?.x;
        const fromY = ev.y ?? from?.y;
        const toX = ev.toX;
        const toY = ev.toY;
        if (!Number.isFinite(fromX) || !Number.isFinite(toX)) continue;
        const team = ev.team || from?.team;
        if (!team) continue;

        const d = Math.hypot(fromX - toX, fromY - toY);
        const inBox = engine._inOwnFoulBox(team, fromX, fromY);
        if (inBox) {
          inOwnBox++;
          distIn.push(d);
          if (d > 45) distInFar.push(d);
          const oldKeep = d >= 6 && d <= 45;
          const newKeep = d >= 6 && d <= BOX_CAP;
          if (!oldKeep && newKeep) newUnlocked++;
        } else {
          elsewhere++;
          distOut.push(d);
        }
      }
    }
  } finally {
    Math.random = original;
  }
}

const median = (values) => {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return Number((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2));
};
const pct = (num, den) => Number(((num / Math.max(1, den)) * 100).toFixed(1));
const per = (v) => Number((v / seeds.length).toFixed(2));

console.log(`\n=== 候选「本方禁区内放宽距离惩罚」的影响面（${seeds.length} 场）===`);
console.log(`候选参数：BOX_REACH=${BOX_REACH}（原 55）、BOX_CAP=${BOX_CAP}（原 45）`);
console.log(`引擎 pass 事件总数：${passEvents}（${per(passEvents)}/场）\n`);

console.log("[1] 起脚点在本方禁区内的传球：");
console.log({
  "次数": inOwnBox,
  "每场": per(inOwnBox),
  "占全部传球": `${pct(inOwnBox, passEvents)}%`,
  "传球距离中位": median(distIn),
  "距离 >45 单位的次数": `${distInFar.length} (${pct(distInFar.length, inOwnBox)}%)`,
});
console.log("\n[2] 起脚点在其它区域的传球（改动不应触及）：");
console.log({
  "次数": elsewhere,
  "每场": per(elsewhere),
  "传球距离中位": median(distOut),
});
console.log("\n[3] 候选截断放宽后**新解锁**的传球（仅本方禁区内）：");
console.log({
  "新解锁次数": newUnlocked,
  "每场": per(newUnlocked),
  "占本方禁区传球": `${pct(newUnlocked, inOwnBox)}%`,
});
console.log(
  "\n判别：\n" +
  "  · [1] 的占比决定这次改动的**最大影响面**（只有本方禁区内的传球可能变）。\n" +
  "  · [3] 是「把球开远」这个新选项出现的频率。若它接近 0，说明即使放宽截断，\n" +
  "    真实场景里防守者也没有 45 单位以外的队友可选 —— 改截断无用，杠杆在别处。\n" +
  "  · 本脚本只报影响面，不报收益。收益必须用完整标定（进球/传球量/完成率）验。"
);
