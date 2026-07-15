// 事件序列追踪：dump 一段时间窗内的全部事件，人眼看清"射门画廊"到底怎么循环的。
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

const eng = new SimEngine(makeClub("H", 65), makeClub("A", 65));
// 跑到出现第一次射门附近，然后 dump 之后 20 秒的所有事件
let firstShotStep = -1;
for (let i = 0; i < 54000; i++) {
  eng.step();
  const shots = eng.events.filter((e) => e.type === "shot");
  if (firstShotStep < 0 && shots.length > 0) firstShotStep = i;
  if (firstShotStep > 0 && i > firstShotStep + 200) break; // 第一次射门后再跑 20 秒
}

// 打印从第一次射门前 2 秒到之后 20 秒的事件，含球位置
const t0 = eng.events.find((e) => e.type === "shot")?.t ?? 0;
console.log(`第一次射门 t=${t0.toFixed(1)}s，dump [${(t0 - 2).toFixed(1)} .. ${(t0 + 20).toFixed(1)}]s 的事件：\n`);
for (const e of eng.events) {
  if (e.t < t0 - 2 || e.t > t0 + 20) continue;
  const extra = e.type === "goal" ? ` 比分${e.score.home}-${e.score.away}` : "";
  console.log(`  t=${e.t.toFixed(1)}  ${e.type.padEnd(9)} ${e.team || ""} ${e.agentId || ""}${extra}`);
}

// 统计各类事件间隔
const shots = eng.events.filter((e) => e.type === "shot");
console.log(`\n共 ${shots.length} 次射门（截断样本）`);
if (shots.length > 1) {
  const gaps = [];
  for (let i = 1; i < shots.length; i++) gaps.push(shots[i].t - shots[i - 1].t);
  gaps.sort((a, b) => a - b);
  console.log(`射门间隔：中位 ${gaps[Math.floor(gaps.length / 2)].toFixed(2)}s  最短 ${gaps[0].toFixed(2)}s  最长 ${gaps[gaps.length - 1].toFixed(2)}s`);
  const rapid = gaps.filter((g) => g < 1.5).length;
  console.log(`间隔<1.5s 的连射占比：${Math.round((rapid / gaps.length) * 100)}%`);
}
