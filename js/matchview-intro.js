/**
 * 进场动画的**时序规划**（纯函数，零 DOM 依赖）
 *
 * 为什么要单独抽出来
 * ----------------
 * 进场动画的时序（总时长 / 错峰 / 压缩 / 跳过收尾）是纯数学，
 * 但原先它和内联在 `matchview.js` 里的 DOM 操作揉在一起，导致：
 *   1. 无法单元测试 —— 想验证「传 2000ms 真的播 2 秒」必须先造一个
 *      完整的浏览器环境（`matchview.js` 的导入链拖着 `data.js` 等）。
 *   2. 时序常数（`0.62s` 位移 / `0.28s` 错峰）在 JS 与 CSS 两处重复，
 *      改一处忘一处就会出现「人到了名字还没到」。
 *
 * 所以把规划逻辑抽到这里：它只做算术，返回一份「该怎么演」的计划，
 * 由 `matchview.js` 负责照着执行（写 CSS 变量、加 class、挂监听）。
 * 本模块**不引用 `window`/`document`/`performance`**，因此可被
 * `js/matchview-intro.test.js` 直接测试。
 */

/** CSS 侧单程位移时长（秒）—— 必须与 `style.css` 的默认 `--intro-run` 一致 */
export const RUN_SECONDS = 0.62;
/** CSS 侧错峰延迟上限（秒）—— 必须与 `matchview.js` 注入 `--intro-delay` 的上限一致 */
export const MAX_STAGGER_SECONDS = 0.28;
/** 跳过时保留的「快速收拢」位移时长（秒）—— 不是硬切 */
export const FAST_RUN_SECONDS = 0.16;
/** 名字 / 阴影的淡入时长（秒）—— 与 `--intro-fade` 一致 */
export const FADE_SECONDS = 0.3;
/** 跳过时的淡入时长（秒） */
export const FAST_FADE_SECONDS = 0.12;

/** 位移跑完所需时间（毫秒） */
export function moveDurationMs() {
  return Math.round((RUN_SECONDS + MAX_STAGGER_SECONDS) * 1000);
}

/**
 * 计算某个球员的错峰延迟（秒）。
 *
 * 22 人同时冲进来像爆炸，观感应是「一队人依次跑出」。同队内按索引顺次，
 * 两队交错 0.013s，避免两队球员在视觉上「排队对齐」显得机械。
 *
 * @param {number} index 球员在 `this.players` 里的下标（0..21）
 * @param {boolean} isHome 是否主队
 * @returns {number} 延迟秒数，落在 [0, MAX_STAGGER_SECONDS]
 */
export function staggerDelay(index, isHome) {
  const within = (index % 11) * 0.026 + (isHome ? 0 : 0.013);
  return Math.min(MAX_STAGGER_SECONDS, within);
}

/**
 * 规划一次进场动画的时序。
 *
 * 关键约束（这里是最容易搞错的地方）：
 * - **总时长必须等于调用方给的 `ms`**。曾经用「位移时长 + 剩余时长」相加，
 *   但那段是从 rAF 触发点（约 16ms 后）才开始计时的，会漏掉已流逝的时间，
 *   使「2 秒」实际变成 1.2 秒。所以这里返回的是 `holdMs`（还该站多久），
 *   由调用方从 `t0` 起算绝对时间戳，而不是把各段时长相加。
 * - **`ms` 太短时要压缩位移时长**，否则「还没跑到就开球」。压缩用 CSS
 *   变量整体缩放（球员、名字、阴影、球一起），避免只压球员导致名字迟到。
 *
 * @param {number} ms 期望总时长（毫秒）；≤0 视为跳过整段动画
 * @returns {{
 *   skip: boolean,          // 是否应完全跳过（无动画）
 *   runSeconds: number,     // 应写入 --intro-run 的位移时长（秒）
 *   fadeSeconds: number,    // 应写入 --intro-fade 的淡入时长（秒）
 *   holdMs: number,         // 位移跑完后还应保持多久（毫秒），从 t0 起算
 *   totalMs: number,        // 实际可预期的总时长（毫秒）
 *   tailMs: number,         // 收尾时长（移除 class 前留给补间的时间）
 * }}
 */
export function planIntro(ms) {
  const target = Number(ms);
  if (!Number.isFinite(target) || target <= 0) {
    return {
      skip: true,
      runSeconds: RUN_SECONDS,
      fadeSeconds: FADE_SECONDS,
      staggerScale: 1,
      holdMs: 0,
      totalMs: 0,
      tailMs: 0,
    };
  }

  const moveMs = moveDurationMs();
  // 位移放不下 ⇒ 按比例压缩（下限 0.15 保证不是「瞬移」）。
  const scale = target < moveMs ? Math.max(0.15, target / moveMs) : 1;
  const runSeconds = Number((RUN_SECONDS * scale).toFixed(3));
  const fadeSeconds = Number((FADE_SECONDS * scale).toFixed(3));

  // ⚠️ 错峰延迟（`--intro-delay`）**必须跟着一起缩**，否则最后一名球员
  // 到位时刻 = runSeconds + MAX_STAGGER，在压缩场景下会超出目标时长
  // （例如 ms=700 ⇒ 0.48 + 0.28 = 0.76s > 0.7s）。调用方要按这个比例
  // 去乘每名球员的错峰延迟。
  const staggerScale = scale;
  // 位移实际占用时间：**用未取整的值**。曾经复用 `Math.round()` 后的
  // actualMoveMs 去算 totalMs，在 ms=200 这种边界上「200.2ms 被抹成 200」，
  // 导致 totalMs 比位移完成时刻还短 ⇒ 球员跑到一半被收尾掐断。
  const moveOccupancyMs = (runSeconds + MAX_STAGGER_SECONDS * staggerScale) * 1000;
  const tailMs = 120;
  // 正常结束的「保持」时间：目标总时长里扣掉位移与收尾。
  const holdMs = Math.max(0, target - moveOccupancyMs - tailMs);
  // 总时长至少覆盖位移本身（防浮点/取整让总时长比位移还短）。
  const totalMs = Math.max(moveOccupancyMs, target);

  return {
    skip: false,
    runSeconds,
    fadeSeconds,
    staggerScale,
    holdMs,
    totalMs,
    tailMs,
  };
}

/**
 * 规划「用户跳过」时的收尾时序。
 * 不是硬切：把位移压到 `FAST_RUN_SECONDS` 做一次快速收拢。
 *
 * `tailMs` 必须**明显大于**收拢时长，留出调度余量 —— 否则收拢还没跑完
 * 就被清理，最后一帧的偏移会突然跳回 0，等于变相硬切。
 * （0.16s 收拢 vs 0.24s 收尾 ⇒ 80ms 余量。）
 *
 * @returns {{ runSeconds: number, fadeSeconds: number, tailMs: number }}
 */
export function planSkip() {
  return {
    runSeconds: FAST_RUN_SECONDS,
    fadeSeconds: FAST_FADE_SECONDS,
    tailMs: 240,
  };
}
