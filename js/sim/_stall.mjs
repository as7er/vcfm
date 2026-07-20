// 僵持根因探针：在看门狗触发前（_stallT>15s）抓现场快照 + 最近决策日志。
// 用法：node js/sim/_stall.mjs [场数]
import { SimEngine, SIM } from "./engine.js";

function makeClub(name, power) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = [], lineup = [];
  for (let i = 0; i < 11; i++) {
    const mean = power / 5;
    const g = () => Math.max(1, Math.min(20, Math.round(mean + (Math.random() - 0.5) * 5)));
    const id = `${name}-p${i}`;
    players.push({
      id, name: `${name}#${i}`, pos: roles[i], number: i + 1, fitness: 100,
      attrs: { pace: g(), shooting: g(), passing: g(), dribbling: g(), defending: g(), physical: g(),
        finishing: g(), tackling: g(), marking: g(), strength: g(), stamina: g(), vision: g(),
        reflexes: g(), handling: g(), positioning: g(), kicking: g() },
    });
    lineup.push(id);
  }
  return { name, players, tactics: { formation: "4-3-3", lineup } };
}

const GAMES = Number(process.argv[2] || 20);
let stallCount = 0;
const captures = [];

for (let g = 0; g < GAMES; g++) {
  const eng = new SimEngine(makeClub("H", 65), makeClub("A", 65));

  // 环形决策日志：记录持球决策入口与产出意图
  const decLog = [];
  const origDecide = eng._decideOnBall.bind(eng);
  eng._decideOnBall = (a) => {
    const before = { x: a.x.toFixed(1), y: a.y.toFixed(1) };
    const pressure = eng._pressureOn(a);
    const shotCd = Math.max(0, (a.shotCdUntil || 0) - eng.t);
    const teamCd = Math.max(0, (eng._teamShotUntil[a.team] || 0) - eng.t);
    const attackAge = Math.max(0, eng.t - (eng._teamAttackSince[a.team] || 0));
    const passTo = eng._bestPass(a);
    origDecide(a);
    decLog.push({
      t: eng.t, id: a.id, role: a.role, x: before.x, y: before.y,
      intent: a.intent ? { ...a.intent } : null,
      ballState: eng.ball.state, ballOwner: eng.ball.owner,
      pressure: +pressure.toFixed(2), shotCd: +shotCd.toFixed(1), teamCd: +teamCd.toFixed(1),
      attackAge: +attackAge.toFixed(1), passVal: passTo ? +passTo.value.toFixed(2) : null,
    });
    if (decLog.length > 40) decLog.shift();
  };

  let captured = false;
  for (let i = 0; i < 54000; i++) {
    eng.step();
    if (!captured && (eng._stallT || 0) > 15) {
      captured = true;
      stallCount++;
      const b = eng.ball;
      const o = b.owner ? eng.agentById(b.owner) : null;
      captures.push({
        game: g, t: eng.t,
        ball: { x: b.x, y: b.y, z: b.z, state: b.state, owner: b.owner,
                vx: b.vx, vy: b.vy, receiverId: b.receiverId, kickTeam: b.kickTeam },
        deadBallUntil: eng.deadBallUntil,
        owner: o ? { id: o.id, role: o.role, team: o.team, x: o.x, y: o.y,
                     tx: o.tx, ty: o.ty, fsm: o.fsm, intent: o.intent,
                     decisionUntil: o.decisionUntil, noReclaimUntil: o.noReclaimUntil,
                     sentOff: !!o.sentOff, injuredOff: !!o.injuredOff } : null,
        agents: eng.agents.map((a) => ({
          id: a.id, team: a.team, role: a.role,
          x: +a.x.toFixed(1), y: +a.y.toFixed(1),
          tx: +((a.tx ?? 0).toFixed?.(1) ?? a.tx), ty: +((a.ty ?? 0).toFixed?.(1) ?? a.ty),
          fsm: a.fsm, off: !!(a.sentOff || a.injuredOff),
          nr: a.noReclaimUntil > eng.t ? +(a.noReclaimUntil - eng.t).toFixed(1) : 0,
        })),
        recentDecisions: decLog.slice(-12),
        defenders: (() => {
          const b2 = eng.ball;
          const ownerTeam = o ? o.team : null;
          const defTeam = ownerTeam === "home" ? "away" : "home";
          const plan = eng._defPlans?.[defTeam];
          return eng.agents.filter((a) => a.team === defTeam && !a.sentOff)
            .map((a) => ({
              id: a.id, role: a.role,
              d: +Math.hypot(a.x - b2.x, a.y - b2.y).toFixed(2),
              x: +a.x.toFixed(1), y: +a.y.toFixed(1),
              tx: +(+a.tx).toFixed(1), ty: +(+a.ty).toFixed(1),
              fsm: a.fsm, job: plan?.jobs?.get(a.id)?.type || "-",
              tackleCd: a.tackleCdUntil > eng.t ? +(a.tackleCdUntil - eng.t).toFixed(1) : 0,
            }))
            .sort((x2, y2) => x2.d - y2.d).slice(0, 4);
        })(),
        teamTackleCd: (() => {
          const defTeam = (o ? o.team : "home") === "home" ? "away" : "home";
          const v = eng._teamTackleUntil?.[defTeam] || 0;
          return v > eng.t ? +(v - eng.t).toFixed(1) : 0;
        })(),
        recentEvents: eng.events.slice(-6).map((e) => ({ t: +e.t.toFixed(1), type: e.type, team: e.team })),
      });
    }
  }
}

