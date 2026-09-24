/**
 * 界外球可见性审计（2026-09-22）
 *
 * 用户报「观看比赛里从没见过界外球」。查证结论：引擎侧那条判定不可达（另一个分支在修），
 * 而 **UI 侧是「零消费者」** —— 即使引擎发了 `throwin`，玩家也永远看不到。三个缺口：
 *   ① `js/sim/adapt.js` 的 `buildHighlightWindows` 只认 goal/save/shot/corner/kickoff
 *      ⇒ 界外球落进 skip 段（`advanceCuesTo(t, { show:false })` 连解说都不播）；
 *   ② `js/sim/adapt.js` 的 `pickFlavorEvents` 白名单 `caps` 里没有 throwin ⇒ 直接丢弃；
 *   ③ `js/sim/adapt.js` 的 `defaultFlavorText` 没有 `case "throwin"` ⇒ 落到 `default`
 *      分支显示「45' 球队名」这种垃圾文案（隐藏的雷）。
 * 另有第四处（本审计也覆盖）：`liveInterestOfEvent` 不认 throwin ⇒ 落点附近**一帧都不录**，
 * 于是即使 ① 选中了它，`buildHighlightSegments` 的 `if (fr.length >= 2)` 也会把整段丢掉。
 *
 * 本审计**不做静态断言**，全部走真实函数：
 *   ① 纯函数：合成事件喂 `buildHighlightWindows`（含上限 / 去重 / 预算四条）；
 *   ② 纯函数：`defaultFlavorText` 的返回值不许是 `default:` 那种「分钟 + 队名」形态；
 *   ③ 真实引擎：`runSimPeriodRaw(eng, 1, 45, { record:true, adaptive:true })` 跑一个半场，
 *      用 `eng._emit` **中途**注入 `throwin`（引擎当前产生不出界外球，见 AGENTS.md 交接），
 *      再走 `buildHighlightWindows` + `buildHighlightSegments`，断言切得出 `kind === "play"`
 *      且 `frames.length >= 2` 的段；③a 另用 8 条注入钉死风味上限 `caps.throwin = 4`。
 *   ④ 变异测试 5 条：三处缺口 + `liveInterestOfEvent` 漏接线 + 上限 2，各自撤掉一次
 *      （在 `js/` 的临时副本上改，绝不写仓库内的文件），用子进程跑对应检查，断言**会红**；
 *      跑完比对 sha256 证明仓库文件逐字节未动。
 *
 * ⚠ 复现性（AGENTS.md 铁律）：`createWorld` 会 `_id++`，**同一个进程里建两次世界 id 不同**
 *   ⇒ 比赛种子（`hashSeed(fixture.id, …)`）不同 ⇒ 读数不可比。因此这里**只建一次世界**，
 *   每次跑 `structuredClone`，并跑两遍取指纹比对（同进程内的强证据）。
 *   ⚠ 跨进程世界仍可能不同（`js/staff.js:108` 用 `Date.now()` 生成 id）⇒ 断言只依赖结构，
 *     不依赖任何具体读数（读数会打印出来供人看）。
 * ⚠ 注入是「中途 `_emit`」而不是「跑完再 push」：只有前者才会经过
 *   `liveInterestOfEvent` 的密采判定 —— 也就是缺的那第四处。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ADAPT_PATH = join(ROOT, "js", "sim", "adapt.js");
const SCRIPT_PATH = fileURLToPath(import.meta.url);
/** 变异测试用：整套 `js/` 从别处解析（engine / adapt / match 必须同源） */
const JS_ROOT_URL = process.env.THROWIN_AUDIT_JS_ROOT || new URL("../js/", import.meta.url).href;
const ONLY = (process.env.THROWIN_AUDIT_ONLY || "").trim();
const jsUrl = (rel) => new URL(rel, JS_ROOT_URL).href;

