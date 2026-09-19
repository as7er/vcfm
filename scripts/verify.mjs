import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const checks = [
  "js/matchview-fsm.test.js",
  "js/matchview-coords.test.js",
  "js/matchview-director.test.js",
  "scripts/cache-audit.mjs",
  "scripts/save-durability-audit.mjs",
  "scripts/save-schema-audit.mjs",
  "scripts/replay-ui-audit.mjs",
  "scripts/match-presentation-audit.mjs",
  "scripts/match-continuity-audit.mjs",
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
