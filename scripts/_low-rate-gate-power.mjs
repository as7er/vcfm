// 低频事件信封的「尺子可靠性」计算器（纯数学，不跑模拟）。
//
// 背景：match-realism-audit.mjs 把每一项都写成 perMatch，再和固定信封比。
// 对**高频**指标（射门 26/场、传球 1000/场）24 场足够；对**低频**指标
// （点球 0.17/场）24 场里只有几个事件，门槛判定基本由噪声决定。
// 这个脚本回答两个问题：
//   1) 假设真实速率 = 基线速率，24 场里被判失败的概率有多大？（假警报率）
//   2) 假设真实速率真的变了（比如腰斩），24 场里能测出来的概率有多大？（功效）
//
// 判定必须复刻审计脚本的真实行为：assert 比的是 `Number((X / n).toFixed(2))`
// 与信封边界，所以「通过的最小 X」要按 toFixed 后的值去找，不能按 X/n 算。
//
// 用法：
//   node scripts/_low-rate-gate-power.mjs <命中数> <场数> [观察命中数] [观察场数]
//   node scripts/_low-rate-gate-power.mjs --variants <命中数,命中数,...>
// 例：
//   node scripts/_low-rate-gate-power.mjs 4 24          # HEAD 基线标准档的点球
//   node scripts/_low-rate-gate-power.mjs 4 24 2 24     # 候选的 2 个点球有多不寻常
//   node scripts/_low-rate-gate-power.mjs --variants 4,6,6,3,4,5,4,2
//   node scripts/_low-rate-gate-power.mjs --pairs 4:2,19:11,11:20
//
// `--pairs` 模式回答第三个问题：两个变体在某个**低频**指标上差了一截，
// 这算显著吗？零假设下两边同速率、样本量相同，所以某一侧的计数服从
// Binomial(n1+n2, 0.5)——直接算双侧精确 p 值。一次可以传多组，
// 免得只看一个指标就下结论（看的指标越多，越该做多重比较的折扣）。
//
// `--variants` 模式回答另一个问题：同一份引擎的 N 个变体，读数散成一片时，
// 到底是「有变体效应」还是「就是泊松噪声」？对低频计数用离散度检验
// （Cochran：sum((xi - x̄)²) / x̄ ~ χ²(k-1)），而不是去比两两差值——
// 两两差值在 k=2 时分辨不出这两种情况。

const LO = 0.1;
const HI = 0.5;
const SIZES = [24, 48, 96];

/** ln Γ(x)，Lanczos 近似（Numerical Recipes 系数） */
const LANCZOS = [
  76.18009172947146, -86.50532032941677, 24.01409824083091,
  -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
];
function gammaln(xx) {
  const x = xx;
  let y = xx;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let series = 1.000000000190015;
  for (let j = 0; j < 6; j++) series += LANCZOS[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * series) / x);
}
/** 正则化下不完全伽马 P(a,x)，级数展开（x < a+1 时收敛快） */
function gammaPSeries(a, x) {
  if (x <= 0) return 0;
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 1; n <= 500; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
}
/** 正则化上不完全伽马 Q(a,x)，连分式（x >= a+1 时收敛快） */
function gammaQContinuedFraction(a, x) {
  const TINY = 1e-300;
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
}
/** χ² 上尾概率 P(χ²_df > value) */
function chiSquareUpperTail(value, df) {
  if (value <= 0) return 1;
  const a = df / 2;
  const x = value / 2;
  return x < a + 1 ? 1 - gammaPSeries(a, x) : gammaQContinuedFraction(a, x);
}

// 注意：这里必须是函数声明而不是直接执行——它用到的 gateWindow/passes/tail/poissonPmf
// 都是文件下半部分的 const，直接执行会撞上 TDZ（Cannot access 'passes' before initialization）。
// 函数声明会提升，调用点放在文件末尾，那时这些 const 已经初始化完了。
function runVariantsMode() {
  const counts = String(process.argv[3] || "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (counts.length < 2) {
    console.error("用法: node scripts/_low-rate-gate-power.mjs --variants 4,6,6,3,4,5,4,2");
    process.exit(2);
  }
  const k = counts.length;
  const mean = counts.reduce((a, b) => a + b, 0) / k;
  const sumSquares = counts.reduce((a, b) => a + (b - mean) ** 2, 0);
  const variance = sumSquares / (k - 1);
  const sd = Math.sqrt(variance);
  const poissonSd = Math.sqrt(mean);
  const dispersion = sumSquares / mean; // Cochran 离散度统计量
  const df = k - 1;
  const pValue = chiSquareUpperTail(dispersion, df);

  console.log(`\n变体读数: ${counts.join(", ")}  (k = ${k})`);
  console.log(`均值 ${mean.toFixed(3)}  观测 sd ${sd.toFixed(3)}  泊松理论 sd ${poissonSd.toFixed(3)}`);
  console.log(`极差 ${Math.max(...counts) - Math.min(...counts)}`);
  console.log(`\n离散度检验（Cochran）: sum((xi - x̄)²) / x̄ = ${dispersion.toFixed(3)}, df = ${df}`);
  console.log(`  P(χ²_${df} > ${dispersion.toFixed(3)}) = ${(pValue * 100).toFixed(1)}%`);
  console.log(
    pValue > 0.05
      ? "  => 离散度**没有**超出泊松噪声：这组变体之间看不出真实差异。"
      : "  => 离散度超出泊松噪声：变体之间可能存在真实差异，值得追。"
  );

  console.log(`\n若把这 ${k} 个变体都当成同一速率，24 场门槛（>= 0.1）对每个变体的表现：`);
  const windows24 = gateWindow(24);
  const failProbability = tail((x) => poissonPmf(x, mean), 0, windows24.min - 1);
  console.log(
    `  池化速率 ${(mean / 24).toFixed(3)}/场 -> 单个变体被判失败的概率 ${(failProbability * 100).toFixed(1)}%`
  );
  const wouldFail = counts.filter((count) => !passes(count, 24)).length;
  console.log(`  这组里实际被判失败的个数: ${wouldFail} / ${k}`);
  console.log("");
}