const {
  buildHighlightSegments,
  buildHighlightWindows,
  defaultFlavorText,
  ensureSimEngine,
  runSimPeriodRaw,
} = await import(jsUrl("sim/adapt.js"));
const { CLUB_TEMPLATES } = await import(jsUrl("data.js"));
const { createMatchSession } = await import(jsUrl("match.js"));
const { createWorld } = await import(jsUrl("models.js"));
const { ensureWorldStaff } = await import(jsUrl("staff.js"));

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const HASH_BEFORE = sha256(readFileSync(ADAPT_PATH));
const say = (label, value) => console.log(`  ${label} ${value}`);

/* ─────────────────────────── 检查 ①：高光窗选材（纯函数） ─────────────────────────── */

const HALF = { tStart: 0, tEnd: 2700 };
const tw = (t) => ({ type: "throwin", team: "home", agentId: "h_m0", t, x: 1, y: 50, setPiece: "throwin" });
const build = (rawEvents, scaledGoals = []) =>
  buildHighlightWindows({ ...HALF, rawEvents, scaledGoals });
const throwinWins = (res) => res.windows.filter((w) => w.label === "throwin");

function checkWindows() {
  // (a) 单条
  const a = build([tw(400)]);
  const aW = throwinWins(a);
  assert.equal(aW.length, 1, "(a) 单条界外球必须切出一个高光窗");
  assert.equal(aW[0].t0, 400, "(a) 窗起点 = 事件帧（不把规则层瞬时重排播给观众）");
  assert.equal(aW[0].t1, 408, "(a) 窗长必须覆盖「摆位 + 抛出 + 争抢」8s");
  assert.equal(aW[0].priority, 20, "(a) 优先级必须低于角球 42、高于开球 10");
  assert.equal(aW[0].at, 400, "(a) `at` 必须是事件时刻（导演镜头/慢镜对齐）");
  say("(a) 单条 →", JSON.stringify(aW.map((w) => `${w.t0}-${w.t1}@p${w.priority}`)));

  // (b) 上限：10 条、间隔 80s（> 70s 去重间隔）⇒ 恰好 2 个（上限拦住的，不是去重拦的）
  const rawB = [];
  for (let i = 0; i < 10; i++) rawB.push(tw(100 + i * 80));
  const b = build(rawB, [{ t: 1500, team: "away", scorerId: "a_f0" }]);
  const bW = throwinWins(b);
  assert.equal(bW.length, 2, "(b) 半场最多 2 个界外球窗（喂 10 条也一样）");
  assert.deepEqual(bW.map((w) => w.at), [100, 180], "(b) 必须按 t 升序取最早两条");
  assert.ok(b.windows.some((w) => w.label === "goal"), "(b) 进球窗必须仍然在");
  say("(b) 10 条/80s →", JSON.stringify(b.windows.map((w) => w.label)));

  // (c) 与既有窗打架时必须让位（farFromExisting 20，与角球同量级的 22）
  const c = build([tw(600), tw(598), tw(602)], [{ t: 600, team: "away", scorerId: "a_f0" }]);
  assert.equal(throwinWins(c).length, 0, "(c) 撞进球窗的界外球必须被 `farFromExisting(20)` 拒掉");
  assert.ok(c.windows.some((w) => w.label === "goal"), "(c) 被拒的只能是界外球");
  say("(c) 撞进球窗 →", JSON.stringify(c.windows.map((w) => w.label)));

  // (d) 受半场预算 MAX_PLAY=150 约束（**不**进 `goal/kickoff` 豁免名单）
  const squeeze = (corners) => {
    const raw = [
      { type: "save", team: "home", t: 200, hold: true },
      { type: "save", team: "away", t: 400, hold: false },
      { type: "save", team: "home", t: 800, hold: true },
      { type: "shot", team: "home", t: 1000, distance: 10 },
      { type: "shot", team: "away", t: 1400, distance: 22 },
      tw(2200),
    ];
    for (const t of corners) raw.push({ type: "corner", team: "home", t, x: 2, y: 96 });
    return build(raw, [{ t: 600, team: "away", scorerId: "a_f0" }]);
  };
  const d3 = squeeze([1600, 1800, 2000]);
  const d2 = squeeze([1600, 1800]);
  assert.equal(throwinWins(d3).length, 0, "(d) 预算用满（145s）时界外球窗必须被挤掉");
  assert.equal(throwinWins(d2).length, 1, "(d) 让出 12s 预算后同一个界外球窗必须回来");
  say("(d) 预算 145/150 →", `${throwinWins(d3).length} 个；预算 133/150 → ${throwinWins(d2).length} 个`);

  console.log("检查 ① 高光窗选材：passed");
}

