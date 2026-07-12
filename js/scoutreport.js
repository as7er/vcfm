/**
 * 球探报告：对转会目标给出区间估值 + 风格标签 + 风险
 */

import { POS_LABEL } from "./data.js";
import { staffRating } from "./staff.js";

function staffRatingSafe(club, role) {
  try {
    return staffRating(club, role);
  } catch {
    return 8;
  }
}

export function buildScoutReport(world, player, userClub) {
  if (!player) return null;
  const r = staffRatingSafe(userClub, "scout"); // 约 5–16
  const accuracy = Math.min(0.95, 0.45 + r / 25); // 球探越好区间越窄、越准
  const trueVal = player.value || 0;
  const spread = (1 - accuracy) * 0.45 + 0.08;
  const lo = Math.round(trueVal * (1 - spread));
  const hi = Math.round(trueVal * (1 + spread * 0.9));

  // 能力区间（低球探模糊）
  const ovrSpread = Math.max(0, Math.round((16 - r) / 5));
  const ovrLo = Math.max(1, player.ovr - ovrSpread);
  const ovrHi = Math.min(20, player.ovr + ovrSpread);

  const pot = player.potential != null ? player.potential : player.ovr;
  const potLo = Math.max(ovrLo, pot - ovrSpread - 1);
  const potHi = Math.min(20, pot + Math.max(0, ovrSpread - 1));

  const tags = [];
  if (player.age <= 21 && pot >= player.ovr + 2) tags.push("高潜新星");
  if (player.age >= 32) tags.push("经验老将");
  if ((player.stats?.goals || 0) >= 8) tags.push("进球手");
  if ((player.stats?.assists || 0) >= 6) tags.push("创造者");
  if (player.pos === "GK" && (player.stats?.cleanSheets || 0) >= 5) tags.push("门线可靠");
  if ((player.morale || 70) < 50) tags.push("士气偏低");
  if ((player.contractYears || 2) <= 1) tags.push("合同将尽");
  if ((player.fitness || 100) < 70) tags.push("近期体能一般");
  if (!tags.length) tags.push("全面型");

  const risks = [];
  if (player.age >= 30) risks.push("年龄偏大，转售价值可能下滑");
  if ((player.contractYears || 2) <= 1) risks.push("短约，卖家可能坐地起价或球员自由身");
  if ((player.injured || 0) > 0) risks.push("目前伤缺");
  if (pot <= player.ovr) risks.push("成长空间有限");
  if (r < 9) risks.push("球探等级一般，数据区间较宽");

  const rec =
    pot >= 15 && player.age <= 24
      ? "强烈推荐跟进"
      : player.ovr >= 14 && trueVal < 800000
        ? "性价比可关注"
        : player.age >= 33
          ? "谨慎，短约过渡即可"
          : "中性评价，按需求补强";

  return {
    playerId: player.id,
    name: player.name,
    pos: player.pos,
    posLabel: POS_LABEL[player.pos] || player.pos,
    age: player.age,
    scoutRating: r,
    valueLo: lo,
    valueHi: hi,
    ovrLo,
    ovrHi,
    potLo,
    potHi,
    tags,
    risks,
    recommendation: rec,
    accuracy: Math.round(accuracy * 100),
  };
}

export function formatScoutReportHtml(rep, formatMoney) {
  if (!rep) return "";
  return `
    <div class="scout-report">
      <div class="scout-report-head">
        <strong>🔍 球探报告</strong>
        <span class="muted">可信度约 ${rep.accuracy}% · 球探 ${rep.scoutRating}/16</span>
      </div>
      <p style="margin:0.35rem 0">
        估值 <strong>${formatMoney(rep.valueLo)} – ${formatMoney(rep.valueHi)}</strong>
        · 能力 ${rep.ovrLo}–${rep.ovrHi}
        · 潜力 ${rep.potLo}–${rep.potHi}
      </p>
      <p class="scout-tags">${rep.tags.map((t) => `<span class="badge">${t}</span>`).join(" ")}</p>
      <p class="muted" style="margin:0.35rem 0 0"><strong>建议：</strong>${rep.recommendation}</p>
      ${
        rep.risks.length
          ? `<ul class="scout-risks">${rep.risks.map((r) => `<li>${r}</li>`).join("")}</ul>`
          : ""
      }
    </div>
  `;
}
