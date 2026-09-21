/**
 * 中场休息面板「各队员体能 / 下半场角色指令」显示异常 —— 最小复现与取证。
 *
 * 症状（用户报告）：
 *   1) 中场休息界面的「各队员体能」数值与场上实际不符；
 *   2) 「下半场角色指令」内容疑似张冠李戴。
 *
 * 本脚本只**测量**，不改引擎、不改 UI。
 *
 * ⚠ 2026-09-21 改造：假球员原来只给 `attrs: {}`（**同值档**），
 *   而引擎的逐人体能差异主要来自 `attr.stamina`（`engine.js:5851`
 *   的 `1.18 - stamina * 0.35`）⇒ **同值档会把个体差异在构造上抹掉**，
 *   于是「引擎侧也几乎没差」这个结论是探针自己造出来的。
 *   现在所有球员都走 `ensureFootballProfile()`（与真实存档同一条属性生成路径）。
 *
 * 用法：node scripts/_halftime-fitness-display-probe.mjs
 */

import { defaultTactics, getLineupPlayers, ensureFootballProfile } from "../js/models.js";
import { generatePlayerAttributes } from "../js/player-attributes.js";
import { createMatchSession, playFirstHalf } from "../js/match.js";

function player(id, pos, ovr, fitness = 90) {
  return {
    id, name: id, pos, ovr, potential: ovr + 1, age: 27,
    fitness, morale: 70, injured: 0, suspendedMatches: 0, attrs: {},
  };
}

function squad() {
  const players = [player("gk", "GK", 14), player("gk2", "GK", 13)];
  for (let i = 0; i < 7; i++) players.push(player(`d${i}`, "DEF", +(16 - i * 0.3).toFixed(2)));
  for (let i = 0; i < 8; i++) players.push(player(`m${i}`, "MID", +(16 - i * 0.25).toFixed(2)));
  for (let i = 0; i < 6; i++) players.push(player(`a${i}`, "ATT", +(16 - i * 0.4).toFixed(2)));
  // ⚠ 必须补**完整**属性：`ensureFootballProfile` 只补 heading/crossing/decisions
  //   + 位置/习惯，**不生成 stamina**（实测全员 stamina 都是默认 0.600）⇒ 仍是同值档。
  //   完整属性要走 `generatePlayerAttributes(player, ovr)`（与新建世界同一条路径）。
  for (const p of players) {
    generatePlayerAttributes(p, p.ovr);
    ensureFootballProfile(p);
  }
  return players;
}

function makeWorld() {
  const club = {
    id: "user", name: "User", power: 70, players: squad(),
    tactics: defaultTactics(), staff: {},
  };
  const opponent = { id: "opp", name: "Opponent", power: 65, players: squad(), tactics: defaultTactics() };
  return { clubs: [club, opponent], userClubId: "user", season: 2026, day: 5 };
}

const world = makeWorld();
const club = world.clubs[0];

const fixture = { day: 5, home: "user", away: "opp", played: false };
const state = createMatchSession(world, fixture);

// ⚠ 基线必须在 `createMatchSession` **之后**取：
//   `defaultTactics().lineup` 是空数组，首发是建会话时才自动挑的
//   ⇒ 之前在这一步之前调 `getLineupPlayers()` 拿到的是**空集合**，
//     于是下面的「差」全部以 `?? 100` 兜底 ⇒ 把「90 → 87（−3）」错读成「100 → 87（−13）」。
const before = new Map(getLineupPlayers(club).map((p) => [p.id, p.fitness]));
console.log("=== 赛前首发体能 ===");
console.log([...before.entries()].map(([k, v]) => `${k}:${v}`).join(" "));

// 跑完上半场（直播路径）
await playFirstHalf(state, {});

console.log("\n=== 中场时刻（state.phase =", state.phase, "minute =", state.minute, "）===");

const xi = getLineupPlayers(club).filter((p) => p && !(state.sentOff?.home || new Set()).has(p.id));
console.log("\n--- 面板会读到的体能（club.players[].fitness）---");
for (const p of xi) {
  const b = before.get(p.id) ?? 100;
  console.log(`  ${p.id.padEnd(4)} ${p.pos.padEnd(4)} 赛前 ${String(b).padStart(3)}  中场 ${String(p.fitness).padStart(3)}  差 ${String((p.fitness ?? 100) - b).padStart(4)}`);
}

const dropped = xi.filter((p) => (p.fitness ?? 100) < (before.get(p.id) ?? 100));
console.log(`\n⇒ 有体能变化的球员数：${dropped.length} / ${xi.length}`);

const avg = Math.round(xi.reduce((s, p) => s + (p.fitness || 100), 0) / (xi.length || 1));
console.log(`⇒ 面板「首发体能均」会显示：${avg}%`);

