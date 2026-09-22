/**
 * 伤退 / 罚下者「必须离场，且不得被画在场上」—— 回归检查（2026-09-22，v288）。
 *
 * 用户原话：
 *   「观看比赛直播又发现一个新的BUG，受伤不能继续比赛的球员依然留在场上且不动，
 *     正常来说应该被替补球员换下才对吧？」
 *
 * 查证结论（三件事，缺一不可）：
 *   ① **换人本来就会发生**：`js/sim/engine.js:6796` 调 `onInjurySub`，
 *      40 模拟秒后热替换（`substituteAgent` + `_emit("sub_on")`）。
 *      只有「名额用尽 / 无合格替补」时才 `return null` —— 那时真实地少打一人。
 *   ② **「不动」是引擎设计**：`_think` 的 sentOff 分支把他钉到 `x = 1|99`
 *      （`js/sim/engine.js:2168-2172`），而 `:5903` 的 `clamp(..., 1, 99)` 保证
 *      他只能停在草皮上（实测 x ≈ 1.04）⇒ 走不到场外，就那么站着。
 *   ③ 🔴 **「还在画面上」是帧字段缺口**：直播/高光播放喂给 `applySimSnapshot` 的帧
 *      是 `compactSimFrame`，而它**没带 `sentOff`` ⇒ `js/matchview.js` 的离场同步
 *      `const off = !!s.sentOff;` 永远拿到 `undefined` ⇒
 *      **`.sent-off` 永远不会被加上** ⇒ 既不会被 `:637` 跳过坐标写入，
 *      也不会被 `drawList` 过滤 ⇒ **他被当正常球员逐帧画在场上**。
 *
 * ⇒ v288 的修法（表现层，引擎零改动）：
 *   `js/sim/adapt.js` 的 compact 帧补 `sentOff` / `injuredOff` 两个字段；
 *   并把 `scripts/match-presentation-audit.mjs` 里那条断言的**靶子读对**
 *   （它从 2026-09 起一直读 `engine.js` 的 `snapshot()`，而真正的帧生产者在 `adapt.js`
 *   —— 要求写对了、**验错了文件**，所以这个缺陷能在审计全绿的情况下长期存在）。
 *
 * 本检查守四条 —— **全部是行为级**，不是「文件里有没有那一行」：
 *   ① 真实引擎里伤退 ⇒ 该 agent 的 **compact 帧**必须带 `sentOff: true`
 *     （这正是那个缺口；补字段之前它会红）。
 *   ② 把该帧喂进 `MatchView.applySimSnapshot` ⇒ 该球员的 DOM 必须被加上 `.sent-off`，
 *     且此后**不再接收坐标写入**（位置冻结 = 用户看到的「不动」）。
 *   ③ 换上新球员时必须把 `.sent-off` / `.injured` 摘掉
 *     （否则「刚登场的人一上来就是淡出的、不可点」—— 换人复用同一个 DOM 元素）。
 *   ④ 引擎侧仍把伤退者钉在边线附近（`x ≤ 2` 或 `x ≥ 98`）—— 这是「他确实离场了」的
 *     引擎证据；若哪天改成「真的走出场外」，这一条会提醒你来更新。
 *
 * ⚠ 本链路此前**没有任何探针**（`scripts/*injur*` 零命中），所以这个缺陷
 *   在「审计全绿」的状态下存在了很久。这就是补它的理由。
 *
 * 用法：node scripts/sent-off-off-pitch-audit.mjs   （约 5~10 秒）
 */
import { readFileSync } from "node:fs";

import { MatchView } from "../js/matchview.js";
import { SimEngine } from "../js/sim/engine.js";
import { compactSimFrame } from "../js/sim/adapt.js";

const ATTR_KEYS = [
  "pace", "strength", "passing", "vision", "shooting", "finishing", "dribbling",
  "tackling", "marking", "stamina", "positioning", "reflexes", "handling", "kicking",
  "heading", "crossing", "decisions", "physical",
];

