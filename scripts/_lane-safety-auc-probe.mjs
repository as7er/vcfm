/**
 * 传球线安全度预测力（2026-09-25，v292 依据）：朴素垂距 vs「抢点赛跑」谁更能预测地面传球被断。
 * 结果（6 场 4975 次）：AUC naive 0.755 / race0（不外推）0.808 / race1（按速度外推）0.818。
 * 用法：node scripts/_lane-safety-auc-probe.mjs [场数=6]
 */
import { CLUB_TEMPLATES } from "../js/data.js";
import { createMatchSession } from "../js/match.js";
import { createWorld } from "../js/models.js";
import { ensureSimEngine, runSimPeriodRaw } from "../js/sim/adapt.js";
import { ensureStaff } from "../js/staff.js";
import { SimEngine } from "../js/sim/engine.js";

function mulberry32(seed){let a=seed>>>0;return function(){a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const r = Math.random, dn = Date.now;
Math.random = mulberry32(0x1a2b3c); Date.now = () => 1789000000000;
const club = CLUB_TEMPLATES.find((c) => c.division === 3);
const src = createWorld(club.id, "R");
for (const c of src.clubs) ensureStaff(c);
Math.random = r; Date.now = dn;

const PITCH_W = 68, PITCH_H = 105; // 米（x 向宽 68、y 向长 105，同 SIM.PITCH_*_METRES）；场地坐标 0..100
const MX = PITCH_W / 100, MY = PITCH_H / 100;

// 赛跑安全度：lookahead ∈ [0,1] 是「按对手当前速度外推」的比例（1 = 完全外推）
function raceSafety(eng, a, tx, ty, eta, lookahead) {
  const ox = eng.ball.owner === a.id ? eng.ball.x : a.x;
  const oy = eng.ball.owner === a.id ? eng.ball.y : a.y;
  const dx = (tx - ox) * MX, dy = (ty - oy) * MY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  let minMargin = Infinity;
  for (const o of eng.agents) {
    if (o.team === a.team || o.role === "GK" || o.sentOff || o.injuredOff) continue;
    let t = ((o.x - ox) * MX * ux + (o.y - oy) * MY * uy) / len;
    if (t < -0.05 || t > 1.05) continue;
    t = Math.max(0, Math.min(1, t));
    const ballTime = eta * t;
    const px = o.x + (o.vx || 0) * ballTime * lookahead;
    const py = o.y + (o.vy || 0) * ballTime * lookahead;
    const perpM = Math.abs(((px - ox) * MX) * uy - ((py - oy) * MY) * ux);
    // 对手 ballTime 秒内能横移的距离（反应 0.25 s，约 6.5 m/s）+ 伸脚 1 m
    const reach = 1 + 6.5 * Math.max(0, ballTime - 0.25);
    minMargin = Math.min(minMargin, perpM - reach);
  }
  return minMargin === Infinity ? 12 : minMargin;
}

const P = SimEngine.prototype;
const recs = [];
const op = P._pass;
P._pass = function (a, t, prepared) {
  if (!prepared && t?.agent && !t.cross && !t.backpass) {
    const tx = t.tx ?? t.agent.x, ty = t.ty ?? t.agent.y;
    const distM = Math.hypot((tx - a.x) * MX, (ty - a.y) * MY);
    const eta = Math.max(0.2, distM / 15); // 粗估：普通地面球约 15 m/s 平均
    recs.push({
      eng: this, idx: this.events.length, team: a.team,
      naive: this._laneSafety(a, t.agent, tx, ty),
      race0: raceSafety(this, a, tx, ty, eta, 0),
      race1: raceSafety(this, a, tx, ty, eta, 1),
      distM,
    });
  }
  return op.call(this, a, t, prepared);
};

const SEEDS = Number(process.argv[2]) || 6;
for (let s = 1; s <= SEEDS; s++) {
  const w = structuredClone(src);
  const fx = w.fixtures.find((f) => f.home === w.userClubId);
  const st = createMatchSession(w, fx);
  st.random = mulberry32(s);
  const e = ensureSimEngine(st);
  runSimPeriodRaw(e, 1, 45);
  runSimPeriodRaw(e, 46, 90);
}
for (const rec of recs) {
  const ev = rec.eng.events;
  rec.out = "other";
  for (let i = rec.idx; i < ev.length && i < rec.idx + 12; i++) {
    const e = ev[i];
    if (e.type === "receive") { rec.out = e.team === rec.team ? "ok" : "lost"; break; }
    if (e.type === "intercept") { rec.out = "lost"; break; }
  }
}
const done = recs.filter((x) => x.out === "ok" || x.out === "lost");
// AUC：随机取一个成功传球和一个被断传球，成功那个分数更高的概率
function auc(key) {
  const pos = done.filter((x) => x.out === "ok").map((x) => x[key]);
  const neg = done.filter((x) => x.out === "lost").map((x) => x[key]);
  const all = [...pos.map((v) => [v, 1]), ...neg.map((v) => [v, 0])].sort((p, q) => p[0] - q[0]);
  let rank = 0, sumPos = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j][0] === all[i][0]) j++;
    const avg = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (all[k][1]) sumPos += avg;
    rank = j; i = j;
  }
  return (sumPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}
console.log(`地面传球 ${recs.length}，已判定 ${done.length}（被断 ${done.filter((x) => x.out === "lost").length}）`);
for (const k of ["naive", "race0", "race1", "distM"]) console.log(`AUC ${k.padEnd(6)} ${auc(k).toFixed(3)}`);
