// 乒乓链明细：dump 一段乒乓缠斗里每次易主的上下文
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

let lastOwner = null, lastSwitchT = 0, lastX = 50, lastY = 50;
let chain = [], best = [];
for (let i = 0; i < STEPS; i++) {
  const before = eng.events.length;
  eng.step();
  const o = eng.ball.owner ? eng.agentById(eng.ball.owner) : null;
  if (!o) continue;
  if (lastOwner && o.id !== lastOwner) {
    const dt = eng.t - lastSwitchT;
    const moved = Math.hypot(eng.ball.x - lastX, eng.ball.y - lastY);
    const newEv = eng.events.slice(before).map(e=>e.type).join(",");
    if (dt < 1.2 && moved < 6) {
      chain.push(`  t=${eng.t.toFixed(1)} ${lastOwner}→${o.id}(${o.team}) dt=${dt.toFixed(2)} moved=${moved.toFixed(1)} ev=[${newEv}] ballState=${eng.ball.state}`);
      if (chain.length > best.length) best = [...chain];
    } else chain = [];
    lastSwitchT = eng.t; lastX = eng.ball.x; lastY = eng.ball.y;
  }
  lastOwner = o.id;
}
console.log(`最长乒乓链 ${best.length} 步：`);
console.log(best.join("\n"));