// 零假设下两边同速率、样本量相同 -> 一侧计数服从 Binomial(n1+n2, 0.5)。
// 双侧精确 p 值 = 2 * P(X <= min(n1,n2))，上限截到 1。
function twoSampleExactP(n1, n2) {
  const total = n1 + n2;
  if (total === 0) return 1;
  const smaller = Math.min(n1, n2);
  const oneSided = tail((k) => binomialPmf(k, total, 0.5), 0, smaller);
  return Math.min(1, 2 * oneSided);
}

function runPairsMode() {
  const pairs = String(process.argv[3] || "")
    .split(",")
    .map((part) => part.split(":").map((value) => Number(value.trim())))
    .filter((pair) => pair.length === 2 && pair.every((value) => Number.isFinite(value) && value >= 0));
  if (!pairs.length) {
    console.error("用法: node scripts/_low-rate-gate-power.mjs --pairs 4:2,19:11,11:20");
    process.exit(2);
  }
  console.log(`\n两样本精确检验（零假设：两边同速率、样本量相同）`);
  console.log("A      B      合计    A 占比     双侧 p 值");
  console.log("------|------|------|----------|----------");
  const pValues = [];
  for (const [a, b] of pairs) {
    const total = a + b;
    const share = total ? a / total : 0;
    const pValue = twoSampleExactP(a, b);
    pValues.push(pValue);
    console.log(
      `${String(a).padStart(5)} | ${String(b).padStart(4)} | ${String(total).padStart(4)} | ${share.toFixed(3).padStart(8)} | ${pValue.toFixed(4).padStart(8)}`
    );
  }
  const significant = pValues.filter((value) => value < 0.05).length;
  const expected = pValues.length * 0.05;
  console.log(
    `\n${pValues.length} 个指标里 p < 0.05 的有 ${significant} 个；纯噪声下的期望是 ${expected.toFixed(2)} 个。`
  );
  if (pValues.length) {
    const minP = Math.min(...pValues);
    // Bonferroni：看 k 个指标时，单个指标需要 p < 0.05/k 才算「扛得住多重比较」
    console.log(
      `最小 p 值 ${minP.toFixed(4)}，Bonferroni 门槛 ${(0.05 / pValues.length).toFixed(4)} —— ` +
        (minP < 0.05 / pValues.length ? "至少有一项扛住了多重比较。" : "没有任何一项扛得住多重比较。")
    );
  }
  console.log("");
}

const variantsMode = process.argv[2] === "--variants";
const pairsMode = process.argv[2] === "--pairs";
const hits = variantsMode || pairsMode ? 0 : Number(process.argv[2]);
const trials = variantsMode || pairsMode ? 1 : Number(process.argv[3]);
const observed = process.argv[4] === undefined ? null : Number(process.argv[4]);
const observedTrials = process.argv[5] === undefined ? trials : Number(process.argv[5]);
if (!variantsMode && !pairsMode && (!Number.isFinite(hits) || !Number.isFinite(trials) || trials <= 0 || hits < 0)) {
  console.error("用法: node scripts/_low-rate-gate-power.mjs <命中数> <场数> [观察命中数] [观察场数]");
  console.error("     node scripts/_low-rate-gate-power.mjs --variants <命中数,命中数,...>");
  console.error("     node scripts/_low-rate-gate-power.mjs --pairs <A:B,A:B,...>");
  process.exit(2);
}
const rate = hits / trials;

/** 与审计脚本完全相同的舍入：Number((value / matches).toFixed(2)) */
const gateValue = (count, n) => Number((count / n).toFixed(2));
const passes = (count, n) => gateValue(count, n) >= LO && gateValue(count, n) <= HI;

