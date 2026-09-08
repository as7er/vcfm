/**
 * 标定曲线（角球第 3 步）：把角球摆位推到真实争点区、给主罚一个真正的落点选择、
 * 再给抢点加「有时机的跑动」，量三者各自与合并后的连带影响。
 *
 * 背景（AGENTS.md「🅰️ 角球真实参照值总表」第五~八节）：
 *   数量 3.02 次/队场 = 真实 5.14 的 59%；每个角球进球 2.15% = 真实 4.1% 的 52%。
 *   摆位实测（`corner-structure-audit`，34 次真实角球）：小禁区两边 0 人、门柱 0 人、
 *   进攻方最靠前 10.5m / 防守方最靠前 12.6m / 球吊到 15.1m，三者自洽但整体比真实
 *   争点区（0~11m）远 5~10m；开球窗口 2.5s 内位移中位 1.69m、位移 ≥5m 的 0 人。
 *
 * **本探针开工前先量出的一条新事实（决定了 `delivery` 档的写法）**：
 *   角球时 `_bestCross` **20 次调用全部返回 null（0%）**，所以每一个角球都走
 *   `_decideOnBall` 里那条兜底吊传（`tx = 50±6, ty = boxY±3`，即 11.6~17.9m）。
 *   根因是 `_bestCross` 要求候选 `ahead >= 4`（比出脚人更靠近球门），而主罚者站在角旗、
 *   几乎在球门线上，**没有任何队友能比他更靠前**。
 *   即：**角球落点现在是一个常量，不是一次决策，主罚者的 `crossing` 完全不影响球吊到哪。**
 *
 * 档位（全部只在进程内包装，不改仓库代码）：
 *   `slots`    重排摆位：进攻方前点/中路/后点各一人进小禁区、第二个六码区 2 人、
 *              弧顶 1 人做二次球、边路 1 人回收、**本方半场留 2 名后卫防反**；
 *              防守方补**近柱人 + 小禁区 2 人**、5 名盯人者站在被盯者**球门侧**、
 *              弧顶 1 人、**Law 17 线上 1 人干扰主罚**、**前场留 1 名快马做出球点**；
 *              门将收到离门线 1.5m、略偏后半门。
 *   `delivery` 让 `_bestCross` 在角球时返回真正的落点（小禁区内前点/中路/后点轮换），
 *              取代那条常量兜底吊传。
 *   `runs`     抢点者摆位时**先站远 5m**，主罚出脚窗口内再冲向自己的目标区；
 *              盯人者跟着跑（目标 = 被盯者目标点的球门侧）。这是「跑动原语」的最小实现：
 *              有触发（摆位完成）、有时长（到出脚后 1.2s）、有到达点（目标区）。
 *
 * 接缝与随机数纪律（与 `_final-third-movement-calibration-probe.mjs` 同一套）：
 *   · 包装 `_restart`：**原方法先跑完**（含门将那次 `random()`），之后才覆写坐标。
 *   · 包装 `_think`：原方法先跑完，之后才覆写 `tx/ty`（`_think:1712` 的冻结分支就在里面）。
 *   · 包装 `_bestCross`：**先调原方法**（它自己的 `random()` 照常消费），再替换返回值。
 *   · 所有覆写公式都是位置、id、角球序号的确定性函数，**一个随机数都不取**。
 *   · 自检：control 档必须与未打包装的引擎逐场同分。
 *
 * 口径：种子 372000..、能力 15、标准档、0.1s 步长，与 `corner-structure-audit` 一致，
 * 所以结构列可直接与那份基线比。
 *
 * ⚠ 本表不测 `box-defending-audit` 的 `crowdedPairs`（上限 14、干净基线 12，余量只有 2）。
 *   往小禁区塞人几乎一定顶到它，采用前必须单独跑。
 *
 * 用法：node scripts/_corner-rework-calibration-probe.mjs [场数=8]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const MX = SIM.PITCH_W_METRES / SIM.FIELD_W;
const MY = SIM.PITCH_H_METRES / SIM.FIELD_H;
const SIX_YARD = 5.5;
const SECOND_SIX = 11;
const PEN_AREA = 16.5;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const ATTRS = [
  "pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
  "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling",
  "positioning", "kicking", "decisions", "crossing",
];
function club(name, ability) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, i) => {
    const rating = Math.max(1, Math.min(20, ability + (((i * 7 + ability) % 5) - 2)));
    const attrs = {};
    for (const k of ATTRS) attrs[k] = rating;
    return { id: `${name}-p${i}`, name: `${name}-p${i}`, pos, number: i + 1, fitness: 100, attrs };
  });
  return {
    id: name, name, players,
    tactics: {
      formation: "4-3-3", lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced",
    },
  };
}
function seededRandom(seed) {
  let v = seed >>> 0;
  return () => {
    v += 0x6d2b79f5;
    let n = v;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
const median = (v) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return Number((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2));
};
const mean = (v) => (v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)) : 0);
const pct = (n, d) => Number(((n / Math.max(1, d)) * 100).toFixed(1));

/** 档位开关。depthScale：把三个抢点区 + 落点区的深度按比例外推（1.0=现状 5m，避开门将出击圈用） */
const V = { slots: false, delivery: false, runs: false, releaseRuns: false, restDef: false, outlet: false, gkOnLine: false, depthScale: 1.0 };

