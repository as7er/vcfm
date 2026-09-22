import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  interpolateSimBall,
  nextDisplayedMinute,
  simMinuteOf,
  PENALTY_SETUP_SEC,
  eventTickerMs,
} from "../js/match-presentation.js";
import { SimEngine, SIM } from "../js/sim/engine.js";

assert.equal(nextDisplayedMinute(39, 38), 39, "late events must not move the match clock backwards");
assert.equal(nextDisplayedMinute(39, 40), 40, "newer timeline frames must advance the clock");
assert.equal(nextDisplayedMinute(90, 0, { reset: true }), 0, "a new match must explicitly reset the clock");

// —— 传球插值不能在出脚/接球帧中途把球吸回球员脚下 ——
const kickedBall = interpolateSimBall(
  { x: 10, y: 20, z: 0, owner: "passer", state: "held" },
  { x: 20, y: 30, z: 0.2, owner: null, state: "pass" },
  0.25
);
assert.deepEqual(
  { x: kickedBall.x, y: kickedBall.y, owner: kickedBall.owner, state: kickedBall.state },
  { x: 12.5, y: 22.5, owner: null, state: "pass" },
  "a kicked ball must follow the physical line instead of staying attached to the passer"
);
const arrivingBall = interpolateSimBall(
  { x: 40, y: 50, z: 0, owner: null, state: "pass" },
  { x: 50, y: 60, z: 0, owner: "receiver", state: "held" },
  0.75
);
assert.deepEqual(
  { x: arrivingBall.x, y: arrivingBall.y, owner: arrivingBall.owner, state: arrivingBall.state },
  { x: 47.5, y: 57.5, owner: null, state: "pass" },
  "a pass must reach its receiving frame before the display attaches it to the receiver"
);
assert.equal(
  interpolateSimBall(
    { x: 40, y: 50, owner: null, state: "pass" },
    { x: 50, y: 60, owner: "receiver", state: "held" },
    1
  ).owner,
  "receiver",
  "the receiver must own the ball at the recorded receiving frame"
);

// 引擎无遮挡地滚球只允许沿同一方向受摩擦减速；表现层修复不能掩盖真实物理折向。
const passEngine = new SimEngine(makeClub("pass-home"), makeClub("pass-away"), {
  random: () => 0.5,
});
const passer = passEngine.agents.find((player) => player.team === "home" && player.role !== "GK");
const receiver = passEngine.agents.find(
  (player) => player.team === "home" && player.role !== "GK" && player.id !== passer.id
);
passer.x = 20;
passer.y = 45;
receiver.x = 36;
receiver.y = 55;
for (const opponent of passEngine.agents.filter((player) => player.team === "away")) {
  opponent.x = 85;
  opponent.y = 85;
}
passEngine.ball.x = passer.x;
passEngine.ball.y = passer.y;
passEngine.ball.owner = passer.id;
passEngine.ball.state = "held";
passEngine._pass(passer, { agent: receiver, tx: receiver.x, ty: receiver.y });
const passOrigin = { x: passEngine.ball.x, y: passEngine.ball.y };
const passDirection = {
  x: passEngine.ball.vx,
  y: passEngine.ball.vy,
};
const passDirectionLength = Math.hypot(passDirection.x, passDirection.y);
for (let step = 0; step < 6 && passEngine.ball.state === "pass"; step++) {
  passEngine._stepBall(SIM.DT);
  const traveled = {
    x: passEngine.ball.x - passOrigin.x,
    y: passEngine.ball.y - passOrigin.y,
  };
  const cross = traveled.x * passDirection.y - traveled.y * passDirection.x;
  assert.ok(
    Math.abs(cross) / passDirectionLength < 1e-9,
    "an unobstructed pass must remain collinear while friction slows it"
  );
}

const mainSource = readFileSync(new URL("../js/main.js", import.meta.url), "utf8");
assert.ok(
  mainSource.includes("nextDisplayedMinute(displayedMatchMinute, min, { reset })"),
  "the live HUD must use the monotonic minute helper"
);
assert.ok(
  mainSource.includes("setMatchMinute(0, { reset: true })"),
  "new matches must reset the monotonic clock"
);

