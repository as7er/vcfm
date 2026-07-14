/**
 * 球探系统：属性可见度 + 区间估值 + 赛前对手报告（信息不对称）
 */

import { POS_LABEL, FORMATIONS } from "./data.js";
import { ensureStaff, staffRating } from "./staff.js";
import { isAvailable } from "./discipline.js";

const STYLE_KEYS = ["balanced", "attack", "defend", "possession", "counter"];
const FORMATION_KEYS = Object.keys(FORMATIONS || {
  "4-3-3": 1,
  "4-4-2": 1,
  "4-2-3-1": 1,
  "3-5-2": 1,
  "5-3-2": 1,
  "4-1-4-1": 1,
  "3-4-3": 1,
  "4-5-1": 1,
});

const ATTR_LABELS = {
  pace: "速度",
  shooting: "射门",
  passing: "传球",
  dribbling: "盘带",
  defending: "防守",
  physical: "身体",
  finishing: "终结",
  tackling: "抢断",
  marking: "盯人",
  strength: "力量",
  stamina: "体能",
  vision: "视野",
  reflexes: "反应",
  handling: "手控",
  positioning: "站位",
  kicking: "开球",
};

const ATTR_LABELS_EN = {
  pace: "Pace",
  shooting: "Shooting",
  passing: "Passing",
  dribbling: "Dribbling",
  defending: "Defending",
  physical: "Physical",
  finishing: "Finishing",
  tackling: "Tackling",
  marking: "Marking",
  strength: "Strength",
  stamina: "Stamina",
  vision: "Vision",
  reflexes: "Reflexes",
  handling: "Handling",
  positioning: "Positioning",
  kicking: "Kicking",
};

function staffRatingSafe(club, role) {
  try {
    return staffRating(club, role);
  } catch {
    return 8;
  }
}