/* ─────────────────────────── 检查 ②：风味文案（纯函数） ─────────────────────────── */

function checkText() {
  const state = {
    home: { short: "河畔", name: "河畔竞技" },
    away: { short: "松林", name: "松林" },
  };
  const def = (minute, short) => `${minute}' ${short}`;
  for (const [team, minute, short] of [
    ["home", 45, "河畔"],
    ["away", 7, "松林"],
  ]) {
    const text = defaultFlavorText(state, { type: "throwin", minute, team, agentId: "h_m0" });
    assert.ok(/界外|throw/i.test(text), `(②) 文案必须自证是界外球，实得 ${JSON.stringify(text)}`);
    assert.notEqual(
      text,
      def(minute, short),
      "(②) 不许落到 `default:` 的「分钟 + 队名」形态（45' 球队名这种垃圾文案）"
    );
    assert.ok(text.includes(`${minute}'`), "(②) 文案要带分钟");
    assert.ok(text.includes(short), "(②) 文案要带队名简称");
    say(`(②) ${team} ${minute}' →`, JSON.stringify(text));
  }
  console.log("检查 ② 风味文案：passed");
}

/* ─────────────────────────── 检查 ③a：风味白名单 + 上限（真实引擎） ─────────────────────────── */

/** 确定性 PRNG（与 `scripts/_restart-snap-census.mjs` 同源） */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = 0x5f3a71c9;

/** ⚠ 世界只建一次：`createWorld` 里的 `_id++` 会让第二次建出来的 id 不同 ⇒ 种子不同 */
Math.random = makeRng(SEED);
const SOURCE_WORLD = (() => {
  const club = CLUB_TEMPLATES.find((c) => c.division === 3);
  const world = createWorld(club.id, "Throwin Visibility Audit");
  ensureWorldStaff(world);
  return world;
})();
const FIXTURE_ID = (() => {
  const fx = SOURCE_WORLD.fixtures.find(
    (f) => f.home === SOURCE_WORLD.userClubId || f.away === SOURCE_WORLD.userClubId
  );
  return fx.id;
})();

/**
 * 跑一个时段；`inject` 非空时在 `eng.step` 的每一步之后把到点的 throwin 事件
 * 用引擎自己的 `_emit` 发出去（引擎当前产生不出界外球，所以由审计代发）。
 */
function runPeriod({ fromMin, toMin, inject = null, record = true, profile = null }) {
  Math.random = makeRng(SEED);
  const world = structuredClone(SOURCE_WORLD);
  const fixture = world.fixtures.find((f) => f.id === FIXTURE_ID);
  const state = createMatchSession(world, fixture);
  if (profile) state.simulationProfile = profile;
  const eng = ensureSimEngine(state);
  const made = [];
  if (inject?.length) {
    const origStep = eng.step.bind(eng);
    const queue = inject.slice().sort((x, y) => x - y);
    const taker = eng.agents.find((a) => a.team === "home") || { id: "audit_throwin", team: "home" };
    eng.step = (dt) => {
      origStep(dt);
      while (queue.length && eng.t >= queue[0]) {
        queue.shift();
        eng._emit(
          "throwin",
          { id: taker.id, team: "home", x: 1, y: 50 },
          { x: 1, y: 50, setPiece: "throwin" }
        );
        made.push({ t: eng.t, team: "home", agentId: taker.id });
      }
    };
  }
  const period = runSimPeriodRaw(eng, fromMin, toMin, { record, adaptive: record });
  const raw = (eng.events || []).filter((e) => e.t > period.tStart && e.t <= period.tEnd);
  return { period, eng, raw, made };
}

