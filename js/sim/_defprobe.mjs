// 防守体检：球被推进到逼近球门(y<10 或 y>90)时，防守到底漏在哪。
// 采样每个"深推进"tick：最近防守者离球多远、该端防守人数、门将位置。
import { SimEngine, SIM } from "./engine.js";

function makeClub(name, power) {
  const roles = ["GK","DEF","DEF","DEF","DEF","MID","MID","MID","ATT","ATT","ATT"];
  const players = [], lineup = [];
  for (let i = 0; i < 11; i++) {
    const mean = power / 5;
    const g = () => Math.max(1, Math.min(20, Math.round(mean + (Math.random() - 0.5) * 5)));
    const id = `${name}-p${i}`;
    players.push({ id, name: id, pos: roles[i], number: i + 1, fitness: 100,
      attrs: { pace: g(), shooting: g(), passing: g(), dribbling: g(), defending: g(),
        physical: g(), finishing: g(), tackling: g(), marking: g(), strength: g(),
        stamina: g(), vision: g(), reflexes: g(), handling: g(), positioning: g(), kicking: g() } });
    lineup.push(id);
  }
  return { name, players, tactics: { formation: "4-3-3", lineup } };
}

const STEPS = Math.round((90 * 60) / SIM.DT);
const eng = new SimEngine(makeClub("H", 65), makeClub("A", 65));

function dist(ax,ay,bx,by){ return Math.hypot(ax-bx, ay-by); }

let deepTicks = 0;
let sumNearestDef = 0;   // 深推进时，最近防守者离球平均距离
let sumDefInBox = 0;     // 深推进时，禁区内防守人数（实际位置）
let sumDefInBoxTarget = 0; // 深推进时，目标位置在禁区的防守人数
let sumGap2 = 0;         // 深推进时，防守者实际vs目标位置平均差距
const dCarrierGoal = [];  // 深推进时持球者离球门距离

for (let i = 0; i < STEPS; i++) {
  eng.step();
  const b = eng.ball;
  const o = b.owner ? eng.agentById(b.owner) : null;
  if (!o || o.role === "GK") continue;
  // 主队攻 y 小(0)，客队攻 y 大(100)
  const goalY = o.team === "home" ? 0 : 100;
  const dGoal = Math.abs(b.y - goalY);
  if (dGoal > 12) continue; // 只看逼近球门的时刻

  deepTicks++;
  dCarrierGoal.push(dGoal);
  // 防守方 = 对方
  let nearest = 999, inBox = 0, inBoxTarget = 0, sumGap = 0, nDef = 0;
  for (const d of eng.agents) {
    if (d.team === o.team) continue;
    const dd = dist(d.x, d.y, b.x, b.y);
    if (dd < nearest) nearest = dd;
    // 禁区粗略：离球门 y<16 且 x 在 30..70
    if (Math.abs(d.y - goalY) < 16 && d.x > 30 && d.x < 70) inBox++;
    // 目标位置是否在禁区（区分“目标错” vs “跑不到位”）
    if (Math.abs((d.ty ?? d.y) - goalY) < 16 && (d.tx ?? d.x) > 30 && (d.tx ?? d.x) < 70) inBoxTarget++;
    // 实际位置与目标位置的差距（跑不到位程度）
    if (d.role !== "GK") { sumGap += dist(d.x, d.y, d.tx ?? d.x, d.ty ?? d.y); nDef++; }
  }
  sumNearestDef += nearest;
  sumDefInBox += inBox;
  sumDefInBoxTarget += inBoxTarget;
  sumGap2 += sumGap / (nDef || 1);
}

dCarrierGoal.sort((a,b)=>a-b);
console.log(`深推进 tick 数（球到离门<12）: ${deepTicks}  占比 ${(deepTicks/STEPS*100).toFixed(1)}%`);
console.log(`深推进时 最近防守者离球平均距离: ${(sumNearestDef/deepTicks).toFixed(1)}`);
console.log(`深推进时 禁区内防守人数(含门将)平均: ${(sumDefInBox/deepTicks).toFixed(1)}`);
console.log(`持球者离门距离 中位: ${dCarrierGoal[Math.floor(dCarrierGoal.length/2)].toFixed(1)}`);
console.log(`深推进时 目标位置在禁区的防守人数: ${(sumDefInBoxTarget/deepTicks).toFixed(1)}  ← 若这个也低=目标错；若高但实际低=跑不到位`);
console.log(`深推进时 防守者 实际vs目标 平均差距: ${(sumGap2/deepTicks).toFixed(1)}`);
