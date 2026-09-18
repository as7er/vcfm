/**
 * 标定曲线：给**最后三区**的无球跑位补上位移，量它对全套标定指标的连带影响。
 *
 * 背景（AGENTS.md「🔑 主线诊断（2026-09-02）」）：无球跑位的塌陷只发生在最后三区
 * ——那一区占全部无球决策 54.5%，目标点距球员中位只有 2.08m（组织阶段是 9~10m）。
 * 构成里 67% 是三处「按设计钉在固定点上」的分支，剩下 33% 的支援者目标只有 3.3~5.2m
 * 且全部被 `_clampOffside` 削掉 2.3~7.1 单位纵深。本探针按那份诊断点名的杠杆做档位：
 *
 *   `wingRotate`  最后三区的边锋默认档（`engine.js:3309`，占最后三区 15.0%、目标距离
 *                 1.30m）。现状是 `baseY + dir*(8+prog*6)` 的半宽站桩。改为按**球在哪条边**
 *                 决定前后点：球在对侧 → 抢后点；球在本侧 → 拉到底线做前点；球在中路 →
 *                 拉开宽度让出传中通道。这是真实足球里边锋在最后三区最常做的三件事。
 *   `midLate`     最后三区的非前插中场（`:3219`，占 20.5%、目标距离 2.92m）。现状是
 *                 `b.y - dir*(15 + rank*3.5)`，**锚在球上**，所以球在禁区里怎么倒都跟着不动。
 *                 改为**锚在对方球门**：rank0 到禁区弧顶（约 18m），其后每人再退 6 单位，
 *                 同时保留「永不越过球」的下限（球距球门 + 6 + rank*5），否则第二线会跑到
 *                 球前面、变成第二个 `depthRelease`，归因就混了。现状那 15~22 单位的
 *                 落后量因此收窄到 6~16 单位。只改 `ty`，`tx` 一律保持引擎原值。
 *   `release{R}`  `_clampOffside`（`:3469`）在最后三区对 ATT/MID **把被削掉的纵深还回 R 单位**
 *                 （单调放松：只在夹取真的拉回了目标时生效，且不超过原始目标）。诊断实测
 *                 最后三区被削中位 6.15、p90 13.3 单位，所以取 R=4 与 R=8 两档。
 *                 依据是 Law 11 判的是**出脚瞬间球员的位置**，不是他跑位的终点；
 *                 引擎另有 `_pass:2925` 的越位快照负责真正的判罚，所以夹住**目标点**
 *                 等于把反越位的时间差一起禁掉。边后卫（`DEF-support|final`，同样被削
 *                 7.05 单位）**刻意不放开**——套边球员越过越位线不如前锋合理。
 *
 *   ⛔ 不要重跑的一版：第一版 `depthRelease` 写成「`legalY` 只取 `offY`、丢掉
 *      `min(offY, ball.y)` 那一项」。**那是错的**——min 的单调性决定去掉 ball 项只会让
 *      下界离球门更远或不变，所以它只可能**更严**。12 场实测确实近乎惰性且方向相反：
 *      越位 4.54→4.58、直塞 0.75→0.75、进球 2.92→2.92，而禁区触球 276.29→286.63、
 *      boxSeconds 1024→1068（把支援者压得更靠后 → 更多留区倒脚）。
 *      实测 85.3% 的夹取绑定在**越位线**而不是球上，要放松的是线那一项。
 *
 * **纯测量，不改仓库代码。** 接缝与随机数纪律：
 *   · 包装 `_thinkAttackOffBall`：**原方法先跑完**（它的 `random()` 全部照常消费），
 *     之后才覆写 `a.tx/a.ty`。覆写公式**全是状态与 id 的确定性函数，一个随机数都不取**。
 *   · 覆写后不自己调 `_clampOffside`：引擎随后的 `_applyAttackTactics:1237` 与
 *     `_commitOffBallTarget:1335` 会照常各夹一次，所以**每 tick 的 random() 调用次数与
 *     原版逐位相同**，档位之间的差异只来自行为改变，不掺 RNG 错位。
 *   · `depthRelease` 包装 `_clampOffside` 时**先调原方法**（缓冲与失误率照常消费），
 *     再用原方法自己缓存下来的 `a.offsideRunBuffer` 按「只看越位线」重算一次上界。
 *   · 分支归属用与 `_offball-target-branch-probe.mjs` **逐字相同**的分类器（纯函数，
 *     不消费随机数），保证档位作用的正是那份诊断量过的分支。
 *
 * 自检：control 档必须与未打包装的引擎逐场同分。
 *
 * 口径与既有探针一致：种子 372000..、能力 15、标准档、0.1s 步长。
 * 越位/射门/禁区触球按「每队每场」，传球/传中/直塞/进球/boxSeconds 按「合并双方每场」。
 * `boxSeconds` 与 `box-possession-sampling-audit` 逐字同口径（只算 held/control 的真实持球、
 * 合并两队），因此可直接与基线 1092.12 比。
 *
 * ⚠ 任何档位在采用前必须另跑 `node scripts/match-realism-audit.mjs 24`、
 * `node scripts/box-possession-sampling-audit.mjs` 与 `node scripts/box-defending-audit.mjs`
 * （`crowdedPairs` 上限 14、干净基线 12，余量只有 2，本表不测它）。
 *
 * 用法：node scripts/_final-third-movement-calibration-probe.mjs [场数=6]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

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
const ATTRS = [
  "pace", "shooting", "passing", "dribbling", "defending", "physical",
  "finishing", "tackling", "marking", "strength", "stamina", "vision",
  "reflexes", "handling", "positioning", "kicking", "decisions", "crossing",
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
    id: name,
    name,
    players,
    tactics: { formation: "4-3-3", lineup: players.map((p) => p.id), pressing: 3, tempo: 3, defensiveLine: 3 },
  };
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const METRES_X = SIM.PITCH_W_METRES / SIM.FIELD_W;
const METRES_Y = SIM.PITCH_H_METRES / SIM.FIELD_H;

// —— 目标纵深分布指标（2026-09-05：bug#1 的验收主指标，近静止% 降为次要）——
// 近静止% 已被证明对跑位杠杆几乎不响应（releasePass+wingRotate 只动 2pp），而且
// 「到位即停」本身是正常足球——病的是「位」：目标点全在球后、没有纵深。验收要读的是
// 「有没有人把目标点放进球前/防线身后的空间」。三个公式抽成纯函数，采样与启动自检
// 共用同一份实现，杜绝两处漂移。
// 符号约定与引擎一致：attackDir(home) = -1（攻向 y=0）、away = +1（攻向 y=100）。
// ⚠ 草案曾把列 1/2 写成 (b.y - a.ty)*dir / (lineY - a.ty)*dir——那是反的（home 球
//   y=30、好目标 y=25 会被判 -5.25m）。正确形式是「目标减参照」再乘 dir。
/** 目标领先球多少米（正=朝对方门推进；home 前插目标 y 比球小，负×负=正） */
function targetAheadM(ty, ballY, dir) {
  return (ty - ballY) * dir * METRES_Y;
}
/** 目标是否越过越位线（在越位线的对方球门一侧） */
function targetBeyondLine(ty, lineY, dir) {
  return (ty - lineY) * dir > 0;
}
/** 进攻者实际位置到越位线的签名距离（正=己方侧/线前，负=已越线） */
function distToLineM(y, lineY, dir) {
  return (lineY - y) * dir * METRES_Y;
}

