// 伤病空间化探针：量化伤病频率 + 检测比赛冻结（事件长间隔）。
// 用法：node js/sim/_injury.mjs
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

const STEPS = Math.round((90 * 60) / SIM.DT);
const N = 20;
const withSub = process.argv.includes("--sub");

let totInj = 0, totContact = 0, totFatigue = 0, totStalls = 0, frozen = 0, lowVolume = 0;

for (let m = 0; m < N; m++) {
  const home = makeClub("H", 65);
  const away = makeClub("A", 65);
  const eng = new SimEngine(home, away);
  if (withSub) {
    // 模拟接入层：无限替补（隔离“少人”变量，纯看热替换是否恢复正常量）
    let subN = 0;
    eng.onInjurySub = (agent) => {
      subN++;
      const club = agent.team === "home" ? home : away;
      const id = `${club.name}-sub${subN}`;
      const g = () => 13;
      return {
        id, name: id, pos: "MID", number: 20 + subN, fitness: 100,
        attrs: {
          pace: g(), shooting: g(), passing: g(), dribbling: g(), finishing: g(),
          tackling: g(), marking: g(), strength: g(), stamina: g(), vision: g(),
          reflexes: g(), handling: g(), positioning: g(), kicking: g(),
        },
      };
    };
  }
  for (let i = 0; i < STEPS; i++) eng.step();

  const inj = eng.events.filter((e) => e.type === "injury");
  const contact = inj.filter((e) => e.cause === "contact").length;
  const fatigue = inj.filter((e) => e.cause === "fatigue").length;
  const stalls = eng.events.filter((e) => e.type === "stall_clear").length;
  const passes = eng.events.filter((e) => e.type === "pass").length;
  const offH = eng.agents.filter((a) => a.team === "home" && a.sentOff).length;
  const offA = eng.agents.filter((a) => a.team === "away" && a.sentOff).length;

  // 冻结检测：相邻事件的最大时间间隔（正常比赛事件很密，>120s 即可疑）
  let maxGap = 0, gapAt = 0;
  let prev = 0;
  for (const e of eng.events) {
    if (e.t - prev > maxGap) { maxGap = e.t - prev; gapAt = prev; }
    prev = e.t;
  }
  if (eng.t - prev > maxGap) { maxGap = eng.t - prev; gapAt = prev; }

  const flag = maxGap > 120 ? `  ⚠冻结 gap=${maxGap.toFixed(0)}s @t=${gapAt.toFixed(0)}s ball=${eng.ball.state}/owner=${eng.ball.owner}` : "";
  if (maxGap > 120) frozen++;
  if (passes < 700) lowVolume++;
  totInj += inj.length; totContact += contact; totFatigue += fatigue;
  totStalls += stalls;

  console.log(
    `场${m + 1}: ${eng.score.home}-${eng.score.away}  传${passes}  伤${inj.length}(触${contact}/疲${fatigue})  解困${stalls}  缺席H${offH}/A${offA}${flag}`
  );
}

console.log(
  `\n均值: 伤病${(totInj / N).toFixed(2)}/场 (接触${(totContact / N).toFixed(2)} 疲劳${(totFatigue / N).toFixed(2)})  解困${(totStalls / N).toFixed(1)}/场  冻结场次${frozen}/${N}  低传球量场次${lowVolume}/${N}  模式=${withSub ? "有替补" : "无替补"}`
);
