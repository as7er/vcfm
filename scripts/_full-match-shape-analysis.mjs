// 临时分析：读 `_full-match-watch.mjs` 落下的画面坐标，量「防守落位」与「蜂拥」。
// 截图里看到：对方在本方禁区前组织时，本队边后卫/中场还站在中线附近。
// 静态帧会误判，这里用整场坐标核实。
// 用法：node scripts/_full-match-shape-analysis.mjs
import { readFileSync } from "node:fs";

const d = JSON.parse(readFileSync(new URL("../.tmp-watch/full-match/samples.json", import.meta.url), "utf8"));
const S = d.samples.filter((s) => s.players.length >= 20 && s.ball);
const MX = 0.68;
const MY = 1.05;
const q = (a, p) => {
  const b = [...a].sort((x, y) => x - y);
  return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : NaN;
};
const rows = [];
const swarm = [];
for (const s of S) {
  swarm.push(
    s.players.filter((p) => p.pos !== "GK" && Math.hypot((p.x - s.ball.x) * MX, (p.y - s.ball.y) * MY) < 10).length
  );
  for (const team of ["home", "away"]) {
    const gk = s.players.find((p) => p.team === team && p.pos === "GK");
    if (!gk) continue;
    const goalY = gk.y > 50 ? 100 : 0;
    const bd = Math.abs(s.ball.y - goalY);
    if (bd > 33) continue; // 球在本方后三区（≈ 35 m）
    // ⚠ bd < 12（≈ 12.6 m）多是角球 / 球门球 / 点球 —— 球在底线或禁区里，
    //   按定义没人能站到「球门侧」。第一版没排除，中位读成 1，是口径错不是 AI 错。
    //   直播模式偏爱这些定位球片段，所以必须单列。
    const setPieceZone = bd < 12;
    const out = s.players.filter((p) => p.team === team && p.pos !== "GK");
    const opp = s.players.filter((p) => p.team !== team && p.pos !== "GK");
    rows.push({
      team,
      setPieceZone,
      clock: s.clock,
      goalSide: out.filter((p) => Math.abs(p.y - goalY) < bd).length,
      upfield: out.filter((p) => Math.abs(p.y - goalY) > 50).length,
      upfieldPos: out.filter((p) => Math.abs(p.y - goalY) > 50).map((p) => p.pos),
      ownNear: out.filter((p) => Math.abs(p.y - goalY) < 40).length,
      oppNear: opp.filter((p) => Math.abs(p.y - goalY) < 40).length,
    });
  }
}
const col = (k, list = open) => list.map((r) => r[k]);
const open = rows.filter((r) => !r.setPieceZone);
console.log(`球在某队后三区的采样：${rows.length}（总采样 ${S.length}；其中底线 12 格内 ${rows.length - open.length}，下面只看其余 ${open.length}）`);
console.log(`球门侧外场人数  P10/中位/P90：${q(col("goalSide"), 0.1)} / ${q(col("goalSide"), 0.5)} / ${q(col("goalSide"), 0.9)}`);
console.log(`仍在对方半场的外场人数  中位/P90/最大：${q(col("upfield"), 0.5)} / ${q(col("upfield"), 0.9)} / ${Math.max(...col("upfield"))}`);
console.log(`本方 40 格内  本队外场 vs 对方外场 中位：${q(col("ownNear"), 0.5)} vs ${q(col("oppNear"), 0.5)}`);
// 留在对方半场的是谁：ATT 留前场 = 反击支点（合理）；DEF 留前场 = 没回防（不合理）
const upPos = {};
for (const r of open) for (const p of r.upfieldPos) upPos[p] = (upPos[p] || 0) + 1;
console.log(`仍在对方半场者的位置分布（人次）：${JSON.stringify(upPos)}`);
console.log(`人数劣势（对方 > 本队）占比：${((open.filter((r) => r.oppNear > r.ownNear).length / Math.max(1, open.length)) * 100).toFixed(1)}%`);
console.log(`球 10 m 内外场总人数  中位/P90/最大：${q(swarm, 0.5)} / ${q(swarm, 0.9)} / ${Math.max(...swarm)}`);
console.log(`≥ 6 人挤在球 10 m 内的采样占比：${((swarm.filter((x) => x >= 6).length / swarm.length) * 100).toFixed(1)}%`);