// —— 符号自检：启动即验，错了一个直接退出，不许带病采样 ——
{
  const assertNear = (got, want, what) => {
    if (Math.abs(got - want) > 1e-6) {
      console.error(`❌ 符号自检失败：${what} 期望 ${want} 实测 ${got}`);
      process.exit(1);
    }
  };
  // home（dir=-1）球 y=30：前插目标 y=25 → +5.25m；回传目标 y=35 → -5.25m
  assertNear(targetAheadM(25, 30, -1), 5 * METRES_Y, "home 前插目标领先球");
  assertNear(targetAheadM(35, 30, -1), -5 * METRES_Y, "home 回传目标领先球");
  // away（dir=+1）球 y=70：前插目标 y=75 → +5.25m
  assertNear(targetAheadM(75, 70, 1), 5 * METRES_Y, "away 前插目标领先球");
  // 越线：home 线 y=15，目标 y=10 在对方门侧 → 越过；y=20 → 未越过；away 对称
  if (!targetBeyondLine(10, 15, -1)) { console.error("❌ 符号自检失败：home 越线应为真"); process.exit(1); }
  if (targetBeyondLine(20, 15, -1)) { console.error("❌ 符号自检失败：home 未越线应为假"); process.exit(1); }
  if (!targetBeyondLine(85, 80, 1)) { console.error("❌ 符号自检失败：away 越线应为真"); process.exit(1); }
  // 距线：home 线 y=15，人 y=20（己方侧）→ +5.25m；y=10（已越线）→ -5.25m
  assertNear(distToLineM(20, 15, -1), 5 * METRES_Y, "home 己方侧距线");
  assertNear(distToLineM(10, 15, -1), -5 * METRES_Y, "home 已越线距线");
  console.log("[自检] 目标纵深三列符号 ✅（home/away 双向、越线/未越线、前插/回传）");
}

// —— 真实参照值与现有护栏（AGENTS.md 真实参照总表 / match-realism-audit.mjs:362-370 /
//    box-possession-sampling-audit.mjs:397）——
const REAL = { offsideBand: [1.4, 2.1], offsideTarget: 1.7, shots: [11.9, 13.8], boxTouches: 26.1, through: 3.38 };
const GATE = {
  goals: [2.5, 3.3],
  passes: [800, 1250],
  crossSharePct: [3, 14],
  boxSecondsCeiling: 1200,
};

// ⚠ 2026-09-17：上面的 `GATE.goals = [2.5, 3.3]` 是 **`match-realism-audit` 口径**
//   （能力 13、含强弱对阵、24 场）的真实带。**本探针是另一个口径**
//   （能力 15、同强度、`SIM.DT` 0.1s），两者不可互相判定。
//
//   实测（同种子、同一探针文件、`git worktree` 各引擎实跑，见
//   `docs/measurements/` 与 `docs/offball-run-primitive-design-2026-09-17.md` §6.7）：
//       v251 524589d  12 场 2.50
//       v252 468816e  48 场 2.35
//       今日 3f10fd5  48 场 2.38
//       （同批四组 12 场读数 2.50 / 2.50 / 3.50 / 2.25 —— 12 场下 SE ≈ ±0.35）
//   ⇒ **本口径下没有任何历史版本进过 2.5**。若继续拿 2.5 当门，
//     等于给「跑动原语」预设一个历史版本从未满足的门槛，**任何档位都会被判失败**。
//
//   ⇒ 因此本探针分两条判据（都打印，不互相替代）：
//     ① `PROBE_BAND.goals` —— 本口径的历史值域，**只标注不判死**：
//        落在带内 = 与前三个版本同量级；越出 = 需要解释（真回归 或 真增益）。
//     ② `GATE.goals` —— 审计口径的真实带，**本探针不能自证**，
//        必须另跑 `node scripts/match-realism-audit.mjs 24` 才能判。
const PROBE_BAND = {
  // v251/v252/今日 三点：2.50 / 2.35 / 2.38 ⇒ 取 [2.2, 2.7]，
  // 下沿留 0.15 给抽样（12 场 SE ≈ 0.35 的一半），上沿留 0.2 到 2.50 + 余量。
  goals: [2.2, 2.7],
};

const ORIG = {
  think: SimEngine.prototype._thinkAttackOffBall,
  clamp: SimEngine.prototype._clampOffside,
};