// —— 分钟换算必须全项目唯一：进球、事件文案与顶栏不能对同一时刻各说一套 ——
assert.equal(simMinuteOf(0), 1, "the match starts in the 1st minute");
assert.equal(simMinuteOf(0.5), 1, "the first second belongs to the 1st minute");
assert.equal(simMinuteOf(59.9), 1, "0-59s is the 1st minute");
assert.equal(simMinuteOf(60), 2, "60s starts the 2nd minute");
assert.equal(simMinuteOf(2340), 40, "39:00 into the match is the 40th minute");
assert.equal(simMinuteOf(2699.9), 45, "the first half ends in the 45th minute");
assert.equal(simMinuteOf(5400), 90, "full time stays inside 90 minutes");
assert.equal(simMinuteOf(9999), 90, "extra time must not overflow the clock");
for (const t of [0.4, 12, 60, 61, 119, 120, 2340, 2360, 2400, 2401, 5399]) {
  const viaHelper = simMinuteOf(t);
  // 引擎的进球分钟与表现层顶栏必须落在同一分钟，否则会出现
  // "顶栏已到 40′才回放 39′点球"这类因果错乱。
  assert.equal(
    viaHelper,
    Math.max(1, Math.min(90, Math.floor(t / 60) + 1)),
    `minute conversion drifted at t=${t}`
  );
  assert.ok(viaHelper >= 1 && viaHelper <= 90, `minute out of range at t=${t}`);
}
const engineSource = readFileSync(new URL("../js/sim/engine.js", import.meta.url), "utf8");
const adaptSource = readFileSync(new URL("../js/sim/adapt.js", import.meta.url), "utf8");
const viewSource = readFileSync(new URL("../js/matchview.js", import.meta.url), "utf8");
assert.ok(
  engineSource.includes("minute: simMinuteOf(goal.t)"),
  "goal minutes must use the shared conversion"
);
assert.ok(
  !/Math\.round\(\(tSec \/ \(90 \* 60\)\) \* 90\)/.test(adaptSource),
  "flavor events must not round simulation time into a different minute"
);
assert.ok(
  !/Math\.ceil\(sp\.simT \/ 60\)/.test(viewSource),
  "the live clock must not ceil simulation time into the next minute"
);
assert.ok(
  viewSource.includes("simMinuteOf(sp.simT)"),
  "the playback clock must use the shared conversion"
);
assert.ok(
  viewSource.includes("const ball = interpolateSimBall(fa.ball, fb.ball, t)"),
  "the match view must use causal ball interpolation"
);
assert.ok(
  viewSource.includes("trailPhase !== this._simBallTrailPhase"),
  "ball trails must reset between possession and flight phases"
);

// —— 离场者（红牌/伤退）必须由**每帧快照**同步到 DOM class，而非只靠一次性事件 ——
//
// 背景（用户报告：「有个球员比赛开始没多久后就一直站在场边不动」）：
// 引擎 `_think` 的 sentOff 分支会让该球员走向本方底线并停住——这是设计行为。
// 表现层有两条路把它表达成「离场」：
//   (a) `case "red"` 事件分支里的 `classList.add("sent-off")` —— **一次性**；
//   (b) `applySimSnapshot` 每帧按 compact frame 的 `sentOff` 同步 class —— **自愈**。
// 画布绘制（`drawList`）与几十处选人逻辑全读 `el.classList`。只留 (a) 时，
// 任何一个没被这一层消费到的红牌事件（跳段/快进/事件重放/players 刚重建过）
// 都会让 class 永远补不上，该球员此后**一直画在场上**并参与选人。
//
// 这条断言锁死 (b) 的存在，避免它被当成冗余代码删掉而回归。
assert.ok(
  viewSource.includes('pl.el.classList.toggle("sent-off", off)'),
  "applySimSnapshot must sync the sent-off class from every snapshot frame"
);
assert.ok(
  /if \(off !== pl\.el\.classList\.contains\("sent-off"\)\)/.test(viewSource),
  "the sent-off sync must be edge-triggered (write DOM only on state change)"
);
// ⚠ 靶子必须是**帧生产者** `js/sim/adapt.js` 的 `compactSimFrame`，不是 `engine.js`。
//   直播/高光播放喂给 `applySimSnapshot` 的就是 compact 帧（事件快照走 `sim: null`），
//   而 `engine.js` 里那处 `sentOff: !!a.sentOff` 属于 `snapshot()`，是**另一条**路径。
//   本断言 2026-09-22 之前一直读 `engineSource` ⇒ 要求写对了、**验错了文件**，
//   于是「伤退/罚下者被画在场上且不动」这个真实缺陷在审计全绿的情况下存在了很久。
assert.ok(
  adaptSource.includes("sentOff: !!a.sentOff"),
  "compact frames must carry sentOff for the snapshot sync to read"
);
// 换人是**身份替换 + 复用同一个 DOM 元素**（`applySubOnPitch` 只改 `pl.id` 等字段，
// 不新建元素）。被换下的若是罚下/伤退者，他的离场标记会被新上场的球员**继承** ——
// 表现为「刚换上来的人一登场就是淡出的、不可点、还不被画到画布上」。
assert.ok(
  /pl\.el\.classList\.remove\("sent-off",\s*"injured"\)/.test(viewSource),
  "applySubOnPitch must clear the off-pitch markers off the reused DOM element"
);