console.log(`${GAMES} 场，捕获到僵持（>15s 零进展）的场次：${stallCount}`);
for (const c of captures.slice(0, 5)) {
  console.log(`\n===== 场 ${c.game}  t=${c.t.toFixed(1)}s =====`);
  console.log(`球: (${c.ball.x.toFixed(1)},${c.ball.y.toFixed(1)}) z=${c.ball.z.toFixed(2)} state=${c.ball.state} owner=${c.ball.owner} v=(${c.ball.vx.toFixed(2)},${c.ball.vy.toFixed(2)}) recv=${c.ball.receiverId} kickTeam=${c.ball.kickTeam} deadBallUntil=${c.deadBallUntil?.toFixed?.(1)}`);
  if (c.owner) {
    console.log(`持球者: ${c.owner.id} ${c.owner.role} (${c.owner.x.toFixed(1)},${c.owner.y.toFixed(1)}) fsm=${c.owner.fsm} intent=${JSON.stringify(c.owner.intent)} decUntil=${c.owner.decisionUntil?.toFixed?.(1)} t=${c.t.toFixed(1)}`);
  } else {
    console.log(`无主球`);
    // 无主时：谁离球最近、在干嘛
    const near = c.agents.filter((a) => !a.off)
      .map((a) => ({ ...a, d: Math.hypot(a.x - c.ball.x, a.y - c.ball.y) }))
      .sort((a, b) => a.d - b.d).slice(0, 6);
    for (const a of near) console.log(`  近球: ${a.id} ${a.team} ${a.role} d=${a.d.toFixed(1)} pos=(${a.x},${a.y}) tgt=(${a.tx},${a.ty}) fsm=${a.fsm} noReclaim=${a.nr}`);
  }
  console.log(`最近事件: ${c.recentEvents.map((e) => `${e.t}s ${e.type}`).join("  ")}`);
  if (c.defenders) {
    console.log(`防守方 teamTackleCd=${c.teamTackleCd}，近球防守者:`);
    for (const d of c.defenders)
      console.log(`  ${d.id} ${d.role} d=${d.d} pos=(${d.x},${d.y}) tgt=(${d.tx},${d.ty}) fsm=${d.fsm} job=${d.job} tackleCd=${d.tackleCd}`);
  }
  console.log(`最近持球决策:`);
  for (const d of c.recentDecisions)
    console.log(`  t=${d.t.toFixed(1)} ${d.id} ${d.role} @(${d.x},${d.y}) press=${d.pressure} shotCd=${d.shotCd} teamCd=${d.teamCd} atkAge=${d.attackAge} passVal=${d.passVal} → ${JSON.stringify(d.intent)}`);
}