function checkFlavorCap() {
  // 注入 8 条（> caps.throwin = 4），只关心风味列表 —— 用 background 档省时间，
  // 风味白名单与档位无关（`pickFlavorEvents(raw, fromMin, toMin)` 只读事件流）。
  const inject = [];
  for (let i = 0; i < 8; i++) inject.push(300 + i * 120);
  const { period, raw } = runPeriod({ fromMin: 1, toMin: 45, inject, record: false, profile: "background" });
  const injected = raw.filter((e) => e.type === "throwin");
  assert.ok(injected.length >= 8, `(③a) 注入的 8 条 throwin 必须都进了事件流，实得 ${injected.length}`);
  const flavor = period.flavor.filter((f) => f.type === "throwin");
  assert.equal(flavor.length, 4, "(③a) `caps.throwin = 4`：8 条必须恰好采 4 条");
  assert.ok(
    flavor.every((f) => (f.team === "home" || f.team === "away") && f.minute >= 1 && f.minute <= 45),
    "(③a) 风味条目必须带合法 team/minute（`pushSimFlavor` 要读它们）"
  );
  assert.ok(
    period.flavor.some((f) => f.type !== "throwin"),
    "(③a) 别的事件类型必须不受影响"
  );
  say("(③a) 注入 8 条 → 风味", `${period.flavor.length} 条，其中 throwin ${flavor.length} 条`);
  console.log("检查 ③a 风味白名单 + 上限：passed");
}

/* ─────────────────────────── 检查 ③b：真实引擎端到端一条链 ─────────────────────────── */

/** 页面外可复现指纹：事件流 + 帧数 + 比分（同世界同种子必须逐位相同） */
/**
 * 每个界外球 play 段都必须：① ≥2 帧（否则 `buildHighlightSegments` 静默丢弃整段）
 * ② 帧连续覆盖到 trail（说明密采窗真的为界外球打开，而不是借了别人的帧）。
 */
function checkPlayFrames(segList, label) {
  for (const s of segList) {
    assert.ok(
      s.frames.length >= 2,
      `(③b) ${label}：play 段必须 ≥2 帧，实得 ${s.frames.length}`
    );
    const last = s.frames[s.frames.length - 1].t ?? 0;
    assert.ok(
      last >= s.t0 + 5,
      `(③b) ${label}：帧必须连续覆盖到 trail，末帧 ${last.toFixed(1)} vs t0 ${s.t0.toFixed(1)}`
    );
  }
}

const fingerprint = (r) =>
  [
    r.raw.map((e) => `${e.type}:${e.team}:${e.t.toFixed(2)}`).join("|"),
    r.period.frames.length,
    `${r.period.scaled.score.home}-${r.period.scaled.score.away}`,
  ].join("‖");

