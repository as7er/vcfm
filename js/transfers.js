/**
 * 转会窗：夏窗（赛季初）+ 冬窗（赛季中）
 * 窗口外禁止买卖与 AI 转会（自由球员签约同样受限）
 */

/** 夏窗：第 1 天起，默认 35 天 */
const SUMMER_START = 1;
const SUMMER_END = 35;

/** 冬窗：约第 120–145 天（联赛中段） */
const WINTER_START = 120;
const WINTER_END = 145;

export function ensureTransferWindow(world) {
  if (!world) return null;
  if (!world.transferWindow || typeof world.transferWindow !== "object") {
    world.transferWindow = {
      summerStart: SUMMER_START,
      summerEnd: SUMMER_END,
      winterStart: WINTER_START,
      winterEnd: WINTER_END,
      lastPhase: null,
    };
  }
  const tw = world.transferWindow;
  if (tw.summerStart == null) tw.summerStart = SUMMER_START;
  if (tw.summerEnd == null) tw.summerEnd = SUMMER_END;
  if (tw.winterStart == null) tw.winterStart = WINTER_START;
  if (tw.winterEnd == null) tw.winterEnd = WINTER_END;
  return tw;
}

/** @returns {'summer'|'winter'|'closed'} */
export function getTransferPhase(world) {
  ensureTransferWindow(world);
  if (!world || world.seasonOver) return "closed";
  const day = world.day || 1;
  const tw = world.transferWindow;
  if (day >= tw.summerStart && day <= tw.summerEnd) return "summer";
  if (day >= tw.winterStart && day <= tw.winterEnd) return "winter";
  return "closed";
}

export function isTransferWindowOpen(world) {
  return getTransferPhase(world) !== "closed";
}

export function transferWindowLabel(world) {
  const phase = getTransferPhase(world);
  const tw = ensureTransferWindow(world);
  if (phase === "summer") {
    return `夏窗开放（D${tw.summerStart}–D${tw.summerEnd}）· 剩 ${Math.max(0, tw.summerEnd - (world.day || 0))} 天`;
  }
  if (phase === "winter") {
    return `冬窗开放（D${tw.winterStart}–D${tw.winterEnd}）· 剩 ${Math.max(0, tw.winterEnd - (world.day || 0))} 天`;
  }
  // 下个窗口提示
  const day = world?.day || 1;
  if (day < tw.summerStart) {
    return `转会窗关闭 · 夏窗 D${tw.summerStart} 开启`;
  }
  if (day < tw.winterStart) {
    return `转会窗关闭 · 冬窗 D${tw.winterStart} 开启（约 ${tw.winterStart - day} 天后）`;
  }
  return `转会窗关闭 · 下季夏窗再开`;
}

export function transferWindowShort(world) {
  const phase = getTransferPhase(world);
  if (phase === "summer") return "夏窗开放";
  if (phase === "winter") return "冬窗开放";
  return "转会窗关闭";
}

/**
 * 推进时检测开/关窗新闻（每日最多一条状态变化）
 */
export function processTransferWindowDay(world) {
  if (!world || world.seasonOver) return;
  const tw = ensureTransferWindow(world);
  const phase = getTransferPhase(world);
  if (tw.lastPhase === phase) return;

  const prev = tw.lastPhase;
  tw.lastPhase = phase;

  if (phase === "summer" && prev !== "summer") {
    world.news.unshift({
      day: world.day,
      text: `📅 夏窗开启（至第 ${tw.summerEnd} 天）：可自由买卖球员。`,
    });
  } else if (phase === "winter" && prev !== "winter") {
    world.news.unshift({
      day: world.day,
      text: `📅 冬窗开启（至第 ${tw.winterEnd} 天）：短暂补强窗口。`,
    });
  } else if (phase === "closed" && (prev === "summer" || prev === "winter")) {
    const name = prev === "summer" ? "夏窗" : "冬窗";
    world.news.unshift({
      day: world.day,
      text: `📅 ${name}关闭：转会市场冻结，直至下个窗口。`,
    });
  }
}

export function assertTransferOpen(world) {
  if (isTransferWindowOpen(world)) return { ok: true };
  return {
    ok: false,
    msg: `转会窗已关闭（${transferWindowShort(world)}）。${transferWindowLabel(world)}`,
  };
}