/** 当前档位开关 */
const V = {
  wingRotate: false, midLate: false, release: 0, releaseMode: "always", runBehind: 0,
  // wingRotate 三个深度（后点/前点/中路，单位=距门线）；null=用引擎已落地的 7/13/16
  wingDepths: null,
  // 跑动原语：runCommit=开启承诺态，runLead=到达时刻的余量系数
  // runMargin=目标距越位线的安全余量（场地单位，1 ≈ 1.05m）——防惯性滑过线被判越位
  // runWindow=触发窗口（秒）：0=常驻（当前行为）；>0=仅「刚赢回球权后 runWindow 秒内」生效
  //   ——即设计文档 §6 档位表的 `holdPass`。窗口读引擎既有的 `_teamAttackSince[team]`
  //   （`:522` 声明、`:1697` 在球权交接时重置为 `this.t`），**不新增任何引擎状态**。
  runCommit: false, runLead: 1.0, runMargin: 0, runWindow: 0,
};

/**
 * 分支归属：与 `_offball-target-branch-probe.mjs` 的分类器逐字相同，
 * 顺序对应 `_thinkAttackOffBall` 的分支顺序。全部是纯函数，不消费随机数。
 */
function branchKeyOf(eng, a, ownerOk, prog, fsm, kind) {
  const finalThird = prog > 0.64;
  if (kind === "one-two") return "one-two";
  if (finalThird && a.role === "MID" && !eng._isPrimaryMidRunner(a)) return "mid-2nd-layer";
  if (finalThird && a.role === "DEF" && !eng._isFullback(a)) return "cb-hold";
  if (a.isCore && ownerOk) return "core-support";
  if (eng._isWinger(a)) return `wing-${fsm}`;
  return `${a.role}-${fsm}`;
}

/** 覆写计数（每个档位重置），用来确认档位真的作用到了预期的样本量上 */
let applied = { wingRotate: 0, midLate: 0, depthRelease: 0, runBehind: 0, runCommit: 0, runBlocked: 0, windowInside: 0, windowOutside: 0 };

// —— 跑动原语（设计见 docs/offball-run-primitive-design-2026-09-17.md §5）——
//   病是「目标分布没有纵深」：`_thinkAttackOffBall` 逐 tick 重算目标，
//   球员永远只需走几米就到位 ⇒ 任何目标点公式改动都只是「换个地方站住」。
//
//   本原语给目标附加 **到达时刻**：一旦为某球员选定一个「必须跑到」的目标，
//   在 `arriveBy` 之前**不接受新目标**——即使球的移动让「最优目标」变了，也先跑完。
//   位移因此真的产生，而不是换个地方站着。
//
//   承诺态的关键是**跨 tick 状态**：`_thinkAttackOffBall` 每次被调用时，
//   引擎已把 `a.ty` 覆写成本 tick 的最优值，所以必须在**覆写之后**把它掰回承诺值。
const commit = new Map(); // agent.id -> { ty, tx, arriveBy, t, dir }

/** 当前时刻（秒）。引擎用 `this.t` 累计，探针不额外取随机数。 */
function nowOf(eng) {
  return Number.isFinite(eng.t) ? eng.t : 0;
}