function checkEngine() {
  // ① 侦察跑：真实事件流 + 高光窗几何（决定「安静时刻」）
  const A1 = runPeriod({ fromMin: 1, toMin: 45 });
  // ② 复现性自检（AGENTS.md 铁律）：同世界同种子重跑必须逐位相同
  const A2 = runPeriod({ fromMin: 1, toMin: 45 });
  assert.equal(fingerprint(A2), fingerprint(A1), "(③b) 同种子重跑必须逐位相同（否则读数不可比）");
  say("(③b) 复现性", `事件 ${A1.raw.length} 条 / 帧 ${A1.period.frames.length}（两跑一致）`);

  // ③ 选注入时刻。判据必须**可证**，不能靠「看起来够远」——实测踩过两个坑：
  //   坑 1：按「与最终高光窗 ≥20s」选点 ⇒ 被 `MAX_PLAY` 预算挤掉的窗**看不见**，
  //        可它在 `buildHighlightWindows` 的循环里照样把界外球窗挤掉了（实得 0 个窗）；
  //   坑 2：注入点彼此正好 70s ⇒ `eng.t` 的浮点误差让差值落到 69.99，被 70s 去重拒掉。
  //   所以改成对**所有会产生窗的事件**留出足够余量（与预算无关的上界）：
  //     窗类型  事件→窗的 lead/trail  加上 `farFromExisting(20)` ⇒ 半宽上界 34s
  //       goal 8(有助攻 10)/6 · save 12/7 · shot 14/5 · corner 0/12 · kickoff 0/14
  //     ⇒ 要求 |t - e.t| ≥ 34 对全部上述事件成立，界外球窗就**一定**被收下；
  //   另有 `injury` / `sub_on`：有 `LIVE_DENSE` 密采窗但**不产生高光窗**（没有护栏），
  //   单独要求 ≥25s —— 合起来 ⇒ 注入点周边的帧**只可能**来自界外球自己的密采窗
  //   （这正是「漏接线」那条缺口的判据）。
  const WINDOW_TYPES = ["goal", "save", "shot", "corner", "kickoff"];
  const NO_WINDOW_DENSE = ["injury", "sub_on"];
  const blocked = A1.raw.filter((e) => WINDOW_TYPES.includes(e.type)).map((e) => e.t);
  const lonely = A1.raw.filter((e) => NO_WINDOW_DENSE.includes(e.type)).map((e) => e.t);
  const picks = [];
  for (let t = 60; t <= A1.period.tEnd - 20; t += 5) {
    if (!blocked.every((d) => Math.abs(d - t) >= 34)) continue;
    if (!lonely.every((d) => Math.abs(d - t) >= 25)) continue;
    // 注入点彼此 ≥80s：70s 去重间隔之上再留 10s 浮点余量（坑 2）
    if (picks.every((p) => Math.abs(p - t) >= 80)) picks.push(t);
  }
  assert.ok(picks.length >= 4, `(③b) 安静时刻不足（只有 ${picks.length} 个）⇒ 判据失效`);
  const use = picks.slice(0, 4);
  say("(③b) 安静时刻", `${picks.length} 个，注入用 ${JSON.stringify(use)}`);

  // ④ 带注入重跑
  const B = runPeriod({ fromMin: 1, toMin: 45, inject: use });
  assert.equal(B.made.length, use.length, "(③b) 每条注入都必须真的发出去");
  // 注入不许扰动玩法：去掉注入事件后事件流与 A1 必须相同
  const stripped = B.raw.filter((e) => !(e.type === "throwin" && B.made.some((m) => Math.abs(m.t - e.t) < 1e-6)));
  assert.equal(
    stripped.map((e) => `${e.type}:${e.team}:${e.t.toFixed(2)}`).join("|"),
    A1.raw.map((e) => `${e.type}:${e.team}:${e.t.toFixed(2)}`).join("|"),
    "(③b) 注入必须是「只发事件、不改玩法」的（否则整条链不可信）"
  );
  say("(③b) 注入", `${B.made.length} 条，帧 ${A1.period.frames.length} → ${B.period.frames.length}`);

  // ⑤ 整半场口径的高光窗（真实几何 + 真实预算竞争）
  const hl = buildHighlightWindows({
    tStart: B.period.tStart,
    tEnd: B.period.tEnd,
    rawEvents: B.raw,
    scaledGoals: B.period.scaled.goals,
  });
  const wins = hl.windows.filter((w) => w.label === "throwin");
  say(
    "(③b) 整半场高光窗",
    `${hl.windows.map((w) => w.label).join("/")} ｜ playSec=${hl.playSec.toFixed(1)} ｜ 界外球 ${wins.length} 个`
  );
  // ⚠ 这里**只**断言上限，不断言「必须出现」：`throwin` 的 priority = 20 是全表最低的
  //   可丢弃窗（只高于开球），而 `goal` / `kickoff` 虽然不被丢弃、**duration 仍计入 budget**
  //   （`adapt.js:564-568`）。所以一个 2~3 球的半场能把 150s 预算吃满，界外球窗整场不播
  //   —— 那是**设计内的预算行为**，不是缺陷，断言「必须出现」会变成假红。
  //   「必须出现且能切出段」由 ⑥ 的窄窗口径钉死（那里没有预算竞争）。
  assert.ok(
    wins.length <= 2,
    `(③b) 界外球窗不超上限（≤2），实得 ${wins.length}（playSec=${hl.playSec.toFixed(1)}）`
  );
  const segs = buildHighlightSegments(B.period.frames, hl.windows, B.period.tStart, B.period.tEnd);
  const plays = segs.filter((s) => s.kind === "play" && s.label === "throwin");
  assert.equal(
    plays.length,
    wins.length,
    `(③b) 整半场口径里每个界外球窗都必须切出一个 play 段（窗 ${wins.length} 个，段 ${plays.length} 个）`
  );
  checkPlayFrames(plays, "整半场口径");
  if (plays.length) {
    say(
      "(③b) play 段（整半场）",
      JSON.stringify(
        plays.map((s) => `${s.t0.toFixed(1)}-${s.t1.toFixed(1)} n=${s.frames.length} 末帧=${(s.frames.at(-1).t ?? 0).toFixed(1)}`)
      )
    );
  }

  // ⑥ 窄窗口径（**判据主力**）：围绕每个注入点单独取窗 —— 没有预算竞争、没有别的窗，
  //   于是「界外球窗一定出现 + 一定切得出 ≥2 帧的 play 段」是可证的；帧仍是那次真实半场
  //   跑出来的录制帧（不是合成帧）。注入点对会产窗的真实事件都留了 ≥34s（见 ③）。
  //   ⚠ 必须只喂**窗内**的事件（与 `match.js` 把「本时段事件」喂给同一函数的用法一致）：
  //     喂全量会让窗外的注入点被 clamp 成 `t1 = tEnd` 的退化窗挤进来（实测踩过：
  //     `throwin@185.1-110@at185.1` ⇒「窄窗内恰好 1 个界外球窗」被误判成 2 个）。
  const narrow = [];
  for (const t of use.slice(0, 2)) {
    const a = t - 30;
    const b = t + 30;
    const inSpan = B.raw.filter((e) => e.t >= a && e.t <= b);
    const strangers = inSpan.filter((e) => WINDOW_TYPES.includes(e.type));
    assert.equal(
      strangers.length,
      0,
      `(③b) 注入点 ${t}s ±30s 内不该有会产生高光窗的真实事件（安静时刻判据失效）：${strangers
        .map((e) => `${e.type}@${e.t.toFixed(1)}`)
        .join("/")}`
    );
    const nw = buildHighlightWindows({ tStart: a, tEnd: b, rawEvents: inSpan, scaledGoals: [] }).windows;
    const nThrowin = nw.filter((w) => w.label === "throwin");
    assert.equal(
      nThrowin.length,
      1,
      `(③b) [${a},${b}] 窄窗内必须恰好 1 个界外球窗，实得 ${nThrowin.length}（${nw.map((w) => w.label).join("/")}）`
    );
    const ns = buildHighlightSegments(B.period.frames, nThrowin, a, b).filter(
      (s) => s.kind === "play" && s.label === "throwin"
    );
    assert.equal(ns.length, 1, `(③b) 注入点 ${t}s 必须切出一个 play 段，实得 ${ns.length}`);
    checkPlayFrames(ns, `注入点 ${t}s`);
    narrow.push(ns[0]);
  }
  say(
    "(③b) play 段（窄窗）",
    JSON.stringify(
      narrow.map((s) => `${s.t0.toFixed(1)}-${s.t1.toFixed(1)} n=${s.frames.length} 末帧=${(s.frames.at(-1).t ?? 0).toFixed(1)}`)
    )
  );

  // ⑦ 风味：注入 4 条 ⇒ 必须进列表（`caps` 白名单），且不超上限。
  //    ⚠ 「恰好 4 条」那把尺子在检查 ③a（8 条注入 ⇒ 4 条）—— 这里注入数就是 4，
  //      断言 «恰好 4» 会变成恒真，等于没有判别力。
  const flavor = B.period.flavor.filter((f) => f.type === "throwin");
  assert.ok(
    flavor.length >= 1 && flavor.length <= 4,
    `(③b) 注入的界外球必须进风味列表且不超上限，实得 ${flavor.length} 条`
  );
  say("(③b) 风味 throwin", `${flavor.length} 条 / 注入 4 条`);

  console.log("检查 ③b 真实引擎端到端：passed");
}

