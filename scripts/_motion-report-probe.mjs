/**
 * 探针：验证 MotionIntegrityMonitor 的「本场累计」计数不受 history 截断影响。
 *
 * 背景：`history` 会被 `maxHistory` 截断、`frames`/`incidents` 会被 `_trimFrames`
 * 按时间窗裁掉，因此直接用它们做导出统计会漏数。本探针构造超过 maxHistory 的
 * 异常数，断言累计计数仍然完整。
 *
 * 只读取模块，不改动引擎或阈值。
 */
import assert from "node:assert/strict";
import {
  MotionIntegrityMonitor,
  MOTION_INCIDENT_TYPES,
} from "../js/match-motion-integrity.js";

const TELEPORT = MOTION_INCIDENT_TYPES.PLAYER_TELEPORT;

function player(id, x, y) {
  return { id, team: "home", role: "MID", num: 1, x, y, vx: 0, vy: 0, heading: 0, fsm: "hold" };
}

// maxIncidents/maxHistory 取模块允许的最小值，便于用小样本触发截断。
const monitor = new MotionIntegrityMonitor({ maxIncidents: 20, maxHistory: 20 });
const IDS = ["p1", "p2", "p3", "p4"];
// 四人都在左半场、纵向拉开 30 格（≈31.5m），+20 格后仍在界内且互不重叠。
const BASE = { p1: [10, 10], p2: [10, 40], p3: [10, 70], p4: [10, 90] };
const TELEPORTS = 30;
const DT = 0.5; // <=0.55 不算运动边界；每个 id 间隔 2.0s > 0.75s 冷却，不会被去重。

function fieldAt(t, moveId = null) {
  return {
    t,
    ball: { x: 50, y: 50, z: 0, owner: null, state: "loose" },
    players: IDS.map((id) => {
      const [x, y] = BASE[id];
      // 20 格 x = 13.6m / 0.5s = 27.2 m/s，必然超过 12.2 m/s 上限。
      return player(id, id === moveId ? x + 20 : x, y);
    }),
  };
}

// 预热帧：建立 previous，使后续每一帧都能被判定。
monitor.record(fieldAt(0), null, { label: "probe" });
for (let step = 0; step < TELEPORTS; step++) {
  monitor.record(fieldAt((step + 1) * DT, IDS[step % IDS.length]), null, { label: "probe" });
}
const EXPECTED_FRAMES = TELEPORTS + 1;

const summary = monitor.auditSummary();
console.log(
  JSON.stringify(
    {
      teleportsInjected: TELEPORTS,
      historyRetained: summary.historyRetained,
      totalIncidents: summary.totalIncidents,
      byType: summary.byType,
      severeByType: summary.severeByType,
      framesSampledTotal: summary.framesSampledTotal,
      framesSampledWindow: summary.framesSampled,
      firstAt: summary.firstAt,
      lastAt: summary.lastAt,
    },
    null,
    2
  )
);

assert.ok(
  summary.historyRetained < TELEPORTS,
  "history 必须被 maxHistory 截断，否则本探针没有验证到目标缺陷"
);
assert.equal(summary.totalIncidents, TELEPORTS, "累计异常数必须等于注入数，不受 history 截断影响");
assert.equal(summary.byType[TELEPORT], TELEPORTS, "按类型累计必须完整");
assert.equal(summary.severeByType[TELEPORT], TELEPORTS, "severe 累计必须完整");
assert.equal(summary.framesSampledTotal, EXPECTED_FRAMES, "累计采样帧数必须完整");
assert.ok(summary.framesSampled < EXPECTED_FRAMES, "窗口内帧数应被 _trimFrames 裁到小于总量");
assert.ok(summary.firstAt[TELEPORT] <= summary.lastAt[TELEPORT], "firstAt 必须不晚于 lastAt");

const logged = monitor.logMotionReport("probe");
assert.equal(logged.rows.length, Object.keys(MOTION_INCIDENT_TYPES).length, "报告必须覆盖全部异常类型");

console.log("Motion report probe passed.");
