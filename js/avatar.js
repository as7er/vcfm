/**
 * 程序生成像素头像（球员 / 职员 / 经理）——90 年代热血系列（くにおくん）画风
 *
 * v5 全面重绘：SD 大头、粗黑描边、方块发型（飞机头/平头/刺猬/锅盖/爆炸头等）、
 * 热血式怒眉。肤色/发色/发型按球员国籍的地区画像加权分配（稳定哈希种子）；
 * 心情系统保留：neutral 怒眉、happy 咧嘴、injured 绷带X眼、tired 汗滴、sad 垂眉。
 *
 * v5.1 起浏览器端把像素画到 canvas（每格整数设备像素）导出 PNG <img>，
 * 避免 SVG 在模态动画/系统缩放下出现不可控合成；SVG 路径保留作无 DOM 兜底。
 *
 * v5.4 自然表情：状态表情与天生五官分离；同为 neutral 的球员也会按稳定种子生成
 * 不同眉形、眼型、目光、鼻型与嘴型，默认观感由怒眉坏笑改为平静 / 专注 / 友善。
 *
 * v5.5 正式肖像资产：当 player.avatarAssetId（等）命中本地 manifest 时，渲染 WebP/PNG
 * 文件（不重新绘制人物）；失败 onerror 回退本文件的程序生成图。映射见 avatar-assets.js。
 *
 * 对外 API 与 v4 完全兼容：moodFromPlayer / renderAvatarSvg / avatarHtml /
 * playerAvatarHtml / staffAvatarHtml；并 re-export resolvePlayerAvatar。
 */

import {
  resolvePlayerAvatar,
  loadAvatarManifest,
  getAvatarManifest,
  playerAppearanceKey,
  getKitRecoloredSrc,
  colorDistance,
} from "./avatar-assets.js";

// 后台刷新磁盘 manifest（失败则保留内置副本）
if (typeof fetch === "function") {
  try {
    loadAvatarManifest();
  } catch {
    /* ignore */
  }
}

/** @typedef {'neutral'|'happy'|'injured'|'sad'|'tired'} AvatarMood */

// ============================================================
// 基础工具
// ============================================================

