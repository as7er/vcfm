import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const checks = [
  "js/matchview-fsm.test.js",
  "js/matchview-coords.test.js",
  "js/matchview-intro.test.js",
  "js/matchview-director.test.js",
  "scripts/cache-audit.mjs",
  "scripts/save-durability-audit.mjs",
  "scripts/save-schema-audit.mjs",
  "scripts/replay-ui-audit.mjs",
  "scripts/match-presentation-audit.mjs",
  "scripts/match-continuity-audit.mjs",
  // 角球侧别：`js/match.js` 的角球是统计事件（不模拟球出底线），所以侧别必须在
  // 生成事件时掷一次并写进 `cornerX`；表现层的**两条**路径（sim 的
  // `_stageCornerSetPiece` 与非 sim 的内联 `case "corner"`）都必须照读，不能
  // 各自 `Math.random() < 0.5` 掷骰子——否则同一角球的文字与画面会互相矛盾，
  // 用户 2026-09-20 报的就是「从另一侧底线开角球」。
  "scripts/corner-side-consistency-verify.mjs",
  // 角球侧别的**动态**防线（2026-09-20）：上面那条是静态断言（读源码），
  // 防不住「代码对了但数据不对」；这条真跑 24 场整场模拟，断言每个角球事件
  // 都带合法 `cornerX`（∈{2,98}）、左右分布无偏、侧别序列随场次变化，
  // 并**显式断言样本 > 0**（防「0 场 0 角球」空真通过）。
  // 耗时实测 ~22 秒，相对全量 57 分钟可忽略 ⇒ 值得常驻。
  "scripts/corner-side-e2e-probe.mjs",
  // 全屏观赛（2026-09-20）：手机横持视口高只有 ~390px，浏览器工具栏还要吃掉
  // ~95px（dvh≈295）——**这才是「手机横屏看比赛还是太小」的根因**，不是 CSS 没调好。
  // 进全屏后 dvh 直接等于屏幕高。本检查只做**静态接线**（1 秒），守：
  //   按钮默认 `hidden`（iPhone Safari 不支持任意元素全屏，否则是个死按钮）、
  //   能力检测读 `fullscreenEnabled` 而非 UA、全屏宿主是整块比赛界面（否则进不去退不出）、
  //   离开比赛界面退出全屏、CSS 的 `[hidden]` 与 `:fullscreen` 两个特异性坑、i18n 双语键。
  // ⚠ 浏览器级验证在 `scripts/mobile-pitch-adaptation-verify.mjs` 的 ②c 用例，
  //   它要跑 134 场联赛（~3 分钟/上下文）⇒ 只能手动跑，未常驻本套件。
  "scripts/mobile-fullscreen-wiring-verify.mjs",
  // 切段淡场（2026-09-21 v277）：用户报「整队瞬移」已判决为场景切换，
  // 但遮罩峰值 72%、reduced-motion 下完全透明、开球因 Number(null)===0 多闪一次。
  // 本检查只做**静态 + 替身行为**（1 秒）：守 `== null` 守卫、keyframes 峰值 1 + 保持曲段、
  // reduced-motion 静态全遮、`_playSegmentCut` 到时摘 class。
  // ⚠ 跳变帧真实 fadeOpacity 由 `scripts/_segment-boundary-displacement.mjs` 量，
  //   要 Playwright，未常驻本套件。
  "scripts/segment-cut-fade-verify.mjs",
  // 中场体能「按跑动距离占比分摊」（2026-09-21）：用户已拍板的
  // 「读引擎 agent.fitness 回写」实测修不好「中场全队同值」（个体 spread 只有 0.39），
  // 改成用引擎累计的**真实跑动距离**分摊。本检查守：`runMetres` 在 engine.js 里
  // **只写不读**（纯计数器 ⇒ 不影响物理）、结算实现唯一且四处调用点都走它、
  // **球队总量精确守恒**（Σ 差 = 名义扣减 × 人数 × 结算次数，实测 33.000000）、
  // 队内出现差异且排序与跑动距离一致、概率引擎路径（无 simEng）仍走等额回退。
  "scripts/fitness-distance-share-verify.mjs",
  // 终场体能「按跑动距离占比分摊」（2026-09-21，方案 E）：终场这笔 4~9 点
  // （均值 6.5，**比中场那 6 点还大**）原先也是逐人掷骰子，与跑动无关 ——
  // 实测这一笔与跑动的 Spearman 只有 **-0.007**，把整场总扣减的相关性从中场那半的
  // 0.890 稀释到 **0.481**。**只有一半**的体能扣减是因果的，用户最初报的
  // 「各队员体能显示不对」就是这一半。本检查守：严格比例分摊（比值恒定）、
  // 球队总量仍落在旧骰子区间（零重标定）、`runMetres` 清零时**退回旧的等额掷骰**
  // （读档重建 / 概率引擎路径），且两支路 `rng()` 抽取次数相同（不平移随机流）。
  // ⚠ 约 30 秒；要 Playwright 的整场对照见 `scripts/_fitness-finalize-drain-probe.mjs`。
  "scripts/fitness-finalize-drain-verify.mjs",

  // 换边方向/端别（2026-09-22）：审计发现引擎里有一整类「用队名隐式表达方向」的写法
  // （`restartTeam === "home" ? 5 : 95` 之类）—— 上半场恰好正确，**下半场成批失效**：
  // 进球记给错队（还会被判成乌龙）、门将站进球网、越位失效、前场任意球整队摆到另一端。
  // 🔴 原有的 42 例换边检查 + 24 场角球探针**全都没抓到**，因为它们只问「总进球数」
  // 「射门纵深」这类**总量**指标，没有一条问「**这个球是谁进的**」「门将站在哪」
  // —— **判据选错**，不是探针坏了。本检查逐点断言方向/端别，两种换边取值都跑。
  // 约 2 秒，不需要浏览器。
  "scripts/ends-swap-verify.mjs",

  // 战术响应（2026-09-22）：「战术参数 → 逐人位置」此前**只有 `defensiveLine` 一条 e2e 链**，
  // 而 `width` / `tempo` / `style` 在 scripts/ 里只作 fixture 字面量出现、从没被扫过 ⇒
  // 「旋钮死了 / 响应反了」可以长期全绿。本检查把四个旋钮钉成回归（约 9 秒）：
  // `width` → 横向、`defensiveLine` / `pressing` → `_defLineY`（**直接量**，零噪声）、
  // `tempo` → 持球时长；另含「两处模块对 regroup/counterPress 必须一致」的静态断言。
  // ⚠ 教训：判据要量「**旋钮代码里直接改的那个量**」——
  //   第一版用「传球数」判 `tempo` 得出「tempo 是死的」，是**判据选错**（见归档）；
  //   快档第一版用行为量判 `defensiveLine`/`pressing` 也把信号稀释了（3.4/1.2 格），
  //   改成直接调 `_defLineY()` 后零噪声。
  //   同轮唯一落地的行为改动：`pressing` 现会**轻推防线**（原来防线完全不跟它）。
  //   「反击」语义（该不该"丢球后回收"）试改过、**已撤回**：证据只有 0.43σ，且会推翻既有断言。
  "scripts/tactics-response-verify.mjs",

  // 重开直播提示（2026-09-22 v281）：用户报「直播一段时间后重开，画面好像一样」。
  // 已查清**不是 bug 是设计**（`openMatch` 无条件重置 + `fromMin` 硬编码 1 + `matchSeed`
  // 随存档保留 ⇒ 重放逐位相同）。本检查守那一轮的「提示 + 替代动作」：
  // 进度写入必须在 `setMatchMinute` 里**且被 `!reset` 守卫**（否则 `openMatch` 的
  // `setMatchMinute(0,{reset:true})` 会把进度写成 0′、弹窗从此永不出现）、
  // 弹窗必须双语且**不得承诺续播**（续播本轮未实现）。
  // ⚠ 纯静态 + 7 项变异测试（瞬时）。**弹窗是否真的出现**由
  //   `npm run test:reopen-browser` 用真实 Chromium 验 —— 静态断言证明不了这件事，
  //   本仓库有「单测全绿但画面上什么都没发生」的血例（见 AGENTS.md ③）。
  "scripts/reopened-match-notice-audit.mjs",
  // 主动突破原语护栏：`beat`/场 落在 [2.68, 5.18]，基线 3.93，半边 1.25（=2SE）。
  // 半边由 96 场噪声标定实测（SD_batch 0.62 @12 场/批），**不是拍脑袋**。
  // ⚠ 24 场只能判「大幅消失 / 大幅爆表」；辨出 1/场 需每组 37 场（本审计不承诺更细）。
  // 原语默认关闭，本审计自己显式打开开关跑（否则读数恒 0，会顶破下沿）。
  "scripts/beat-guardrail-audit.mjs",
  // 评分榜口径：门槛（联赛 ≥10 / 赛事 ≥4）+ 6 处文案一致性 + 用真实评分公式
  // 做蒙特卡洛复现「低出场高均分占榜」（用户 2026-09-19 报告）。
  // 同时断言「旧门槛确实复现」与「新门槛确实清零」，两边都测才防得住回退。
  "scripts/ratings-leaderboard-audit.mjs",
  // 官员跑位：import 真正的 `MatchView.prototype._updateOfficials`，用替身 `this` 驱动，
  // 球的轨迹来自真 `SimEngine`（2 场约 17s）。verify 此前完全没覆盖 officials，
  // 用户三次报「主裁和球同步瞬移 / 比追球球员还快 / 距离被锁死」全靠肉眼发现。
  // DOM 那一半（R/A 字母、圆点尺寸）由 `npm run test:officials-browser` 覆盖。
  "scripts/officials-presentation-audit.mjs",
  "scripts/match-motion-integrity-audit.mjs",
  // 默认 4+4 场（约 60s）：把 v238 诊断的「进攻时队形纵向被拉长」钉成回归断言。
  // role-noGK 口径基线 = 己方 37.0 / 中场 37.8 / 进攻三区 63.3~63.8 m，
  // 进攻三区内 DEF→ATT 跨度 60.0 m ≈ 4-3-3 静态模板 59.85 m（= 缺少 team block 平移+压缩）。
  // 阈值按「现状 + 余量」设，所以改好会通过、改坏会失败；另有下限防「压成一团」。
  "scripts/attack-shape-compaction-audit.mjs",
  "scripts/off-ball-movement-audit.mjs",
  "scripts/match-broadcast-audit.mjs",
  "scripts/pass-speed-audit.mjs",
  "scripts/pass-routing-audit.mjs",
  "scripts/pass-support-audit.mjs",
  "scripts/support-offer-audit.mjs",
  "scripts/press-shadow-geometry-audit.mjs",
  "scripts/defensive-plan-state-audit.mjs",
  "scripts/pass-destination-audit.mjs",
  "scripts/cross-arrival-audit.mjs",
  "scripts/ball-reach-audit.mjs",
  "scripts/attacking-opportunity-audit.mjs",
  "scripts/shot-flight-audit.mjs",
  "scripts/ball-drag-audit.mjs",
  "scripts/substep-contact-audit.mjs",
  "scripts/corner-routine-audit.mjs",
  "scripts/set-piece-presentation-audit.mjs",
  "scripts/player-traits-set-pieces-audit.mjs",
  "scripts/player-attributes-audit.mjs",
  "scripts/player-names-audit.mjs",
  "scripts/player-habits-audit.mjs",
  "scripts/player-positions-audit.mjs",
  "scripts/squad-numbers-audit.mjs",
  "scripts/player-roles-audit.mjs",
  "scripts/team-shapes-audit.mjs",
  "scripts/player-control-audit.mjs",
  "scripts/collective-defense-audit.mjs",
  "scripts/box-defending-audit.mjs",
  "scripts/box-possession-sampling-audit.mjs",
  "scripts/edge-rules-audit.mjs",
  "scripts/defensive-spacing-audit.mjs",
  "scripts/lazy-load-audit.mjs",
  "scripts/player-pathway-audit.mjs",
  "scripts/development-football-audit.mjs",
  "scripts/dressing-room-audit.mjs",
  "scripts/delegation-audit.mjs",
  "scripts/staff-identity-audit.mjs",
  "scripts/manager-ecosystem-audit.mjs",
  "scripts/manager-phase-shapes-audit.mjs",
  "scripts/phase-shape-evidence-audit.mjs",
  "scripts/scouting-knowledge-audit.mjs",
  "scripts/avatar-audit.mjs",
  "scripts/match-appearance-audit.mjs",
  "scripts/reality-audit.mjs",
  "scripts/branding-audit.mjs",
  "scripts/club-short-name-audit.mjs",
  "scripts/club-crest-audit.mjs",
  "scripts/intl-audit.mjs",
  "scripts/international-callup-audit.mjs",
  "scripts/finance-audit.mjs",
  "scripts/ai-facility-investment-audit.mjs",
  "scripts/matchday-finance-audit.mjs",
  "scripts/finance-ledger-audit.mjs",
  "scripts/ai-debt-audit.mjs",
  "scripts/club-debt-audit.mjs",
  "scripts/finance-budget-audit.mjs",
  "scripts/finance-commitments-audit.mjs",
  "scripts/cash-reservations-audit.mjs",
  "scripts/competition-audit.mjs",
  "scripts/competition-finance-audit.mjs",
  "scripts/finance-obligations-audit.mjs",
  "scripts/training-solidarity-audit.mjs",
  "scripts/training-prep-symmetry-audit.mjs",
  "scripts/sponsorship-audit.mjs",
  "scripts/league-transition-finance-audit.mjs",
  "scripts/transfer-negotiations-audit.mjs",
  "scripts/sale-negotiations-audit.mjs",
  "scripts/deal-negotiations-audit.mjs",
  "scripts/squad-registration-audit.mjs",
  "scripts/squad-planning-audit.mjs",
  "scripts/match-seed-audit.mjs",
  "scripts/match-causality-audit.mjs",
  "scripts/goalkeeper-open-goal-audit.mjs",
  "scripts/background-spatial-worker-audit.mjs",
  "scripts/match-analysis-audit.mjs",
  "scripts/match-balance-audit.mjs",
  "scripts/long-term-reality-audit.mjs",
  "scripts/ui-layout-audit.mjs",
  // 战术板 ⭐「设为核心球员」点击回归：pointerdown 阶段 setPointerCapture 会把
  // pointerup/click 的 target 改写成 .tac-slot，导致槽位内子按钮收不到点击。
  // 三组断言：点击恢复 / 拖拽换位未坏 / 模拟逻辑与 js/main.js 源码对齐。
  "scripts/tactics-core-click-audit.mjs",
  // 表现层「画面侧 AI 在真实比赛路径下是否执行」的静态断言。
  // 换边第 3 步复查发现：js/matchview.js 自带的 _attackDir 一族位于 update() 的
  // simDrive 早返回之后，真实比赛里根本不跑（唯一权威是 applySimSnapshot 写入的
  // 引擎坐标）。这决定「表现层要不要为换边改」——结论是不必改，故需长期看住：
  // 若将来有人删掉那个早返回、让画面侧 AI 复活，本审计必须失败。
  //
  // 该脚本默认只跑**段 A（纯静态，不启动浏览器）**，所以 verify 无 Playwright
  // 硬依赖；段 B（真实 Chromium 逐帧计数）需显式加 `--browser`，
  // 走独立入口 `npm run test:matchview-browser`。
  "scripts/matchview-audit-in-simdrive.mjs",
  // 下半场易边是正式比赛行为（调用层 fromMin===46 置 endsSwapped）。
  // 这四条是快的契约检查，不跑整场。整场探针是 scripts/_swap-ends-fullmatch-probe.mjs。
  "scripts/_swap-ends-behavior-check.mjs",
  "scripts/_swap-ends-wiring-check.mjs",
  "scripts/_swap-ends-resync-check.mjs",
  "scripts/_swap-ends-mirror-entry-check.mjs",
  "scripts/manager-onboarding-audit.mjs",
  "scripts/ecosystem-audit.mjs",
  "scripts/world-invariants-audit.mjs",
  // 默认 8 场（约 60s）：2 场就能稳定产生 20+ 次判罚，不存在「零样本让断言空转」，
  // 8 场只是让判罚率告警的分母更可信。
  "scripts/offside-event-integrity-audit.mjs",
  // 默认 6 场（约 50s，与 box-possession-sampling-audit 同量级）：6 场约 34 次角球，
  // 间距、主罚位置、Law 17、落点记录与已修复的还原度结构均为硬约束。
  "scripts/corner-structure-audit.mjs",
  // 默认 3 场（约 35s）：走**真实比赛会话**，让 `aiTuneTactics` 按实力差（power 78 vs 62，
  // 跨过 ±12 门槛）设出防线 4 / 2，再断言进攻三区内强队中卫线确实站得比弱队高。
  // 这是唯一覆盖「防线高度 → 中卫线前压」端到端链路的入口：两个 realism/shape 审计
  // 都把防线写死成 3、对该因子不敏感，而本审计的断言只在两队防线不同时才可能失败。
  "scripts/cb-line-height-e2e-audit.mjs",
];
const fullChecks = [
  ["scripts/match-realism-audit.mjs", "24"],
  ["scripts/match-realism-audit.mjs", "24", "background"],
];

function javascriptFiles(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const absolute = resolve(directory, name);
    const stat = statSync(absolute);
    if (stat.isDirectory()) files.push(...javascriptFiles(absolute));
    else if (/\.(?:js|mjs)$/.test(name)) files.push(absolute);
  }
  return files;
}

function run(args, label) {
  console.log(`\n> ${label}`);
  const result = spawnSync(process.execPath, args, { cwd: repo, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const file of javascriptFiles(resolve(repo, "js"))) {
  run(["--check", file], `syntax ${file.slice(repo.length + 1)}`);
}
for (const check of checks) run([check], check);
if (process.argv.includes("--full")) {
  for (const args of fullChecks) run(args, args.join(" "));
}

console.log("\nVCFM verification passed");