SimEngine.prototype._thinkAttackOffBall = function _thinkProbe(a, owner) {
  const ownerOk = !!(owner && owner.team === a.team && owner !== a);
  ORIG.think.call(this, a, owner);
  const dir = this.attackDir(a.team);
  const goalY = this.targetGoalY(a.team);
  const ownGoalY = a.team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
  const prog = Math.abs(this.ball.y - ownGoalY) / 100;

  // —— 跑动原语：跨 tick 承诺（先于其它档位，因为它要读到引擎刚覆写的 a.ty）——
  // 触发窗口（`holdPass`）：`V.runWindow > 0` 时，只有「本队刚赢回球权后 runWindow 秒内」
  // 才允许进入/维持承诺态。窗口读引擎既有的 `_teamAttackSince[team]`——它在球权交接时
  // 被重置为 `this.t`（`engine.js:1697`），语义正是「本队本次进攻始于何时」。
  // ⚠ 窗口是**进入条件**，不是「出了窗口就把已承诺的目标丢掉」：一旦进入承诺，
  //   就让它跑完（否则 `arriveBy` 到期前被打断，球员会在半路站住 —— 那正是要修的病）。
  const attackAge = this.t - (this._teamAttackSince[a.team] || 0);
  const windowOpen = V.runWindow <= 0 || attackAge <= V.runWindow;
  const t0 = nowOf(this);
  const heldNow = commit.get(a.id);
  // 「已在承诺中且未到期」不受窗口关闭影响 —— 让它跑完（见上）。
  const holding = !!(heldNow && t0 < heldNow.arriveBy && heldNow.dir === dir);
  if (V.runWindow > 0 && V.runCommit) {
    if (windowOpen || holding) applied.windowInside++;
    else applied.windowOutside++;
  }
  if (V.runCommit && (windowOpen || holding) && prog > 0.64) {
    const t = t0;
    // ① 已在承诺中且还没到点 ⇒ 掰回承诺目标，本 tick 不接受新目标
    const held = heldNow;
    if (holding) {
      a.tx = held.tx;
      a.ty = held.ty;
      applied.runCommit++;
      return;
    }
    // ② 到期或首次进入 ⇒ 按当前引擎目标与距离算一个新的到达时刻
    commit.delete(a.id);
    // 只给「该跑」的角色与分支：ATT 全部 + 主前插中场。
    // ⚠ 分支 key 是拼串（`${a.role}-${fsm}`），不要写死字面量——
    //   第一版我写了 `"att-support"`（小写），与 `"ATT-support"` 不匹配，
    //   会让 `eligible` **恒为假**、整个档位静默空转（覆写计数为 0）。
    //   这里改成按 `role` / `fsm` / `isCore` 直接判，绕开拼串。
    const key = branchKeyOf(this, a, ownerOk, prog, a.fsm, a.offBallTargetKind);
    // `mid-2nd-layer` = 纵深接应层（非主前插者），它的动机是「接应」不是「跑动」，
    // 按 §5 的触发条件排除在外；主前插中场由 `_isPrimaryMidRunner` 认。
    const isAttacker = a.role === "ATT" || this._isPrimaryMidRunner(a);
    const eligible = isAttacker && key !== "mid-2nd-layer" && key !== "cb-hold";
    if (!eligible) return;
    // 目标必须**不越位**（越位线以内）——越过防线的纵深仍由 `_clampOffside` 管。
    // 这条是 `release{R}` 失败的教训：允许把防线身后当目标 ⇒ 永久站在越位位置。
    //
    // ⚠ 2026-09-17：第一版直接在 `lineY` 上截断（`capped = min/max(ty, lineY)`），
    //   12 场实测**越位升到 2.67~3.42**（真实带 1.4~2.1）。原因是 `_isOffsidePosition`
    //   有 `tol = 0.45` 容差（`engine.js:4104`），而球员**带着惯性**跑到线上会滑过去；
    //   站位刚好贴线 ⇒ 极易被判越位。
    //   ⇒ 截断时退到线后方 `V.runMargin` 个单位（`var`，单位=场地单位 1 ≈ 1.05m）。
    const lineY = this._offsideLineY(a.team);
    const tyRaw = a.ty;
    if (Number.isFinite(lineY)) {
      const safeLine = lineY - dir * V.runMargin;
      const capped = a.team === "home" ? Math.min(tyRaw, safeLine) : Math.max(tyRaw, safeLine);
      if (Math.abs(capped - tyRaw) > 1e-9) applied.runBlocked++;
      a.ty = capped;
    }
    // 距离 → 到达时刻：按该球员可用速度（引擎的 `a.speedMax`，退化到 7.0 m/s）
    const speed = Number(a.speedMax) || 7.0;
    const dx = (a.tx - a.x) * 1.05;
    const dy = (a.ty - a.y) * 1.05;
    const dist = Math.hypot(dx, dy);
    // `V.runLead` = 余量系数：1.0 = 只给「跑得到」的时间；>1 = 多留余量（跑得更急）
    const arriveBy = t + (dist / speed) * V.runLead + 0.05;
    commit.set(a.id, { tx: a.tx, ty: a.ty, arriveBy, t, dir });
    applied.runCommit++;
    return;
  }
  if (!V.runCommit) commit.clear();

  if (!V.wingRotate && !V.midLate && !V.runBehind) return;
  const key = branchKeyOf(this, a, ownerOk, prog, a.fsm, a.offBallTargetKind);
  // u 单位远离对方球门（u>0 = 距球门线 u 个场地单位，1 单位 ≈ 1.05m）
  const fromGoal = (u) => clamp(goalY - dir * u, 3, 97);

  if (V.wingRotate && key === "wing-home") {
    // 边侧取**阵型侧**而不是 `_wingSide` 的当前 x：后者会在球员越过中线时翻面，
    // 造成目标点来回跳，量出来的位移会是伪影。
    const dep = V.wingDepths || { back: 7, near: 13, mid: 16 };
    const side = a.baseX < 50 ? -1 : 1;
    const ballOffset = this.ball.x - 50;
    const wide = Math.abs(ballOffset) > 8;
    if (wide && Math.sign(ballOffset) === -side) {
      a.tx = clamp(50 + side * 7, 8, 92);   // 球在对侧 → 抢后点
      a.ty = fromGoal(dep.back);
    } else if (wide) {
      a.tx = clamp(50 + side * 13, 6, 94);  // 球在本侧 → 前点/底线接应
      a.ty = fromGoal(dep.near);
    } else {
      a.tx = clamp(50 + side * 26, 5, 95);  // 球在中路 → 拉开宽度
      a.ty = fromGoal(dep.mid);
    }
    applied.wingRotate++;
    return;
  }

  if (V.midLate && key === "mid-2nd-layer") {
    // rank 与 `engine.js:3221-3225` 同法：同队 MID 按 id 排序后的序号
    const mids = this.agents
      .filter((m) => m.team === a.team && m.role === "MID")
      .sort((m, n) => String(m.id).localeCompare(String(n.id)));
    const rank = Math.max(0, mids.indexOf(a));
    // 锚在球门（rank0 到禁区弧顶 ≈18m），但**永不越过球**——第二线是接应层，
    // 目标点跑到球前面就变成第二个 depthRelease 了，会污染归因。
    const ballFromGoal = Math.abs(this.ball.y - goalY);
    a.ty = fromGoal(Math.max(17 + rank * 6, ballFromGoal + 6 + rank * 5));
    applied.midLate++; // 只改纵深，tx 保持引擎原值
    return;
  }

  // —— 跑位时间差（bug#1 轨道2 原语）：只给「当前在线后」的跑动者放纵深 ——
  // Law 11 判的是**出脚瞬间**的位置：起跑在线后、球到时前插到位，是合法的反越位。
  // 已越线者刻意不放——不许常驻防线身后（release8 常开=越位 58 的反例）。
  // 出脚瞬间的越位判定照旧由 `_pass` 的快照 + `okOffside ±2` 容差负责：
  // 起跑失误（_clampOffside 的 mistimeChance）造成的越位才是真实 1.7 的来源机制。
  if (V.runBehind && (a.role === "ATT" || this._isPrimaryMidRunner(a))) {
    const lineY = this._offsideLineY(a.team);
    if (Number.isFinite(lineY)) {
      // ownSide：实际位置在越位线己方侧（容差 0.5 单位 ≈ 0.5m，贴线起跑算合法）
      const ownSide = (lineY - a.y) * dir > -0.5;
      if (ownSide) {
        a.ty = clamp(lineY + dir * V.runBehind, 3, 97); // 目标=线后 R 单位；tx 保持引擎原值
        applied.runBehind++;
      }
    }
  }
};

