// 换边第 2 步：**调用层接线**验证
//
// 这一层最容易错，因为 `resyncSimAfterHalfTime` 有两条触发路径，
// 只有「进入下半场」那条才该开换边。本脚本逐条钉死：
//
//   ① 上半场（fromMin=1）跑完，引擎必须仍是 endsSwapped=false；
//   ② 下半场首段（fromMin=46）跑完，引擎必须变成 endsSwapped=true；
//   ③ **换人/换阵触发的 resync 绝不能顺带换边**（fromMin=61 + _simNeedsResync，
//      且此前从未进过下半场 ⇒ 必须仍为 false）；这是最危险的一条。
//   ④ 读档场景：清掉 simEng 模拟「引擎未持久化」，只留 state._endsSwappedApplied，
//      再跑一段 ⇒ 新引擎必须被重新置成 endsSwapped=true（自愈）。
//   ⑤ 幂等：重复进入 46 分钟不产生副作用。
//
// 手法：不真正跑比赛（太慢），而是直接驱动 `applyHalfTimeSwap` 的等价逻辑。
//   由于 `applyHalfTimeSwap` 不是导出函数，这里改用**行为等价的可观察量**：
//   构造 state → 手动设置 simEng/_endsSwappedApplied → 调用导出的
//   `resyncSimAfterHalfTime`，再断言 endsSwapped 的取值是否符合接线规则。
//   （接线规则本身从 match.js 源码同步，脚本末尾会做一次源码一致性检查。）
//
// 用法：node scripts/_swap-ends-wiring-check.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SimEngine } from "../js/sim/engine.js";
import { resyncSimAfterHalfTime } from "../js/sim/adapt.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MATCH_JS = join(HERE, "..", "js", "match.js");

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROLES = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
const NAMES = [
  "pace", "shooting", "passing", "dribbling", "defending", "physical",
  "finishing", "tackling", "marking", "strength", "stamina", "vision",
  "reflexes", "handling", "positioning", "kicking", "decisions",
];
function makeClub(name, bias) {
  const players = ROLES.map((role, i) => {
    const attrs = {};
    for (const k of NAMES) attrs[k] = 10 + bias + ((i * 3 + k.length) % 5);
    return {
      id: `${name}-${i}`, name: `${name} ${i}`, pos: role, role, number: i + 1,
      attrs, playingHabits: [], fitness: 100, injured: 0,
    };
  });
  return {
    id: name, name, players,
    tactics: {
      formation: "4-3-3", lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, width: 3, style: "balanced",
    },
  };
}
function makeState() {
  const home = makeClub("H", 4), away = makeClub("A", 1);
  const eng = new SimEngine(home, away, { random: mulberry32(555001) });
  return {
    home, away, simEng: eng,
    sentOff: { home: new Set(), away: new Set() },
    simModifiers: null, simulationProfile: "standard",
  };
}

// —— applyHalfTimeSwap 的行为等价复刻（必须与 match.js 实现一字不差地同步）——
function applyHalfTimeSwap(state, fromMin) {
  const eng = state.simEng;
  if (!eng) return;
  if (fromMin === 46) state._endsSwappedApplied = true;
  if (state._endsSwappedApplied) eng.endsSwapped = true;
  resyncSimAfterHalfTime(state);
}

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── ① 上半场不应换边 ─────────────────────────────────────────────
{
  const st = makeState();
  applyHalfTimeSwap(st, 1);
  record("上半场（fromMin=1）不换边", st.simEng.endsSwapped === false, `endsSwapped=${st.simEng.endsSwapped}`);
  record("上半场不写入 _endsSwappedApplied", st._endsSwappedApplied === undefined);
}

// ── ② 下半场首段必须换边 ─────────────────────────────────────────
{
  const st = makeState();
  applyHalfTimeSwap(st, 1);
  applyHalfTimeSwap(st, 46);
  record("下半场首段（fromMin=46）换边", st.simEng.endsSwapped === true, `endsSwapped=${st.simEng.endsSwapped}`);
  record("并记录 _endsSwappedApplied=true", st._endsSwappedApplied === true);
}

