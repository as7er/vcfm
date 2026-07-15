// 乒乓探针：检测"贴身缠斗中球权在两队间快速反复易主"的循环。
// 定义一次乒乓 tick：本步 owner 所属队 与 上次不同，且两次易主间隔 < 1.2s、
// 且球位置移动 < 6（几乎原地）。连续乒乓计入一段"缠斗"。
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

let lastTeam = null, lastSwitchT = 0, lastX = 50, lastY = 50;
let pongSwitches = 0, totalSwitches = 0;
let maxChain = 0, chain = 0;

for (let i = 0; i < STEPS; i++) {
  eng.step();
  const o = eng.ball.owner ? eng.agentById(eng.ball.owner) : null;
  if (!o) continue;
  if (lastTeam && o.team !== lastTeam) {
    totalSwitches++;
    const dt = eng.t - lastSwitchT;
    const moved = Math.hypot(eng.ball.x - lastX, eng.ball.y - lastY);
    if (dt < 1.2 && moved < 6) {
      pongSwitches++;
      chain++;
      if (chain > maxChain) maxChain = chain;
    } else {
      chain = 0;
    }
    lastSwitchT = eng.t;
    lastX = eng.ball.x; lastY = eng.ball.y;
  }
  lastTeam = o.team;
}

console.log(`总易主 ${totalSwitches} 次`);
console.log(`乒乓易主（<1.2s 且原地）${pongSwitches} 次  占比 ${(pongSwitches/totalSwitches*100).toFixed(0)}%`);
console.log(`最长连续乒乓链 ${maxChain} 次`);