function hashStr(s) {
  let h = 2166136261;
  const str = String(s || "x");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
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
  return "#" + [r, g, bl].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** 相对亮度 0–1（sRGB 近似） */
function luminance(hex) {
  if (!hex?.startsWith?.("#") || hex.length < 7) return 0.2;
  const ch = (i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(1)) + 0.0722 * lin(ch(2));
}

/** 球衣显示色：相对背景强制拉开对比（深衣提亮），保留色相 */
function kitDisplayColor(hex, bgLum = 0.12) {
  let c = hex || "#3d8bfd";
  let lum = luminance(c);
  const minLum = Math.max(0.3, bgLum + 0.24);
  let guard = 0;
  while (lum < minLum && guard < 8) {
    const t = Math.min(0.5, 0.2 + (minLum - lum) * 0.9);
    c = mixHex(c, "#ffffff", t);
    lum = luminance(c);
    guard++;
  }
  if (lum > 0.9) c = mixHex(c, "#cbd5e1", 0.2);
  return c;
}

/** 加权抽取：pairs = [[value, weight], ...]，哈希流稳定 */
function wpick(h, salt, pairs) {
  let total = 0;
  for (const [, w] of pairs) total += w;
  let r = ((h ^ Math.imul(salt + 1, 2654435761)) >>> 0) % Math.max(1, total);
  for (const [v, w] of pairs) {
    if ((r -= w) < 0) return v;
  }
  return pairs[0][0];
}

// ============================================================
// 地区画像：肤色 / 发色 / 发型按国籍合理分配
// ============================================================

/** 肤色 [底色, 阴影]（NES 暖调色阶，浅→深） */
const SKIN_TONES = {
  pale: ["#f6d7b8", "#d9b48f"],
  fair: ["#efc8a0", "#cfa377"],
  light: ["#e6b98e", "#c39468"],
  tan: ["#d4a06a", "#ad7c4b"],
  olive: ["#c08d58", "#9a6c3e"],
  brown: ["#9f6b3f", "#7c4f2b"],
  deep: ["#7c4c2a", "#5e3820"],
  dark: ["#5f3a22", "#452a18"],
};

const HAIR_COLORS = {
  black: "#26221f",
  dkbrown: "#42301f",
  brown: "#5f4128",
  ltbrown: "#7d5731",
  blond: "#c99a45",
  red: "#a84c28",
  grey: "#9aa0a8",
  white: "#dfe3e8",
};

/**
 * 发型 id：
 * 0 平顶(国夫头) 1 飞机头(リーゼント) 2 刺猬 3 寸头 4 侧分
 * 5 锅盖 6 爆炸头 7 短卷 8 光头渐层 9 长发(90s 后蓄)
 */
const STYLE_DEFAULT = [
  [2, 16], [4, 16], [3, 14], [0, 12], [7, 10], [1, 10], [9, 8], [5, 6], [8, 6], [6, 2],
];
const STYLE_EASIA = [
  [5, 20], [4, 18], [2, 18], [1, 14], [3, 12], [0, 10], [9, 5], [7, 3],
];
const STYLE_AFRO = [
  [3, 26], [7, 24], [6, 16], [8, 16], [0, 10], [2, 8],
];

/** 地区画像：skin/hair 为加权表；style 缺省用 STYLE_DEFAULT */
const REGION_PROFILES = {
  nordic: {
    skin: [["pale", 55], ["fair", 30], ["light", 9], ["brown", 3], ["deep", 3]],
    hair: [["blond", 38], ["ltbrown", 25], ["brown", 20], ["red", 9], ["black", 8]],
  },
  brit: {
    skin: [["pale", 38], ["fair", 30], ["light", 13], ["tan", 5], ["brown", 8], ["deep", 6]],
    hair: [["brown", 33], ["dkbrown", 25], ["ltbrown", 14], ["blond", 10], ["red", 12], ["black", 6]],
  },
  weur: {
    skin: [["fair", 36], ["pale", 22], ["light", 17], ["tan", 8], ["brown", 10], ["deep", 7]],
    hair: [["dkbrown", 30], ["brown", 27], ["black", 15], ["blond", 15], ["ltbrown", 9], ["red", 4]],
  },
  fra: {
    skin: [["fair", 28], ["light", 18], ["tan", 12], ["olive", 8], ["brown", 17], ["deep", 13], ["dark", 4]],
    hair: [["black", 34], ["dkbrown", 30], ["brown", 21], ["blond", 8], ["ltbrown", 7]],
  },
  seur: {
    skin: [["light", 30], ["fair", 22], ["tan", 25], ["olive", 15], ["brown", 5], ["deep", 3]],
    hair: [["black", 44], ["dkbrown", 31], ["brown", 18], ["blond", 4], ["ltbrown", 3]],
  },
  eeur: {
    skin: [["pale", 35], ["fair", 35], ["light", 20], ["tan", 6], ["brown", 4]],
    hair: [["brown", 27], ["dkbrown", 25], ["blond", 20], ["ltbrown", 15], ["black", 11], ["red", 2]],
  },
  tur: {
    skin: [["tan", 32], ["olive", 27], ["light", 22], ["fair", 10], ["brown", 9]],
    hair: [["black", 62], ["dkbrown", 28], ["brown", 10]],
  },
  easia: {
    skin: [["light", 38], ["fair", 30], ["tan", 22], ["pale", 10]],
    hair: [["black", 82], ["dkbrown", 15], ["brown", 3]],
    style: STYLE_EASIA,
  },
  wafr: {
    skin: [["deep", 34], ["dark", 30], ["brown", 26], ["tan", 8], ["olive", 2]],
    hair: [["black", 85], ["dkbrown", 15]],
    style: STYLE_AFRO,
  },
  nafr: {
    skin: [["tan", 30], ["olive", 26], ["light", 20], ["brown", 16], ["deep", 6], ["fair", 2]],
    hair: [["black", 70], ["dkbrown", 24], ["brown", 6]],
  },
  latM: {
    skin: [["tan", 22], ["light", 20], ["fair", 12], ["olive", 14], ["brown", 16], ["deep", 12], ["dark", 4]],
    hair: [["black", 50], ["dkbrown", 30], ["brown", 14], ["blond", 4], ["ltbrown", 2]],
  },
  latE: {
    skin: [["fair", 30], ["light", 28], ["tan", 20], ["olive", 10], ["brown", 8], ["deep", 4]],
    hair: [["dkbrown", 32], ["black", 30], ["brown", 22], ["blond", 10], ["ltbrown", 6]],
  },
  mex: {
    skin: [["tan", 32], ["olive", 24], ["brown", 18], ["light", 16], ["fair", 6], ["deep", 4]],
    hair: [["black", 68], ["dkbrown", 24], ["brown", 8]],
  },
  usa: {
    skin: [["fair", 26], ["light", 18], ["pale", 12], ["tan", 10], ["brown", 16], ["deep", 14], ["dark", 4]],
    hair: [["dkbrown", 28], ["brown", 24], ["black", 26], ["blond", 14], ["red", 4], ["ltbrown", 4]],
  },
  aus: {
    skin: [["fair", 34], ["pale", 24], ["light", 18], ["tan", 10], ["brown", 8], ["deep", 6]],
    hair: [["brown", 30], ["dkbrown", 24], ["blond", 22], ["ltbrown", 12], ["black", 8], ["red", 4]],
  },
};

const REGION_OF = {
  ENG: "brit", SCO: "brit", WAL: "brit", IRL: "brit",
  GER: "weur", NED: "weur", BEL: "weur", AUT: "weur", SUI: "weur",
  FRA: "fra",
  ESP: "seur", ITA: "seur", POR: "seur", CRO: "seur", SRB: "seur",
  POL: "eeur", UKR: "eeur",
  DEN: "nordic", SWE: "nordic", NOR: "nordic",
  TUR: "tur",
  JPN: "easia", KOR: "easia", CHN: "easia",
  NGA: "wafr", SEN: "wafr", GHA: "wafr", CIV: "wafr",
  MAR: "nafr",
  BRA: "latM", COL: "latM",
  ARG: "latE", URU: "latE",
  MEX: "mex",
  USA: "usa",
  AUS: "aus",
};

/** 由国籍 + 哈希得到稳定的外貌；face 保存与状态无关的天生五官差异。 */
function lookFor(h, nation, age = 25) {
  const prof = REGION_PROFILES[REGION_OF[nation] || ""] || REGION_PROFILES.weur;
  const skinKey = wpick(h, 11, prof.skin);
  const [skin, skinShade] = SKIN_TONES[skinKey];
  // 深肤色 → 黑/深棕发（自然合理）；发型偏向短寸/短卷/爆炸头
  const darkSkin = skinKey === "deep" || skinKey === "dark";
  const hairKey = darkSkin
    ? wpick(h, 12, [["black", 80], ["dkbrown", 20]])
    : wpick(h, 12, prof.hair);
  let hairHex = HAIR_COLORS[hairKey];
  // 年龄灰白
  if (age >= 40) {
    hairHex = wpick(h, 13, [[HAIR_COLORS.grey, 55], [HAIR_COLORS.white, 25], [mixHex(hairHex, HAIR_COLORS.grey, 0.6), 20]]);
  } else if (age >= 34 && (h & 3) === 0) {
    hairHex = mixHex(hairHex, HAIR_COLORS.grey, 0.45);
  }
  const styleW = darkSkin ? STYLE_AFRO : prof.style || STYLE_DEFAULT;
  const styleId = wpick(h, 14, styleW);
  const face = {
    eyeStyle: (h >>> 3) % 4,
    browStyle: (h >>> 8) % 4,
    mouthStyle: (h >>> 13) % 4,
    noseStyle: (h >>> 18) % 3,
    gaze: ((h >>> 21) % 3) - 1,
  };
  return { skin, skinShade, hairHex, styleId, darkSkin, face };
}

// ============================================================
// 像素绘制：32×32 单元格列表（cell 单位），双输出 SVG / canvas-PNG
// v5.3 起关键轮廓与五官直接使用 1-cell 细节，不再沿用旧 16×16 的 2× 粗块。
// ============================================================

const GRID = 32;
const OUT = "#1b1613"; // 全局粗描边（热血式近黑）
const EYE = "#1e1a17";
const EYEWHITE = "#f4efe4";
const MOUTH = "#7e3a30";

/** 单格像素 → cell 对象 */
function P(x, y, c) {
  return { x, y, w: 1, h: 1, c };
}
/** 横向一段 [x0..x1] */
function R(x0, x1, y, c) {
  return { x: x0, y, w: x1 - x0 + 1, h: 1, c };
}
/** 竖向一段 [y0..y1] */
function C(x, y0, y1, c) {
  return { x, y: y0, w: 1, h: y1 - y0 + 1, c };
}
/** 矩形填充 [x0..x1] × [y0..y1] */
function Box(x0, x1, y0, y1, c) {
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, c };
}