/** 通过信封的最小/最大命中数（含边界） */
function gateWindow(n) {
  let min = null;
  let max = null;
  for (let count = 0; count <= n * HI + 2; count++) {
    if (passes(count, n)) {
      if (min === null) min = count;
      max = count;
    }
  }
  return { min, max };
}

/** 对数阶乘，避免大 n 的组合数溢出 */
const logFactorialCache = [0];
function logFactorial(n) {
  for (let i = logFactorialCache.length; i <= n; i++) {
    logFactorialCache[i] = logFactorialCache[i - 1] + Math.log(i);
  }
  return logFactorialCache[n];
}
function logChoose(n, k) {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/** 二项分布 P(X = k)，用对数空间算再指数化 */
function binomialPmf(k, n, p) {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p));
}
/** 泊松分布 P(X = k) */
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}
function tail(pmf, from, to) {
  let total = 0;
  for (let k = Math.max(0, from); k <= to; k++) total += pmf(k);
  return Math.min(1, total);
}

const f = (value, digits = 4) => Number(value).toFixed(digits);
const pct = (value) => `${(value * 100).toFixed(1)}%`;

if (!variantsMode && !pairsMode) {
console.log(`\n基线读数: ${hits} / ${trials} = ${f(rate)} 个/场`);
console.log(`信封: ${LO} - ${HI}（与 match-realism-audit.mjs 一致，按 toFixed(2) 后的值比）`);

console.log("\n=== 门槛窗口：多少命中数才算通过 ===");
console.log("场数 | 通过的最小命中数 | 对应读数 | 通过的最大命中数");
console.log("-----|------------------|----------|------------------");
const windows = {};
for (const n of SIZES) {
  const { min, max } = gateWindow(n);
  windows[n] = { min, max };
  console.log(
    `${String(n).padStart(4)} | ${String(min).padStart(16)} | ${String(gateValue(min, n)).padStart(8)} | ${String(max).padStart(16)}`
  );
}

console.log("\n=== 假警报率：真实速率 = 基线速率时，被判失败的概率 ===");
console.log("场数 | 期望命中 | 二项 下界失败 | 泊松 下界失败 | 二项 上界失败 | 合计(二项)");
console.log("-----|----------|---------------|---------------|---------------|-----------");
for (const n of SIZES) {
  const lambda = rate * n;
  const lowerBinomial = tail((k) => binomialPmf(k, n, rate), 0, windows[n].min - 1);
  const lowerPoisson = tail((k) => poissonPmf(k, lambda), 0, windows[n].min - 1);
  const upperBinomial = tail((k) => binomialPmf(k, n, rate), windows[n].max + 1, n);
  console.log(
    `${String(n).padStart(4)} | ${f(lambda, 2).padStart(8)} | ${pct(lowerBinomial).padStart(13)} | ${pct(lowerPoisson).padStart(13)} | ${pct(upperBinomial).padStart(13)} | ${pct(lowerBinomial + upperBinomial).padStart(9)}`
  );
}

console.log("\n=== 功效：真实速率真的变了，门槛能测出来的概率 ===");
console.log("假设真实速率 | 场数 | 期望命中 | 判定通过的概率");
console.log("-------------|------|----------|----------------");
for (const factor of [0.5, 0.75, 1, 1.5, 2]) {
  const trueRate = rate * factor;
  const label = factor === 1 ? "不变" : `×${factor}`;
  for (const n of SIZES) {
    const lambda = trueRate * n;
    const passProbability =
      trueRate <= 0
        ? passes(0, n)
          ? 1
          : 0
        : tail((k) => poissonPmf(k, lambda), windows[n].min, windows[n].max);
    console.log(
      `${label.padEnd(12)} | ${String(n).padStart(4)} | ${f(lambda, 2).padStart(8)} | ${pct(passProbability).padStart(15)}`
    );
  }
}

if (observed !== null) {
  console.log(`\n=== 观察到的读数有多不寻常 ===`);
  console.log(`观察: ${observed} / ${observedTrials} = ${f(observed / observedTrials)}`);
  for (const n of SIZES) {
    const lambda = rate * n;
    const asExtreme = tail((k) => poissonPmf(k, lambda), 0, Math.round((observed / observedTrials) * n));
    const asExtremeBinomial = tail(
      (k) => binomialPmf(k, n, rate),
      0,
      Math.round((observed / observedTrials) * n)
    );
    console.log(
      `  若按 ${n} 场折算: 期望 ${f(lambda, 2)} 个, P(命中数 <= ${Math.round((observed / observedTrials) * n)}) = ${pct(asExtreme)} (泊松) / ${pct(asExtremeBinomial)} (二项)`
    );
  }
  const lambda = rate * observedTrials;
  const pValue = tail((k) => poissonPmf(k, lambda), 0, observed);
  console.log(
    `  直接按 ${observedTrials} 场: 期望 ${f(lambda, 2)} 个, P(X <= ${observed}) = ${pct(pValue)} —— 这就是「基线速率下出现这么少点球」的单侧概率`
  );
}
}

if (variantsMode) runVariantsMode();
if (pairsMode) runPairsMode();