let failed = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failed += 1;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeClub(id) {
  const positions = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = positions.map((pos, i) => ({
    id: `${id}-${i}`,
    name: `${id}-${i}`,
    pos,
    number: i + 1,
    fitness: 100,
    attrs: Object.fromEntries(ATTR_KEYS.map((k) => [k, 12])),
  }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}

// ————————————————————————————————————————————————————————————
console.log("=== 伤退 / 罚下者离场检查 ===\n");

// ① 真实引擎：强制一次伤退（`_commitInjury` 是唯一置位入口），
//    并模拟「名额用尽」—— `onInjurySub` 返回 null，与 `wireSimInjuries` 的契约一致。
const eng = new SimEngine(makeClub("home"), makeClub("away"), { random: mulberry32(4242) });
eng.onInjurySub = () => null; // 无名额 / 无人可换 ⇒ 真实地少打一人
const victim = eng.agents.find((a) => a.team === "home" && a.role !== "GK");
victim.fitness = 20;
check(eng._commitInjury(victim, "audit") === true, "引擎接受了这次伤退（`_commitInjury` 返回 true）");
check(victim.injuredOff === true && victim.sentOff === true,
  "伤退者同时被标 `injuredOff` 与 `sentOff`（复用罚下减员，退出一切决策/摆位池）",
  `injuredOff=${victim.injuredOff} sentOff=${victim.sentOff}`);

// 跑一段，让引擎把他送到边线并停住
for (let i = 0; i < 600; i += 1) eng.step(0.1);
const frame = compactSimFrame(eng);
const framePlayer = frame.players.find((p) => p.id === victim.id);
check(!!framePlayer, "该球员仍在帧里（不删实体，只标离场）");
check(framePlayer?.sentOff === true,
  "🔴 compact 帧必须带 `sentOff: true`（缺它就是「被画在场上」的根因）",
  `sentOff=${JSON.stringify(framePlayer?.sentOff)}`);
check(framePlayer?.injuredOff === true, "compact 帧同时带 `injuredOff`（供将来区分伤退/红牌）",
  `injuredOff=${JSON.stringify(framePlayer?.injuredOff)}`);
const pinned = victim.x <= 2 || victim.x >= 98;
check(pinned, "引擎把伤退者钉在边线附近（x ≤ 2 或 ≥ 98）——「他已经离场了」的引擎证据",
  `x=${victim.x.toFixed(2)} y=${victim.y.toFixed(2)}`);

// ② 表现层：把该帧喂进 MatchView，DOM 必须立刻被标离场，且不再收坐标写入
const view = new MatchView(null);
view._built = true;
view.fsm.transition("PRE_MATCH");
view.players = frame.players.map((p) => {
  const classes = new Set();
  return {
    ...p,
    pos: p.role,
    el: {
      classList: {
        contains: (n) => classes.has(n),
        add: (...ns) => ns.forEach((n) => classes.add(n)),
        remove: (...ns) => ns.forEach((n) => classes.delete(n)),
        toggle: (n, on) => (on ? classes.add(n) : classes.delete(n)),
      },
      get _classes() { return classes; },
    },
  };
});
view.officials = {
  referee: { x: 42, y: 50 },
  assistantA: { x: 3, y: 32 },
  assistantB: { x: 97, y: 68 },
};
for (const m of ["_applyPlayer", "_applyBall", "_applyOfficials", "_updatePossessionChrome", "_setTouch"]) {
  view[m] = () => {};
}
view.bursts = [];

const shown = view.players.find((p) => p.id === victim.id);
const before = { x: shown.x, y: shown.y };
view.applySimSnapshot(frame);
check(shown.el._classes.has("sent-off"),
  "🔴 该球员的 DOM 必须被加上 `.sent-off`（离场同步的边沿触发）",
  JSON.stringify([...shown.el._classes]));

// 再喂几帧目标位已变的帧：离场者**不得**接收坐标写入（= 用户看到的「不动」）
for (let k = 1; k <= 3; k += 1) {
  const moved = {
    ...frame,
    t: frame.t + k * 0.1,
    players: frame.players.map((p) => (p.id === victim.id ? { ...p, x: 40 + k, y: 40 + k } : p)),
  };
  view.applySimSnapshot(moved);
}
check(shown.x === before.x && shown.y === before.y,
  "离场者不再接收坐标写入（位置冻结在离场那一刻）",
  `(${before.x.toFixed(1)},${before.y.toFixed(1)}) → (${shown.x.toFixed(1)},${shown.y.toFixed(1)})`);

// `tx` 在离场分支里**根本不会被写**（`:637` 的 `continue` 在 `pl.tx = pl.x` 之前）——
// 所以「没被推着走」的表现是 `undefined` 或仍等于 `x`，两种都算通过。
check(shown.tx === undefined || shown.tx === shown.x,
  "离场者不再被推新的目标位 tx（`continue` 在写 tx 之前）", `tx=${JSON.stringify(shown.tx)}`);

// ③ 换人复用同一个 DOM 元素 ⇒ 必须把离场标记摘掉
//    （否则「刚换上来的人一登场就是淡出的、不可点、还不被画到画布上」）
//
// ⚠ 必须照**产品的真实顺序**驱动：`applySubOnPitch`（`js/matchview.js:2217`）先
//   `classList.remove("sent-off","injured")`（`:2235`）**再**把 `pl.id` 换成新球员
//   （`:2237`）。换完之后下一帧的快照同步按**新 id** 查到 `sentOff === false`，
//   就再也不会把标记加回来 —— 那就是第二道保险。
//   我第一版的测法是「id 不变、只把 sentOff 改成 false」，那对应不到任何真实路径
//   （引擎里换人就是换 id），会误报。
shown.el._classes.delete("sent-off"); // 模拟 `applySubOnPitch:2235`
shown.el._classes.delete("injured");
shown.id = "home-sub"; // 模拟 `applySubOnPitch:2237` 的身份替换
const replacement = {
  ...frame,
  t: frame.t + 1,
  players: frame.players.map((p) =>
    p.id === victim.id
      ? { ...p, id: "home-sub", sentOff: false, injuredOff: false, x: 50, y: 50 }
      : p
  ),
};
view.applySimSnapshot(replacement);
check(!shown.el._classes.has("sent-off") && !shown.el._classes.has("injured"),
  "换上来的球员继承了同一个 DOM 元素，且离场标记不会被加回来（第二道保险生效）",
  JSON.stringify([...shown.el._classes]));
check(shown.x === 50 && shown.y === 50, "替补登场后坐标恢复正常写入", `(${shown.x},${shown.y})`);

// ④ 静态：帧生产者与离场同步两头都在（防「只改一边」）
const adaptSrc = readFileSync(new URL("../js/sim/adapt.js", import.meta.url), "utf8");
const viewSrc = readFileSync(new URL("../js/matchview.js", import.meta.url), "utf8");
const auditSrc = readFileSync(new URL("./match-presentation-audit.mjs", import.meta.url), "utf8");
check(/sentOff: !!a\.sentOff/.test(adaptSrc), "帧生产者（`adapt.js` 的 compactSimFrame）带 sentOff");
check(/const off = !!s\.sentOff;/.test(viewSrc), "表现层仍按 `s.sentOff` 边沿同步 `.sent-off`");
check(/adaptSource\.includes\("sentOff: !!a\.sentOff"\)/.test(auditSrc),
  "`match-presentation-audit` 的断言靶子已指向 `adapt.js`（别再读回 engine.js）");

// ————————————————————————————————————————————————————————————
console.log(
  `\n${failed === 0 ? "sent-off-off-pitch-audit: ok" : `sent-off-off-pitch-audit: FAILED (${failed})`}`
);
process.exitCode = failed === 0 ? 0 : 1;