SimEngine.prototype._clampOffside = function _clampProbe(a) {
  const preTy = a.ty;
  ORIG.clamp.call(this, a);
  if (!V.release) return;
  if (a.role !== "ATT" && a.role !== "MID") return; // 边后卫刻意不放开
  const ownGoalY = a.team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
  if (Math.abs(this.ball.y - ownGoalY) / 100 <= 0.64) return;
  // `pass` 档：只在**球已经飞在路上、且他就是预定接球人**时放开。
  // 这才是 Law 11 里合法的反越位插上——越位快照在 `_pass:2925` 出脚那一刻就取好了，
  // 出脚时不越位、球飞行途中越过防线**不构成越位**。所以这一档预期不该推高判罚。
  if (V.releaseMode === "pass") {
    const b = this.ball;
    if (!b || b.state !== "pass" || b.receiverId !== a.id) return;
  }
  // 单调放松：只在原方法**真的把目标拉回来了**的时候，把被削掉的纵深还回 R 单位，
  // 且绝不超过原始目标。夹取后的 `a.ty` 就是引擎算出的那个下界，直接拿来减。
  //
  // ⚠ 第一版写成「legalY 只取 offY、丢掉 min(..., ball.y) 那一项」是**错的**：
  //   min 的单调性决定了去掉 ball 项只会让下界离球门更远或不变，
  //   即那一版只可能**更严**、绝不可能更松（12 场实测越位 4.54→4.58、直塞 0.75→0.75、
  //   进球 2.92→2.92，禁区触球反升 10 次，与「变严」一致）。不要照那版重跑。
  //   实测 85.3% 的夹取绑定在**越位线**上而不是球上，所以要放松的是线那一项。
  const R = V.release;
  const before = a.ty;
  if (a.team === "home") {
    if (a.ty > preTy) a.ty = Math.max(preTy, a.ty - R);
  } else {
    if (a.ty < preTy) a.ty = Math.min(preTy, a.ty + R);
  }
  if (Math.abs(a.ty - before) > 1e-9) applied.depthRelease++;
};

const matches = Math.max(1, Number(process.argv[2]) || 6);
const seeds = Array.from({ length: matches }, (_, i) => 372000 + i);
const SAMPLE_EVERY = 5; // 每 0.5 秒采一次跑位画像，够稳且不拖慢六个档位

function runMatch(seed) {
  const restore = Math.random;
  Math.random = seededRandom(seed);
  try {
    const eng = new SimEngine(club(`h${seed}`, 15), club(`a${seed}`, 15), {
      simulationProfile: "standard",
      timeStep: SIM.DT,
      separationPasses: 8,
    });
    const steps = Math.round((90 * 60) / SIM.DT);
    const t = {
      offsides: 0, passes: 0, crosses: 0, through: 0, shots: 0, goals: 0,
      corners: 0, boxTouches: 0, boxSeconds: 0, finalThirdSeconds: 0,
      offBallSamples: 0, nearStatic: 0, speedSum: 0, targetDistSum: 0,
      // 诊断（2026-09-05）：把「近静止」切成「已到位（该静止）」vs「离目标≥2m 却不动（真病）」，
      // 并记录真病样本处于什么 fsm，一锤定音病根在决策层还是移动层。
      staticArrived: 0, staticStranded: 0, strandedFsm: {},
      // 目标纵深分布（验收主指标）：领先≥5m 占比、领先中位、越过越位线占比、距线中位。
      // 数组用完即弃（sweep 聚合后），只在这一场内累积。
      ahead5: 0, beyondCnt: 0, lineSamples: 0, aheadArr: [], distLineArr: [],
    };
    for (let s = 0; s < steps; s++) {
      eng.step(SIM.DT);

      // —— boxSeconds：与 box-possession-sampling-audit.mjs:185-217 逐字同口径 ——
      const b = eng.ball;
      const owner = b.owner ? eng.agentById(b.owner) : null;
      const defendingTeam = eng._inOwnFoulBox("home", b.x, b.y)
        ? "home"
        : eng._inOwnFoulBox("away", b.x, b.y)
          ? "away"
          : null;
      if (
        owner && defendingTeam && owner.team !== defendingTeam &&
        (b.state === "held" || b.state === "control")
      ) {
        t.boxSeconds += SIM.DT;
      }

      // —— 最后三区的无球跑位画像（档位想改的正是这一项）——
      // `finalThirdSeconds` 每 tick 都数：它是 boxSeconds 的分母。放开纵深会造成大量
      // 越位停顿，若不做归一，boxSeconds 下降有可能只是「球被判罚拿走了」的假象。
      {
        const attTeam0 = eng.possession;
        if (attTeam0 === "home" || attTeam0 === "away") {
          const ownGoalY0 = attTeam0 === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
          if (Math.abs(b.y - ownGoalY0) / 100 > 0.64) t.finalThirdSeconds += SIM.DT;
        }
      }
      if (s % SAMPLE_EVERY === 0) {
        const attTeam = eng.possession;
        if (attTeam === "home" || attTeam === "away") {
          const ownGoalY = attTeam === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
          if (Math.abs(b.y - ownGoalY) / 100 > 0.64) {
            // dir/越位线每 tick 算一次（防守方不足 2 人时 _offsideLineY 返回 null，跳过线指标）
            const dir = attTeam === "home" ? -1 : 1;
            const lineY = eng._offsideLineY(attTeam);
            const hasLine = Number.isFinite(lineY);
            for (const a of eng.agents) {
              if (a.team !== attTeam || a.sentOff || a.role === "GK") continue;
              if (owner && a.id === owner.id) continue; // 持球人的慢是带球，不算跑位
              const speed = Math.hypot((a.vx || 0) * METRES_X, (a.vy || 0) * METRES_Y);
              t.offBallSamples++;
              t.speedSum += speed;
              const targetDist = Math.hypot((a.tx - a.x) * METRES_X, (a.ty - a.y) * METRES_Y);
              if (speed < 1) {
                t.nearStatic++;
                // 离目标 <1.5m = 已到位，该静止；≥1.5m 却不动 = 真病（该跑没跑）
                if (targetDist < 1.5) t.staticArrived++;
                else {
                  t.staticStranded++;
                  const key = `${a.role}|${a.fsm || "?"}`;
                  t.strandedFsm[key] = (t.strandedFsm[key] || 0) + 1;
                }
              }
              t.targetDistSum += targetDist;
              // —— 目标纵深分布（验收主指标）——
              const aheadM = targetAheadM(a.ty, b.y, dir);
              t.aheadArr.push(aheadM);
              if (aheadM >= 5) t.ahead5++;
              if (hasLine) {
                t.lineSamples++;
                if (targetBeyondLine(a.ty, lineY, dir)) t.beyondCnt++;
                t.distLineArr.push(distToLineM(a.y, lineY, dir));
              }
            }
          }
        }
      }
    }
    for (const ev of eng.events) {
      if (ev.type === "offside") t.offsides++;
      else if (ev.type === "shot") t.shots++;
      else if (ev.type === "goal") t.goals++;
      else if (ev.type === "corner") t.corners++;
      if (ev.type === "pass") {
        t.passes++;
        if (ev.cross) t.crosses++;
        if (ev.through && !ev.cross) t.through++;
      }
      if (ev.type === "pass" || ev.type === "shot" || ev.type === "receive") {
        if ((ev.team === "home" || ev.team === "away") && Number.isFinite(ev.x) && Number.isFinite(ev.y)) {
          const opp = ev.team === "home" ? "away" : "home";
          if (eng._inOwnFoulBox(opp, ev.x, ev.y)) t.boxTouches++;
        }
      }
    }
    return { score: `${eng.score.home}-${eng.score.away}`, ...t };
  } finally {
    Math.random = restore;
  }
}

