/**
 * 本地球员头像资产管线（正式 PNG/WebP 肖像）
 *
 * 职责：manifest 加载、稳定映射 resolvePlayerAvatar、相对路径（GitHub Pages 友好）。
 * 不生成 SVG/Canvas 人物；程序生成 fallback 仍由 avatar.js 负责。
 *
 * assignment:
 * - explicit（推荐，池不足时）：仅 avatarAssetId 绑定；其余走程序生成脸
 * - hash：池内稳定取模（易撞脸，不推荐）
 * - match：仅对 matchable!==false 的条目按年龄/地区/肤色/球衣打分
 *
 * 重要：source=variant-recolor 的“换肤克隆”必须 matchable:false，禁止自动分配。
 * 同队球衣色由渲染层强制 kit recolor，不依赖资产文件里的默认球衣色。
 *
 * 本文件可由 scripts/build-avatar-assets-module.mjs 从 manifest 重新生成内置副本。
 */

const MANIFEST_REL = "assets/player-avatars/manifest.json";

/** @type {import('./avatar-assets-types').AvatarManifest} */
const BUILTIN_MANIFEST = {
  "version": 3,
  "assignment": "explicit",
  "minDisplayPx": 64,
  "minMatchScore": 0,
  "poolPolicy": "explicit-until-diverse-pool",
  "avatars": [
    {
      "id": "avatar-0001",
      "portrait": "portraits/avatar-0001.webp",
      "portraitPng": "portraits/avatar-0001.png",
      "thumbnail": "thumbnails/avatar-0001.webp",
      "master": "portraits/avatar-0001.png",
      "width": 512,
      "height": 512,
      "masterWidth": 1024,
      "masterHeight": 1024,
      "ageMin": 20,
      "ageMax": 28,
      "ageBand": "young_adult",
      "skinTone": "fair",
      "hairColor": "brown",
      "hairStyle": "spiky",
      "regions": [
        "weur",
        "brit",
        "seur",
        "fra",
        "usa",
        "aus"
      ],
      "kitPrimary": "#1e3a5f",
      "kitSecondary": "#0f172a",
      "notes": "master pilot navy jersey",
      "source": "master",
      "matchable": true
    },
    {
      "id": "avatar-0002",
      "portrait": "portraits/avatar-0002.webp",
      "portraitPng": "portraits/avatar-0002.png",
      "thumbnail": "thumbnails/avatar-0002.webp",
      "master": "portraits/avatar-0002.png",
      "width": 512,
      "height": 512,
      "masterWidth": 1024,
      "masterHeight": 1024,
      "ageMin": 17,
      "ageMax": 22,
      "ageBand": "youth",
      "skinTone": "light",
      "hairColor": "black",
      "hairStyle": "bowl",
      "regions": [
        "easia"
      ],
      "kitPrimary": "#38bdf8",
      "kitSecondary": "#f8fafc",
      "notes": "easia youth sky blue",
      "source": "variant-recolor",
      "matchable": false,
      "autoAssign": false
    },
    {
      "id": "avatar-0003",
      "portrait": "portraits/avatar-0003.webp",
      "portraitPng": "portraits/avatar-0003.png",
      "thumbnail": "thumbnails/avatar-0003.webp",
      "master": "portraits/avatar-0003.png",
      "width": 512,
      "height": 512,
      "masterWidth": 1024,
      "masterHeight": 1024,
      "ageMin": 21,
      "ageMax": 28,
      "ageBand": "young_adult",
      "skinTone": "deep",
      "hairColor": "black",
      "hairStyle": "fade",
      "regions": [
        "wafr",
        "usa",
        "fra"
      ],
      "kitPrimary": "#f97316",
      "kitSecondary": "#5b21b6",
      "notes": "deep skin sunset orange",
      "source": "variant-recolor",
      "matchable": false,
      "autoAssign": false
    },
    {
      "id": "avatar-0004",
      "portrait": "portraits/avatar-0004.webp",
      "portraitPng": "portraits/avatar-0004.png",
      "thumbnail": "thumbnails/avatar-0004.webp",
      "master": "portraits/avatar-0004.png",
      "width": 512,
      "height": 512,
      "masterWidth": 1024,
      "masterHeight": 1024,
      "ageMin": 24,
      "ageMax": 32,
      "ageBand": "prime",
      "skinTone": "pale",
      "hairColor": "blond",
      "hairStyle": "messy",
      "regions": [
        "nordic",
        "brit",
        "weur",
        "aus"
      ],
      "kitPrimary": "#166534",
      "kitSecondary": "#eab308",
      "notes": "nordic blond mill green",
      "source": "variant-recolor",
      "matchable": false,
      "autoAssign": false
    },
    {
      "id": "avatar-0005",
      "portrait": "portraits/avatar-0005.webp",
      "portraitPng": "portraits/avatar-0005.png",
      "thumbnail": "thumbnails/avatar-0005.webp",
      "master": "portraits/avatar-0005.png",
      "width": 512,
      "height": 512,
      "masterWidth": 1024,
      "masterHeight": 1024,
      "ageMin": 28,
      "ageMax": 34,
      "ageBand": "prime",
      "skinTone": "olive",
      "hairColor": "black",
      "hairStyle": "sidepart",
      "regions": [
        "seur",
        "tur",
        "nafr",
        "latE"
      ],
      "kitPrimary": "#dc2626",
      "kitSecondary": "#f8fafc",
      "notes": "olive sidepart crimson",
      "source": "variant-recolor",
      "matchable": false,
      "autoAssign": false
    },
    {
      "id": "avatar-0006",
      "portrait": "portraits/avatar-0006.webp",
      "portraitPng": "portraits/avatar-0006.png",
      "thumbnail": "thumbnails/avatar-0006.webp",
      "master": "portraits/avatar-0006.png",
      "width": 512,
      "height": 512,
      "masterWidth": 1024,
      "masterHeight": 1024,
      "ageMin": 20,
      "ageMax": 27,
      "ageBand": "young_adult",
      "skinTone": "tan",
      "hairColor": "black",
      "hairStyle": "short",
      "regions": [
        "latM",
        "mex"
      ],
      "kitPrimary": "#f8fafc",
      "kitSecondary": "#0ea5e9",
      "notes": "latam tan white kit",
      "source": "variant-recolor",
      "matchable": false,
      "autoAssign": false
    },
    {
      "id": "avatar-0007",
      "portrait": "portraits/avatar-0007.webp",
      "portraitPng": "portraits/avatar-0007.png",
      "thumbnail": "thumbnails/avatar-0007.webp",
      "master": "portraits/avatar-0007.png",
      "width": 512,
      "height": 512,
      "masterWidth": 1024,
      "masterHeight": 1024,
      "ageMin": 34,
      "ageMax": 40,
      "ageBand": "veteran",
      "skinTone": "fair",
      "hairColor": "grey",
      "hairStyle": "short",
      "regions": [
        "brit",
        "weur",
        "usa",
        "aus",
        "eeur"
      ],
      "kitPrimary": "#64748b",
      "kitSecondary": "#dc2626",
      "notes": "veteran grey steel",
      "source": "variant-recolor",
      "matchable": false,
      "autoAssign": false
    },
    {
      "id": "avatar-0008",
      "portrait": "portraits/avatar-0008.webp",
      "portraitPng": "portraits/avatar-0008.png",
      "thumbnail": "thumbnails/avatar-0008.webp",
      "master": "portraits/avatar-0008.png",
      "width": 512,
      "height": 512,
      "masterWidth": 1024,
      "masterHeight": 1024,
      "ageMin": 22,
      "ageMax": 29,
      "ageBand": "young_adult",
      "skinTone": "brown",
      "hairColor": "black",
      "hairStyle": "curl",
      "regions": [
        "wafr",
        "usa",
        "fra",
        "latM"
      ],
      "kitPrimary": "#5b21b6",
      "kitSecondary": "#f97316",
      "notes": "brown skin purple kit",
      "source": "variant-recolor",
      "matchable": false,
      "autoAssign": false
    },
    {
      "id": "avatar-0009",
      "portrait": "portraits/avatar-0009.webp",
      "portraitPng": "portraits/avatar-0009.png",
      "thumbnail": "thumbnails/avatar-0009.webp",
      "master": "portraits/avatar-0009.png",
      "width": 512,
      "height": 512,
      "masterWidth": 1024,
      "masterHeight": 1024,
      "ageMin": 18,
      "ageMax": 24,
      "ageBand": "youth",
      "skinTone": "light",
      "hairColor": "dkbrown",
      "hairStyle": "spiky",
      "regions": [
        "easia",
        "usa",
        "weur"
      ],
      "kitPrimary": "#0ea5e9",
      "kitSecondary": "#f8fafc",
      "notes": "youth harbor blue",
      "source": "variant-recolor",
      "matchable": false,
      "autoAssign": false
    },
    {
      "id": "avatar-0010",
      "portrait": "portraits/avatar-0010.webp",
      "portraitPng": "portraits/avatar-0010.png",
      "thumbnail": "thumbnails/avatar-0010.webp",
      "master": "portraits/avatar-0010.png",
      "width": 512,
      "height": 512,
      "masterWidth": 1024,
      "masterHeight": 1024,
      "ageMin": 23,
      "ageMax": 30,
      "ageBand": "prime",
      "skinTone": "pale",
      "hairColor": "red",
      "hairStyle": "messy",
      "regions": [
        "brit",
        "nordic",
        "weur"
      ],
      "kitPrimary": "#f97316",
      "kitSecondary": "#5b21b6",
      "notes": "redhead sunset",
      "source": "variant-recolor",
      "matchable": false,
      "autoAssign": false
    },
    {
      "id": "avatar-0011",
      "portrait": "portraits/avatar-0011.webp",
      "portraitPng": "portraits/avatar-0011.png",
      "thumbnail": "thumbnails/avatar-0011.webp",
      "master": "portraits/avatar-0011.png",
      "width": 512,
      "height": 512,
      "masterWidth": 1024,
      "masterHeight": 1024,
      "ageMin": 29,
      "ageMax": 36,
      "ageBand": "prime",
      "skinTone": "brown",
      "hairColor": "black",
      "hairStyle": "short",
      "regions": [
        "nafr",
        "tur",
        "latM",
        "mex"
      ],
      "kitPrimary": "#1e3a5f",
      "kitSecondary": "#94a3b8",
      "notes": "brown mid navy",
      "source": "variant-recolor",
      "matchable": false,
      "autoAssign": false
    },
    {
      "id": "avatar-0012",
      "portrait": "portraits/avatar-0012.webp",
      "portraitPng": "portraits/avatar-0012.png",
      "thumbnail": "thumbnails/avatar-0012.webp",
      "master": "portraits/avatar-0012.png",
      "width": 512,
      "height": 512,
      "masterWidth": 1024,
      "masterHeight": 1024,
      "ageMin": 33,
      "ageMax": 40,
      "ageBand": "veteran",
      "skinTone": "dark",
      "hairColor": "grey",
      "hairStyle": "fade",
      "regions": [
        "wafr",
        "usa",
        "fra"
      ],
      "kitPrimary": "#166534",
      "kitSecondary": "#eab308",
      "notes": "dark veteran mill",
      "source": "variant-recolor",
      "matchable": false,
      "autoAssign": false
    }
  ],
  "notes": "variant-recolor clones disabled for auto-assign; use procedural faces until distinct portraits exist",
  "minAutoPool": 6
};