/** 心情背景（棋盘双色，复古抖动） */
const MOOD_BG = {
  neutral: ["#4d5a74", "#465269"],
  happy: ["#4d6e5c", "#456354"],
  injured: ["#6e4d55", "#63454c"],
  tired: ["#4d5f74", "#455669"],
  sad: ["#565d6b", "#4d5461"],
};

function bgCells(mood) {
  const [a, b] = MOOD_BG[mood] || MOOD_BG.neutral;
  const cells = [{ x: 0, y: 0, w: GRID, h: GRID, c: a }];
  // 8×8 cell 的棋盘块（= 旧 4×4 的 2×）
  for (let by = 0; by < 4; by++) {
    for (let bx = 0; bx < 4; bx++) {
      if ((bx + by) % 2 === 1) {
        cells.push({ x: bx * 8, y: by * 8, w: 8, h: 8, c: b });
      }
    }
  }
  return cells;
}

/**
 * 发型（覆盖在脸之上）。每款返回 cell 数组（32 空间）。
 * H=发色 Hh=高光 S=肤色（发际线用）
 */
function hairCells(styleId, H, Hh, S) {
  const Hd = shiftHex(H, -22);
  switch (styleId) {
    case 0: // 平顶（国夫头）
      return [
        R(7, 24, 0, OUT), C(6, 1, 7, OUT), C(25, 1, 7, OUT),
        Box(7, 24, 1, 6, H), R(7, 24, 7, Hd),
        R(9, 15, 2, Hh), R(8, 12, 3, Hh),
        R(7, 10, 8, H), R(22, 24, 8, H),
      ];
    case 1: // 飞机头（リーゼント）
      return [
        R(15, 25, 0, OUT), P(26, 1, OUT), P(27, 2, OUT), P(28, 3, OUT),
        R(7, 14, 1, OUT), P(6, 2, OUT),
        Box(15, 25, 1, 3, H), R(26, 27, 2, H), P(27, 3, H),
        Box(7, 26, 3, 7, H), R(6, 25, 7, Hd),
        R(18, 24, 1, Hh), R(20, 25, 2, Hh), P(25, 3, Hh),
        R(7, 10, 8, H), R(22, 24, 8, H),
      ];
    case 2: // 刺猬头
      return [
        P(8, 0, OUT), P(14, 0, OUT), P(20, 0, OUT), P(25, 1, OUT),
        P(7, 1, H), P(9, 1, H), P(13, 1, H), P(15, 1, H),
        P(19, 1, H), P(21, 1, H), P(24, 2, H),
        R(6, 25, 3, OUT), Box(7, 24, 4, 7, H), R(7, 24, 7, Hd),
        P(10, 4, Hh), P(11, 4, Hh), P(16, 3, Hh), P(17, 3, Hh), P(22, 4, Hh),
        R(7, 10, 8, H), R(22, 24, 8, H),
      ];
    case 3: { // 寸头
      const buzz = mixHex(H, S, 0.3);
      return [
        R(9, 22, 3, OUT), P(8, 4, OUT), P(23, 4, OUT),
        R(7, 24, 5, buzz), R(6, 25, 6, buzz), R(7, 24, 7, Hd),
        P(9, 5, Hh), P(13, 5, Hh), P(17, 5, Hh), P(21, 5, Hh),
      ];
    }
    case 4: // 侧分
      return [
        R(9, 23, 0, OUT), P(8, 1, OUT), C(6, 2, 7, OUT), C(25, 2, 8, OUT),
        Box(7, 24, 1, 5, H), R(7, 18, 6, H), R(7, 14, 7, Hd),
        R(9, 15, 2, Hh), R(8, 12, 3, Hh),
        R(7, 10, 8, H), R(23, 24, 7, H), P(24, 9, H),
      ];
    case 5: // 锅盖头（刘海到眉上）
      return [
        R(9, 22, 0, OUT), P(7, 1, OUT), P(8, 1, OUT), P(23, 1, OUT), P(24, 1, OUT),
        Box(6, 25, 2, 7, H), R(7, 24, 8, Hd),
        R(8, 14, 2, Hh), R(9, 13, 3, Hh),
        R(6, 10, 9, H), R(21, 25, 9, H), P(7, 10, H), P(24, 10, H),
      ];
    case 6: // 爆炸头
      return [
        R(9, 22, 0, H), R(6, 25, 1, H), R(4, 27, 3, H),
        Box(3, 28, 4, 7, H), C(4, 8, 11, H), C(27, 8, 11, H),
        P(5, 2, H), P(8, 2, H), P(14, 2, H), P(19, 2, H), P(24, 2, H), P(27, 2, H),
        P(7, 3, Hh), P(12, 1, Hh), P(17, 4, Hh), P(23, 2, Hh), P(26, 5, Hh),
        P(5, 7, Hd), P(10, 5, Hd), P(21, 6, Hd), P(27, 8, Hd),
      ];
    case 7: // 短卷
      return [
        R(9, 12, 1, H), R(15, 18, 1, H), R(21, 24, 1, H),
        R(7, 10, 3, H), R(12, 16, 3, H), R(18, 22, 3, H), R(24, 25, 3, H),
        Box(6, 25, 4, 7, H), R(7, 24, 7, Hd),
        P(10, 4, Hh), P(15, 2, Hh), P(19, 4, Hh), P(24, 2, Hh),
        R(7, 10, 8, H), R(22, 24, 8, H),
      ];
    case 8: { // 光头渐层
      const fade = mixHex(H, S, 0.45);
      const gloss = mixHex(S, "#ffffff", 0.3);
      return [
        R(9, 22, 4, fade), P(8, 5, fade), P(23, 5, fade),
        C(6, 7, 11, fade), C(25, 7, 11, fade),
        R(12, 16, 5, gloss), P(11, 6, gloss),
      ];
    }
    case 9: // 90s 长发
      return [
        R(9, 22, 0, OUT), P(7, 1, OUT), P(8, 1, OUT), P(23, 1, OUT), P(24, 1, OUT),
        Box(6, 25, 2, 7, H), C(4, 6, 17, H), C(5, 7, 18, Hd),
        C(26, 7, 18, Hd), C(27, 6, 17, H),
        P(4, 18, OUT), P(5, 19, OUT), P(26, 19, OUT), P(27, 18, OUT),
        R(9, 15, 2, Hh), R(8, 12, 3, Hh),
      ];
    default:
      return [Box(6, 25, 4, 5, "#26221f")];
  }
}

