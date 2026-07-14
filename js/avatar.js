/**
 * 程序生成 SVG 小人形象（球员 / 职员 / 经理）
 * 由 id 种子稳定生成；表情随状态变化（开心 / 受伤等）。
 * v2 polish：中性灰背景 + 球衣强制对比/双描边、发型/肤色拉开、五官高光。
 * v3：小尺寸（列表/战术板 ≤32px）用紧凑五官，避免缩成「黑脸大眼珠」。
 * v3.1：compact 强制浅肤 + 短顶发，避免深发盖满圆圈像「黑球」。
 * v4：战术板/列表 ≤36px 改走 token 令牌（大脸+短发帽+简化球衣），不再缩放完整小人。
 */

/** 肤色：偏浅 → 中 → 深；刻意不含近黑，缩小时仍像人脸 */
const SKINS = [
  "#ffe0c2",
  "#f5d0b0",
  "#e8b896",
  "#d4a574",
  "#c68642",
  "#a86f3a",
  "#8d5524",
  "#7a4a28",
];
/** 发色 */
const HAIRS = [
  "#0f0f10",
  "#1a1a1a",
  "#2c1810",
  "#3d2314",
  "#5c3317",
  "#6b4423",
  "#8b5a2b",
  "#c4a35a",
  "#d4af37",
  "#8b0000",
  "#4a1515",
  "#2f4f4f",
  "#1e3a5f",
  "#f5f5f5",
  "#c0c0c0",
  "#4a3728",
];
const BG_FALLBACK = ["#1e3a5f", "#3d1f4a", "#1a4d3e", "#4a3020", "#2c3e50", "#3b2f5c", "#1a2744"];

/** @typedef {'neutral'|'happy'|'injured'|'sad'|'tired'} AvatarMood */