/** 国籍 → 地区（与 avatar.js REGION_OF 对齐） */
export const NATION_REGION = Object.freeze({
  ENG: "brit",
  SCO: "brit",
  WAL: "brit",
  IRL: "brit",
  GER: "weur",
  NED: "weur",
  BEL: "weur",
  AUT: "weur",
  SUI: "weur",
  FRA: "fra",
  ESP: "seur",
  ITA: "seur",
  POR: "seur",
  CRO: "seur",
  SRB: "seur",
  POL: "eeur",
  UKR: "eeur",
  DEN: "nordic",
  SWE: "nordic",
  NOR: "nordic",
  TUR: "tur",
  JPN: "easia",
  KOR: "easia",
  CHN: "easia",
  NGA: "wafr",
  SEN: "wafr",
  GHA: "wafr",
  CIV: "wafr",
  MAR: "nafr",
  BRA: "latM",
  COL: "latM",
  ARG: "latE",
  URU: "latE",
  MEX: "mex",
  USA: "usa",
  AUS: "aus",
});

/** 地区默认肤色偏好（打分用） */
const REGION_SKIN_PREF = Object.freeze({
  nordic: ["pale", "fair", "light"],
  brit: ["pale", "fair", "light", "tan"],
  weur: ["fair", "pale", "light"],
  fra: ["fair", "light", "tan", "brown", "deep"],
  seur: ["light", "fair", "tan", "olive"],
  eeur: ["pale", "fair", "light"],
  tur: ["tan", "olive", "light"],
  easia: ["light", "fair", "tan", "pale"],
  wafr: ["deep", "dark", "brown"],
  nafr: ["tan", "olive", "brown", "light"],
  latM: ["tan", "light", "brown", "olive", "deep"],
  latE: ["fair", "light", "tan", "olive"],
  mex: ["tan", "olive", "brown", "light"],
  usa: ["fair", "light", "brown", "deep", "pale"],
  aus: ["fair", "pale", "light", "tan"],
});