/** 眉+眼+嘴（心情决定）；锅盖头(5)刘海压到眉线，一律用平眉防穿模 */
function faceCells(mood, look, styleId) {
  const browColor = mixHex(look.hairHex, OUT, look.darkSkin ? 0.3 : 0.55);
  const cheek = mixHex(look.skin, "#b85c55", look.darkSkin ? 0.12 : 0.22);
  const face = look.face || { eyeStyle: 0, browStyle: 0, mouthStyle: 0, noseStyle: 0, gaze: 0 };
  const flatOnly = styleId === 5;
  const parts = [];

  // —— 眉毛：状态负责情绪，种子负责普通状态下的天生眉形 ——
  if (mood === "happy") {
    parts.push(R(10, 13, 9, browColor), R(18, 21, 9, browColor));
  } else if (mood === "tired") {
    parts.push(R(9, 13, 11, browColor), R(18, 22, 11, browColor));
  } else if (mood === "sad") {
    // 垂眉：外低内高
    parts.push(P(9, 10, browColor), R(10, 11, 9, browColor), R(12, 13, 8, browColor));
    parts.push(R(18, 19, 8, browColor), R(20, 21, 9, browColor), P(22, 10, browColor));
  } else if (mood === "injured") {
    parts.push(R(9, 12, 10, browColor), R(19, 22, 9, browColor));
  } else if (flatOnly || face.browStyle === 0) {
    // 平静直眉
    parts.push(R(9, 13, 9, browColor), R(18, 22, 9, browColor));
  } else if (face.browStyle === 1) {
    // 专注眉：只有一格倾斜，不再是旧版统一怒眉
    parts.push(R(9, 11, 9, browColor), R(12, 13, 10, browColor));
    parts.push(R(20, 22, 9, browColor), R(18, 19, 10, browColor));
  } else if (face.browStyle === 2) {
    // 轻扬眉
    parts.push(P(9, 9, browColor), R(10, 12, 8, browColor), P(13, 9, browColor));
    parts.push(P(18, 9, browColor), R(19, 21, 8, browColor), P(22, 9, browColor));
  } else {
    // 短眉，观感更年轻友善
    parts.push(R(10, 13, 9, browColor), R(18, 21, 9, browColor));
  }

  // 普通眼睛：四种眼型 + 三种目光方向；两眼始终同步，避免斜视感。
  const openEyes = () => {
    const lp = Math.max(10, Math.min(12, 11 + face.gaze));
    const rp = lp + 9;
    if (face.eyeStyle === 1) {
      // 圆眼
      parts.push(R(10, 12, 11, EYE), P(9, 12, EYE), P(13, 12, EYE), R(10, 12, 13, EYE));
      parts.push(R(19, 21, 11, EYE), P(18, 12, EYE), P(22, 12, EYE), R(19, 21, 13, EYE));
      parts.push(R(10, 12, 12, EYEWHITE), R(19, 21, 12, EYEWHITE), P(lp, 12, EYE), P(rp, 12, EYE));
    } else if (face.eyeStyle === 2) {
      // 细长眼，但保持水平眼线，避免眯眼坏笑
      parts.push(R(9, 13, 12, EYE), R(10, 12, 13, EYEWHITE), P(lp, 13, EYE));
      parts.push(R(18, 22, 12, EYE), R(19, 21, 13, EYEWHITE), P(rp, 13, EYE));
    } else if (face.eyeStyle === 3) {
      // 柔和短眼
      const lp2 = Math.max(10, Math.min(12, lp));
      const rp2 = lp2 + 9;
      parts.push(R(10, 13, 11, EYE), R(10, 12, 12, EYEWHITE), P(lp2, 12, EYE));
      parts.push(R(18, 21, 11, EYE), R(19, 21, 12, EYEWHITE), P(rp2, 12, EYE));
    } else {
      // 标准开眼
      parts.push(R(9, 13, 11, EYE), R(10, 12, 12, EYEWHITE), P(lp, 12, EYE));
      parts.push(R(18, 22, 11, EYE), R(19, 21, 12, EYEWHITE), P(rp, 12, EYE));
    }
  };

  // —— 眼睛：伤病 / 疲惫覆盖天生眼型，其余状态保留个人差异 ——
  if (mood === "injured") {
    // 左眼闭合线 + 右眼正常 + 淤青
    parts.push(R(9, 13, 12, EYE), P(10, 11, EYE), P(12, 13, EYE));
    parts.push(R(18, 22, 12, EYE), R(19, 21, 13, EYEWHITE), P(19, 13, EYE));
    parts.push(P(21, 14, "#a15b50"), P(22, 14, "#8f4a48"));
  } else if (mood === "tired") {
    parts.push(R(9, 13, 12, EYE), R(18, 22, 12, EYE));
    parts.push(P(24, 8, "#b7ecff"), P(24, 9, "#8fd7f2"), P(25, 10, "#5db6dc"));
  } else if (mood === "happy" && face.eyeStyle % 2 === 0) {
    // 一半球员开心时眯成上扬弧线，另一半仍保留开眼笑
    parts.push(P(9, 12, EYE), R(10, 12, 13, EYE), P(13, 12, EYE));
    parts.push(P(18, 12, EYE), R(19, 21, 13, EYE), P(22, 12, EYE));
  } else {
    openEyes();
  }

  // —— 三种小鼻型；去掉旧版横向三格鼻影，避免像胡子 ——
  if (face.noseStyle === 1) {
    parts.push(P(15, 14, look.skinShade), P(15, 15, look.skinShade), P(16, 16, look.skinShade));
  } else if (face.noseStyle === 2) {
    parts.push(P(16, 14, look.skinShade), P(16, 15, look.skinShade), P(15, 16, look.skinShade));
  } else {
    parts.push(P(16, 15, look.skinShade), P(15, 16, look.skinShade));
  }

  // —— 嘴：状态决定情绪，neutral 仍有四种自然嘴型 ——
  if (mood === "happy") {
    if (face.mouthStyle % 2 === 0) {
      parts.push(P(11, 17, OUT), R(12, 19, 18, OUT), P(20, 17, OUT));
      parts.push(R(13, 18, 18, "#fdf6ea"), R(14, 17, 19, MOUTH));
    } else {
      parts.push(P(12, 18, MOUTH), R(13, 18, 19, MOUTH), P(19, 18, MOUTH));
    }
    parts.push(P(9, 16, cheek), P(22, 16, cheek));
  } else if (mood === "sad" || mood === "injured") {
    parts.push(R(14, 17, 17, MOUTH), P(13, 18, MOUTH), P(18, 18, MOUTH));
  } else if (face.mouthStyle === 1) {
    // 很轻的友善弧线
    parts.push(P(13, 18, MOUTH), R(14, 17, 19, MOUTH), P(18, 18, MOUTH));
  } else if (face.mouthStyle === 2) {
    // 坚定的短直嘴
    parts.push(R(14, 17, 18, OUT));
  } else if (face.mouthStyle === 3) {
    // 略张嘴，但保持居中对称
    parts.push(R(14, 17, 18, OUT), R(15, 16, 19, MOUTH));
  } else {
    parts.push(R(14, 17, 18, MOUTH));
  }

  // —— 受伤绷带 ——
  if (mood === "injured") {
    parts.push(R(8, 23, 5, "#e8e4da"), R(10, 21, 6, "#d4cfc2"));
    parts.push(P(7, 6, "#e8e4da"), P(24, 5, "#d4cfc2"));
  }
  return parts;
}