const LEVELS = [
  { label: "control 现状", set: {} },
  { label: "release8 常开（复现）", set: { release: 8 } },
  { label: "releasePass 只在传球飞行中", set: { release: 8, releaseMode: "pass" } },
  { label: "releasePass + wingRotate", set: { release: 8, releaseMode: "pass", wingRotate: true } },
  // 轨道 2（跑位时间差）：落地 wingRotate 后的引擎上再标定纵深档
  { label: "runBehind4 线后4单位", set: { runBehind: 4 } },
  { label: "runBehind8 线后8单位", set: { runBehind: 8 } },
  // wingRotate 深度重标定：落地版 7/13/16 把边锋常驻进了禁区（点球 0.58 破上限、
  // 未标记近距机会 62.3 破 58、crowdedPairs 2.67→4.17），试禁区边缘外的深度
  { label: "wingD 11/15/16", set: { wingRotate: true, wingDepths: [11, 15, 16] } },
  { label: "wingD 9/14/16", set: { wingRotate: true, wingDepths: [9, 14, 16] } },
  { label: "wingD 12/16/17", set: { wingRotate: true, wingDepths: [12, 16, 17] } },
  // —— 跑动原语（§5）：给目标附加 arriveBy，到点前不接受新目标 ——
  //   runLead=1.0「只给跑得到的时间」；2.0/3.0 让球员跑得更急（到达时刻更早 ⇒ 承诺更短）
  { label: "runC1.0 承诺·只给跑得到", set: { runCommit: true, runLead: 1.0 } },
  { label: "runC2.0 承诺·留 2 倍余量", set: { runCommit: true, runLead: 2.0 } },
  { label: "runC3.0 承诺·留 3 倍余量", set: { runCommit: true, runLead: 3.0 } },
  // 越位配平：目标退到线后 m 单位（runMargin），压 `runC*` 推高的越位
  { label: "runC1.0+margin2 线后2", set: { runCommit: true, runLead: 1.0, runMargin: 2 } },
  { label: "runC1.0+margin4 线后4", set: { runCommit: true, runLead: 1.0, runMargin: 4 } },
  { label: "runC1.0+margin6 线后6", set: { runCommit: true, runLead: 1.0, runMargin: 6 } },
  // —— `holdPass`（设计文档 §6 档位表，本轮首实现）——
  //   触发窗口：仅「刚赢回球权后 N 秒内」才允许进入承诺态（已在承诺中的跑完）。
  //   目的：压 `runC*` 常驻触发造成的 boxSec 回升（818 vs 679），同时保留纵深改善。
  //   基线一律取配平点 margin2（越位 1.88 进带），这样与 margin 档可直接对照。
  { label: "holdPass6 赢球后6s", set: { runCommit: true, runLead: 1.0, runMargin: 2, runWindow: 6 } },
  { label: "holdPass8 赢球后8s", set: { runCommit: true, runLead: 1.0, runMargin: 2, runWindow: 8 } },
  { label: "holdPass4 赢球后4s", set: { runCommit: true, runLead: 1.0, runMargin: 2, runWindow: 4 } },
  { label: "holdPass10 赢球后10s", set: { runCommit: true, runLead: 1.0, runMargin: 2, runWindow: 10 } },
];

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((p, q) => p - q);
  return Number(s[Math.floor(s.length / 2)].toFixed(2));
}

