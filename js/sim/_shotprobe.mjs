// 射门体检：距离分布 + 结果构成（进球/扑救/偏出）
import { SimEngine, SIM } from "./engine.js";

function makeClub(name, power) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
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

// 记录每次射门瞬间的 dGoal，并追踪其结果
const shotDist = [];
let shots = 0;
for (let i = 0; i < STEPS; i++) {
  const before = eng.events.length;
  eng.step();
  for (let k = before; k < eng.events.length; k++) {
    const e = eng.events[k];
    if (e.type === "shot") {
      const a = eng.agentById(e.agentId);
      if (a) {
        const gy = a.team === "home" ? 0 : 100;
        shotDist.push(Math.hypot(a.x - 50, a.y - gy));
      }
      shots++;
    }
  }
}

const goals = eng.events.filter((e) => e.type === "goal").length;
const saves = eng.events.filter((e) => e.type === "save").length;
const miss = shots - goals - saves;
shotDist.sort((a, b) => a - b);
const med = shotDist[Math.floor(shotDist.length / 2)] || 0;
const buckets = { "0-4": 0, "4-8": 0, "8-16": 0, "16+": 0 };
for (const d of shotDist) {
  if (d < 4) buckets["0-4"]++;
  else if (d < 8) buckets["4-8"]++;
  else if (d < 16) buckets["8-16"]++;
  else buckets["16+"]++;
}
console.log(`射门 ${shots}  进球 ${goals}  扑救 ${saves}  偏出 ${miss}`);
console.log(`命中率(进/射) ${((goals / shots) * 100).toFixed(0)}%   扑救率(扑/射) ${((saves / shots) * 100).toFixed(0)}%   偏出率 ${((miss / shots) * 100).toFixed(0)}%`);
console.log(`射门距离 中位 ${med.toFixed(1)}  分布`, buckets);