/** 头部底盘：描边 + 脸 + 耳 + 下颚阴影 */
function headCells(look) {
  const S = look.skin;
  const Sd = look.skinShade;
  const Sh = mixHex(S, "#fff7ed", 0.18);
  return [
    // 一格描边 + 阶梯式下颚，轮廓比旧版更圆润清楚
    R(9, 22, 3, OUT), R(7, 24, 4, OUT),
    P(6, 5, OUT), P(25, 5, OUT), C(6, 6, 18, OUT), C(25, 6, 18, OUT),
    P(5, 11, OUT), C(4, 12, 15, OUT), P(5, 16, OUT),
    P(26, 11, OUT), C(27, 12, 15, OUT), P(26, 16, OUT),
    P(7, 19, OUT), P(24, 19, OUT), R(8, 10, 20, OUT), R(21, 23, 20, OUT),
    P(11, 21, OUT), P(20, 21, OUT),
    // 脸、耳朵与下颚
    Box(7, 24, 5, 18, S), R(8, 23, 19, S), R(11, 20, 20, S),
    C(5, 12, 15, S), C(26, 12, 15, S), P(5, 14, Sd), P(26, 14, Sd),
    R(8, 10, 18, Sd), R(21, 23, 18, Sd), P(10, 19, Sd), P(21, 19, Sd),
    R(9, 13, 6, Sh), P(8, 7, Sh),
  ];
}