/* ─────────────────────────── 检查 ④：变异测试（断言必须有判别力） ─────────────────────────── */

/** 撤掉 ①：整块删掉界外球高光窗（模拟改动没做） */
function cutWindows(src) {
  const from = src.indexOf("  // 界外球：半场最多 2 次。");
  const to = src.indexOf("  // 开球一小段");
  assert.ok(from > 0 && to > from, "变异锚点变了（高光窗注释找不到）");
  return src.slice(0, from) + src.slice(to);
}
/** 撤掉 ②：白名单两张表里的 throwin 都删掉 */
function cutCaps(src) {
  // ⚠ 仓库源码是 CRLF：用 `\r?\n` 的行正则，别写字面 `"\n"`（实测踩过，
  //   字面量匹配不上 ⇒ 变异根本没发生 ⇒ 「测试变红」变成假象）。
  const out = src
    .replace(/^ {4}throwin: 4,\r?\n/m, "")
    .replace(/^ {4}throwin: 0,\r?\n/m, "");
  assert.notEqual(out, src, "变异锚点变了（caps 里的 throwin 找不到）");
  assert.ok(
    !/throwin: 4,/.test(out) && !/throwin: 0,/.test(out),
    "变异没删干净（caps/counts 里还剩 throwin）"
  );
  return out;
}
/** 撤掉 ③：删掉 `case "throwin"`（含上面的注释） */
function cutText(src) {
  const from = src.indexOf('    // 界外球：引擎的 `throwin` 事件以前没有 case');
  const to = src.indexOf('    case "save":');
  assert.ok(from > 0 && to > from, "变异锚点变了（文案 case 找不到）");
  const out = src.slice(0, from) + src.slice(to);
  assert.ok(!out.includes('case "throwin"'), "变异没删干净");
  return out;
}
/** 撤掉上限（额外一条）：`throwinN < 2` → 不限 */
function cutCap(src) {
  const out = src.replace("throwinN < 2", "true");
  assert.notEqual(out, src, "变异锚点变了（上限条件找不到）");
  return out;
}