function sweep(level) {
  V.wingRotate = !!level.set.wingRotate;
  V.midLate = !!level.set.midLate;
  V.release = Number(level.set.release) || 0;
  V.releaseMode = level.set.releaseMode || "always";
  V.runBehind = Number(level.set.runBehind) || 0;
  V.wingDepths = Array.isArray(level.set.wingDepths) ? level.set.wingDepths : null;
  V.runCommit = !!level.set.runCommit;
  V.runLead = Number(level.set.runLead) || 1.0;
  V.runMargin = Number(level.set.runMargin) || 0;
  V.runWindow = Number(level.set.runWindow) || 0;
  commit.clear();
  applied = { wingRotate: 0, midLate: 0, depthRelease: 0, runBehind: 0, runCommit: 0, runBlocked: 0, windowInside: 0, windowOutside: 0 };
  const agg = {
    offsides: 0, passes: 0, crosses: 0, through: 0, shots: 0, goals: 0,
    corners: 0, boxTouches: 0, boxSeconds: 0, finalThirdSeconds: 0,
    offBallSamples: 0, nearStatic: 0, speedSum: 0, targetDistSum: 0,
    staticArrived: 0, staticStranded: 0,
    ahead5: 0, beyondCnt: 0, lineSamples: 0,
  };
  const strandedFsm = {};
  const aheadArr = [];
  const distLineArr = [];
  const scores = [];
  for (const seed of seeds) {
    const r = runMatch(seed);
    scores.push(r.score);
    for (const k of Object.keys(agg)) agg[k] += r[k];
    for (const [k, v] of Object.entries(r.strandedFsm || {})) strandedFsm[k] = (strandedFsm[k] || 0) + v;
    // 数组不能 push(...r.x) 展开——几十万元素会爆调用栈
    for (const v of r.aheadArr) aheadArr.push(v);
    for (const v of r.distLineArr) distLineArr.push(v);
  }
  V.wingRotate = V.midLate = false;
  V.release = 0;
  V.releaseMode = "always";
  V.runBehind = 0;
  V.wingDepths = null;
  const per = (n) => Number((n / matches).toFixed(2));
  const perTeam = (n) => Number((n / matches / 2).toFixed(2));
  const share = (n, d) => Number(((n / Math.max(1, d)) * 100).toFixed(1));
  return {
    scores,
    越位: perTeam(agg.offsides),
    传球: per(agg.passes),
    传中占比: Number(((agg.crosses / Math.max(1, agg.passes)) * 100).toFixed(2)),
    射门: perTeam(agg.shots),
    进球: per(agg.goals),
    角球: per(agg.corners),
    禁区触球: perTeam(agg.boxTouches),
    直塞: per(agg.through),
    boxSeconds: per(agg.boxSeconds),
    最后三区秒: per(agg.finalThirdSeconds),
    "boxSec占最后三区%": share(agg.boxSeconds, agg.finalThirdSeconds),
    近静止占比: share(agg.nearStatic, agg.offBallSamples),
    "静止-已到位%": share(agg.staticArrived, agg.offBallSamples),
    "静止-该跑没跑%": share(agg.staticStranded, agg.offBallSamples),
    "目标领先球≥5m%": share(agg.ahead5, agg.offBallSamples),
    "目标领先球中位m": median(aheadArr),
    "目标越过线%": share(agg.beyondCnt, agg.lineSamples),
    "距防线中位m": median(distLineArr),
    strandedFsm,
    均速: Number((agg.speedSum / Math.max(1, agg.offBallSamples)).toFixed(2)),
    目标距离m: Number((agg.targetDistSum / Math.max(1, agg.offBallSamples)).toFixed(2)),
    applied: { ...applied },
  };
}

console.log(`\n=== 最后三区无球跑位的标定曲线（${matches} 场，种子 ${seeds[0]}..${seeds[seeds.length - 1]}）===`);

// [0] 自检：control 必须与未打包装的引擎逐场同分
const patchedThink = SimEngine.prototype._thinkAttackOffBall;
const patchedClamp = SimEngine.prototype._clampOffside;
SimEngine.prototype._thinkAttackOffBall = ORIG.think;
SimEngine.prototype._clampOffside = ORIG.clamp;
const bare = seeds.map((s) => runMatch(s).score).join(" ");
SimEngine.prototype._thinkAttackOffBall = patchedThink;
SimEngine.prototype._clampOffside = patchedClamp;
const control = sweep(LEVELS[0]);
const faithful = bare === control.scores.join(" ");
console.log("\n[0] 包装自检 —— control 档必须与未打包装的引擎逐场同分：");
console.log({ 未打包装: bare, control: control.scores.join(" "), 判定: faithful ? "✅ 一致" : "❌ 不一致，整表作废" });
if (!faithful) process.exit(1);

console.log("\n[1] 🔑 标定曲线（★ = 越位落进 1.4~2.1，⚠ = 撞护栏）：");
// 第二个 CLI 参数：逗号分隔的档位名子串过滤（如 "control,wingD"），空=全跑
const only = (process.argv[3] || "").split(",").filter(Boolean);
const rows = [];
for (const level of LEVELS) {
  if (only.length && !only.some((s) => level.label.includes(s))) continue;
  const r = level === LEVELS[0] ? control : sweep(level);
  rows.push({ label: level.label, ...r });
  // 逐场比分：落地忠实性校验靠它（引擎内嵌版 control 必须 ≡ 探针包装档的逐场比分）
  console.log(`  [比分] ${level.label}: ${r.scores.join(" ")}`);
  const inBand = r.越位 >= REAL.offsideBand[0] && r.越位 <= REAL.offsideBand[1];
  const warn = [];
  // ① 本口径历史值域（软标注：越出要解释，不直接判死）
  if (r.进球 < PROBE_BAND.goals[0] || r.进球 > PROBE_BAND.goals[1]) warn.push("进球越本口径值域");
  if (r.传球 < GATE.passes[0] || r.传球 > GATE.passes[1]) warn.push("传球量");
  if (r.传中占比 < GATE.crossSharePct[0] || r.传中占比 > GATE.crossSharePct[1]) warn.push("传中占比");
  if (r.boxSeconds > GATE.boxSecondsCeiling) warn.push("boxSeconds");
  if (r.射门 < REAL.shots[0] || r.射门 > REAL.shots[1]) warn.push("射门离真实带");
  console.log(
    `${inBand ? "★" : " "} ${level.label.padEnd(24)} ` +
      `越位 ${String(r.越位).padStart(5)}  ` +
      `进球 ${String(r.进球).padStart(4)}  ` +
      `射门 ${String(r.射门).padStart(5)}  ` +
      `传球 ${String(r.传球).padStart(7)}  ` +
      `传中 ${String(r.传中占比).padStart(5)}%  ` +
      `禁区触球 ${String(r.禁区触球).padStart(6)}  ` +
      `boxSec ${String(r.boxSeconds).padStart(7)}  ` +
      `直塞 ${String(r.直塞).padStart(4)}` +
      (warn.length ? `  ⚠${warn.join("/")}` : "")
  );
}

