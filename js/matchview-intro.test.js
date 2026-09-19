/**
 * 进场动画时序单元测试（纯函数，无需浏览器）
 *
 * 运行方式：node js/matchview-intro.test.js
 *
 * 覆盖的是最容易搞错的两件事：
 *   1. 「约 2 秒」必须真的是 2 秒（曾经因 rAF 计时起点而缩水到 1.2s）
 *   2. `ms` 太短时必须压缩位移时长，而不是「还没跑到就开球」
 */

import {
  planIntro,
  planSkip,
  staggerDelay,
  moveDurationMs,
  RUN_SECONDS,
  MAX_STAGGER_SECONDS,
  FAST_RUN_SECONDS,
  FADE_SECONDS,
  FAST_FADE_SECONDS,
} from "./matchview-intro.js";

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

function assertNear(actual, expected, tolerance, message = "") {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${message}\nExpected: ~${expected}\nActual: ${actual}\nDiff: ${Math.abs(actual - expected)}`,
    );
  }
}

function assertRange(actual, lo, hi, message = "") {
  if (actual < lo || actual > hi) {
    throw new Error(`${message}\nExpected in [${lo}, ${hi}]\nActual: ${actual}`);
  }
}

// ============ 默认时长 ============

test("planIntro(2000) —— 总时长确实是 2 秒（不许缩水）", () => {
  const p = planIntro(2000);
  assertNear(p.totalMs, 2000, 40, "总时长应≈2000ms");
  assert(!p.skip, "2000ms 不应跳过");
});

test("planIntro(2000) —— 不压缩位移时长", () => {
  const p = planIntro(2000);
  assertNear(p.runSeconds, RUN_SECONDS, 0.001, "位移时长应保持默认 0.62s");
  assertNear(p.fadeSeconds, FADE_SECONDS, 0.001, "淡入时长应保持默认 0.3s");
});

test("planIntro(2000) —— hold 占大头（跑完后站稳）", () => {
  const p = planIntro(2000);
  // 位移 0.90s + 收尾 0.12s ⇒ 保持约 0.98s
  assertRange(p.holdMs, 900, 1100, "保持时间应在 ~1s");
  assert(p.holdMs > moveDurationMs() * 0.8, "保持时间应接近位移时长的量级");
});

// ============ 压缩 ============

test("planIntro(700) —— 位移被压缩，且观众感知时长≈700ms", () => {
  const p = planIntro(700);
  assert(p.runSeconds < RUN_SECONDS, "700ms 放不下 0.90s 位移，应压缩");
  // 「观众感知时长」= 位移 + 错峰（最后一人的到位时刻），不含收尾缓冲。
  const perceived = (p.runSeconds + MAX_STAGGER_SECONDS * p.staggerScale) * 1000;
  assertNear(perceived, 700, 40, "观众感知时长应≈700ms");
  // Promise 会在收尾缓冲后才 resolve，故略长于感知时长。
  assertNear(p.totalMs, 700, 40, "totalMs 应≈目标 700ms（覆盖位移）");
});

test("planIntro(700) —— 淡入时长同步缩放（否则名字迟到）", () => {
  const p = planIntro(700);
  assert(p.fadeSeconds < FADE_SECONDS, "淡入应随位移一起压缩");
  // 缩放比例应一致
  assertNear(p.fadeSeconds / FADE_SECONDS, p.runSeconds / RUN_SECONDS, 0.02, "两者缩放比例应一致");
});

test("planIntro(200) —— 按比例压缩（200/900）", () => {
  const p = planIntro(200);
  // scale = 200/900 ≈ 0.222 ⇒ 0.62 × 0.222 ≈ 0.138
  assertNear(p.runSeconds, RUN_SECONDS * (200 / 900), 0.002, "按 ms/位移 比例压缩");
  assertNear(p.staggerScale, 200 / 900, 0.002, "错峰也要同比例缩放");
});

test("planIntro(50) —— 触到 15% 压缩下限（不会变瞬移）", () => {
  const p = planIntro(50);
  // 50/900 = 0.056 < 0.15 ⇒ 取下限 0.15
  assertNear(p.runSeconds, RUN_SECONDS * 0.15, 0.001, "压缩下限为 15%");
  assertNear(p.staggerScale, 0.15, 0.001, "错峰缩放同样取到下限");
});

test("planIntro —— 压缩时错峰与位移严格同比例（不许一个缩一个不缩）", () => {
  // 这是曾经的真实缺陷：runSeconds 被缩了，但 --intro-delay 没缩，
  // 导致最后一名球员到位时刻超出目标时长。
  for (const ms of [200, 400, 700, 850]) {
    const p = planIntro(ms);
    assertNear(
      p.staggerScale,
      p.runSeconds / RUN_SECONDS,
      0.002,
      `ms=${ms}: 错峰缩放应与位移缩放一致`,
    );
    // 位移动画真正结束的时刻不应超出目标总时长
    const lastArriveMs = (p.runSeconds + MAX_STAGGER_SECONDS * p.staggerScale) * 1000;
    assert(lastArriveMs <= ms + 1, `ms=${ms}: 最后一人到位 ${lastArriveMs}ms 不应超过 ${ms}ms`);
  }
});

// ============ 跳过 ============

test("planIntro(0) / 负数 / NaN —— 全部跳过", () => {
  for (const v of [0, -1, -2000, NaN, undefined, null, "abc"]) {
    const p = planIntro(v);
    assert(p.skip === true, `planIntro(${String(v)}) 应跳过`);
    assert(p.totalMs === 0, `${String(v)} 的总时长应为 0`);
  }
});

test("planSkip —— 保留快速收拢，不是硬切", () => {
  const s = planSkip();
  assert(s.runSeconds > 0, "跳过也应有收拢位移（>0）");
  assertNear(s.runSeconds, FAST_RUN_SECONDS, 0.001, "收拢时长应=0.16s");
  assert(s.runSeconds < RUN_SECONDS, "收拢应比正常位移快");
  assertNear(s.fadeSeconds, FAST_FADE_SECONDS, 0.001, "收拢淡入应=0.12s");
  assertRange(s.tailMs, 100, 300, "收尾应给足一次补间的时间");
});

// ============ 错峰 ============

test("staggerDelay —— 落在 [0, 上限] 内", () => {
  for (let i = 0; i < 22; i++) {
    for (const home of [true, false]) {
      const d = staggerDelay(i, home);
      assertRange(d, 0, MAX_STAGGER_SECONDS, `index=${i} home=${home}`);
    }
  }
});

test("staggerDelay —— 两队交错（同索引不同延迟）", () => {
  const h = staggerDelay(3, true);
  const a = staggerDelay(3, false);
  assert(Math.abs(a - h) > 1e-9, "同索引的两队球员应有不同延迟，避免视觉排队");
});

test("staggerDelay —— 同队内按索引递增（依次跑出）", () => {
  for (let i = 1; i < 11; i++) {
    assert(
      staggerDelay(i, true) >= staggerDelay(i - 1, true),
      `同队索引 ${i} 的延迟应 >= ${i - 1}`,
    );
  }
});

test("staggerDelay —— 上限封顶（不允许无限错峰）", () => {
  // index % 11 == 10 时 within = 0.26（主队），已接近上限；客队 +0.013
  assertNear(staggerDelay(10, false), 0.273, 0.001, "最大错峰应≈0.273s");
  assert(staggerDelay(10, false) <= MAX_STAGGER_SECONDS, "不得超过上限");
});

// ============ 一致性 ============

test("moveDurationMs —— 与 CSS 常数一致", () => {
  assertNear(moveDurationMs(), 900, 1, "0.62 + 0.28 = 0.90s = 900ms");
});

test("planIntro —— 各种 ms 都不返回负数时长", () => {
  for (const ms of [1, 50, 300, 900, 2000, 5000, 60000]) {
    const p = planIntro(ms);
    assert(p.runSeconds > 0, `${ms}: runSeconds 应>0`);
    assert(p.fadeSeconds > 0, `${ms}: fadeSeconds 应>0`);
    assert(p.holdMs >= 0, `${ms}: holdMs 应>=0`);
    assert(p.totalMs >= 0, `${ms}: totalMs 应>=0`);
  }
});

test("planIntro(5000) —— 长时长只是保持更久，位移不变", () => {
  const p = planIntro(5000);
  assertNear(p.runSeconds, RUN_SECONDS, 0.001, "长时长不应改位移");
  assertNear(p.totalMs, 5000, 40, "总时长应≈5000ms");
  const short = planIntro(2000);
  assert(p.holdMs > short.holdMs, "更长的时长应有更长的保持时间");
});

test("planIntro —— totalMs 是「覆盖位移的总时长」，不是 holdMs", () => {
  // 回归防护：曾经把 holdMs 当总时长用，导致 ms=700（位移刚好占满、
  // holdMs=0）时在 0ms 就收尾 —— 球员跑到一半被掐断（实测 153ms 结束，
  // 而位移需要 697ms）。断言 totalMs 始终覆盖位移本身。
  for (const ms of [200, 400, 700, 900, 2000]) {
    const p = planIntro(ms);
    const moveEndsAt = (p.runSeconds + MAX_STAGGER_SECONDS * p.staggerScale) * 1000;
    assert(
      p.totalMs >= moveEndsAt - 0.001,
      `ms=${ms}: totalMs=${p.totalMs} 必须 >= 位移完成时刻 ${moveEndsAt.toFixed(1)}ms`,
    );
  }
});

test("planIntro(700) —— holdMs=0 但 totalMs 仍覆盖位移", () => {
  const p = planIntro(700);
  assertNear(p.holdMs, 0, 1, "位移刚好占满时 holdMs 应为 0");
  const moveEndsAt = (p.runSeconds + MAX_STAGGER_SECONDS * p.staggerScale) * 1000;
  assert(p.totalMs >= moveEndsAt - 0.001, "总时长应覆盖位移完成时刻");
});

test("planIntro(2000) —— 位移有余量时 totalMs=目标时长", () => {
  const p = planIntro(2000);
  assertNear(p.totalMs, 2000, 0.001, "宽松场景下总时长等于目标");
  assert(p.holdMs > 0, "此时应有保持时间");
});

// ============ 执行 ============

for (const t of tests) {
  try {
    t.fn();
    passed++;
    console.log(`  ✅ ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${t.name}`);
    console.log(`     ${e.message.split("\n").join("\n     ")}`);
  }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${tests.length} total`);
if (failed > 0) process.exit(1);