function hashStr(s) {
  let h = 2166136261;
  const str = String(s || "x");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(arr, h, salt = 0) {
  return arr[(h + salt * 97) % arr.length];
}

function initials(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return String(name).slice(0, 2).toUpperCase();
}

function shiftHex(hex, delta) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#") || hex.length < 7) {
    return hex || "#334155";
  }
  const clamp = (n) => Math.max(0, Math.min(255, n));
  const r = clamp(parseInt(hex.slice(1, 3), 16) + delta);
  const g = clamp(parseInt(hex.slice(3, 5), 16) + delta);
  const b = clamp(parseInt(hex.slice(5, 7), 16) + delta);
  return (
    "#" +
    [r, g, b]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** 两色混合（t=0 全 a，t=1 全 b） */
function mixHex(a, b, t) {
  if (!a?.startsWith?.("#") || a.length < 7) return b || a || "#334155";
  if (!b?.startsWith?.("#") || b.length < 7) return a;
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  const ch = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const r = clamp(ch(a, 0) * (1 - t) + ch(b, 0) * t);
  const g = clamp(ch(a, 1) * (1 - t) + ch(b, 1) * t);
  const bl = clamp(ch(a, 2) * (1 - t) + ch(b, 2) * t);
  return (
    "#" +
    [r, g, bl]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** 相对亮度 0–1（sRGB 近似） */
function luminance(hex) {
  if (!hex?.startsWith?.("#") || hex.length < 7) return 0.2;
  const ch = (i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(1)) + 0.0722 * lin(ch(2));
}

/**
 * 球衣显示色：相对背景强制拉开对比（深衣大幅提亮，极亮衣略压）
 * 保留色相，主要动明度；比 v1 更激进，解决「深队服≈深背景」
 */
function kitDisplayColor(hex, bgLum = 0.12) {
  let c = hex || "#3d8bfd";
  let lum = luminance(c);
  // 目标：相对背景至少 +0.28 亮度差，且绝对不低于 ~0.34
  const minLum = Math.max(0.34, bgLum + 0.28);
  let guard = 0;
  while (lum < minLum && guard < 8) {
    // 越暗混入越多白；同时略加饱和感用浅色推
    const t = Math.min(0.55, 0.22 + (minLum - lum) * 0.9);
    c = mixHex(c, "#ffffff", t);
    lum = luminance(c);
    guard++;
  }
  // 仍偏闷的极深色：再叠一层冷白，避免糊成「一块灰」
  if (lum < 0.4) c = mixHex(c, "#e8eef8", 0.18);
  // 极亮白衣：略压，靠深描边辨认
  if (lum > 0.9) c = mixHex(c, "#cbd5e1", 0.2);
  return c;
}

/** 球衣主描边：深衣用亮边，浅衣用深边（提高不透明度） */
function kitOutlineColor(kitHex) {
  return luminance(kitHex) < 0.48 ? "rgba(255,255,255,0.92)" : "rgba(15,23,42,0.78)";
}

/** 外圈暗描边：给球衣「剪影」感，与背景彻底脱开 */
function kitOuterStroke(kitHex) {
  return luminance(kitHex) < 0.48 ? "rgba(0,0,0,0.55)" : "rgba(15,23,42,0.45)";
}

/**
 * 根据球员状态推断表情（优先级：伤 > 低士气 > 高士气开心 > 低体能疲惫 > 默认）
 * @returns {AvatarMood}
 */
export function moodFromPlayer(player) {
  if (!player) return "neutral";
  if ((player.injured || 0) > 0) return "injured";
  const morale = player.morale ?? 70;
  const fitness = player.fitness ?? 80;
  if (morale <= 40) return "sad";
  if (morale >= 82) return "happy";
  if (fitness <= 50) return "tired";
  if (fitness <= 62 && morale < 60) return "tired";
  return "neutral";
}

/** 五官：眼高光 + 眉 + 嘴 + 可选绷带/汗；compact 时缩小眼白，避免战术板「大眼珠」 */
function faceFeatures(mood, hair, browY, skin, compact = false) {
  const brow = shiftHex(hair, -10);
  const lip = mixHex("#b4534a", skin, 0.25);
  let eyes = "";
  let brows = "";
  let mouth = "";
  let extra = "";
  const sw = compact ? 1.05 : 1.35;
  const browW = compact ? 1.05 : 1.25;

  // 眼白 + 瞳孔 + 高光（通用积木）
  // 大尺寸可带眼白；小尺寸只用小圆点+高光，否则缩成两颗「白球黑珠」
  const eyePair = (ly, ry, open = true) => {
    if (!open) {
      return `
        <path d="M17 ${ly} H21" stroke="#1e293b" stroke-width="${sw}" stroke-linecap="round"/>
        <path d="M27 ${ry} H31" stroke="#1e293b" stroke-width="${sw}" stroke-linecap="round"/>
      `;
    }
    if (compact) {
      return `
        <circle cx="19" cy="${ly}" r="1.15" fill="#1e293b"/>
        <circle cx="29" cy="${ry}" r="1.15" fill="#1e293b"/>
        <circle cx="19.35" cy="${ly - 0.35}" r="0.32" fill="#fff" opacity="0.9"/>
        <circle cx="29.35" cy="${ry - 0.35}" r="0.32" fill="#fff" opacity="0.9"/>
      `;
    }
    return `
      <ellipse cx="19" cy="${ly}" rx="2.05" ry="2.25" fill="#f8fafc"/>
      <ellipse cx="29" cy="${ry}" rx="2.05" ry="2.25" fill="#f8fafc"/>
      <circle cx="19.15" cy="${ly + 0.1}" r="1.05" fill="#1e293b"/>
      <circle cx="29.15" cy="${ry + 0.1}" r="1.05" fill="#1e293b"/>
      <circle cx="19.55" cy="${ly - 0.4}" r="0.38" fill="#fff" opacity="0.9"/>
      <circle cx="29.55" cy="${ry - 0.4}" r="0.38" fill="#fff" opacity="0.9"/>
    `;
  };

  if (mood === "injured") {
    if (compact) {
      eyes = `
        <path d="M17 20.8 L21 22.6 M21 20.8 L17 22.6" stroke="#1e293b" stroke-width="${sw}" stroke-linecap="round"/>
        <circle cx="29" cy="21.5" r="1.1" fill="#1e293b"/>
        <circle cx="29.3" cy="21.15" r="0.3" fill="#fff" opacity="0.85"/>
      `;
    } else {
      eyes = `
        <path d="M16.5 20.5 L21.5 22.5 M21.5 20.5 L16.5 22.5" stroke="#1e293b" stroke-width="1.35" stroke-linecap="round"/>
        <ellipse cx="29" cy="21.5" rx="2.0" ry="2.15" fill="#f8fafc"/>
        <circle cx="29.1" cy="21.6" r="1.0" fill="#1e293b"/>
        <circle cx="29.5" cy="21.15" r="0.35" fill="#fff" opacity="0.85"/>
      `;
    }
    brows = `
      <path d="M15 17.5 L22 19" stroke="${brow}" stroke-width="${browW}" stroke-linecap="round"/>
      <path d="M27 18.5 L33 17" stroke="${brow}" stroke-width="${browW}" stroke-linecap="round"/>
    `;
    mouth = `<path d="M20 27.5 Q24 25 28 27.5" stroke="${lip}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`;
    if (!compact) {
      extra = `
        <path d="M10 14 L18 8 L22 12 L14 18 Z" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.6"/>
        <path d="M12 15 L20 9" stroke="#ef4444" stroke-width="1.1"/>
        <path d="M14 17 L22 11" stroke="#ef4444" stroke-width="1.1"/>
      `;
    } else {
      extra = `<path d="M12 14 L17 10 L19 12 L14 16 Z" fill="#f8fafc" stroke="#ef4444" stroke-width="0.7"/>`;
    }
  } else if (mood === "happy") {
    eyes = `
      <path d="M16.5 21.3 Q19 18.6 21.5 21.3" stroke="#1e293b" stroke-width="${compact ? 1.25 : 1.45}" fill="none" stroke-linecap="round"/>
      <path d="M26.5 21.3 Q29 18.6 31.5 21.3" stroke="#1e293b" stroke-width="${compact ? 1.25 : 1.45}" fill="none" stroke-linecap="round"/>
    `;
    brows = `
      <path d="M16 ${browY - 0.6} H21" stroke="${brow}" stroke-width="${browW}" stroke-linecap="round"/>
      <path d="M27 ${browY - 0.6} H32" stroke="${brow}" stroke-width="${browW}" stroke-linecap="round"/>
    `;
    mouth = `
      <path d="M18.5 25.8 Q24 30.5 29.5 25.8" stroke="${lip}" stroke-width="${compact ? 1.15 : 1.35}" fill="none" stroke-linecap="round"/>
      ${compact ? "" : `<path d="M20.5 26.2 Q24 30 27.5 26.2" fill="#fca5a5" opacity="0.5"/>`}
    `;
  } else if (mood === "sad") {
    eyes = eyePair(21.8, 21.8);
    brows = `
      <path d="M15 19 L22 17.3" stroke="${brow}" stroke-width="${browW}" stroke-linecap="round"/>
      <path d="M26 17.3 L33 19" stroke="${brow}" stroke-width="${browW}" stroke-linecap="round"/>
    `;
    mouth = `<path d="M20 28 Q24 25.2 28 28" stroke="${lip}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`;
    if (!compact) {
      extra = `<path d="M17 24.5 Q19 26 21 24.5" stroke="#7dd3fc" stroke-width="1" fill="none" opacity="0.85"/>`;
    }
  } else if (mood === "tired") {
    eyes = `
      ${eyePair(22.0, 22.0)}
      <path d="M16.5 20.4 H21.5" stroke="#1e293b" stroke-width="0.95" stroke-linecap="round" opacity="0.5"/>
      <path d="M26.5 20.4 H31.5" stroke="#1e293b" stroke-width="0.95" stroke-linecap="round" opacity="0.5"/>
    `;
    brows = `
      <path d="M16 ${browY + 0.6} H21" stroke="${brow}" stroke-width="${browW}" stroke-linecap="round"/>
      <path d="M27 ${browY + 0.6} H32" stroke="${brow}" stroke-width="${browW}" stroke-linecap="round"/>
    `;
    mouth = `<path d="M20 26.8 H28" stroke="${lip}" stroke-width="${sw}" stroke-linecap="round"/>`;
    if (!compact) {
      extra = `
        <circle cx="34.5" cy="15.5" r="1.15" fill="#7dd3fc" opacity="0.9"/>
        <circle cx="37" cy="18.5" r="0.9" fill="#7dd3fc" opacity="0.7"/>
        <circle cx="35.5" cy="20.5" r="0.55" fill="#7dd3fc" opacity="0.5"/>
      `;
    }
  } else {
    eyes = eyePair(21, 21);
    brows = `
      <path d="M16 ${browY} H21" stroke="${brow}" stroke-width="${browW}" stroke-linecap="round"/>
      <path d="M27 ${browY} H32" stroke="${brow}" stroke-width="${browW}" stroke-linecap="round"/>
    `;
    mouth = `<path d="M20 26.2 Q24 28.5 28 26.2" stroke="${lip}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`;
  }

  return { eyes, brows, mouth, extra };
}

/**
 * 发型路径（7 种；compact 只画短顶发，避免 30px 时头发吞掉整张脸）
 */
function hairPaths(style, hair, h, compact = false) {
  const shade = shiftHex(hair, compact ? -8 : -18);
  if (compact) {
    // 小圆头像：统一短顶/薄刘海，禁止蓬松卷发与披肩长发
    const kind = style % 4;
    if (kind === 0) {
      return `<ellipse cx="24" cy="12.2" rx="9.2" ry="5.6" fill="${hair}"/>`;
    }
    if (kind === 1) {
      return `
        <ellipse cx="24" cy="11.8" rx="9.6" ry="5.2" fill="${hair}"/>
        <path d="M15.5 14.5 Q24 11.2 32.5 14.5" fill="${hair}"/>
      `;
    }
    if (kind === 2) {
      return `<ellipse cx="24" cy="12" rx="8.8" ry="4.6" fill="${hair}" opacity="0.92"/>`;
    }
    return `
      <ellipse cx="24" cy="12.4" rx="9.4" ry="5.4" fill="${hair}"/>
      <ellipse cx="24" cy="11" rx="7.2" ry="2.6" fill="${shade}" opacity="0.35"/>
    `;
  }
  switch (style % 7) {
    case 0: // 短平
      return `
        <ellipse cx="24" cy="13.5" rx="12.2" ry="9.2" fill="${hair}"/>
        <ellipse cx="24" cy="11" rx="10" ry="5" fill="${shade}" opacity="0.35"/>
      `;
    case 1: // 前额刘海
      return `
        <path d="M11.5 17 Q13 5.5 24 6.5 Q35 5.5 36.5 17 Q30 11.5 24 12 Q18 11.5 11.5 17 Z" fill="${hair}"/>
        <path d="M14 12 Q24 8 34 12" stroke="${shade}" stroke-width="1.2" fill="none" opacity="0.4"/>
      `;
    case 2: // 卷发/蓬松
      return `
        <circle cx="15" cy="12" r="5.2" fill="${hair}"/>
        <circle cx="24" cy="9.5" r="6.2" fill="${hair}"/>
        <circle cx="33" cy="12" r="5.2" fill="${hair}"/>
        <circle cx="18" cy="15" r="4" fill="${hair}"/>
        <circle cx="30" cy="15" r="4" fill="${hair}"/>
        <ellipse cx="24" cy="14" rx="11.5" ry="6.5" fill="${hair}"/>
      `;
    case 3: // 中分偏短
      return `
        <ellipse cx="24" cy="13" rx="11.5" ry="7.5" fill="${hair}"/>
        <path d="M24 6.5 V16" stroke="${shade}" stroke-width="1.1" opacity="0.45"/>
      `;
    case 4: // 两侧长/披肩感
      return `
        <ellipse cx="24" cy="13" rx="12.5" ry="9" fill="${hair}"/>
        <path d="M11.5 16 Q9.5 25 12.5 30" stroke="${hair}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <path d="M36.5 16 Q38.5 25 35.5 30" stroke="${hair}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      `;
    case 5: // 寸头/光头边缘
      if ((h & 3) === 0) {
        // 接近光头：只留薄边
        return `<ellipse cx="24" cy="12" rx="11" ry="5.5" fill="${hair}" opacity="0.55"/>`;
      }
      return `
        <ellipse cx="24" cy="12.5" rx="11.8" ry="7" fill="${hair}"/>
        <ellipse cx="24" cy="11" rx="9" ry="3.5" fill="${shade}" opacity="0.3"/>
      `;
    default: // 高马尾/顶髻暗示
      return `
        <ellipse cx="24" cy="14" rx="11.5" ry="8" fill="${hair}"/>
        <ellipse cx="24" cy="7" rx="4.5" ry="4" fill="${hair}"/>
        <circle cx="24" cy="5.5" r="2.8" fill="${shade}" opacity="0.4"/>
      `;
  }
}

/**
 * 战术板 / 列表专用令牌头像（为大圆点可读性设计，非完整小人缩放）
 * 结构：亮灰底 → 大面积肤色脸 → 短发帽 → 下半身球衣色块 → 两点眼睛
 */
function renderTokenAvatarSvg(opts = {}) {
  const seed = opts.seed || opts.id || opts.name || "anon";
  const h = hashStr(seed);
  const size = opts.size || 36;
  const mood = opts.mood || "neutral";
  const pos = opts.pos || "";
  const kitPRaw = opts.kitPrimary || "#3d8bfd";
  let kitSRaw = opts.kitSecondary || shiftHex(kitPRaw, -42);
  {
    const pr = parseInt(String(kitPRaw).slice(1, 3), 16) || 0;
    const pg = parseInt(String(kitPRaw).slice(3, 5), 16) || 0;
    const pb = parseInt(String(kitPRaw).slice(5, 7), 16) || 0;
    const sr = parseInt(String(kitSRaw).slice(1, 3), 16) || 0;
    const sg = parseInt(String(kitSRaw).slice(3, 5), 16) || 0;
    const sb = parseInt(String(kitSRaw).slice(5, 7), 16) || 0;
    if (Math.hypot(pr - sr, pg - sg, pb - sb) < 70) {
      const lum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
      kitSRaw = lum > 140 ? mixHex(kitPRaw, "#0f172a", 0.55) : mixHex(kitPRaw, "#f8fafc", 0.45);
    }
  }
  // 强制可读肤色：只在浅/中暖色里选
  const tokenSkins = ["#ffd9b8", "#f5c9a0", "#efbf94", "#e8b896", "#d4a574"];
  let skin = pick(tokenSkins, h, 1);
  if (luminance(skin) < 0.48) skin = mixHex(skin, "#ffe0c2", 0.5);
  // 发色：避免纯黑
  const tokenHairs = ["#3d2914", "#4a3420", "#5c4033", "#6b4423", "#2c3e50", "#4a5568", "#7a5c3a"];
  let hair = pick(tokenHairs, h, 2);
  if (luminance(hair) < 0.1) hair = "#4a3420";

  const bgTop = mood === "injured" ? "#6a5560" : mood === "happy" ? "#556a60" : "#6b7488";
  const bgBot = mood === "injured" ? "#4e4048" : mood === "happy" ? "#424e46" : "#525a6e";
  const bgLum = luminance(bgBot);
  const kitP = kitDisplayColor(kitPRaw, bgLum);
  const kitS = kitDisplayColor(kitSRaw, bgLum);
  const kitOuter = kitOuterStroke(kitP);
  const kitOutline = kitOutlineColor(kitP);

  const clipId = `tok${h.toString(36)}${mood[0] || "n"}s${size}`;
  const faceY = 17.5;
  // 发帽：只盖头顶，绝不盖过眼睛
  const hairCap =
    (h % 3) === 0
      ? `<ellipse cx="24" cy="11.5" rx="11" ry="6.2" fill="${hair}"/>`
      : (h % 3) === 1
        ? `<path d="M12.5 15 Q13 7 24 7.5 Q35 7 35.5 15 Q30 11.5 24 12 Q18 11.5 12.5 15 Z" fill="${hair}"/>`
        : `<ellipse cx="24" cy="12" rx="10.5" ry="5.4" fill="${hair}"/><ellipse cx="24" cy="10.5" rx="8" ry="2.8" fill="${shiftHex(hair, 20)}" opacity="0.35"/>`;

  let eyes;
  if (mood === "happy") {
    eyes = `
      <path d="M16.5 18.5 Q19 16.2 21.5 18.5" stroke="#1e293b" stroke-width="1.35" fill="none" stroke-linecap="round"/>
      <path d="M26.5 18.5 Q29 16.2 31.5 18.5" stroke="#1e293b" stroke-width="1.35" fill="none" stroke-linecap="round"/>
    `;
  } else if (mood === "injured") {
    eyes = `
      <path d="M16.5 17.5 L21.5 20 M21.5 17.5 L16.5 20" stroke="#1e293b" stroke-width="1.2" stroke-linecap="round"/>
      <circle cx="29" cy="18.5" r="1.35" fill="#1e293b"/>
      <circle cx="29.4" cy="18.1" r="0.4" fill="#fff" opacity="0.9"/>
    `;
  } else {
    eyes = `
      <circle cx="19" cy="18.5" r="1.45" fill="#1e293b"/>
      <circle cx="29" cy="18.5" r="1.45" fill="#1e293b"/>
      <circle cx="19.4" cy="18.1" r="0.4" fill="#fff" opacity="0.95"/>
      <circle cx="29.4" cy="18.1" r="0.4" fill="#fff" opacity="0.95"/>
    `;
  }
  const mouth =
    mood === "happy"
      ? `<path d="M19 23.2 Q24 27 29 23.2" stroke="#b4534a" stroke-width="1.25" fill="none" stroke-linecap="round"/>`
      : mood === "sad"
        ? `<path d="M19.5 25 Q24 22.5 28.5 25" stroke="#b4534a" stroke-width="1.15" fill="none" stroke-linecap="round"/>`
        : `<path d="M19.5 24 Q24 25.8 28.5 24" stroke="#b4534a" stroke-width="1.15" fill="none" stroke-linecap="round"/>`;

  const gkBar =
    pos === "GK"
      ? `<rect x="14" y="29.5" width="20" height="2.6" rx="1" fill="${mixHex(kitP, "#ffffff", 0.45)}" stroke="${kitOuter}" stroke-width="0.6"/>`
      : "";

  const ring =
    mood === "injured"
      ? "rgba(239,68,68,0.55)"
      : mood === "happy"
        ? "rgba(61,214,140,0.45)"
        : mood === "tired"
          ? "rgba(125,211,252,0.4)"
          : "rgba(255,255,255,0.28)";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" class="avatar-svg avatar-token" data-mood="${mood}" aria-hidden="true">
  <defs>
    <clipPath id="${clipId}"><circle cx="24" cy="24" r="24"/></clipPath>
  </defs>
  <g clip-path="url(#${clipId})">
    <rect width="48" height="48" fill="${bgTop}"/>
    <rect y="24" width="48" height="24" fill="${bgBot}"/>
    <!-- 球衣：下半圆大色块，一眼能认队色 -->
    <path d="M6 30 L14 26 L34 26 L42 30 L39 48 L9 48 Z" fill="${kitP}" stroke="${kitOuter}" stroke-width="1.2"/>
    <path d="M6 30 L14 26 L16 34 L10 38 Z" fill="${kitS}"/>
    <path d="M42 30 L34 26 L32 34 L38 38 Z" fill="${kitS}"/>
    <path d="M14 38 H34" stroke="${kitS}" stroke-width="2.2" stroke-linecap="round" opacity="0.95"/>
    <circle cx="24" cy="35.5" r="2.4" fill="${kitS}" stroke="${kitOutline}" stroke-width="0.7"/>
    ${gkBar}
    <!-- 脖子 -->
    <rect x="20" y="25" width="8" height="5" rx="1.5" fill="${skin}"/>
    <!-- 大脸：占上半区主体，必须是肉色 -->
    <ellipse cx="24" cy="${faceY}" rx="12.5" ry="12.2" fill="${skin}"/>
    <ellipse cx="20" cy="15" rx="4" ry="2.6" fill="#fff" opacity="0.2"/>
    ${hairCap}
    ${eyes}
    ${mouth}
  </g>
  <circle cx="24" cy="24" r="23" fill="none" stroke="${ring}" stroke-width="1.6"/>
</svg>`;
  return svg.replace("<svg ", `<svg data-ini="${escapeAttr(initials(opts.name))}" `);
}

/**
 * @param {object} opts
 * @param {AvatarMood} [opts.mood]
 */
export function renderAvatarSvg(opts = {}) {
  const seed = opts.seed || opts.id || opts.name || "anon";
  const h = hashStr(seed);
  const size = opts.size || 40;
  const role = opts.role || "player";
  const pos = opts.pos || "";
  const age = opts.age || 25;
  const mood = opts.mood || "neutral";
  // ≤44px 或显式 token：走令牌路径（战术板 40 / 列表 26–30），彻底解决黑球
  if (opts.token === true || (opts.token !== false && size <= 44 && role === "player")) {
    return renderTokenAvatarSvg(opts);
  }
  // 中等尺寸（少见）：仍可用 compact 五官
  // 阈值 32：覆盖 26/28/30 常用尺寸，详情卡 64 等仍走完整五官
  const compact = opts.compact === true || size <= 32;

  // 肤色：主色 + 轻微偏移；compact 强制暖米色系，禁止近黑
  let skin = pick(SKINS, h, 1);
  skin = shiftHex(skin, ((h >> 8) % 7) - 3);
  if (compact) {
    // 小尺寸只保留前 5 档浅/中肤，再整体抬亮——截图里的「黑球」主因是深肤+深发
    const compactSkins = SKINS.slice(0, 5);
    skin = pick(compactSkins, h, 1);
    skin = mixHex(skin, "#f3d0b0", 0.42);
    if (luminance(skin) < 0.42) skin = mixHex(skin, "#f5d7b8", 0.55);
    if (luminance(skin) < 0.5) skin = mixHex(skin, "#ffe8d0", 0.35);
  } else if (luminance(skin) < 0.12) {
    skin = mixHex(skin, "#c68642", 0.35);
  }

  let hair = pick(HAIRS, h, 2);
  if (age >= 34 && (h & 1) === 0) hair = mixHex(hair, "#6b7280", 0.55);
  if (age >= 40) hair = pick(["#6b7280", "#9ca3af", "#d1d5db", mixHex(hair, "#9ca3af", 0.5)], h, 3);
  if (compact) {
    // 纯黑发在 30px 会糊成半个黑圆；抬到深褐/深灰并略掺肤色边
    if (luminance(hair) < 0.12) hair = mixHex(hair, "#5c4033", 0.55);
    else if (luminance(hair) < 0.2) hair = mixHex(hair, "#6b5344", 0.35);
  }

  const kitPRaw = opts.kitPrimary || pick(BG_FALLBACK, h, 4);
  let kitSRaw = opts.kitSecondary || shiftHex(kitPRaw, -42);
  // 副色与主色太近时，强制拉开（避免袖/衣糊成一片）
  {
    const pr = parseInt(String(kitPRaw).slice(1, 3), 16) || 0;
    const pg = parseInt(String(kitPRaw).slice(3, 5), 16) || 0;
    const pb = parseInt(String(kitPRaw).slice(5, 7), 16) || 0;
    const sr = parseInt(String(kitSRaw).slice(1, 3), 16) || 0;
    const sg = parseInt(String(kitSRaw).slice(3, 5), 16) || 0;
    const sb = parseInt(String(kitSRaw).slice(5, 7), 16) || 0;
    const dist = Math.hypot(pr - sr, pg - sg, pb - sb);
    if (dist < 70) {
      const lum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
      kitSRaw = lum > 140 ? mixHex(kitPRaw, "#0f172a", 0.55) : mixHex(kitPRaw, "#f8fafc", 0.45);
    }
  }

  /**
   * 背景：中性冷灰（偏中亮），**零队色**
   * 刻意不用近黑海军蓝，避免和深蓝/黑色球衣糊在一起
   * compact 再抬亮一档，绿茵战术板上对比更清楚
   */
  let bgTop = compact ? "#5c6780" : "#4a556c";
  let bgBot = compact ? "#424b60" : "#343c50";
  if (role !== "player") {
    bgTop = pick(BG_FALLBACK, h, 5);
    bgBot = shiftHex(bgTop, 16);
  } else if (mood === "injured") {
    bgTop = compact ? "#6a5560" : "#5a4550";
    bgBot = compact ? "#4e4048" : "#3e3038";
  } else if (mood === "happy") {
    bgTop = compact ? "#556a60" : "#455a52";
    bgBot = compact ? "#424e46" : "#324038";
  } else if (mood === "tired") {
    bgTop = compact ? "#556070" : "#455060";
    bgBot = compact ? "#434a58" : "#333a48";
  }

  const bgLum = luminance(bgBot);
  // 显示用球衣色：深色队服强制提亮
  const kitP = role === "player" ? kitDisplayColor(kitPRaw, bgLum) : kitPRaw;
  const kitS = role === "player" ? kitDisplayColor(kitSRaw, bgLum) : kitSRaw;
  const kitOutline = kitOutlineColor(kitP);
  const kitOuter = kitOuterStroke(kitP);

  const hairStyle = h % 7;
  // compact：脸略大、阴影浅，保证肉色面积压过头发
  const faceW = (compact ? 10.2 : 10.5) + (h % 4) * (compact ? 0.25 : 0.55);
  const faceH = (compact ? 10.8 : 11.5) + (h % 3) * (compact ? 0.2 : 0.4);
  const browY = 17.5 + (h % 3) * 0.4;
  const skinShade = shiftHex(skin, compact ? -6 : -22);
  const skinHi = shiftHex(skin, compact ? 18 : 18);

  let accessory = "";
  if (role === "coach") {
    accessory = `
      <path d="M12 36 L20 28 L28 28 L36 36 L36 48 L12 48 Z" fill="#1e293b"/>
      <path d="M20 28 L24 36 L28 28" fill="#334155"/>
      <rect x="22.5" y="30" width="3" height="10" rx="0.5" fill="#3d8bfd"/>
    `;
  } else if (role === "scout") {
    accessory = `
      <path d="M10 34 Q24 30 38 34 L36 48 L12 48 Z" fill="#334155"/>
      <circle cx="18" cy="20" r="3.2" fill="none" stroke="#94a3b8" stroke-width="1.2"/>
      <circle cx="30" cy="20" r="3.2" fill="none" stroke="#94a3b8" stroke-width="1.2"/>
      <line x1="21.2" y1="20" x2="26.8" y2="20" stroke="#94a3b8" stroke-width="1"/>
    `;
  } else if (role === "doctor") {
    accessory = `
      <path d="M12 34 L36 34 L34 48 L14 48 Z" fill="#f1f5f9"/>
      <rect x="22" y="36" width="4" height="10" fill="#ef4444"/>
      <rect x="19" y="39" width="10" height="4" fill="#ef4444"/>
    `;
  } else if (role === "manager") {
    accessory = `
      <path d="M12 35 L24 29 L36 35 L34 48 L14 48 Z" fill="#0f172a"/>
      <rect x="22" y="32" width="4" height="8" fill="#e6b450"/>
    `;
  } else {
    // 球衣：浅色底板 + 外暗描边 + 内亮描边，与中性灰背景强分离
    const sleeve = kitS;
    const collar = mixHex(kitP, "#ffffff", 0.32);
    const kitHi = mixHex(kitP, "#ffffff", 0.38);
    const kitShade = mixHex(kitP, "#0f172a", 0.22);
    accessory = `
      <ellipse cx="24" cy="41" rx="18" ry="10" fill="#0f172a" opacity="0.22"/>
      <path d="M5.5 36 L15 26.5 L33 26.5 L42.5 36 L38.5 48 L9.5 48 Z" fill="#f1f5f9" opacity="0.55"/>
      <path d="M6.2 35.5 L15.2 27 L32.8 27 L41.8 35.5 L37.5 48 L10.5 48 Z" fill="${kitShade}" opacity="0.9"/>
      <path d="M7.2 35 L15.6 27.6 L32.4 27.6 L40.8 35 L37 48 L11 48 Z" fill="${kitP}" stroke="${kitOuter}" stroke-width="1.85"/>
      <path d="M7.2 35 L15.6 27.6 L32.4 27.6 L40.8 35 L37 48 L11 48 Z" fill="none" stroke="${kitOutline}" stroke-width="1.05"/>
      <path d="M7.2 35 L15.6 27.6 L15.6 36 L9.8 41 Z" fill="${sleeve}" stroke="${kitOuter}" stroke-width="1.4"/>
      <path d="M7.2 35 L15.6 27.6 L15.6 36 L9.8 41 Z" fill="none" stroke="${kitOutline}" stroke-width="0.75"/>
      <path d="M40.8 35 L32.4 27.6 L32.4 36 L38.2 41 Z" fill="${sleeve}" stroke="${kitOuter}" stroke-width="1.4"/>
      <path d="M40.8 35 L32.4 27.6 L32.4 36 L38.2 41 Z" fill="none" stroke="${kitOutline}" stroke-width="0.75"/>
      <path d="M12 33.2 Q24 28.8 36 33.2" fill="none" stroke="${kitHi}" stroke-width="1.7" opacity="0.7" stroke-linecap="round"/>
      <path d="M17 28 Q24 32.2 31 28 L30 30.2 Q24 33.8 18 30.2 Z" fill="${collar}" opacity="0.98"/>
      <path d="M15 40 H33" stroke="${kitOuter}" stroke-width="2.4" opacity="0.35" stroke-linecap="round"/>
      <path d="M15 40 H33" stroke="${kitS}" stroke-width="1.9" opacity="0.9" stroke-linecap="round"/>
      <circle cx="24" cy="37.5" r="2.75" fill="${kitS}" stroke="${kitOuter}" stroke-width="1.1"/>
      <circle cx="24" cy="37.5" r="2.75" fill="none" stroke="${kitOutline}" stroke-width="0.65"/>
      <circle cx="24" cy="37.5" r="1.2" fill="${mixHex(kitS, "#ffffff", 0.4)}" opacity="0.75"/>
    `;
    if (pos === "GK") {
      accessory += `
        <rect x="13" y="26.5" width="22" height="3.4" rx="1.2" fill="${mixHex(kitP, "#ffffff", 0.42)}" stroke="${kitOuter}" stroke-width="0.9"/>
        <rect x="13" y="26.5" width="22" height="3.4" rx="1.2" fill="none" stroke="${kitOutline}" stroke-width="0.5"/>
        <rect x="13" y="26.5" width="22" height="1.2" rx="0.6" fill="#fff" opacity="0.35"/>
      `;
    }
  }

  const hairPath = hairPaths(hairStyle, hair, h, compact);

  let facial = "";
  // compact 不画胡须：30px 下会糊成嘴下黑斑
  if (!compact && age >= 27 && (h % 4) === 0 && mood !== "injured") {
    // 短须 / 山羊胡
    if ((h >> 3) & 1) {
      facial = `<path d="M18 27.5 Q24 33 30 27.5" stroke="${shiftHex(hair, 15)}" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.85"/>`;
    } else {
      facial = `<ellipse cx="24" cy="29.5" rx="3.2" ry="2.2" fill="${shiftHex(hair, 10)}" opacity="0.55"/>`;
    }
  }

  const { eyes, brows, mouth, extra } = faceFeatures(mood, hair, browY, skin, compact);
  const ini = initials(opts.name);
  // 把 size 编进 id，避免同页大小头像共享 gradient/clip 定义互相覆盖
  const clipId = `av${h.toString(36)}${mood[0] || "n"}${(h >> 12) & 15}s${size}`;
  const gradId = `bg${clipId}`;
  const skinGradId = `sk${clipId}`;

  const ring =
    mood === "injured"
      ? "rgba(239,68,68,0.55)"
      : mood === "happy"
        ? "rgba(61,214,140,0.45)"
        : mood === "tired"
          ? "rgba(125,211,252,0.4)"
          : "rgba(255,255,255,0.22)";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" class="avatar-svg" data-mood="${mood}" aria-hidden="true">
  <defs>
    <clipPath id="${clipId}"><circle cx="24" cy="24" r="24"/></clipPath>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${bgTop}"/>
      <stop offset="100%" stop-color="${bgBot}"/>
    </linearGradient>
    <linearGradient id="${skinGradId}" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="${skinHi}"/>
      <stop offset="55%" stop-color="${skin}"/>
      <stop offset="100%" stop-color="${skinShade}"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#${clipId})">
    <rect width="48" height="48" fill="url(#${gradId})"/>
    <circle cx="24" cy="52" r="18" fill="#0f172a" opacity="${compact ? 0.08 : 0.12}"/>
    <ellipse cx="24" cy="8" rx="16" ry="8" fill="#fff" opacity="${compact ? 0.14 : 0.1}"/>
    ${accessory}
    <rect x="20" y="27.5" width="8" height="6.5" rx="1" fill="url(#${skinGradId})"/>
    <ellipse cx="24" cy="${compact ? 20.2 : 19.5}" rx="${faceW}" ry="${faceH}" fill="url(#${skinGradId})"/>
    <ellipse cx="20" cy="${compact ? 18.5 : 18}" rx="3.5" ry="2.2" fill="#fff" opacity="${compact ? 0.18 : 0.12}"/>
    ${hairPath}
    ${brows}
    ${eyes}
    ${mouth}
    ${facial}
    ${extra}
  </g>
  <circle cx="24" cy="24" r="23" fill="none" stroke="${ring}" stroke-width="1.75"/>
  <circle cx="24" cy="24" r="23.6" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="0.6"/>
</svg>`;

  return svg.replace("<svg ", `<svg data-ini="${ini}" `);
}

export function avatarHtml(person, opts = {}) {
  if (!person) return "";
  const role =
    opts.role ||
    person.role ||
    (person.pos ? "player" : "manager");
  const size = opts.size || 36;
  const kitPrimary = opts.kitPrimary || opts.kit?.primary;
  const kitSecondary = opts.kitSecondary || opts.kit?.secondary;
  let mood = opts.mood;
  if (!mood && role === "player") mood = moodFromPlayer(person);
  if (!mood) mood = "neutral";

  const svg = renderAvatarSvg({
    seed: person.id || person.name,
    name: person.name,
    role,
    pos: person.pos,
    age: person.age,
    kitPrimary,
    kitSecondary,
    size,
    mood,
    // 列表/战术板小尺寸强制 token，避免走完整小人再缩放
    token: role === "player" && size <= 44 ? true : opts.token,
  });
  const moodTip =
    mood === "injured"
      ? " · 受伤"
      : mood === "happy"
        ? " · 状态佳"
        : mood === "sad"
          ? " · 士气低"
          : mood === "tired"
            ? " · 疲惫"
            : "";
  const cls = `avatar mood-${mood}${opts.className ? " " + opts.className : ""}`;
  return `<span class="${cls}" style="width:${size}px;height:${size}px" title="${escapeAttr(
    (person.name || "") + moodTip
  )}">${svg}</span>`;
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** 主题队固定配色（与 models.ensureKit 同步；avatar 不 import models 以免环依赖） */
const AVATAR_KIT_THEME = {
  sunset: { primary: "#f97316", secondary: "#5b21b6" },
};

/** 球员 + 俱乐部球衣色 + 状态表情 */
export function playerAvatarHtml(player, club, size = 36) {
  const theme = club?.id ? AVATAR_KIT_THEME[club.id] : null;
  // 主题队优先；否则用 kit / color（调用方应 ensureKit，这里再兜一层）
  const kitPrimary = theme?.primary || club?.kit?.primary || club?.color || "#3d8bfd";
  const kitSecondary =
    theme?.secondary || club?.kit?.secondary || club?.kit?.secondaryColor || null;
  return avatarHtml(player, {
    role: "player",
    size,
    kitPrimary,
    kitSecondary,
    mood: moodFromPlayer(player),
  });
}

export function staffAvatarHtml(staff, size = 48) {
  return avatarHtml(staff, {
    role: staff?.role || "coach",
    size,
    mood: "neutral",
  });
}