/**
 * 角球计划：`_restart` 包装里算好，`_think` / `_bestCross` 包装读它。
 * 只存 id 与目标坐标，全是确定性推导。
 */
let plan = null;
let cornerIndex = 0;

/** 距被攻球门 m 米处的 y（引擎坐标） */
const yFromGoal = (goalY, dir, m) => clamp(goalY - dir * (m / MY), 1.5, 98.5);
/** 距球门中线 m 米处的 x（带符号，+ 为 x 增大方向） */
const xFromCentre = (m) => clamp(50 + m / MX, 3, 97);
/** 空中争顶能力：属性均匀的测试阵容下等价于按 id 稳定排序，但公式本身是真实依据 */
const aerial = (a) =>
  (a.attr.strength || 0.5) * 0.5 + (a.attr.physical || 0.5) * 0.3 + (a.attr.finishing || 0.5) * 0.2;
const byAerial = (list) =>
  [...list].sort((p, q) => aerial(q) - aerial(p) || String(p.id).localeCompare(String(q.id)));

/**
 * 真实角球布置。`side` = 角球在哪一侧（-1 左 / +1 右），近柱在同侧。
 * 返回 { attack: Map<id,{x,y,run?}>, defend: Map<id,{x,y,markId?}>, gk: {x,y} }
 */
function buildLayout(engine, attTeam, taker, ball) {
  const dir = engine.attackDir(attTeam);
  const goalY = engine.targetGoalY(attTeam);
  const side = ball.x < 50 ? -1 : 1;          // 角球所在半边
  const near = side;                           // 近柱与角球同侧
  const far = -side;
  const at = (lateralM, depthM) => ({ x: xFromCentre(lateralM), y: yFromGoal(goalY, dir, depthM) });

  const outfield = (team) =>
    engine.agents.filter((a) => a.team === team && a.role !== "GK" && !a.sentOff);
  const defTeam = attTeam === "home" ? "away" : "home";
  const attackers = outfield(attTeam).filter((a) => a !== taker);
  const defenders = outfield(defTeam);

  // —— 进攻方：2 名后卫留守，其余按争顶能力从最危险的点往外排 ——
  const backs = [...attackers]
    .filter((a) => a.role === "DEF")
    .sort((p, q) => aerial(p) - aerial(q) || String(p.id).localeCompare(String(q.id)))
    .slice(0, 2);
  const backIds = new Set(backs.map((a) => a.id));
  const forward = byAerial(attackers.filter((a) => !backIds.has(a.id)));

  // 三个真实进球区（The Analyst：前点/中路/后点，全在小禁区内）。
  // depthScale 把深度整体外推：落点与抢点点同步移动，避免只推一头造成「无人区」。
  const ds = V.depthScale;
  const zones = [
    { key: "near", ...at(near * 3.0, 5.0 * ds) },
    { key: "central", ...at(near * -0.5, 5.4 * ds) },
    { key: "far", ...at(far * 4.5, 4.6 * ds) },
  ];
  const attack = new Map();
  const runners = [];
  forward.slice(0, 3).forEach((a, i) => {
    const z = zones[i];
    attack.set(a.id, { x: z.x, y: z.y, zone: z.key });
    runners.push({ id: a.id, x: z.x, y: z.y });
  });
  // 第二个六码区两人（利物浦式：54% 的第一下触球发生在这里）
  const second = [at(near * 2.5, 9.0), at(far * 3.0, 9.5)];
  forward.slice(3, 5).forEach((a, i) => {
    attack.set(a.id, { ...second[i], zone: "secondSix" });
    runners.push({ id: a.id, ...second[i] });
  });
  // 弧顶做二次球 + 边路回收（都不参与抢点跑动）
  if (forward[5]) attack.set(forward[5].id, { ...at(near * -1.0, 18.0), zone: "edge" });
  if (forward[6]) attack.set(forward[6].id, { ...at(near * 12.0, 20.0), zone: "recycle" });
  // 留守两名后卫（防反）。`V.restDef` 关掉时**不给他们目标点**，`_restart` 里
  // `if (!spot) continue;` 会跳过，于是他们留在引擎自己摆的位置。
  // 关键：`backIds` 无论开关都把这两人从 `forward` 里排除，所以禁区里的抢点
  // 结构逐位相同——开关只改变「这 2 人有没有被拉回 60m」这一个变量。
  if (V.restDef) {
    backs.forEach((a, i) => attack.set(a.id, { ...at((i ? 1 : -1) * 8.0, 60 + i * 2), zone: "held" }));
  }

  return { dir, goalY, side, near, far, at, attack, defend: null, runners, defenders, defTeam };
}