/**
 * 撤掉 ④：`liveInterestOfEvent` 不认 throwin（**忘了接线**）。
 * 这一处最阴：高光窗明明选中了界外球，落点附近却一帧都没有 ⇒
 * `buildHighlightSegments` 的 `if (fr.length >= 2)` 静默丢弃整段，玩家还是看不到。
 */
function cutLiveInterest(src) {
  const from = src.indexOf("  // 界外球：引擎的 `throwin` 事件以前在这里 return null");
  const to = src.indexOf('  if (e.type === "sub_on") return LIVE_DENSE.sub_on;');
  assert.ok(from > 0 && to > from, "变异锚点变了（liveInterestOfEvent 的 throwin 分支找不到）");
  const out = src.slice(0, from) + src.slice(to);
  assert.ok(!/if \(e\.type === "throwin"\) return/.test(out), "变异没删干净");
  return out;
}

const MUTATIONS = [
  { name: "①高光窗整块撤掉", check: "windows", patch: cutWindows },
  { name: "②白名单 caps/counts 撤掉", check: "flavorcap", patch: cutCaps },
  { name: "③文案 case 撤掉", check: "text", patch: cutText },
  { name: "④`liveInterestOfEvent` 不认 throwin（漏接线）", check: "engine", patch: cutLiveInterest },
  { name: "⑤上限 `throwinN < 2` 撤掉（额外一条）", check: "windows", patch: cutCap },
];

