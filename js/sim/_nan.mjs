// NaN 猎手：单场逐步跑，第一次出现 NaN 时打印完整上下文并停。
import { SimEngine, SIM } from "./engine.js";

function makeClub(name, power, formation = "4-3-3") {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = [];
  const lineup = [];
  for (let i = 0; i < 11; i++) {
    const pos = roles[i];
    const mean = power / 5;
    const g = () => Math.max(1, Math.min(20, Math.round(mean + (Math.random() - 0.5) * 5)));
    const id = `${name}-p${i}`;
    players.push({
      id, name: `${name}#${i}`, pos, number: i + 1, fitness: 100,
      attrs: {
        pace: g(), shooting: g(), passing: g(), dribbling: g(), defending: g(),
        physical: g(), finishing: g(), tackling: g(), marking: g(), strength: g(),
        stamina: g(), vision: g(), reflexes: g(), handling: g(), positioning: g(), kicking: g(),
      },
    });
    lineup.push(id);
  }
  return { name, players, tactics: { formation, lineup } };
}

const bad = (v) => Number.isNaN(v) || !Number.isFinite(v);

const eng = new SimEngine(makeClub("H", 65), makeClub("A", 65));
for (let i = 0; i < 54000; i++) {
  eng.step();
  const b = eng.ball;
  let culprit = null;
  if (bad(b.x) || bad(b.y) || bad(b.vx) || bad(b.vy)) culprit = { who: "BALL", b: { ...b } };
  if (!culprit) {
    for (const a of eng.agents) {
      if (bad(a.x) || bad(a.y) || bad(a.vx) || bad(a.vy) || bad(a.heading) || bad(a.tx) || bad(a.ty)) {
        culprit = { who: a.id, role: a.role, x: a.x, y: a.y, vx: a.vx, vy: a.vy, heading: a.heading, tx: a.tx, ty: a.ty, intent: a.intent, fsm: a.fsm };
        break;
      }
    }
  }
  if (culprit) {
    console.log(`首次 NaN @ step ${i} (t=${eng.t.toFixed(1)}s)`);
    console.log("肇事者:", JSON.stringify(culprit, null, 2));
    console.log("球:", JSON.stringify({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, owner: b.owner, state: b.state }, null, 2));
    const lastEv = eng.events.slice(-5);
    console.log("最近5事件:", JSON.stringify(lastEv));
    break;
  }
}
console.log("done");