/** 防守方布置：近柱人 + 小禁区区域人 + 盯人（球门侧）+ 弧顶 + Law 17 线上 + 前场出球点 */
function buildDefence(engine, L, ball) {
  const { at, near, far, attack, defenders } = L;
  const defend = new Map();
  const pool = byAerial(defenders);

  // 1) 前场留一名最快的前锋做出球点（真实防守角球的标配）
  const outlet =
    [...defenders]
      .filter((a) => a.role === "ATT")
      .sort((p, q) => (q.attr.pace || 0) - (p.attr.pace || 0) || String(p.id).localeCompare(String(q.id)))[0] ||
    pool[pool.length - 1];
  // `V.outlet` 关掉时不给他目标点 → 留在引擎自己摆的位置。
  // 他**无论开关都从 `rest` 里排除**，所以禁区里的近柱人/区域人/盯人分配
  // 逐位相同——开关只改变「有没有 1 人被停在 55m 处等反击」这一个变量。
  if (V.outlet) defend.set(outlet.id, { ...at(near * 4.0, 55), role: "outlet" });

  const rest = pool.filter((a) => a.id !== outlet.id);
  let k = 0;
  // 2) 近柱人：站在球门线上
  if (rest[k]) defend.set(rest[k++].id, { ...at(near * 3.4, 0.8), role: "post" });
  // 3) 小禁区区域人：护住门将出击区（真实区域防守是沿小禁区线的一排）
  if (rest[k]) defend.set(rest[k++].id, { ...at(near * 0.5, 3.4), role: "sixYardZone" });
  if (rest[k]) defend.set(rest[k++].id, { ...at(far * 2.0, 6.5), role: "sixYardEdge" });
  // 4) 盯人：站在被盯者的**球门侧**（现状 12.6m 对 12.6m，完全没有分层）
  const marked = [...attack.entries()]
    .filter(([, s]) => s.zone === "near" || s.zone === "central" || s.zone === "far" || s.zone === "secondSix")
    .sort((p, q) => p[1].y - q[1].y || String(p[0]).localeCompare(String(q[0])));
  for (const [attId, spot] of marked) {
    if (!rest[k]) break;
    defend.set(rest[k++].id, {
      x: clamp(spot.x + near * -1.2 / MX, 3, 97),
      y: clamp(spot.y + L.dir * (1.8 / MY), 1.5, 98.5), // 朝球门方向 1.8m（2.16m 间距，过 1.6m 闸门）
      role: "mark",
      markId: attId,
    });
  }
  // 5) 弧顶盯二次球
  if (rest[k]) defend.set(rest[k++].id, { ...at(near * -1.0, 16.0), role: "edge" });
  // 6) Law 17 线上干扰主罚：距球 9.6m，沿底线朝场内
  if (rest[k]) {
    const bx = ball.x + (ball.x < 50 ? 1 : -1) * (9.6 / MX) * 0.86;
    const by = ball.y + L.dir * (9.6 / MY) * 0.5;
    defend.set(rest[k++].id, { x: clamp(bx, 3, 97), y: clamp(by, 1.5, 98.5), role: "law17" });
  }
  // 7) 还没排到的（11v10 之类）：填到弧顶外侧
  while (rest[k]) defend.set(rest[k++].id, { ...at(far * 9.0, 19.0), role: "spare" });

  // 门将：离门线 1.5m，略偏后半门。
  // `V.gkOnLine` 关掉时返回 null → `_restart` 不动他，留在引擎原值（实测离线 5.25m）。
  // 这是「+0.66 归因」的第二轮：留守/留前场已证伪（留档十），门将是 `slots` 里
  // 唯一碰了守门员的部分，而角球频率的来源正是 `engine.js:6178/6196` 的托救与封堵。
  const gk = engine.agents.find((a) => a.team === L.defTeam && a.role === "GK" && !a.sentOff);
  return { defend, gk, gkSpot: V.gkOnLine ? at(far * 0.8, 1.5) : null };
}

/**
 * 摆位去重叠：确定性、按 id 排序的有界 Gauss-Seidel，最多 6 轮，两人各让一半。
 * 与引擎自己的 `_separateSupportTargets` 同一套写法，**不消费随机数**。
 * 需要它是因为「盯人者站在被盯者球门侧」天然会把两人拉到 2m 内，
 * 而 `set-piece-presentation-audit` 的重叠闸门是 1.6m。
 */
function relax(list, minMetres = 2.0) {
  const sorted = [...list].sort((p, q) => String(p.id).localeCompare(String(q.id)));
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        const dx = (b.x - a.x) * MX;
        const dy = (b.y - a.y) * MY;
        const d = Math.hypot(dx, dy);
        if (d >= minMetres) continue;
        const push = (minMetres - Math.max(d, 1e-6)) / 2;
        // 完全重合时按 id 分侧，避免两点永久粘连
        const ux = d > 1e-6 ? dx / d : (String(a.id) < String(b.id) ? -1 : 1);
        const uy = d > 1e-6 ? dy / d : 0;
        a.x = clamp(a.x - (ux * push) / MX, 3, 97);
        a.y = clamp(a.y - (uy * push) / MY, 1.5, 98.5);
        b.x = clamp(b.x + (ux * push) / MX, 3, 97);
        b.y = clamp(b.y + (uy * push) / MY, 1.5, 98.5);
        moved = true;
      }
    }
    if (!moved) break;
  }
}

const ORIG = {
  restart: SimEngine.prototype._restart,
  think: SimEngine.prototype._think,
  bestCross: SimEngine.prototype._bestCross,
};