// 上半场应有一次 45' 结算（minute % 15 === 0）。若 45 未结算，体能差会只体现 15/30 两次。
console.log("\n=== 判定线索 ===");
console.log(`球员体能是否出现「差值全为 0 或全相同」的团块？（那是整点结算的特征）`);
const uniq = [...new Set(xi.map((p) => p.fitness))];
console.log(`  体能取值种类数：${uniq.length}（取值：${uniq.join(",")}）`);
console.log(`  若种类数很少 ⇒ 体能是「整点批量扣减」而非连续消耗`);

// 引擎内部 agent 的体能（另一套，面板没读它）
const eng = state.simEng;
if (eng?.agents) {
  console.log("\n--- 引擎内部 agent 的体能（面板没有读这一套）---");
  const home = eng.agents.filter((a) => a.team === "home");
  const rows = home.map((a) => `${a.id}:${Number(a.fitness).toFixed(2)}`);
  console.log(rows.join(" "));
  // ⚠ 关键读数：引擎侧**本来就有**个体差异。若这里 spread 也是 0，
  //   说明探针又落回「同值档」（球员属性同值），必须先修探针再谈结论。
  const fits = home.map((a) => Number(a.fitness));
  const lo = fits.reduce((m, v) => (v < m ? v : m), Infinity);
  const hi = fits.reduce((m, v) => (v > m ? v : m), -Infinity);
  const mean = fits.reduce((s, v) => s + v, 0) / (fits.length || 1);
  console.log(
    `  min ${lo.toFixed(2)} / max ${hi.toFixed(2)} / mean ${mean.toFixed(2)} / spread ${(hi - lo).toFixed(2)}`
  );
  // 引擎逐人耗尽的「个体倍率」：1.18 - stamina*0.35（engine.js:5851）
  const stam = home.map((a) => Number(a.attr?.stamina ?? NaN));
  const sLo = stam.reduce((m, v) => (v < m ? v : m), Infinity);
  const sHi = stam.reduce((m, v) => (v > m ? v : m), -Infinity);
  console.log(
    `  引擎 stamina（norm 后）min ${sLo.toFixed(3)} / max ${sHi.toFixed(3)} ⇒ 耗尽倍率 ` +
      `${(1.18 - sHi * 0.35).toFixed(3)} ~ ${(1.18 - sLo * 0.35).toFixed(3)} ` +
      `（比值 ${((1.18 - sLo * 0.35) / (1.18 - sHi * 0.35)).toFixed(3)}×）`
  );
  const fsmCount = {};
  for (const a of home) fsmCount[a.fsm] = (fsmCount[a.fsm] || 0) + 1;
  console.log(`  采样时刻 fsm 分布：${JSON.stringify(fsmCount)}`);
}

console.log("\n=== 角色指令面板的取数（对齐 renderHtRoleEditors）===");
const lineup = club.tactics.lineup || [];
const roles = club.tactics.roles || [];
const duties = club.tactics.duties || [];
const formation = (await import("../js/data.js")).FORMATIONS[club.tactics.formation] || null;
const slots = formation?.slots || [];
console.log(`阵型 ${club.tactics.formation}；slots ${slots.length}；lineup ${lineup.length}；roles ${roles.length}；duties ${duties.length}`);
console.log("lineup:", lineup.join(","));
console.log("roles :", roles.join(","));
console.log("duties:", duties.join(","));

// 逐槽位对齐打印：这正是面板每一行会显示的内容
console.log("\n--- 面板逐行内容（位置码 | 球员名 | 角色 | 职责）---");
const { getSlotRole } = await import("../js/models.js");
const { slotPositionCode } = await import("../js/player-positions.js");
for (let i = 0; i < Math.max(slots.length, lineup.length); i++) {
  const slot = slots[i];
  const pid = lineup[i];
  const p = club.players.find((x) => x.id === pid);
  const detailed = slot ? slotPositionCode(slot, i, slots) : "—(无槽位)";
  const rid = roles[i] || (slot ? getSlotRole(club, i) : "—");
  const dutyId = duties[i] || "—";
  const gap = slots[i] ? "" : "   ⚠ 该下标没有对应槽位";
  console.log(
    `  [${String(i).padStart(2)}] ${String(detailed).padEnd(4)} ${String(p?.name ?? "—").padEnd(5)} ${String(rid).padEnd(12)} ${String(dutyId).padEnd(10)}${gap}`
  );
}

console.log("\n=== 判定 ===");
console.log(`slots 与 lineup 是否等长？${slots.length === lineup.length ? "✅ 是" : `❌ 否（slots ${slots.length} vs lineup ${lineup.length}）`}`);
if (slots.length !== lineup.length) {
  console.log("  ⇒ 面板按 slots.map() 渲染，超出 lineup 的下标会显示「—」，");
  console.log("    而 collectHtRoles 按 select 的 data-ht-role-slot 回写 ⇒ 数组长度/空洞可能与 slots 不一致。");
}
const roleHoles = roles.filter((r) => r === undefined).length;
if (roleHoles) console.log(`  ⚠ roles 数组有 ${roleHoles} 个空洞（稀疏赋值遗留）`);

