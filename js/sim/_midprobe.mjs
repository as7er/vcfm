// 中场推进体检：确认"进入三区太容易"是不是进球虚高的源头。
// 采样每次控球回合：从本方拿球到进入对方三区(离门<33)，中场拦截了几次、
// 一次控球平均多久就推进到三区。
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

// 统计：进入三区的"波次"数（球从三区外进入三区算一次）
let entriesHome = 0, entriesAway = 0;
let inThirdHome = false, inThirdAway = false;
// 中场区时间占比（球在 y 33..67）
let midTicks = 0, ownedTicks = 0;

for (let i = 0; i < STEPS; i++) {
  eng.step();
  const b = eng.ball;
  const o = b.owner ? eng.agentById(b.owner) : null;
  if (!o) continue;
  ownedTicks++;
  const y = b.y;
  if (y > 33 && y < 67) midTicks++;
  // 主队攻 y 小：三区 = y<33
  if (y < 33) { if (!inThirdHome) { entriesHome++; inThirdHome = true; } } else inThirdHome = false;
  if (y > 67) { if (!inThirdAway) { entriesAway++; inThirdAway = true; } } else inThirdAway = false;
}

console.log(`三区进入波次: 主 ${entriesHome}  客 ${entriesAway}  合计 ${entriesHome+entriesAway}`);
console.log(`中场(y33-67)控球时间占比: ${(midTicks/ownedTicks*100).toFixed(0)}%`);
console.log(`—— 真实参照：一场约 40-60 次进攻波次进入三区；中场拉锯应占大头 ——`);