SimEngine.prototype._restart = function _restartProbe(type, team, x, y, ...rest) {
  const out = ORIG.restart.call(this, type, team, x, y, ...rest);
  if (type !== "corner" || (!V.slots && !V.runs && !V.delivery)) {
    if (type !== "corner") plan = null;
    return out;
  }
  const b = this.ball;
  const attTeam = b.kickTeam === "home" || b.kickTeam === "away" ? b.kickTeam : team;
  // 主罚者 = `_restart` 刚放到角旗旁那个（进攻方离球最近者）
  let taker = null;
  let best = Infinity;
  for (const a of this.agents) {
    if (a.team !== attTeam || a.role === "GK" || a.sentOff) continue;
    const d = Math.hypot((a.x - b.x) * MX, (a.y - b.y) * MY);
    if (d < best) { best = d; taker = a; }
  }
  if (!taker) return out;

  const L = buildLayout(this, attTeam, taker, b);
  const D = buildDefence(this, L, b);
  cornerIndex++;
  plan = {
    attTeam, takerId: taker.id, dir: L.dir, goalY: L.goalY, near: L.near, far: L.far,
    attack: L.attack, defend: D.defend, runners: L.runners,
    // 抢点者的最终目标（runs 档用）；摆位时先站远 RUN_BACK 米
    until: this.t + 4.2,
    index: cornerIndex,
    zones: [
      L.at(L.near * 3.0, 5.0 * V.depthScale),
      L.at(L.near * -0.5, 5.4 * V.depthScale),
      L.at(L.far * 4.5, 4.6 * V.depthScale),
    ],
  };

  if (!V.slots) { plan.attack = new Map(); plan.defend = new Map(); return out; }

  // runs 档：抢点者先退 RUN_BACK 米，摆位完成就开始冲。
  // ⚠ 3.0m 不是随手取的：主罚暂停只有 1.6s（`engine.js:6558`），而引擎无球球员实测
  //   只跑得动约 1.2 m/s（2 场烟测：退 5m 时 2.5s 位移中位 3.06m、无人跑满 5m），
  //   退太远就赶不到落点，量出来会是「跑了但没到」。
  const RUN_BACK = V.releaseRuns ? 5.0 : 3.0;
  const staged = [];
  for (const a of this.agents) {
    if (a.sentOff) continue;
    if (a.id === taker.id) continue;
    if (a.role === "GK") {
      if (a.team !== attTeam && D.gkSpot) { a.x = D.gkSpot.x; a.y = D.gkSpot.y; }
      continue;
    }
    const spot = a.team === attTeam ? plan.attack.get(a.id) : plan.defend.get(a.id);
    if (!spot) continue;
    const isRunner = (V.runs || V.releaseRuns) && plan.runners.some((r) => r.id === a.id);
    a.x = spot.x;
    a.y = isRunner ? clamp(spot.y + L.dir * (-RUN_BACK / MY), 1.5, 98.5) : spot.y;
    a.vx = 0;
    a.vy = 0;
    staged.push(a);
  }
  relax(staged);
  for (const a of staged) {
    a.tx = a.x;
    a.ty = a.y;
  }
  return out;
};

/** `runs` 档：冻结窗口内把抢点者的目标点设成他的争点区，盯人者跟到球门侧 */
SimEngine.prototype._think = function _thinkProbe(a, ...rest) {
  const out = ORIG.think.call(this, a, ...rest);
  if ((!V.runs && !V.releaseRuns) || !plan || a.sentOff || a.injuredOff || a.role === "GK") return out;
  if (V.releaseRuns) {
    const ball = this.ball;
    if (ball.state !== "pass" || ball.lastKicker !== plan.takerId ||
        ball.lastPassAt < plan.until - 4.2 || this.t > ball.expectedAt + 0.4) return out;
  } else if (this.t > plan.until) return out;
  if (a.id === plan.takerId) return out;
  if (a.team === plan.attTeam) {
    const target = plan.runners.find((r) => r.id === a.id);
    if (target) { a.tx = target.x; a.ty = target.y; }
    return out;
  }
  const spot = plan.defend.get(a.id);
  if (spot && spot.markId) {
    const target = plan.runners.find((r) => r.id === spot.markId);
    if (target) {
      a.tx = clamp(target.x + plan.near * -1.2 / MX, 3, 97);
      a.ty = clamp(target.y + plan.dir * (1.8 / MY), 1.5, 98.5);
    }
  }
  return out;
};

/**
 * `delivery` 档：角球时给出真正的落点。
 * 现状 `_bestCross` 在角球上 100% 返回 null（`ahead >= 4` 永远过不了，主罚者就在球门线上），
 * 所以这里替换返回值不会抢走任何本来存在的决策。
 */
SimEngine.prototype._bestCross = function _bestCrossProbe(a) {
  const out = ORIG.bestCross.call(this, a);
  if (!V.delivery || !plan || out) return out;
  const b = this.ball;
  if (b.state !== "corner" || b.owner !== a.id || a.id !== plan.takerId) return out;
  const z = plan.zones[plan.index % plan.zones.length]; // 前点/中路/后点轮换
  return { agent: null, value: 1, through: false, cross: true, tx: z.x, ty: z.y };
};

const matches = Math.max(2, Number(process.argv[2]) || 8);
const seeds = Array.from({ length: matches }, (_, i) => 372000 + i);

