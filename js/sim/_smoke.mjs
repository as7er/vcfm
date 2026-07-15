// P1 冒烟测试：跑多场，看进球/射门/控球分布是否合理。
// 用法：node js/sim/_smoke.mjs
import { SimEngine, SIM } from "./engine.js";

// —— 构造两支测试队（不依赖完整存档，直接喂 tactics.lineup + players）——
function makeClub(name, power, formation = "4-3-3") {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = [];
  const lineup = [];
  for (let i = 0; i < 11; i++) {
    const pos = roles[i];
    const mean = power / 5; // 1..20 制大致中心
    const g = () => Math.max(1, Math.min(20, Math.round(mean + (Math.random() - 0.5) * 5)));
    const id = `${name}-p${i}`;
    players.push({
      id,
      name: `${name}#${i}`,
      pos,
      number: i + 1,
      fitness: 100,
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

const STEPS_PER_MATCH = Math.round((90 * 60) / SIM.DT); // 90 分钟 @10Hz

function runMatch(home, away) {
  const eng = new SimEngine(home, away);
  let nan = false;
  let ownerSteps = { home: 0, away: 0, none: 0 };
  // 推进深度探针：主队攻 y 小(0)、客队攻 y 大(100)
  // deepest = 各队把球推进到的最靠近对方球门的 y；finalThird = 在对方三区的 tick 数
  let deepestHome = 100, deepestAway = 0;
  let finalThird = { home: 0, away: 0 };
  for (let i = 0; i < STEPS_PER_MATCH; i++) {
    eng.step();
    const b = eng.ball;
    if (Number.isNaN(b.x) || Number.isNaN(b.y)) { nan = true; break; }
    const o = b.owner ? eng.agentById(b.owner) : null;
    if (o) {
      ownerSteps[o.team]++;
      if (o.team === "home") {
        if (b.y < deepestHome) deepestHome = b.y;
        if (b.y < 33) finalThird.home++;
      } else {
        if (b.y > deepestAway) deepestAway = b.y;
        if (b.y > 67) finalThird.away++;
      }
    } else ownerSteps.none++;
  }
  const shots = eng.events.filter((e) => e.type === "shot");
  const goals = eng.events.filter((e) => e.type === "goal");
  const passes = eng.events.filter((e) => e.type === "pass");
  const tackles = eng.events.filter((e) => e.type === "tackle");
  const saves = eng.events.filter((e) => e.type === "save");
  const totalOwned = ownerSteps.home + ownerSteps.away || 1;
  return {
    score: eng.score,
    nan,
    shots: { home: shots.filter((s) => s.team === "home").length, away: shots.filter((s) => s.team === "away").length },
    goals: goals.length,
    passes: passes.length,
    tackles: tackles.length,
    saves: saves.length,
    possHome: Math.round((ownerSteps.home / totalOwned) * 100),
    freeBallPct: Math.round((ownerSteps.none / STEPS_PER_MATCH) * 100),
    deepestHome, deepestAway,
    finalThirdHome: Math.round((finalThird.home / STEPS_PER_MATCH) * 100),
    finalThirdAway: Math.round((finalThird.away / STEPS_PER_MATCH) * 100),
  };
}

console.log(`每场 ${STEPS_PER_MATCH} 步 (90min @${1 / SIM.DT}Hz)\n`);

// 1) 势均力敌 10 场
let agg = { g: 0, sh: 0, ps: 0, tk: 0, sv: 0, poss: 0, free: 0, nan: 0 };
const N = 10;
console.log("=== 势均力敌 (power 65 vs 65) ===");
for (let i = 0; i < N; i++) {
  const r = runMatch(makeClub("H", 65), makeClub("A", 65));
  console.log(
    `场${i + 1}: ${r.score.home}-${r.score.away}  射${r.shots.home}/${r.shots.away}  传${r.passes}  抢${r.tackles}  扑${r.saves}  控球主${r.possHome}%  松球${r.freeBallPct}%  主最深${r.deepestHome?.toFixed(0)}  三区%${r.finalThirdHome}${r.nan ? "  ⚠NaN" : ""}`
  );
  agg.g += r.goals; agg.sh += r.shots.home + r.shots.away; agg.ps += r.passes;
  agg.tk += r.tackles; agg.sv += r.saves; agg.poss += r.possHome; agg.free += r.freeBallPct;
  if (r.nan) agg.nan++;
}
console.log(
  `\n均值: 进球${(agg.g / N).toFixed(1)}  射门${(agg.sh / N).toFixed(1)}  传球${(agg.ps / N).toFixed(0)}  抢断${(agg.tk / N).toFixed(0)}  扑救${(agg.sv / N).toFixed(1)}  控球主${(agg.poss / N).toFixed(0)}%  松球${(agg.free / N).toFixed(0)}%  NaN${agg.nan}`
);

// 2) 强弱对抗 10 场（强队应更多控球/进球）
console.log("\n=== 强弱对抗 (主 78 vs 客 52) ===");
let strong = { win: 0, gf: 0, ga: 0, poss: 0 };
for (let i = 0; i < N; i++) {
  const r = runMatch(makeClub("STR", 78), makeClub("WK", 52));
  console.log(`场${i + 1}: ${r.score.home}-${r.score.away}  控球强队${r.possHome}%`);
  if (r.score.home > r.score.away) strong.win++;
  strong.gf += r.score.home; strong.ga += r.score.away; strong.poss += r.possHome;
}
console.log(
  `\n强队战绩: 胜${strong.win}/${N}  场均${(strong.gf / N).toFixed(1)}-${(strong.ga / N).toFixed(1)}  控球${(strong.poss / N).toFixed(0)}%`
);