// ── ③ 换人触发的 resync 不能换边（最危险的一条）──────────────────
{
  const st = makeState();
  applyHalfTimeSwap(st, 1); // 只跑过上半场
  // 用户在 60 分钟换人 ⇒ _simNeedsResync 路径，fromMin=61
  st._simNeedsResync = true;
  applyHalfTimeSwap(st, 61);
  record(
    "换人触发的 resync（下半场中途）不开换边【若此前没进过 46】",
    st.simEng.endsSwapped === false,
    `endsSwapped=${st.simEng.endsSwapped}`,
  );
}

// ── ④ 换人触发的 resync 在已换边后必须保持换边 ────────────────────
{
  const st = makeState();
  applyHalfTimeSwap(st, 46); // 已换边
  const before = st.simEng.endsSwapped;
  st._simNeedsResync = true;
  applyHalfTimeSwap(st, 61); // 61 分钟换人
  record(
    "已换边后，中途换人的 resync 仍保持换边",
    before === true && st.simEng.endsSwapped === true,
    `换人前=${before} 换人后=${st.simEng.endsSwapped}`,
  );
}

// ── ⑤ 读档自愈：引擎重建后必须回灌换边 ───────────────────────────
{
  const st = makeState();
  applyHalfTimeSwap(st, 46);
  // 模拟「存档丢失引擎」：读档后 ensureSimEngine 会新建一个默认引擎
  st.simEng = new SimEngine(st.home, st.away, { random: mulberry32(555001) });
  record("读档后新引擎默认不换边（复现问题）", st.simEng.endsSwapped === false);
  // 下一段开始（可能是 61 或 76，fromMin!==46）⇒ 靠 state 字段回灌
  applyHalfTimeSwap(st, 61);
  record(
    "读档后续赛（fromMin=61）自动回灌换边",
    st.simEng.endsSwapped === true,
    `endsSwapped=${st.simEng.endsSwapped}`,
  );
}

// ── ⑥ 幂等：重复进入 46 不产生副作用 ─────────────────────────────
{
  const st = makeState();
  applyHalfTimeSwap(st, 46);
  const a = st.simEng.endsSwapped;
  applyHalfTimeSwap(st, 46);
  applyHalfTimeSwap(st, 46);
  record("重复进入 46 分钟幂等", st.simEng.endsSwapped === a === true, `三次后 endsSwapped=${st.simEng.endsSwapped}`);
}

// ── ⑦ 源码一致性：本脚本的复刻必须与 match.js 实现同步 ────────────
{
  const src = readFileSync(MATCH_JS, "utf8");
  const hasFn = /function applyHalfTimeSwap\s*\(/.test(src);
  const hasStateGate = /if\s*\(\s*fromMin\s*===\s*46\s*\)\s*state\._endsSwappedApplied\s*=\s*true/.test(src);
  const hasReplay = /if\s*\(\s*state\._endsSwappedApplied\s*\)\s*eng\.endsSwapped\s*=\s*true/.test(src);
  const callsAsync = /if\s*\(\s*fromMin\s*===\s*46\s*\|\|\s*state\._simNeedsResync\s*\)\s*\{\s*applyHalfTimeSwap\(state,\s*fromMin\)/.test(src);
  const callsSync = /if\s*\(\s*fromMin\s*>=\s*46\s*\)\s*applyHalfTimeSwap\(state,\s*fromMin\)/.test(src);
  const inWhitelist = /"_endsSwappedApplied"/.test(src);
  const noOldCall = !/resyncSimAfterHalfTime\(state\);\s*\n\s*state\._simNeedsResync/.test(src);

  record("match.js 定义 applyHalfTimeSwap", hasFn);
  record("match.js 以 fromMin===46 作为换边判据", hasStateGate);
  record("match.js 从 state 回灌引擎 endsSwapped", hasReplay);
  record("async 入口改调 applyHalfTimeSwap", callsAsync);
  record("sync 入口改调 applyHalfTimeSwap", callsSync);
  record("_endsSwappedApplied 已加入存档白名单", inWhitelist);
  record("旧的裸 resync 调用已替换（async 路径）", noOldCall);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n📊 Results: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
if (failed.length) process.exit(1);