function runMatch(seed) {
  const restore = Math.random;
  Math.random = seededRandom(seed);
  plan = null;
  cornerIndex = 0;
  try {
    const eng = new SimEngine(club(`h${seed}`, 15), club(`a${seed}`, 15), {
      simulationProfile: "standard", timeStep: SIM.DT, separationPasses: 8,
    });
    const steps = Math.round((90 * 60) / SIM.DT);
    const t = {
      corners: 0, cornerShots: 0, cornerGoals: 0, goals: 0, shots: 0,
      passes: 0, crosses: 0, structures: [], deliveries: [], runMoves: [],
    };
    let prevState = null;
    let staged = null;
    for (let s = 0; s < steps; s++) {
      eng.step(SIM.DT);
      const b = eng.ball;
      if (b.state === "corner" && prevState !== "corner") {
        const attTeam = b.kickTeam;
        if (attTeam === "home" || attTeam === "away") {
          staged = snapshot(eng, attTeam, s);
          // 抢点者的目标区（runs 档才有）：用来量「出脚那一刻他离目标还有多远」
          staged.runnerTargets =
            plan && plan.attTeam === attTeam ? plan.runners.map((r) => ({ ...r })) : [];
          staged.peak = new Map(staged.runnerTargets.map((r) => [r.id, 0]));
          staged.gapAtKick = null;
        }
      }
      prevState = b.state;
      if (!staged) continue;
      // 抢点者的峰值速度：分辨「覆写没生效」和「跑了但被人堵住」
      if (staged.peak.size) {
        for (const a of eng.agents) {
          if (!staged.peak.has(a.id)) continue;
          const spd = Math.hypot((a.vx || 0) * MX, (a.vy || 0) * MY);
          if (spd > staged.peak.get(a.id)) staged.peak.set(a.id, spd);
        }
      }
      if (staged.delivery == null && b.state === "pass" && b.kickTeam === staged.attTeam &&
          Number.isFinite(b.targetY)) {
        staged.delivery = Number((Math.abs(b.targetY - staged.goalY) * MY).toFixed(2));
        if (staged.runnerTargets.length) {
          const byId = new Map(eng.agents.map((x) => [x.id, x]));
          staged.gapAtKick = median(
            staged.runnerTargets.map((r) => {
              const now = byId.get(r.id);
              return now ? Math.hypot((now.x - r.x) * MX, (now.y - r.y) * MY) : 0;
            })
          );
        }
      }
      if (s - staged.step >= Math.round(2.5 / SIM.DT)) {
        const byId = new Map(eng.agents.map((x) => [x.id, x]));
        const moved = staged.start.map((p) => {
          const now = byId.get(p.id);
          return now ? Math.hypot((now.x - p.x) * MX, (now.y - p.y) * MY) : 0;
        });
        t.structures.push(staged.zones);
        t.runMoves.push({
          median: median(moved),
          over5: moved.filter((d) => d >= 5).length,
          peak: staged.peak.size ? median([...staged.peak.values()]) : null,
          gapAtKick: staged.gapAtKick,
        });
        if (staged.delivery != null) t.deliveries.push(staged.delivery);
        staged = null;
      }
    }
    const cornerAt = { home: -999, away: -999 };
    // 诊断（--diag）：角球窗口内被谁把球吃掉。cornerAt[team] 记的是「攻方」上一次开角球的时刻，
    // 防守方门将/后卫的处理事件挂在防守方名下，所以按「对方 team 的 cornerAt」判窗口。
    const other = (tm) => (tm === "home" ? "away" : "home");
    const inCornerWin = (evT, defTeam) => evT - (cornerAt[other(defTeam)] ?? -999) <= 18;
    const diag = { gk_claim: 0, gk_block: 0, gk_clear: 0, save: 0, block: 0, intercept: 0, offside: 0 };
    for (const ev of eng.events) {
      if (ev.type === "corner") { t.corners++; if (ev.team === "home" || ev.team === "away") cornerAt[ev.team] = ev.t; }
      else if (ev.type === "shot") { t.shots++; if (ev.t - (cornerAt[ev.team] ?? -999) <= 18) t.cornerShots++; }
      else if (ev.type === "goal") { t.goals++; if (ev.t - (cornerAt[ev.team] ?? -999) <= 18) t.cornerGoals++; }
      else if (ev.type === "pass") { t.passes++; if (ev.cross) t.crosses++; }
      else if (ev.type in diag && ev.team && inCornerWin(ev.t, ev.team)) diag[ev.type]++;
    }
    return { score: `${eng.score.home}-${eng.score.away}`, ...t, diag };
  } finally {
    Math.random = restore;
  }
}

/** 角球摆位快照（口径与 `corner-structure-audit.mjs` 一致，只保留标定要用的那几项） */
function snapshot(engine, attTeam, step) {
  const goalY = engine.targetGoalY(attTeam);
  const defTeam = attTeam === "home" ? "away" : "home";
  const b = engine.ball;
  const depth = (a) => Math.abs(a.y - goalY) * MY;
  const outfield = (team) =>
    engine.agents.filter((a) => a.team === team && a.role !== "GK" && !a.sentOff);
  const att = outfield(attTeam);
  const def = outfield(defTeam);
  let taker = null;
  let best = Infinity;
  for (const a of att) {
    const d = Math.hypot((a.x - b.x) * MX, (a.y - b.y) * MY);
    if (d < best) { best = d; taker = a; }
  }
  const others = att.filter((a) => a !== taker);
  const inBand = (list, lo, hi) => list.filter((a) => depth(a) >= lo && depth(a) < hi).length;
  const halfway = SIM.PITCH_H_METRES / 2;
  const gk = engine.agents.find((a) => a.team === defTeam && a.role === "GK" && !a.sentOff);
  const defDepths = def.map(depth);
  const minDef = defDepths.length ? Math.min(...defDepths) : Infinity;
  let nearestDefToBall = Infinity;
  for (const a of def) {
    nearestDefToBall = Math.min(nearestDefToBall, Math.hypot((a.x - b.x) * MX, (a.y - b.y) * MY));
  }
  const all = engine.agents.filter((a) => !a.sentOff);
  let minPair = Infinity;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      minPair = Math.min(minPair, Math.hypot((all[i].x - all[j].x) * MX, (all[i].y - all[j].y) * MY));
    }
  }
  return {
    attTeam, goalY, step, delivery: null,
    start: others.map((a) => ({ id: a.id, x: a.x, y: a.y })),
    zones: {
      attSix: inBand(others, 0, SIX_YARD),
      attSecond: inBand(others, SIX_YARD, SECOND_SIX),
      attBox: others.filter((a) => depth(a) < PEN_AREA).length,
      attHeld: others.filter((a) => depth(a) > halfway).length,
      defSix: inBand(def, 0, SIX_YARD),
      defBox: def.filter((a) => depth(a) < PEN_AREA).length,
      defUp: def.filter((a) => depth(a) > halfway).length,
      goalSideOfAll: others.filter((a) => depth(a) < minDef).length,
      nearestDefToBall,
      minPair,
      gkDepth: gk ? Math.abs(gk.y - goalY) * MY : 0,
    },
  };
}