const SKIN_ORDER = ["pale", "fair", "light", "tan", "olive", "brown", "deep", "dark"];

let manifest = cloneManifest(BUILTIN_MANIFEST);
let byId = indexManifest(manifest);
/** @type {Promise<object>|null} */
let loadPromise = null;

function cloneManifest(m) {
  return JSON.parse(JSON.stringify(m));
}

function indexManifest(m) {
  const map = new Map();
  for (const a of m?.avatars || []) {
    if (a?.id) map.set(String(a.id), a);
  }
  return map;
}

export function avatarAssetUrl(rel) {
  if (!rel) return null;
  const s = String(rel);
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  if (s.startsWith("./") || s.startsWith("../") || s.startsWith("/")) return s;
  if (s.startsWith("assets/")) return s;
  return `assets/player-avatars/${s.replace(/^\/+/, "")}`;
}

export function getAvatarManifest() {
  return manifest;
}

export function getAvatarEntry(id) {
  if (!id) return null;
  return byId.get(String(id)) || null;
}

function normalizeAssignment(a) {
  if (a === "hash" || a === "explicit" || a === "match") return a;
  return "match";
}

export function setAvatarManifest(next) {
  if (!next || !Array.isArray(next.avatars)) return manifest;
  manifest = {
    version: next.version || 1,
    assignment: normalizeAssignment(next.assignment),
    minDisplayPx: next.minDisplayPx ?? 64,
    minMatchScore: next.minMatchScore ?? 0,
    poolPolicy: next.poolPolicy || "trait-score",
    avatars: next.avatars.slice(),
  };
  byId = indexManifest(manifest);
  return manifest;
}