// —— 事件文案必须持续到下一个因果事件，不能在球还没踢出时就被顶掉 ——
assert.equal(
  PENALTY_SETUP_SEC,
  SIM.PENALTY_KICK_SEC,
  "the presentation layer must read the engine's own penalty run-up length"
);
assert.ok(
  eventTickerMs("penalty", 1) >= SIM.PENALTY_KICK_SEC * 1000,
  "the penalty caption must stay up until the kick is actually taken"
);
assert.ok(
  eventTickerMs("penalty", 1) > eventTickerMs("save", 1),
  "the award caption must outlast a plain save caption"
);
// 倍速会同时压缩画面与文案，两者必须同比缩放才不会错位。
assert.ok(
  Math.abs(eventTickerMs("penalty", 1.5) - eventTickerMs("penalty", 1) / 1.5) <= 1,
  "captions must scale with playback speed so they track the pictures"
);
assert.ok(
  mainSource.includes('penalty: PENALTY_SETUP_SEC * 1000'),
  "the timeline must hold on a penalty award until the kick"
);
assert.ok(
  mainSource.includes('eventTickerMs(ev.type, spd)'),
  "generic captions must derive their duration from the shared helper"
);

// —— 空间帧驱动时不得再叠加摆拍：真实站位已在帧里，二次改写就是瞬移 ——
assert.ok(
  /_stageCornerSetPiece\([^)]*\)\s*\{[\s\S]{0,400}?if \(this\.simDrive\)[\s\S]{0,200}?_showCornerChrome\(\);[\s\S]{0,80}?return;/.test(
    viewSource
  ),
  "corner staging must defer to real simulation frames"
);
assert.ok(
  viewSource.includes("_showCornerChrome("),
  "corner chrome must be reusable without moving players"
);
// 碰撞分离的位移权重必须落在对手身上：门将权重低就该少动。
// 早先两处求解器把权重取反，门将反而被推离门线，前锋与门将占同一坐标。
assert.ok(
  !/a\.x = clamp\(a\.x - ux \* push \* \(bw \/ den\)/.test(viewSource),
  "visual unstack must not push the low-weight player further"
);
assert.ok(
  !/a\.x = clamp\(a\.x - ux \* push \* \(bw \/ den\)/.test(engineSource),
  "engine separation must not push the low-weight player further"
);

// —— 直播统计必须按画面时刻切片，而不是提前展示整段模拟的最终值 ——
assert.ok(
  mainSource.includes("function liveStatsThrough(simT, minute)"),
  "the live HUD must derive stats as of the displayed moment"
);
assert.ok(
  mainSource.includes("refreshLiveHudFromState(minute, t)"),
  "the highlight timeline must pass its simulation time to the HUD"
);
assert.ok(
  mainSource.includes("refreshLiveHudFromState(seg.toMin, seg.t1)"),
  "skipped segments must advance stats to the segment end, not the half total"
);

function makeClub(name) {
  const positions = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = positions.map((pos, index) => ({
    id: `${name}-${index}`,
    name: `${name} ${index}`,
    pos,
    number: index + 1,
    fitness: 100,
    attrs: Object.fromEntries(
      [
        "pace",
        "strength",
        "passing",
        "vision",
        "shooting",
        "finishing",
        "dribbling",
        "tackling",
        "marking",
        "stamina",
        "positioning",
        "reflexes",
        "handling",
        "kicking",
      ].map((key) => [key, 12])
    ),
  }));
  return {
    id: name,
    name,
    players,
    tactics: { formation: "4-3-3", lineup: players.map((player) => player.id) },
  };
}

let seed = 987654321;
const engine = new SimEngine(makeClub("stats-home"), makeClub("stats-away"), {
  random: () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff),
});
while (engine.t < 45 * 60) engine.step();

const early = engine.statsThrough(5 * 60);
const mid = engine.statsThrough(23 * 60);
const half = engine.statsThrough(45 * 60);
const fullHalf = engine.directResult({ tMin: 0, tMax: 45 * 60 });

assert.ok(
  early.shots.home + early.shots.away < half.shots.home + half.shots.away,
  "shot counts must still be growing at 5' instead of showing the half total"
);
assert.ok(
  mid.shots.home + mid.shots.away <= half.shots.home + half.shots.away,
  "stats through a moment must never exceed the half total"
);
assert.ok(early.xg.home <= mid.xg.home && mid.xg.home <= half.xg.home, "xG must accumulate monotonically");
assert.equal(half.shots.home, fullHalf.shots.home, "stats through full time must match the half result");
assert.equal(half.shots.away, fullHalf.shots.away, "stats through full time must match the half result");

const possEarly = engine.possessionAt(5 * 60);
const possHalf = engine.possessionAt(45 * 60);
assert.ok(
  possEarly.home + possEarly.away < possHalf.home + possHalf.away,
  "possession seconds must accrue over the half, not arrive complete"
);
assert.ok(
  Math.abs(possEarly.home + possEarly.away - 5 * 60) < 45,
  "possession through 5' must roughly cover only the first five minutes"
);

console.log(
  "Match presentation audit passed: live minutes are monotonic and stats follow the displayed moment"
);