const LEVELS = [
  { label: "control 现状", set: {} },
  { label: "slots 只改摆位", set: { slots: true } },
  // —— 归因三档：`slots` 单独档比 control 多出 +0.66 个进球，而角球进球占比 0%，
  //    也就是那些球**不是角球进的**。嫌疑是摆位顺带改了角球后的转换：进攻方 2 名
  //    后卫被拉回 60m（防反），防守方 1 名前锋被停在 55m（出球点）。
  //    这三档把两个安排各自摘掉，禁区结构保持逐位相同，看 +0.66 跟着谁走。
  { label: "slots −留守−留前场", set: { slots: true, restDef: false, outlet: false } },
  { label: "slots −留守", set: { slots: true, restDef: false } },
  { label: "slots −留前场", set: { slots: true, outlet: false } },
  // —— 归因第二轮：门将。留守/留前场证伪后，`slots` 里只剩三个变量改了非摆位的东西，
  //    门将是唯一碰了守门员的（5.25m → 1.58m），而角球频率的来源就是托救与封堵。
  { label: "slots −门将上线", set: { slots: true, gkOnLine: false } },
  { label: "delivery 只改落点", set: { delivery: true } },
  { label: "slots + delivery", set: { slots: true, delivery: true } },
  { label: "slots + delivery −门将上线", set: { slots: true, delivery: true, gkOnLine: false } },
  { label: "slots + delivery + runs", set: { slots: true, delivery: true, runs: true } },
  { label: "releaseRuns", set: { slots: true, delivery: true, releaseRuns: true } },
  // —— 落点深度扫描（2026-09-04 新增）：诊断表证实 slots+delivery 的射门率塌陷是
  //    「门将解围」翻 3 倍造成的（球被精确吊进门将 1.5m 出击圈）。落点与抢点点一起
  //    外推（depthScale），只测「离门将多远」这一个变量，找回射门率而不吊进无人区。
  { label: "s+d 深度×1.4 (~7m)", set: { slots: true, delivery: true, depthScale: 1.4 } },
  { label: "s+d 深度×1.8 (~9m)", set: { slots: true, delivery: true, depthScale: 1.8 } },
  { label: "s+d 深度×2.2 (~11m)", set: { slots: true, delivery: true, depthScale: 2.2 } },
];

function sweep(level) {
  V.slots = !!level.set.slots;
  V.delivery = !!level.set.delivery;
  V.runs = !!level.set.runs;
  V.releaseRuns = !!level.set.releaseRuns;
  // 未显式指定时跟随 slots，保证既有档位与已留档的数字逐位可比
  V.restDef = level.set.restDef ?? V.slots;
  V.outlet = level.set.outlet ?? V.slots;
  V.gkOnLine = level.set.gkOnLine ?? V.slots;
  V.depthScale = level.set.depthScale ?? 1.0;
  const agg = { corners: 0, cornerShots: 0, cornerGoals: 0, goals: 0, shots: 0, passes: 0, crosses: 0 };
  const z = { attSix: [], attSecond: [], attBox: [], attHeld: [], defSix: [], defBox: [], defUp: [],
    goalSideOfAll: [], nearestDefToBall: [], minPair: [], gkDepth: [] };
  const deliveries = [];
  const runMed = [];
  const runOver5 = [];
  const runPeak = [];
  const runGap = [];
  const scores = [];
  const diagAgg = { gk_claim: 0, gk_block: 0, gk_clear: 0, save: 0, block: 0, intercept: 0, offside: 0 };
  for (const seed of seeds) {
    const r = runMatch(seed);
    scores.push(r.score);
    for (const k of Object.keys(agg)) agg[k] += r[k];
    for (const k of Object.keys(diagAgg)) diagAgg[k] += (r.diag?.[k] || 0);
    for (const s of r.structures) for (const k of Object.keys(z)) z[k].push(s[k]);
    deliveries.push(...r.deliveries);
    for (const m of r.runMoves) {
      runMed.push(m.median);
      runOver5.push(m.over5);
      if (m.peak != null) runPeak.push(m.peak);
      if (m.gapAtKick != null) runGap.push(m.gapAtKick);
    }
  }
  V.slots = V.delivery = V.runs = V.restDef = V.outlet = V.gkOnLine = false;
  V.depthScale = 1.0;
  const per = (n) => Number((n / matches).toFixed(2));
  return {
    scores,
    diag: diagAgg,
    角球: per(agg.corners),
    角球射门: per(agg.cornerShots),
    角球进球: per(agg.cornerGoals),
    每角球进球率: pct(agg.cornerGoals, agg.corners),
    每角球射门率: pct(agg.cornerShots, agg.corners),
    角球进球占比: pct(agg.cornerGoals, agg.goals),
    进球: per(agg.goals),
    // 归因用：+0.66 那些球全落在这一列上（角球进球占比 0% 时它等于进球）
    非角球进球: per(agg.goals - agg.cornerGoals),
    射门每队场: Number((agg.shots / matches / 2).toFixed(2)),
    传球: per(agg.passes),
    传中占比: Number(((agg.crosses / Math.max(1, agg.passes)) * 100).toFixed(2)),
    小禁区进攻: mean(z.attSix),
    争点区进攻: Number((mean(z.attSix) + mean(z.attSecond)).toFixed(2)),
    小禁区防守: mean(z.defSix),
    留守: mean(z.attHeld),
    留前场: mean(z.defUp),
    越过全部防守者: mean(z.goalSideOfAll),
    最近防守者距球: median(z.nearestDefToBall),
    最小间距: Number(Math.min(...z.minPair).toFixed(2)),
    门将离线: median(z.gkDepth),
    落点中位: median(deliveries),
    落点进小禁区: pct(deliveries.filter((d) => d < SIX_YARD).length, deliveries.length),
    落点进争点区: pct(deliveries.filter((d) => d < SECOND_SIX).length, deliveries.length),
    跑动中位: median(runMed),
    跑5米以上: mean(runOver5),
    抢点峰值速度: runPeak.length ? median(runPeak) : null,
    出脚时距目标: runGap.length ? median(runGap) : null,
  };
}