/** 稳定哈希 0–1 */
export function stableUnit(seed) {
  let h = 2166136261;
  const s = String(seed || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function pickBySeed(arr, seed) {
  if (!arr?.length) return null;
  const i = Math.floor(stableUnit(seed) * arr.length) % arr.length;
  return arr[i];
}

/**
 * 球探情报档位
 * 0 很差 · 1 一般 · 2 良好 · 3 顶尖
 */
export function scoutFogLevel(userClub) {
  const r = staffRatingSafe(userClub, "scout");
  if (r >= 16) return 3;
  if (r >= 12) return 2;
  if (r >= 9) return 1;
  return 0;
}

export function scoutRatingOf(userClub) {
  return staffRatingSafe(userClub, "scout");
}

/**
 * 属性可见：返回显示字符串与是否模糊
 * fog 0: 大部分 ?? 或 ±3
 * fog 1: ±2 区间
 * fog 2: ±1 区间
 * fog 3: 精确
 */
export function fogAttrValue(trueVal, fog, seed) {
  const v = Math.max(1, Math.min(20, Math.round(trueVal ?? 10)));
  if (fog >= 3) return { text: String(v), exact: true, lo: v, hi: v };
  if (fog <= 0) {
    // 低球探：仅粗档
    if (v >= 16) return { text: "高", exact: false, lo: 15, hi: 20, tier: "high" };
    if (v >= 12) return { text: "中", exact: false, lo: 11, hi: 16, tier: "mid" };
    if (v >= 8) return { text: "偏低", exact: false, lo: 6, hi: 11, tier: "low" };
    return { text: "弱", exact: false, lo: 1, hi: 8, tier: "weak" };
  }
  const band = fog === 1 ? 2 : 1;
  const jitter = Math.floor(stableUnit(seed) * (band + 1)) - Math.floor(band / 2);
  const center = Math.max(1, Math.min(20, v + jitter));
  const lo = Math.max(1, center - band);
  const hi = Math.min(20, center + band);
  return { text: `${lo}–${hi}`, exact: false, lo, hi };
}

/**
 * 外队球员属性行（用于详情弹窗）
 * ownPlayer=true 时始终精确
 */
export function scoutAttrRows(player, userClub, { ownPlayer = false, lang = "zh" } = {}) {
  const fog = ownPlayer ? 3 : scoutFogLevel(userClub);
  const a = player?.attrs || {};
  const labels = lang === "en" ? ATTR_LABELS_EN : ATTR_LABELS;
  const keys = [
    "pace",
    "shooting",
    "passing",
    "dribbling",
    "defending",
    "physical",
    "finishing",
    "tackling",
    "marking",
    "strength",
    "stamina",
    "vision",
  ];
  if (player?.pos === "GK") {
    keys.push("reflexes", "handling", "positioning", "kicking");
  }
  // 低球探只展示关键几项
  const showKeys =
    fog <= 0
      ? player?.pos === "GK"
        ? ["reflexes", "handling", "positioning"]
        : ["pace", "shooting", "passing", "defending", "physical"]
      : fog === 1
        ? keys.filter((k) =>
            ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing", "tackling", "reflexes", "handling"].includes(k)
          )
        : keys;

  return showKeys.map((k) => {
    const fogged = fogAttrValue(a[k], fog, `${player?.id}_${k}`);
    return {
      key: k,
      label: labels[k] || k,
      ...fogged,
    };
  });
}

export function formatScoutOvrFog(player, userClub, { ownPlayer = false } = {}) {
  if (ownPlayer) return String(player.ovr ?? "—");
  const fog = scoutFogLevel(userClub);
  const ovr = player.ovr || 10;
  if (fog >= 3) return String(ovr);
  const band = fog === 2 ? 1 : fog === 1 ? 2 : 3;
  const j = Math.floor(stableUnit(player.id + "_ovr") * 3) - 1;
  const c = Math.max(1, Math.min(20, ovr + j));
  return `${Math.max(1, c - band)}–${Math.min(20, c + band)}`;
}

export function formatScoutPotFog(player, userClub, { ownPlayer = false } = {}) {
  if (ownPlayer) return player.potential != null ? String(player.potential) : "—";
  const fog = scoutFogLevel(userClub);
  const pot = player.potential != null ? player.potential : player.ovr || 10;
  if (fog >= 3) return String(pot);
  if (fog <= 0) {
    if (pot >= 16) return "高";
    if (pot >= 13) return "中高";
    return "一般";
  }
  const band = fog === 2 ? 1 : 2;
  return `${Math.max(1, pot - band)}–${Math.min(20, pot + band)}`;
}

export function buildScoutReport(world, player, userClub) {
  if (!player) return null;
  const r = staffRatingSafe(userClub, "scout");
  const fog = scoutFogLevel(userClub);
  const accuracy = Math.min(0.95, 0.45 + r / 25);
  const trueVal = player.value || 0;
  const spread = (1 - accuracy) * 0.45 + 0.08;
  const lo = Math.round(trueVal * (1 - spread));
  const hi = Math.round(trueVal * (1 + spread * 0.9));

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
  if (r < 9) risks.push("球探等级一般，数据区间较宽、属性多不可见");

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
    fogLevel: fog,
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
    attrs: scoutAttrRows(player, userClub, { ownPlayer: false }),
  };
}

export function formatScoutReportHtml(rep, formatMoney, lang = "zh") {
  if (!rep) return "";
  const en = lang === "en";
  const fogHint =
    rep.fogLevel <= 0
      ? en
        ? "Low scout: attributes mostly tiered"
        : "球探偏弱：属性多为档位"
      : rep.fogLevel === 1
        ? en
          ? "Scout: attribute ranges only"
          : "球探一般：属性为区间"
        : rep.fogLevel === 2
          ? en
            ? "Good scout: tight ranges"
            : "球探良好：区间较窄"
          : en
            ? "Elite scout: precise reads"
            : "顶尖球探：读数精确";

  const attrHtml = (rep.attrs || [])
    .slice(0, 8)
    .map((a) => `<span class="scout-attr-chip"><em>${a.label}</em> ${a.text}</span>`)
    .join("");

  return `
    <div class="scout-report">
      <div class="scout-report-head">
        <strong>🔍 ${en ? "Scout report" : "球探报告"}</strong>
        <span class="muted">${en ? "Confidence" : "可信度"} ~${rep.accuracy}% · ${en ? "Scout" : "球探"} ${rep.scoutRating}/16 · ${fogHint}</span>
      </div>
      <p style="margin:0.35rem 0">
        ${en ? "Value" : "估值"} <strong>${formatMoney(rep.valueLo)} – ${formatMoney(rep.valueHi)}</strong>
        · ${en ? "OVR" : "能力"} ${rep.ovrLo}–${rep.ovrHi}
        · ${en ? "POT" : "潜力"} ${rep.potLo}–${rep.potHi}
      </p>
      ${attrHtml ? `<div class="scout-attr-row">${attrHtml}</div>` : ""}
      <p class="scout-tags">${rep.tags.map((t) => `<span class="badge">${t}</span>`).join(" ")}</p>
      <p class="muted" style="margin:0.35rem 0 0"><strong>${en ? "Note:" : "建议："}</strong>${rep.recommendation}</p>
      ${
        rep.risks.length
          ? `<ul class="scout-risks">${rep.risks.map((r) => `<li>${r}</li>`).join("")}</ul>`
          : ""
      }
    </div>
  `;
}

// ---------- 赛前对手报告 ----------

function styleLabel(key, en) {
  const map = {
    balanced: en ? "Balanced" : "均衡",
    attack: en ? "Attacking" : "进攻",
    defend: en ? "Defensive" : "防守",
    possession: en ? "Possession" : "控球",
    counter: en ? "Counter" : "反击",
  };
  return map[key] || key;
}

function setPieceBand(score, en) {
  if (score >= 0.66) return en ? "Strong" : "强";
  if (score >= 0.4) return en ? "Average" : "中";
  return en ? "Weak" : "弱";
}

/**
 * 赛前对手情报（带噪声，受球探等级影响）
 */
export function buildOpponentReport(world, userClub, oppClub, fixture = null) {
  if (!userClub || !oppClub) return null;
  ensureStaff(userClub);
  const r = staffRatingSafe(userClub, "scout");
  const fog = scoutFogLevel(userClub);
  const seedBase = `${fixture?.id || fixture?.day || world?.day || 0}_${userClub.id}_${oppClub.id}`;

  const trueForm = oppClub.tactics?.formation || "4-3-3";
  const trueStyle = oppClub.tactics?.style || "balanced";

  // 阵型猜测：低球探可能猜错
  let shownForm = trueForm;
  let formCertain = true;
  if (fog <= 0) {
    formCertain = false;
    if (stableUnit(seedBase + "_f") > 0.45) {
      shownForm = pickBySeed(
        FORMATION_KEYS.filter((k) => k !== trueForm),
        seedBase + "_fw"
      ) || trueForm;
    }
  } else if (fog === 1) {
    formCertain = stableUnit(seedBase + "_f") > 0.25;
    if (!formCertain && stableUnit(seedBase + "_f2") > 0.55) {
      shownForm = pickBySeed(FORMATION_KEYS, seedBase + "_fw2") || trueForm;
    }
  } else if (fog === 2) {
    formCertain = true;
    // 偶发 ± 不确定标记
    formCertain = stableUnit(seedBase + "_f3") > 0.15;
  }

  let shownStyle = trueStyle;
  let styleCertain = true;
  if (fog <= 0) {
    styleCertain = false;
    if (stableUnit(seedBase + "_s") > 0.4) {
      shownStyle = pickBySeed(
        STYLE_KEYS.filter((k) => k !== trueStyle),
        seedBase + "_sw"
      ) || trueStyle;
    }
  } else if (fog === 1) {
    styleCertain = stableUnit(seedBase + "_s") > 0.3;
    if (!styleCertain && stableUnit(seedBase + "_s2") > 0.5) {
      shownStyle = pickBySeed(STYLE_KEYS, seedBase + "_sw2") || trueStyle;
    }
  }

  // 危险球员 1–3，能力模糊
  const dangerCount = fog <= 0 ? 1 : fog === 1 ? 2 : 3;
  const danger = [...(oppClub.players || [])]
    .filter((p) => isAvailable(p))
    .sort((a, b) => (b.ovr || 0) - (a.ovr || 0))
    .slice(0, dangerCount)
    .map((p, i) => {
      const ovrTxt = formatScoutOvrFog(p, userClub, { ownPlayer: false });
      const noteKeys = ["finisher", "creator", "engine", "wall", "speed"];
      const note = pickBySeed(noteKeys, seedBase + "_d" + p.id + i);
      const noteZh = {
        finisher: "禁区杀手",
        creator: "组织核心",
        engine: "中场发动机",
        wall: "防线屏障",
        speed: "边路爆点",
      };
      const noteEn = {
        finisher: "Finisher",
        creator: "Creator",
        engine: "Engine",
        wall: "Defensive rock",
        speed: "Wide threat",
      };
      return {
        id: p.id,
        name: p.name,
        pos: p.pos,
        ovrText: ovrTxt,
        note: noteZh[note] || "关键人",
        noteEn: noteEn[note] || "Key",
      };
    });

  // 定位球强弱（由队内相关属性推，再加噪声）
  const avail = (oppClub.players || []).filter((p) => isAvailable(p));
  const avg = (fn) =>
    avail.length ? avail.reduce((s, p) => s + fn(p), 0) / avail.length : 10;
  let spAtk =
    (avg((p) => (p.attrs?.shooting || 10) * 0.4 + (p.attrs?.passing || 10) * 0.3 + (p.attrs?.strength || 10) * 0.3) -
      8) /
    12;
  let spDef =
    (avg((p) => (p.attrs?.defending || 10) * 0.45 + (p.attrs?.marking || 10) * 0.3 + (p.attrs?.physical || 10) * 0.25) -
      8) /
    12;
  spAtk = Math.max(0, Math.min(1, spAtk + (stableUnit(seedBase + "_spa") - 0.5) * (0.35 - fog * 0.08)));
  spDef = Math.max(0, Math.min(1, spDef + (stableUnit(seedBase + "_spd") - 0.5) * (0.35 - fog * 0.08)));

  // 节奏/压迫猜测
  const press = oppClub.tactics?.pressing ?? 3;
  const tempo = oppClub.tactics?.tempo ?? 3;
  let pressLabel = press >= 4 ? "high" : press <= 2 ? "low" : "mid";
  let tempoLabel = tempo >= 4 ? "high" : tempo <= 2 ? "low" : "mid";
  if (fog <= 1 && stableUnit(seedBase + "_pt") > 0.55) {
    pressLabel = pickBySeed(["high", "mid", "low"], seedBase + "_pr");
    tempoLabel = pickBySeed(["high", "mid", "low"], seedBase + "_tm");
  }

  const confidence = Math.round(
    Math.min(95, 38 + r * 3.2 + (fog >= 2 ? 8 : 0) - (fog <= 0 ? 10 : 0))
  );

  const tips = [];
  if (shownStyle === "attack" || shownStyle === "counter") {
    tips.push(fog <= 0 ? "对方偏进攻，注意身后空当" : "对方偏进攻/反击，边后卫勿压太上");
  }
  if (shownStyle === "defend" || shownStyle === "possession") {
    tips.push("对方可能收缩或控球消耗，耐心拆防");
  }
  if (pressLabel === "high") tips.push("高位压迫迹象：出球要干净，少回传门将");
  if (spAtk >= 0.6) tips.push("定位球有威胁，禁区盯人要死");
  if (spDef <= 0.35) tips.push("对方定位球防守一般，可多争角球");
  if (danger[0]) tips.push(`重点盯防 ${danger[0].name}`);
  if (!tips.length) tips.push("情报有限，开场观察再调");

  // 是否在关注列表
  const watched = (world?.scoutWatch || []).filter((id) =>
    (oppClub.players || []).some((p) => p.id === id)
  );

  return {
    scoutRating: r,
    fogLevel: fog,
    confidence,
    formation: {
      value: shownForm,
      certain: formCertain,
      trueValue: trueForm, // 仅内部，UI 勿直接展示真值 unless debug
    },
    style: {
      value: shownStyle,
      certain: styleCertain,
    },
    pressing: pressLabel,
    tempo: tempoLabel,
    danger,
    setPieces: {
      attack: spAtk,
      defense: spDef,
      attackBand: setPieceBand(spAtk, false),
      defenseBand: setPieceBand(spDef, false),
      attackBandEn: setPieceBand(spAtk, true),
      defenseBandEn: setPieceBand(spDef, true),
    },
    tips,
    watchedCount: watched.length,
    powerShown:
      fog >= 2
        ? String(oppClub.power || 50)
        : fog === 1
          ? `${Math.max(1, (oppClub.power || 50) - 4)}–${(oppClub.power || 50) + 4}`
          : "??",
  };
}

export function formatOpponentReportHtml(rep, { lang = "zh", compact = false } = {}) {
  if (!rep) return "";
  const en = lang === "en";
  const conf = rep.confidence;
  const formQ = rep.formation.certain ? "" : en ? " (est.)" : "（估计）";
  const styleQ = rep.style.certain ? "" : en ? " (est.)" : "（估计）";
  const styleTxt = styleLabel(rep.style.value, en);
  const pressMap = {
    high: en ? "High" : "高",
    mid: en ? "Med" : "中",
    low: en ? "Low" : "低",
  };
  const danger = (rep.danger || [])
    .map(
      (d) =>
        `<span class="opp-danger-chip">${escapeHtmlLite(d.name)} <em>${escapeHtmlLite(d.pos)}</em> ${escapeHtmlLite(d.ovrText)} · ${escapeHtmlLite(en ? d.noteEn : d.note)}</span>`
    )
    .join("");
  const tips = (rep.tips || [])
    .slice(0, compact ? 2 : 4)
    .map((t) => `<li>${escapeHtmlLite(t)}</li>`)
    .join("");

  return `<div class="opp-report ${compact ? "compact" : "full"}">
    <div class="opp-report-head">
      <strong>🕵️ ${en ? "Opponent report" : "对手报告"}</strong>
      <span class="muted">${en ? "Confidence" : "可信度"} ${conf}% · ${en ? "Scout" : "球探"} ${rep.scoutRating}/16</span>
    </div>
    <div class="opp-report-grid">
      <div><span class="muted">${en ? "Formation" : "阵型"}</span> <strong>${escapeHtmlLite(rep.formation.value)}${formQ}</strong></div>
      <div><span class="muted">${en ? "Style" : "风格"}</span> <strong>${escapeHtmlLite(styleTxt)}${styleQ}</strong></div>
      <div><span class="muted">${en ? "Press" : "压迫"}</span> <strong>${pressMap[rep.pressing] || rep.pressing}</strong></div>
      <div><span class="muted">${en ? "Tempo" : "节奏"}</span> <strong>${pressMap[rep.tempo] || rep.tempo}</strong></div>
      <div><span class="muted">${en ? "Set pieces ⬆" : "定位球攻"}</span> <strong>${en ? rep.setPieces.attackBandEn : rep.setPieces.attackBand}</strong></div>
      <div><span class="muted">${en ? "Set pieces ⬇" : "定位球防"}</span> <strong>${en ? rep.setPieces.defenseBandEn : rep.setPieces.defenseBand}</strong></div>
      <div><span class="muted">${en ? "Power" : "实力"}</span> <strong>${escapeHtmlLite(rep.powerShown)}</strong></div>
    </div>
    ${danger ? `<div class="opp-danger-row"><span class="muted">${en ? "Threats" : "危险球员"}</span> ${danger}</div>` : ""}
    ${tips ? `<ul class="opp-tips">${tips}</ul>` : ""}
    ${
      fogHintHtml(rep.fogLevel, en)
    }
  </div>`;
}

function fogHintHtml(fog, en) {
  const t =
    fog <= 0
      ? en
        ? "Low scout quality — treat estimates as rough."
        : "球探偏弱，估计值仅供参考。"
      : fog === 1
        ? en
          ? "Some details may be wrong."
          : "部分细节可能有误。"
        : "";
  return t ? `<p class="opp-fog-hint muted">${t}</p>` : "";
}

function escapeHtmlLite(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 对手报告 → 评论流文案 */
export function opponentReportLogLines(rep, lang = "zh") {
  if (!rep) return [];
  const en = lang === "en";
  const lines = [];
  lines.push(
    en
      ? `🕵️ Opp report · confidence ${rep.confidence}%`
      : `🕵️ 对手报告 · 可信度 ${rep.confidence}%`
  );
  const formQ = rep.formation.certain ? "" : en ? "~" : "约";
  const styleQ = rep.style.certain ? "" : en ? "~" : "约";
  lines.push(
    en
      ? `Setup: ${formQ}${rep.formation.value} · ${styleQ}${styleLabel(rep.style.value, true)}`
      : `部署：${formQ}${rep.formation.value} · ${styleQ}${styleLabel(rep.style.value, false)}`
  );
  if (rep.danger?.length) {
    lines.push(
      en
        ? `Threats: ${rep.danger.map((d) => `${d.name}(${d.ovrText})`).join(", ")}`
        : `危险：${rep.danger.map((d) => `${d.name}(${d.ovrText})`).join("、")}`
    );
  }
  lines.push(
    en
      ? `Set pieces: atk ${rep.setPieces.attackBandEn} · def ${rep.setPieces.defenseBandEn}`
      : `定位球：攻 ${rep.setPieces.attackBand} · 防 ${rep.setPieces.defenseBand}`
  );
  if (rep.tips?.[0]) lines.push(en ? `Tip: ${rep.tips[0]}` : `提示：${rep.tips[0]}`);
  return lines;
}