console.log("\n[2] 档位到底有没有改到跑位（最后三区、非持球、每 0.5s 采样）：");
for (const r of rows) {
  const windowLabel = LEVELS.find((l) => l.label === r.label)?.set?.runWindow > 0;
  console.log(
    `  ${r.label.padEnd(24)} 近静止 ${String(r.近静止占比).padStart(5)}%  ` +
      `均速 ${String(r.均速).padStart(4)} m/s  ` +
      `目标距离 ${String(r.目标距离m).padStart(5)} m  ` +
      `最后三区 ${String(r.最后三区秒).padStart(7)}s  ` +
      `boxSec占比 ${String(r["boxSec占最后三区%"]).padStart(5)}%  ` +
      `覆写 wing=${r.applied.wingRotate} mid=${r.applied.midLate} clamp=${r.applied.depthRelease} run=${r.applied.runBehind}` +
      (r.applied.runCommit
        ? `  承诺 commit=${r.applied.runCommit} 越位线截断=${r.applied.runBlocked}` +
          (windowLabel
            ? `  窗口内=${r.applied.windowInside} 窗口外=${r.applied.windowOutside}`
            : "")
        : "")
  );
}

console.log("\n[2b] 🔬 近静止拆分（把「站着」切成：已到位=该静止 vs 该跑没跑=真病）：");
for (const r of rows) {
  const top = Object.entries(r.strandedFsm || {})
    .sort((p, q) => q[1] - p[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}:${v}`)
    .join("  ");
  console.log(
    `  ${r.label.padEnd(24)} ` +
      `已到位 ${String(r["静止-已到位%"]).padStart(5)}%  ` +
      `该跑没跑 ${String(r["静止-该跑没跑%"]).padStart(5)}%  ` +
      `| 该跑没跑的 role|fsm 前五：${top}`
  );
}

console.log("\n[2c] 🎯 目标纵深分布（bug#1 验收主指标：眼见的「不跑」= 目标分布没纵深）：");
for (const r of rows) {
  console.log(
    `  ${r.label.padEnd(24)} ` +
      `领先≥5m ${String(r["目标领先球≥5m%"]).padStart(5)}%  ` +
      `领先中位 ${String(r["目标领先球中位m"]).padStart(6)}m  ` +
      `越过线 ${String(r["目标越过线%"]).padStart(5)}%  ` +
      `距防线中位 ${String(r["距防线中位m"]).padStart(6)}m`
  );
}

console.log("\n[3] 真实参照与护栏（⚠ 注意口径！）：");
console.log({
  "越位 目标/带（每队每场）": `${REAL.offsideTarget}（${REAL.offsideBand.join("~")}）`,
  "射门 真实/队场": REAL.shots.join("~"),
  "禁区触球 真实/队场": `${REAL.boxTouches}（20~30）`,
  "直塞 真实/场（双方合计尝试）": REAL.through,
  "进球 本探针口径值域（软标注）": `${PROBE_BAND.goals.join("~")} ← v251 2.50 / v252 2.35 / 今日 2.38`,
  "进球 审计口径真实带（本探针不能自证）": `${GATE.goals.join("~")} ← 须另跑 match-realism-audit.mjs 24`,
  "护栏 传球/场": GATE.passes.join("~"),
  "护栏 传中占比": `${GATE.crossSharePct.join("~")}%`,
  "护栏 boxSeconds/场": `≤${GATE.boxSecondsCeiling}（基线 1092.12）`,
});

console.log("\n[4] 读法：");
console.log(
  [
    "· 验收主指标 = [2c] 的目标纵深分布（领先≥5m 占比 / 领先中位 / 越过线占比 / 距防线中位）；",
    "  近静止% 只作次要参考——它对跑位杠杆几乎不响应（releasePass+wingRotate 只动 2pp），",
    "  且「到位即停」本身正常，病在「位」没有纵深。",
    "· 想看到的方向：boxSeconds / 禁区触球下降、直塞上升、[2c] 纵深三列上移，而进球留在本口径值域内。",
    `· ⚠ 进球判据有两条口径，别混用：本探针口径值域 ${PROBE_BAND.goals.join("~")}（历史三点 2.50/2.35/2.38，`,
    `  史无版本进过 2.5）；审计口径真实带 ${GATE.goals.join("~")}（能力 13、含强弱，须另跑 match-realism-audit）。`,
    "  拿 2.5 当本探针的门 = 预设一个历史从未满足的门槛，任何档位都会被判失败。",
    "· 判决用相对量：同种子 48 场、同探针对 control 做 A/B，进球只要求**不显著下降**",
    "  （48 场下差异需 >0.34 才算有差；12 场 SE ≈ ±0.35，**12 场不能看进球**）。",
    "· `depthRelease` 预期会推高越位（现状已是 4.56、真实 1.7）。它不是独立可采用项——",
    "  要与 v241 标定好的 `peelB`+`hardA` 成对，那一对备着 4.54 → 2.04 的下调预算。",
    "· 本表不测 `box-defending-audit` 的 `crowdedPairs`（上限 14、干净基线 12，余量只有 2）。",
    "  任何提高禁区占用的档位都要单独跑它，留档二里两个阻尼值都把它顶到 17。",
    "· 覆写次数为 0 的档位说明分类器没命中，先查 `branchKeyOf` 再读数字。",
  ].join("\n")
);