console.log(`\n=== 角球重做标定曲线（${matches} 场，种子 ${seeds[0]}..${seeds[seeds.length - 1]}）===`);
const patched = {
  restart: SimEngine.prototype._restart,
  think: SimEngine.prototype._think,
  bestCross: SimEngine.prototype._bestCross,
};
SimEngine.prototype._restart = ORIG.restart;
SimEngine.prototype._think = ORIG.think;
SimEngine.prototype._bestCross = ORIG.bestCross;
const bare = seeds.map((s) => runMatch(s).score).join(" ");
SimEngine.prototype._restart = patched.restart;
SimEngine.prototype._think = patched.think;
SimEngine.prototype._bestCross = patched.bestCross;
const control = sweep(LEVELS[0]);
const faithful = bare === control.scores.join(" ");
console.log("\n[0] 包装自检 —— control 档必须与未打包装的引擎逐场同分：");
console.log({ 未打包装: bare, control: control.scores.join(" "), 判定: faithful ? "✅ 一致" : "❌ 不一致，整表作废" });
if (!faithful) process.exit(1);

const rows = [];
console.log("\n[1] 🔑 角球产出（★ = 每角球进球率进 3.3~5.0%，⚠ = 撞护栏）：");
for (const level of LEVELS.filter((level) => !process.argv[3] || level === LEVELS[0] ||
  process.argv[3].split(",").some((filter) => level.label.includes(filter)))) {
  const r = level === LEVELS[0] ? control : sweep(level);
  rows.push({ label: level.label, ...r });
  const warn = [];
  if (r.进球 < 2.5 || r.进球 > 3.3) warn.push("进球");
  if (r.传球 < 800 || r.传球 > 1250) warn.push("传球");
  if (r.传中占比 < 3 || r.传中占比 > 14) warn.push("传中占比");
  if (r.角球 < 2.75 || r.角球 > 10) warn.push("角球频率");
  if (r.最小间距 < 1.6) warn.push("摆位重叠");
  const inBand = r.每角球进球率 >= 3.3 && r.每角球进球率 <= 5.0;
  console.log(
    `${inBand ? "★" : " "} ${level.label.padEnd(24)} ` +
      `角球 ${String(r.角球).padStart(5)}  ` +
      `每角球进球 ${String(r.每角球进球率).padStart(5)}%  ` +
      `每角球射门 ${String(r.每角球射门率).padStart(5)}%  ` +
      `角球进球占比 ${String(r.角球进球占比).padStart(5)}%  ` +
      `进球 ${String(r.进球).padStart(4)}  ` +
      `射门 ${String(r.射门每队场).padStart(5)}  ` +
      `传中 ${String(r.传中占比).padStart(5)}%` +
      (warn.length ? `  ⚠${warn.join("/")}` : "")
  );
}

console.log("\n[1c] 🔍 角球窗口内球被谁吃掉（诊断：解释射门率为何塌陷；每场均值）：");
for (const r of rows) {
  const d = r.diag || {};
  const per = (n) => (n / matches).toFixed(2);
  console.log(
    `  ${r.label.padEnd(24)} ` +
      `门将没收 ${String(per(d.gk_claim || 0)).padStart(5)}  ` +
      `门将封堵 ${String(per(d.gk_block || 0)).padStart(5)}  ` +
      `门将解围 ${String(per(d.gk_clear || 0)).padStart(5)}  ` +
      `门将扑救 ${String(per(d.save || 0)).padStart(5)}  ` +
      `后卫封堵 ${String(per(d.block || 0)).padStart(5)}  ` +
      `拦截 ${String(per(d.intercept || 0)).padStart(5)}  ` +
      `越位 ${String(per(d.offside || 0)).padStart(5)}  ` +
      `| 角球射门 ${String(r.角球射门).padStart(4)}/场`
  );
}

