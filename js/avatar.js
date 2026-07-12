/**
 * 程序生成 SVG 小人形象（球员 / 职员 / 经理）
 * 由 id 种子稳定生成，不依赖外部图片。
 */

const SKINS = ["#f5d0b0", "#e8b896", "#c68642", "#8d5524", "#ffdbac", "#d4a574"];
const HAIRS = ["#1a1a1a", "#3d2314", "#6b4423", "#c4a35a", "#8b0000", "#2f4f4f", "#f5f5f5", "#4a3728"];
const BG_FALLBACK = ["#1e3a5f", "#3d1f4a", "#1a4d3e", "#4a3020", "#2c3e50", "#3b2f5c"];

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

/**
 * @param {object} opts
 * @param {string} opts.seed
 * @param {string} [opts.name]
 * @param {string} [opts.role] player|coach|scout|doctor|manager
 * @param {string} [opts.pos] GK|DEF|MID|ATT
 * @param {string} [opts.kitPrimary]
 * @param {string} [opts.kitSecondary]
 * @param {number} [opts.size]
 * @param {number} [opts.age]
 */
export function renderAvatarSvg(opts = {}) {
  const seed = opts.seed || opts.id || opts.name || "anon";
  const h = hashStr(seed);
  const size = opts.size || 40;
  const role = opts.role || "player";
  const pos = opts.pos || "";
  const age = opts.age || 25;

  const skin = pick(SKINS, h, 1);
  let hair = pick(HAIRS, h, 2);
  // 年龄偏大略灰
  if (age >= 34 && (h & 1) === 0) hair = "#6b7280";
  if (age >= 40) hair = pick(["#6b7280", "#9ca3af", "#d1d5db", hair], h, 3);

  const kitP = opts.kitPrimary || pick(BG_FALLBACK, h, 4);
  const kitS = opts.kitSecondary || shiftHex(kitP, -40);
  const bg = role === "player" ? shiftHex(kitP, -55) : pick(BG_FALLBACK, h, 5);

  // 发型 0–4
  const hairStyle = h % 5;
  // 脸型微调
  const faceW = 11 + (h % 3);
  const browY = 18 + (h % 2);

  // 配饰按角色
  let accessory = "";
  if (role === "coach") {
    // 西装领
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
    // 球员球衣
    const sleeve = kitS;
    accessory = `
      <path d="M8 34 L16 28 L32 28 L40 34 L36 48 L12 48 Z" fill="${kitP}"/>
      <path d="M8 34 L16 28 L16 36 L10 40 Z" fill="${sleeve}"/>
      <path d="M40 34 L32 28 L32 36 L38 40 Z" fill="${sleeve}"/>
      <circle cx="24" cy="38" r="2.2" fill="${kitS}" opacity="0.85"/>
    `;
    // 门将帽檐/手套色提示
    if (pos === "GK") {
      accessory += `<rect x="14" y="27" width="20" height="3" rx="1" fill="${shiftHex(kitP, 30)}" opacity="0.9"/>`;
    }
  }

  // 头发路径
  let hairPath = "";
  if (hairStyle === 0) {
    // 短发
    hairPath = `<ellipse cx="24" cy="14" rx="12" ry="9" fill="${hair}"/>`;
  } else if (hairStyle === 1) {
    // 侧分
    hairPath = `<path d="M12 16 Q14 6 24 7 Q34 6 36 16 Q30 12 24 12 Q18 12 12 16 Z" fill="${hair}"/>`;
  } else if (hairStyle === 2) {
    // 卷发感
    hairPath = `
      <circle cx="16" cy="12" r="5" fill="${hair}"/>
      <circle cx="24" cy="10" r="6" fill="${hair}"/>
      <circle cx="32" cy="12" r="5" fill="${hair}"/>
      <ellipse cx="24" cy="14" rx="11" ry="6" fill="${hair}"/>
    `;
  } else if (hairStyle === 3) {
    // 寸头
    hairPath = `<ellipse cx="24" cy="13" rx="11" ry="7" fill="${hair}"/>`;
  } else {
    // 长一点
    hairPath = `
      <ellipse cx="24" cy="13" rx="12" ry="9" fill="${hair}"/>
      <path d="M12 16 Q10 24 13 28" stroke="${hair}" stroke-width="3" fill="none"/>
      <path d="M36 16 Q38 24 35 28" stroke="${hair}" stroke-width="3" fill="none"/>
    `;
  }

  // 胡子（年长概率）
  let facial = "";
  if (age >= 28 && (h % 5) === 0) {
    facial = `<path d="M18 28 Q24 32 30 28" stroke="${shiftHex(hair, 20)}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  }

  const ini = initials(opts.name);
  // 极小尺寸只显示缩写色块（可选，这里始终画小人）
  const clipId = `av${h.toString(36)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" class="avatar-svg" aria-hidden="true">
  <defs>
    <clipPath id="${clipId}"><circle cx="24" cy="24" r="24"/></clipPath>
  </defs>
  <g clip-path="url(#${clipId})">
    <rect width="48" height="48" fill="${bg}"/>
    <circle cx="24" cy="52" r="18" fill="${shiftHex(bg, 15)}" opacity="0.35"/>
    ${accessory}
    <!-- 颈 -->
    <rect x="20" y="28" width="8" height="6" fill="${skin}"/>
    <!-- 头 -->
    <ellipse cx="24" cy="20" rx="${faceW}" ry="12" fill="${skin}"/>
    ${hairPath}
    <!-- 眉 -->
    <path d="M16 ${browY} H21" stroke="${shiftHex(hair, -10)}" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M27 ${browY} H32" stroke="${shiftHex(hair, -10)}" stroke-width="1.2" stroke-linecap="round"/>
    <!-- 眼 -->
    <circle cx="19" cy="21" r="1.35" fill="#1e293b"/>
    <circle cx="29" cy="21" r="1.35" fill="#1e293b"/>
    <!-- 嘴 -->
    <path d="M20 26 Q24 28.5 28 26" stroke="#b4534a" stroke-width="1.1" fill="none" stroke-linecap="round"/>
    ${facial}
  </g>
  <circle cx="24" cy="24" r="23" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
</svg>`;

  // 给无障碍：title 用缩写
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
  const svg = renderAvatarSvg({
    seed: person.id || person.name,
    name: person.name,
    role,
    pos: person.pos,
    age: person.age,
    kitPrimary,
    kitSecondary,
    size,
  });
  const cls = `avatar${opts.className ? " " + opts.className : ""}`;
  return `<span class="${cls}" style="width:${size}px;height:${size}px" title="${escapeAttr(
    person.name || ""
  )}">${svg}</span>`;
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** 球员 + 俱乐部球衣色 */
export function playerAvatarHtml(player, club, size = 36) {
  const kit = club?.kit;
  return avatarHtml(player, {
    role: "player",
    size,
    kitPrimary: kit?.primary || club?.color,
    kitSecondary: kit?.secondary,
  });
}

export function staffAvatarHtml(staff, size = 48) {
  return avatarHtml(staff, {
    role: staff?.role || "coach",
    size,
  });
}