function checkMutations() {
  const scratch = process.env.PI_SCRATCH_DIR || tmpdir();
  for (const m of MUTATIONS) {
    const dir = mkdtempSync(join(scratch, "throwin-mut-"));
    try {
      cpSync(join(ROOT, "js"), join(dir, "js"), { recursive: true });
      const target = join(dir, "js", "sim", "adapt.js");
      const src = readFileSync(target, "utf8");
      writeFileSync(target, m.patch(src));
      const child = spawnSync(process.execPath, [SCRIPT_PATH], {
        env: {
          ...process.env,
          THROWIN_AUDIT_JS_ROOT: pathToFileURL(`${join(dir, "js")}/`).href,
          THROWIN_AUDIT_ONLY: m.check,
        },
        // ⚠ **必须显式写 `stdio`**。只给 `encoding: "utf8"` 时 Node 用默认 stdio
        //   （三路都是 pipe，**含 stdin**），在某些 Windows 环境下 `spawnSync`
        //   会直接返回 `status: null` + `error.code = "EBUSY"`，子进程根本没启动。
        //   实测（2026-09-24）：`{encoding:"utf8"}` → EBUSY；
        //   `{stdio:["ignore","pipe","pipe"], encoding:"utf8"}` → 正常。
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      // 🔴 先分辨「进程没启动」与「进程跑了但断言没红」。
      //   旧写法只有 `assert.notEqual(child.status, 0)`，而 **`null !== 0` 也成立**
      //   ⇒ 启动失败会被放行到下一句，最后报成「红了但不是断言失败（疑似环境错误）」
      //   —— 把**环境问题**说成**断言判别力问题**，方向完全反了。
      assert.ok(
        child.error === undefined,
        `变异「${m.name}」子进程**根本没启动**（${child.error?.code}）：` +
          `这是环境问题，不是断言判别力问题。`
      );
      assert.notEqual(
        child.status,
        null,
        `变异「${m.name}」子进程没有退出码（signal=${child.signal}）`
      );
      const err = `${child.stdout || ""}${child.stderr || ""}`.trim();
      assert.notEqual(child.status, 0, `变异「${m.name}」必须让检查 ③${m.check} 变红，但它退出了 0`);
      const line = err.split("\n").find((l) => /AssertionError|Error/.test(l)) || err.split("\n")[0] || "";
      assert.ok(
        /AssertionError/.test(err),
        `变异「${m.name}」红了但不是断言失败（疑似环境错误）：${line}`
      );
      say(`变异「${m.name}」→ 红`, line.trim().slice(0, 160));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(`检查 ④ 变异测试：${MUTATIONS.length}/${MUTATIONS.length} 都能让对应断言变红（断言有判别力）`);
}

/* ─────────────────────────── 执行 ─────────────────────────── */

const CHECKS = {
  windows: checkWindows,
  text: checkText,
  flavorcap: checkFlavorCap,
  engine: checkEngine,
  mutations: checkMutations, // 调试用（`THROWIN_AUDIT_ONLY=mutations`）；子进程只跑前面四项
};

if (ONLY) {
  const fn = CHECKS[ONLY];
  assert.ok(fn, `未知的 THROWIN_AUDIT_ONLY=${ONLY}`);
  fn();
} else {
  console.log(`[throwin-visibility-audit] js/ = ${JS_ROOT_URL}`);
  console.log(`[throwin-visibility-audit] adapt.js sha256 = ${HASH_BEFORE}`);
  checkWindows();
  checkText();
  checkFlavorCap();
  checkEngine();
  checkMutations();
  const HASH_AFTER = sha256(readFileSync(ADAPT_PATH));
  assert.equal(HASH_AFTER, HASH_BEFORE, "审计本身不许改动仓库文件");
  console.log(`[throwin-visibility-audit] adapt.js sha256（跑完）= ${HASH_AFTER}（与跑前逐字节相同）`);
  console.log("Throwin visibility audit passed: 界外球能进高光段、能进风味列表、文案不再是「分钟 + 队名」");
}
