// 缩放输出体检：验证 scaledResult() 把快节奏引擎映射到真实量级，
// 且保留强弱差异（强队仍该赢、进球分布合理）。
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
function run(h, a) {
  const eng = new SimEngine(h, a);
  for (let i = 0; i < STEPS; i++) eng.step();
  return eng.scaledResult();
}

console.log("=== 势均力敌 (65 vs 65) 20 场 ===");
let gh=0, ga=0, sh=0, sa=0, draws=0, hw=0, aw=0;
const N = 80;
const dist = {};
for (let i = 0; i < N; i++) {
  const r = run(makeClub("H",65), makeClub("A",65));
  gh += r.score.home; ga += r.score.away;
  sh += r.shots.home; sa += r.shots.away;
  const tot = r.score.home + r.score.away;
  dist[tot] = (dist[tot]||0)+1;
  if (r.score.home > r.score.away) hw++; else if (r.score.home < r.score.away) aw++; else draws++;
  if (i < 8) console.log(`  ${r.score.home}-${r.score.away}  射${r.shots.home}-${r.shots.away}`);
}
console.log(`均值: 进球 ${(gh/N).toFixed(2)}-${(ga/N).toFixed(2)}  射门 ${(sh/N).toFixed(1)}-${(sa/N).toFixed(1)}`);
console.log(`主胜 ${hw} 平 ${draws} 客胜 ${aw}  |  总进球分布`, dist);

console.log("\n=== 强弱 (78 vs 52) 20 场 ===");
let sgh=0,sga=0,swin=0;
for (let i = 0; i < N; i++) {
  const r = run(makeClub("STR",78), makeClub("WK",52));
  sgh += r.score.home; sga += r.score.away;
  if (r.score.home > r.score.away) swin++;
  if (i < 8) console.log(`  ${r.score.home}-${r.score.away}  射${r.shots.home}-${r.shots.away}`);
}
console.log(`强队场均 ${(sgh/N).toFixed(2)}-${(sga/N).toFixed(2)}  胜率 ${swin}/${N}`);