/** 球衣躯干（球员） */
function jerseyCells(kitP, kitS, pos, skin) {
  const collar = mixHex(kitS, "#ffffff", 0.25);
  const parts = [
    // 颈
    Box(12, 19, 20, 21, skin),
    // 肩线描边
    Box(4, 11, 22, 23, OUT),
    Box(20, 27, 22, 23, OUT),
    P(2, 24, OUT), P(3, 24, OUT), P(28, 24, OUT), P(29, 24, OUT),
    // 领口
    Box(12, 19, 22, 23, collar),
    // 躯干
    Box(2, 29, 24, 31, kitP),
    // 插肩袖（副色）
    Box(2, 5, 24, 31, kitS),
    Box(26, 29, 24, 31, kitS),
    Box(6, 7, 24, 25, kitS),
    Box(24, 25, 24, 25, kitS),
    // 胸口小 V
    Box(14, 17, 24, 25, kitS),
  ];
  if (pos === "GK") {
    parts.push(Box(8, 23, 28, 29, mixHex(kitP, "#ffffff", 0.5)));
  }
  return parts;
}

/** 职员躯干：西装 / 风衣 / 白大褂 */
function staffTorsoCells(role, tieColor, skin) {
  if (role === "doctor") {
    return [
      Box(12, 19, 20, 21, skin),
      Box(4, 11, 22, 23, OUT), Box(20, 27, 22, 23, OUT),
      P(2, 24, OUT), P(3, 24, OUT), P(28, 24, OUT), P(29, 24, OUT),
      Box(2, 29, 24, 31, "#eef2f6"),
      Box(14, 17, 22, 31, "#d7dde5"),
      Box(14, 17, 26, 29, "#d84343"),
    ];
  }
  if (role === "scout") {
    return [
      Box(12, 19, 20, 21, skin),
      Box(4, 11, 22, 23, OUT), Box(20, 27, 22, 23, OUT),
      P(2, 24, OUT), P(3, 24, OUT), P(28, 24, OUT), P(29, 24, OUT),
      Box(2, 29, 24, 31, "#57503c"),
      Box(12, 19, 22, 23, "#6b6350"),
      Box(14, 17, 26, 27, "#403a2c"),
      Box(8, 9, 24, 31, "#4a4433"),
      Box(22, 23, 24, 31, "#4a4433"),
    ];
  }
  // coach / manager
  return [
    Box(12, 19, 20, 21, skin),
    Box(4, 11, 22, 23, OUT), Box(20, 27, 22, 23, OUT),
    P(2, 24, OUT), P(3, 24, OUT), P(28, 24, OUT), P(29, 24, OUT),
    Box(2, 29, 24, 31, "#2a3442"),
    Box(12, 19, 22, 23, "#e8ecf2"),
    Box(12, 13, 24, 25, "#e8ecf2"),
    Box(18, 19, 24, 25, "#e8ecf2"),
    Box(14, 17, 24, 27, tieColor),
    Box(14, 17, 28, 29, shiftHex(tieColor, -24)),
  ];
}