console.log("\n[1b] 🔬 +0.66 归因（只看非角球进球；禁区结构在这四档里逐位相同）：");
{
  const base = rows.find((r) => r.label === "control 现状");
  const only = (label) => rows.find((r) => r.label === label);
  const delta = (r) => Number((r.非角球进球 - base.非角球进球).toFixed(2));
  for (const label of [
    "slots 只改摆位", "slots −留守−留前场", "slots −留守", "slots −留前场", "slots −门将上线",
  ]) {
    const r = only(label);
    if (!r) continue;
    const d = delta(r);
    console.log(
      `  ${label.padEnd(26)} 非角球进球 ${String(r.非角球进球).padStart(5)}  ` +
        `Δ vs control ${(d >= 0 ? "+" : "") + d.toFixed(2)}  ` +
        `留守 ${String(r.留守).padStart(4)}  留前场 ${String(r.留前场).padStart(4)}  ` +
        `门将离线 ${String(r.门将离线).padStart(5)}m  ` +
        `角球 ${String(r.角球).padStart(5)}  进球 ${String(r.进球).padStart(4)}`
    );
  }
  console.log(
    `  留守/留前场已证伪（留档十）：摘掉它们 Δ 不回 0，方向还相反——那两个安排是 rest defence。\n` +
      `  本轮看「−门将上线」：若 Δ 掉到 0 附近，+0.66 就归「门将被提到门线上」。\n` +
      `  ⚠ 但那不是可调的旋钮——1.5m 才是真实值（角球审计 12 项告警之一就是「门将离线 5.25m」）。\n` +
      `     若确认，结论是「引擎在角球后恢复门将站位的方式有缺陷」，要修引擎，不是把门将改回去。\n` +
      `  ⚠ 四档之间 0.17 进球/场 的差距是噪声（12 场约 2 个球），只读「回不回 0」，不读排序。`
  );
}

console.log("\n[2] 摆位结构（对照 corner-structure-audit 的 34 次角球基线）：");
for (const r of rows) {
  console.log(
    `  ${r.label.padEnd(24)} 小禁区攻 ${String(r.小禁区进攻).padStart(4)}  ` +
      `争点区攻 ${String(r.争点区进攻).padStart(4)}  ` +
      `小禁区守 ${String(r.小禁区防守).padStart(4)}  ` +
      `留守 ${String(r.留守).padStart(4)}  留前场 ${String(r.留前场).padStart(4)}  ` +
      `越过全部守 ${String(r.越过全部防守者).padStart(4)}  ` +
      `最近守距球 ${String(r.最近防守者距球).padStart(5)}m  ` +
      `门将离线 ${String(r.门将离线).padStart(4)}m  ` +
      `最小间距 ${String(r.最小间距).padStart(4)}m`
  );
}

console.log("\n[3] 落点与跑动：");
for (const r of rows) {
  console.log(
    `  ${r.label.padEnd(24)} 落点中位 ${String(r.落点中位).padStart(5)}m  ` +
      `进小禁区 ${String(r.落点进小禁区).padStart(5)}%  ` +
      `进争点区 ${String(r.落点进争点区).padStart(5)}%  ` +
      `2.5s 位移中位 ${String(r.跑动中位).padStart(5)}m  ` +
      `跑≥5m ${String(r.跑5米以上).padStart(4)} 人  ` +
      `抢点峰值速度 ${String(r.抢点峰值速度 ?? "-").padStart(5)} m/s  ` +
      `出脚时距目标 ${String(r.出脚时距目标 ?? "-").padStart(5)} m`
  );
}

console.log("\n[4] 真实参照与护栏：");
console.log({
  "角球 每队每场": "5.14（带 4.98~5.41）→ 每场双方 10.28",
  "每角球进球（后续这段进攻）": "4.1%（短角球 3.3%，2023/24 峰值 4.2%）",
  "每角球射门（后续这段进攻）": "38.5%",
  "角球进球占全部进球": "十八季带 9.8~14.2%",
  "落点": "领先的队 49.5% 吊进小禁区；争点区 = 0~11m",
  "护栏 进球/场": "2.5~3.3",
  "护栏 角球/场": "2.75~10",
  "护栏 传中占比": "3~14%",
  "护栏 摆位最小间距": "≥1.6m",
});
console.log("\n[5] 读法：");
console.log(
  [
    "· 想看到的方向：每角球进球率从 2.15% 抬到 3.3~5.0%、角球进球占比从 4.5% 抬向 9.8~14.2%，",
    "  而进球总数留在 2.5~3.3、射门别离 11.9~13.8 更远。",
    "· 角球频率不由本探针的档位驱动（来源在 `engine.js:6178/6196` 的托救与封堵），",
    "  它在表里只作为「有没有被意外带飞」的看门指标。",
    "· 本表不测 `box-defending-audit` 的 `crowdedPairs`（上限 14、干净基线 12）。",
    "  任何把人塞进小禁区的档位都要单独跑它，那里余量只有 2。",
    "· `delivery` 单独一档之所以有意义：现状 `_bestCross` 在角球上 100% 返回 null，",
    "  落点是常量兜底吊传，所以「改落点」和「改摆位」是两个独立缺陷，不是一个。",
  ].join("\n")
);