export function loadAvatarManifest(url = MANIFEST_REL) {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      if (typeof fetch !== "function") return manifest;
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) return manifest;
      const data = await res.json();
      if (data && Array.isArray(data.avatars)) setAvatarManifest(data);
    } catch {
      /* keep builtin */
    }
    return manifest;
  })();
  return loadPromise;
}

export function stableAvatarHash(s) {
  let h = 2166136261;
  const str = String(s || "x");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function readExplicitAvatarId(player) {
  if (!player || typeof player !== "object") return null;
  const raw = player.avatarAssetId ?? player.avatarId ?? player.portraitId ?? null;
  if (raw == null || raw === "") return null;
  return String(raw);
}

export function playerAppearanceKey(player) {
  if (!player || typeof player !== "object") return "anon";
  if (player.appearanceSeed != null && player.appearanceSeed !== "") {
    return String(player.appearanceSeed);
  }
  if (player.id != null && player.id !== "") return String(player.id);
  if (player.name != null && player.name !== "") return String(player.name);
  return "anon";
}

export function nationRegion(nation) {
  if (!nation) return null;
  return NATION_REGION[String(nation).toUpperCase()] || null;
}

export function ageBandOf(age) {
  const a = Number(age);
  if (!Number.isFinite(a)) return "young_adult";
  if (a <= 21) return "youth";
  if (a <= 27) return "young_adult";
  if (a <= 33) return "prime";
  return "veteran";
}

function parseHex(hex) {
  if (!hex || typeof hex !== "string") return null;
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** 0..1 色差（越小越近） */
export function colorDistance(a, b) {
  const A = parseHex(a);
  const B = parseHex(b);
  if (!A || !B) return 1;
  const dr = A.r - B.r;
  const dg = A.g - B.g;
  const db = A.b - B.b;
  return Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / 441.67);
}

function skinIndex(tone) {
  const i = SKIN_ORDER.indexOf(String(tone || "").toLowerCase());
  return i < 0 ? 2 : i;
}

/**
 * 从球员 + 可选球衣色构建匹配查询。
 * 身份键不含 club；kit 色只用于匹配/着色。
 */
export function buildAvatarQuery(player, opts = {}) {
  const nation = player?.nationality || player?.nation || opts.nation || null;
  const region = nationRegion(nation) || opts.region || null;
  const age = player?.age ?? opts.age ?? 25;
  const band = ageBandOf(age);
  const key = playerAppearanceKey(player);
  const h = stableAvatarHash(`look:${key}`);
  const pref = (region && REGION_SKIN_PREF[region]) || REGION_SKIN_PREF.weur;
  const skinTone = pref[h % pref.length];
  const kitPrimary = opts.kitPrimary || opts.kit?.primary || null;
  const kitSecondary = opts.kitSecondary || opts.kit?.secondary || null;
  return {
    key,
    age: Number(age) || 25,
    ageBand: band,
    nation,
    region,
    skinTone,
    kitPrimary,
    kitSecondary,
    hash: h,
  };
}

/** 是否允许自动匹配（克隆伪变体必须 false） */
export function isMatchableEntry(entry) {
  if (!entry?.id) return false;
  if (entry.matchable === false || entry.autoAssign === false) return false;
  if (entry.source === "variant-recolor") return false;
  return true;
}

/** 资产 vs 查询打分（越高越好） */
export function scoreAvatarEntry(entry, query) {
  if (!entry || !query) return -1e9;
  if (!isMatchableEntry(entry)) return -1e9;
  let score = 0;

  const amin = entry.ageMin ?? 17;
  const amax = entry.ageMax ?? 40;
  const age = query.age;
  if (age >= amin && age <= amax) score += 40;
  else {
    const dist = age < amin ? amin - age : age - amax;
    score += Math.max(0, 40 - dist * 8);
  }
  if (entry.ageBand && entry.ageBand === query.ageBand) score += 18;

  const regs = Array.isArray(entry.regions) ? entry.regions : [];
  if (query.region && regs.includes(query.region)) score += 36;
  else if (query.region && regs.length) score -= 8;

  if (entry.skinTone && query.skinTone) {
    const d = Math.abs(skinIndex(entry.skinTone) - skinIndex(query.skinTone));
    score += Math.max(0, 28 - d * 9);
  }

  if (query.kitPrimary && entry.kitPrimary) {
    const d = colorDistance(query.kitPrimary, entry.kitPrimary);
    score += Math.round((1 - d) * 32);
  }

  const jitter = (stableAvatarHash(`pick:${query.key}|${entry.id}`) % 1000) / 1000;
  score += jitter * 6;

  return score;
}

function fromEntry(entry, wantThumb, score) {
  if (!entry?.id) return fallbackResolved();
  const portraitRel = entry.portrait || entry.portraitPng || entry.master;
  const thumbRel = entry.thumbnail || portraitRel;
  const srcPortrait = avatarAssetUrl(portraitRel);
  const srcThumb = avatarAssetUrl(thumbRel);
  const src = wantThumb ? srcThumb || srcPortrait : srcPortrait || srcThumb;
  if (!src) return fallbackResolved();
  return {
    kind: "asset",
    id: String(entry.id),
    src,
    srcPortrait,
    srcThumb,
    sizeHint: wantThumb ? "thumbnail" : "portrait",
    score: score ?? 0,
    entry,
    kitPrimary: entry.kitPrimary || null,
  };
}

function fallbackResolved() {
  return {
    kind: "fallback",
    id: null,
    src: null,
    srcPortrait: null,
    srcThumb: null,
    sizeHint: null,
    score: 0,
    entry: null,
    kitPrimary: null,
  };
}

/**
 * 集中式纯函数：球员 → 头像资源或 fallback。
 *
 * 优先级：
 * 1. player.avatarAssetId（及兼容字段）
 * 2. assignment=match：年龄/地区/肤色/球衣打分 + 稳定破平
 * 3. assignment=hash：appearanceSeed / id 取模
 * 4. assignment=explicit：无显式 id 则 fallback
 * 5. 内置程序生成 fallback
 */
export function resolvePlayerAvatar(player, avatarManifest, opts = {}) {
  const m = avatarManifest || manifest;
  const list = m?.avatars || [];
  const index = m === manifest ? byId : indexManifest(m);
  const size = Number(opts.size) || 64;
  const wantThumb = size <= 96;

  const explicit = readExplicitAvatarId(player);
  if (explicit) {
    const entry = index.get(explicit);
    if (entry) return fromEntry(entry, wantThumb, 1e6);
    const id = explicit.replace(/[^a-zA-Z0-9_-]/g, "");
    if (id) {
      const portrait = avatarAssetUrl(`portraits/${id}.webp`);
      const thumb = avatarAssetUrl(`thumbnails/${id}.webp`);
      return {
        kind: "asset",
        id,
        src: wantThumb ? thumb : portrait,
        srcPortrait: portrait,
        srcThumb: thumb,
        sizeHint: wantThumb ? "thumbnail" : "portrait",
        score: 1e6,
        entry: null,
        kitPrimary: null,
      };
    }
  }

  const pool = list.filter(isMatchableEntry);
  if (!pool.length) return fallbackResolved();

  const mode = normalizeAssignment(m.assignment);

  // 可匹配池过小（例如只剩 1 张真·母版）时禁止自动分配，避免全员同一张脸
  const minPool = Number(m.minAutoPool) > 0 ? Number(m.minAutoPool) : 6;
  if (mode !== "explicit" && pool.length < minPool) {
    return fallbackResolved();
  }

  if (mode === "explicit") return fallbackResolved();

  if (mode === "hash") {
    const seed =
      player?.appearanceSeed != null && player.appearanceSeed !== ""
        ? String(player.appearanceSeed)
        : null;
    if (seed) {
      const i = stableAvatarHash(`seed:${seed}`) % pool.length;
      return fromEntry(pool[i], wantThumb, 0);
    }
    const pid = player?.id != null && player.id !== "" ? String(player.id) : null;
    if (pid) {
      const i = stableAvatarHash(`id:${pid}`) % pool.length;
      return fromEntry(pool[i], wantThumb, 0);
    }
    return fallbackResolved();
  }

  // match
  const query = buildAvatarQuery(player, opts);
  let best = null;
  let bestScore = -1e9;
  for (const entry of pool) {
    const s = scoreAvatarEntry(entry, query);
    if (s > bestScore) {
      bestScore = s;
      best = entry;
    }
  }
  const minScore = m.minMatchScore ?? 0;
  if (!best || bestScore < minScore) return fallbackResolved();
  return fromEntry(best, wantThumb, bestScore);
}

export function playerHasAvatarAsset(player, avatarManifest, opts) {
  return resolvePlayerAvatar(player, avatarManifest, opts).kind === "asset";
}

/**
 * 运行时球衣主色着色（canvas）。仅改下半身织物区，保留脸/发/线稿。
 * @returns {Promise<string|null>} data URL
 */
export async function recolorAvatarKit(srcUrl, targetHex, opts = {}) {
  if (typeof document === "undefined" || !srcUrl || !targetHex) return null;
  const target = parseHex(targetHex);
  if (!target) return null;
  const outSize = Math.max(64, Math.min(512, Number(opts.size) || 128));

  const img = await loadImage(srcUrl);
  if (!img) return null;

  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, outSize, outSize);
  const imageData = ctx.getImageData(0, 0, outSize, outSize);
  const d = imageData.data;
  const tr = target.r;
  const tg = target.g;
  const tb = target.b;

  for (let y = 0; y < outSize; y++) {
    for (let x = 0; x < outSize; x++) {
      const i = (y * outSize + x) * 4;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const a = d[i + 3];
      if (a < 8) continue;
      const maxc = Math.max(r, g, b);
      const minc = Math.min(r, g, b);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = maxc === 0 ? 0 : (maxc - minc) / maxc;
      const inLower = y > outSize * 0.62;
      const isBg = sat < 0.12 && lum > 170;
      const isLine = lum < 42;
      const isSkinish =
        y < outSize * 0.72 &&
        r > 90 &&
        g > 50 &&
        b > 40 &&
        r > b &&
        r > g - 10 &&
        sat > 0.12 &&
        sat < 0.65 &&
        lum > 70 &&
        lum < 220;
      if (!inLower || isBg || isLine || isSkinish) continue;
      if (sat < 0.08 && lum > 140) continue;
      const shade = Math.max(0.35, Math.min(1.55, lum / 110));
      d[i] = Math.max(0, Math.min(255, Math.round(tr * shade)));
      d[i + 1] = Math.max(0, Math.min(255, Math.round(tg * shade)));
      d[i + 2] = Math.max(0, Math.min(255, Math.round(tb * shade)));
    }
  }
  ctx.putImageData(imageData, 0, 0);
  try {
    return canvas.toDataURL("image/webp", 0.9);
  } catch {
    return canvas.toDataURL("image/png");
  }
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const kitRecolorCache = new Map();
const KIT_CACHE_MAX = 200;

export async function getKitRecoloredSrc(srcUrl, kitPrimary, size) {
  if (!srcUrl || !kitPrimary) return srcUrl;
  const key = `${srcUrl}|${kitPrimary}|${size || 0}`;
  if (kitRecolorCache.has(key)) return kitRecolorCache.get(key);
  const out = await recolorAvatarKit(srcUrl, kitPrimary, { size: size || 128 });
  const finalSrc = out || srcUrl;
  if (kitRecolorCache.size >= KIT_CACHE_MAX) kitRecolorCache.clear();
  kitRecolorCache.set(key, finalSrc);
  return finalSrc;
}