/** 球探鸭舌帽 */
function scoutCapCells() {
  return [
    Box(8, 23, 0, 1, OUT),
    Box(6, 25, 2, 5, "#6b6350"),
    Box(6, 27, 6, 7, "#57503c"),
    Box(24, 27, 6, 7, "#4a4433"),
    Box(8, 15, 2, 3, "#7d755f"),
  ];
}

// ============================================================
// 组装：cells → SVG / canvas-PNG
// ============================================================

/** 组装完整头像的单元格列表（绘制顺序即遮挡顺序） */
function composeCells(opts = {}) {
  const seed = opts.seed || opts.id || opts.name || "anon";
  const h = hashStr(seed);
  const role = opts.role || "player";
  const pos = opts.pos || "";
  const age = opts.age || 25;
  const mood = opts.mood || "neutral";
  const nation = opts.nation || null;

  const look = lookFor(h, nation, age);

  const bgLum = luminance(MOOD_BG[mood]?.[0] || MOOD_BG.neutral[0]);
  const kitP = kitDisplayColor(opts.kitPrimary || "#3d8bfd", bgLum);
  let kitS = opts.kitSecondary || shiftHex(kitP, -42);
  {
    // 副色与主色太近时强制拉开
    const pr = parseInt(kitP.slice(1, 3), 16) || 0;
    const pg = parseInt(kitP.slice(3, 5), 16) || 0;
    const pb = parseInt(kitP.slice(5, 7), 16) || 0;
    const sr = parseInt(String(kitS).slice(1, 3), 16) || 0;
    const sg = parseInt(String(kitS).slice(3, 5), 16) || 0;
    const sb = parseInt(String(kitS).slice(5, 7), 16) || 0;
    if (Math.hypot(pr - sr, pg - sg, pb - sb) < 70) {
      const lum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
      kitS = lum > 140 ? mixHex(kitP, "#0f172a", 0.55) : mixHex(kitP, "#f8fafc", 0.45);
    }
  }

  const Hh = shiftHex(look.hairHex, 30);
  const isStaff = role !== "player";
  const torso = isStaff
    ? staffTorsoCells(role, role === "manager" ? "#3d8bfd" : "#b0433a", look.skin)
    : jerseyCells(kitP, kitS, pos, look.skin);
  const hairLayer =
    role === "scout" ? scoutCapCells() : hairCells(look.styleId, look.hairHex, Hh, look.skin);

  return [
    ...bgCells(mood),
    ...headCells(look),
    ...hairLayer,
    ...faceCells(mood, look, look.styleId),
    ...torso,
  ];
}

/**
 * 渲染像素头像 SVG（热血风）。预览页 / 无 DOM 环境（node 校验）用；
 * 游戏内 avatarHtml 走 canvas-PNG（清晰度不受浏览器合成影响）。
 * @param {object} opts
 * @param {AvatarMood} [opts.mood]
 * @param {string} [opts.nation] 国籍 code（决定肤色/发色/发型分布）
 */
export function renderAvatarSvg(opts = {}) {
  const size = opts.size || 36;
  const mood = opts.mood || "neutral";
  const cells = composeCells(opts);
  // 32 格 × 2 显示单位 = 64 viewBox（旧 16×3=48 的同比例放大）
  const CELL = 2;
  const VB = GRID * CELL;
  const rects = cells
    .map(
      (r) =>
        `<rect x="${r.x * CELL}" y="${r.y * CELL}" width="${r.w * CELL}" height="${r.h * CELL}" fill="${r.c}"/>`
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" width="${size}" height="${size}" class="avatar-svg avatar-pixel" shape-rendering="crispEdges" data-mood="${mood}" data-ini="${escapeAttr(initials(opts.name))}" aria-hidden="true">${rects}</svg>`;
}

/** PNG 缓存：同一 (种子|心情|球衣|尺寸|DPR) 只画一次 canvas */
const pngCache = new Map();
const PNG_CACHE_MAX = 800;

/**
 * 渲染像素头像 PNG data-URI（canvas 内部保持整数 cell，显示层可平滑缩小）。
 * 仅浏览器可用；无 DOM 时返回 null（调用方回退 SVG）。
 */
export function renderAvatarPngUri(opts = {}) {
  if (typeof document === "undefined") return null;
  const size = opts.size || 36;
  const dpr = Math.max(1, Math.min(3, (typeof window !== "undefined" && window.devicePixelRatio) || 1));
  const key = [
    opts.seed || opts.id || opts.name || "anon",
    opts.role || "player",
    opts.pos || "",
    opts.age || 25,
    opts.nation || "",
    opts.mood || "neutral",
    opts.kitPrimary || "",
    opts.kitSecondary || "",
    size,
    dpr,
  ].join("|");
  const hit = pngCache.get(key);
  if (hit) return hit;

  // 至少生成 64px 源图再交给浏览器缩小：小头像的单格轮廓不会因 28/30px
  // 这类非整数比例被放大成不均匀方块，高分屏仍按整数 cell 绘制。
  const k = Math.max(2, Math.ceil((size * dpr) / GRID));
  const px = GRID * k;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  for (const r of composeCells(opts)) {
    ctx.fillStyle = r.c;
    ctx.fillRect(r.x * k, r.y * k, r.w * k, r.h * k);
  }
  const uri = canvas.toDataURL("image/png");
  if (pngCache.size >= PNG_CACHE_MAX) pngCache.clear();
  pngCache.set(key, uri);
  return uri;
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

export function avatarHtml(person, opts = {}) {
  if (!person) return "";
  const role = opts.role || person.role || (person.pos ? "player" : "manager");
  const size = opts.size || 36;
  const kitPrimary = opts.kitPrimary || opts.kit?.primary;
  const kitSecondary = opts.kitSecondary || opts.kit?.secondary;
  let mood = opts.mood;
  if (!mood && role === "player") mood = moodFromPlayer(person);
  if (!mood) mood = "neutral";

  // 稳定身份：appearanceSeed → id → name（与资产映射、程序脸一致）
  const seedKey = playerAppearanceKey(person);

  const renderOpts = {
    seed: seedKey,
    id: person.id,
    name: person.name,
    role,
    pos: person.pos,
    age: person.age,
    nation: person.nationality || null,
    kitPrimary,
    kitSecondary,
    size,
    mood,
  };
  // 程序生成图：正式资产加载失败时的 fallback；无资产时也是主路径
  const pngUri = renderAvatarPngUri(renderOpts);
  const svgFallback = () => renderAvatarSvg(renderOpts);

  let inner;
  // 仅球员角色尝试正式肖像（职员/经理仍走像素）
  const tryArt =
    role === "player" && opts.forceProcedural !== true
      ? resolvePlayerAvatar(person, getAvatarManifest(), {
          size,
          kitPrimary,
          kitSecondary,
        })
      : null;

  if (tryArt && tryArt.kind === "asset" && tryArt.src) {
    const artSrc = escapeAttr(tryArt.src);
    const alt = escapeAttr(person.name || "player");
    // onerror → 程序生成 data-URI；再失败则去掉图（外层 title 仍在）
    const fb = pngUri ? escapeAttr(pngUri) : "";
    const onerr = fb
      ? `this.onerror=null;this.src="${fb}";this.classList.remove("avatar-art");this.classList.add("avatar-px");this.removeAttribute("data-kit-recolor");`
      : `this.onerror=null;this.remove();`;
    // 同队必须同色：有俱乐部主色就强制着色（不依赖资产自带球衣色）
    const needKit = !!kitPrimary;
    const kitAttr = needKit
      ? ` data-kit-recolor="${escapeAttr(kitPrimary)}" data-art-src="${artSrc}"`
      : "";
    inner = `<img class="avatar-art" src="${artSrc}" width="${size}" height="${size}" alt="${alt}" draggable="false" loading="lazy" decoding="async" data-avatar-id="${escapeAttr(
      tryArt.id || ""
    )}"${kitAttr} onerror="${onerr}">`;
  } else if (pngUri) {
    inner = `<img class="avatar-px" src="${pngUri}" width="${size}" height="${size}" alt="" draggable="false">`;
  } else {
    inner = svgFallback();
  }

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
  const label = (person.name || "") + moodTip;
  const artCls =
    tryArt && tryArt.kind === "asset" ? " avatar-has-art" : "";
  const cls = `avatar mood-${mood}${artCls}${opts.className ? " " + opts.className : ""}`;
  return `<span class="${cls}" style="width:${size}px;height:${size}px" title="${escapeAttr(
    label
  )}" role="img" aria-label="${escapeAttr(label)}">${inner}</span>`;
}

// 资产管线公开 re-export（调用方无需改 import 路径也可测）
export {
  resolvePlayerAvatar,
  loadAvatarManifest,
  getAvatarManifest,
  playerAppearanceKey,
  getKitRecoloredSrc,
  buildAvatarQuery,
  scoreAvatarEntry,
} from "./avatar-assets.js";

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** 主题队固定配色（与 models.ensureKit 同步；avatar 不 import models 以免环依赖） */
const AVATAR_KIT_THEME = {
  sunset: { primary: "#f97316", secondary: "#5b21b6" },
  harbor: { primary: "#0ea5e9", secondary: "#f8fafc" },
  steel: { primary: "#64748b", secondary: "#dc2626" },
  mill: { primary: "#166534", secondary: "#eab308" },
};

/**
 * 插入 DOM 后调用：对带 data-kit-recolor 的正式肖像做球衣主色对齐。
 * 可重复调用；已处理过的图会打 data-kit-done。
 * @param {ParentNode} [root]
 */
export function hydrateAvatarKitRecolor(root) {
  if (typeof document === "undefined") return;
  const scope = root || document;
  const nodes = scope.querySelectorAll?.("img.avatar-art[data-kit-recolor]:not([data-kit-done])");
  if (!nodes || !nodes.length) return;
  nodes.forEach((img) => {
    const kit = img.getAttribute("data-kit-recolor");
    const src = img.getAttribute("data-art-src") || img.getAttribute("src");
    if (!kit || !src) {
      img.setAttribute("data-kit-done", "1");
      return;
    }
    const w = Number(img.getAttribute("width")) || img.width || 128;
    getKitRecoloredSrc(src, kit, Math.max(64, Math.min(256, w * 2)))
      .then((out) => {
        if (out && img.isConnected) {
          img.src = out;
          img.setAttribute("data-kit-done", "1");
        }
      })
      .catch(() => {
        img.setAttribute("data-kit-done", "1");
      });
  });
}

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
