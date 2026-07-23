/** 本地存档：多槽位 localStorage + 导出/导入文件 */

import { compressToUTF16, decompressFromUTF16 } from "./compress.js";
import { clubBrandingById } from "./clubs.js";
import { localizedClubName } from "./branding.js";

// 新键名（VCFM）；旧键兼容读取后迁移
const LEGACY_KEY = "vcfm_save_v1";
const SLOT_PREFIX = "vcfm_slot_";
const ACTIVE_KEY = "vcfm_active_slot";
const META_KEY = "vcfm_slots_meta";
const OLD_LEGACY_KEY = "vc_fm_save_v1";
const OLD_SLOT_PREFIX = "vc_fm_slot_";
const OLD_ACTIVE_KEY = "vc_fm_active_slot";
const OLD_META_KEY = "vc_fm_slots_meta";
export const SLOT_COUNT = 3;
const COMPRESSED_PREFIX = "VCFMZ1:";

function encodeWorld(world) {
  return COMPRESSED_PREFIX + compressToUTF16(JSON.stringify(world));
}

function encodeJson(json) {
  return COMPRESSED_PREFIX + compressToUTF16(json);
}

function decodeWorld(raw) {
  if (!raw) return null;
  const json = raw.startsWith(COMPRESSED_PREFIX)
    ? decompressFromUTF16(raw.slice(COMPRESSED_PREFIX.length))
    : raw;
  return JSON.parse(json);
}

let saveWorker = null;
let activeJob = null;
let saveToken = 0;
const queuedJobs = new Map();
const latestTokenBySlot = new Map();
const pendingJsonBySlot = new Map();

function emitSaveError(error) {
  console.error(error);
  try {
    window.dispatchEvent(new CustomEvent("vcfm-save-error", { detail: String(error) }));
  } catch (_) {
    /* non-browser test environment */
  }
}

function writeEncodedSave(job, encoded) {
  localStorage.setItem(slotKey(job.slot), encoded);
  if (job.slot === 1) localStorage.removeItem(LEGACY_KEY);
  const meta = readMeta();
  meta[job.slot] = job.meta;
  writeMeta(meta);
  localStorage.setItem(ACTIVE_KEY, String(job.slot));
}

function startNextWorkerJob() {
  if (activeJob || !saveWorker || !queuedJobs.size) return;
  const job = queuedJobs.values().next().value;
  queuedJobs.delete(job.slot);
  activeJob = job;
  saveWorker.postMessage({ token: job.token, json: job.json });
}

function ensureSaveWorker() {
  if (saveWorker) return saveWorker;
  if (typeof Worker === "undefined") return null;
  try {
    saveWorker = new Worker(new URL("./save-worker.js", import.meta.url), { type: "module" });
    saveWorker.onmessage = (event) => {
      const job = activeJob;
      activeJob = null;
      if (job && event.data?.token === job.token) {
        if (event.data.error) {
          emitSaveError(event.data.error);
        } else if (latestTokenBySlot.get(job.slot) === job.token) {
          try {
            writeEncodedSave(job, COMPRESSED_PREFIX + event.data.packed);
            pendingJsonBySlot.delete(job.slot);
          } catch (error) {
            emitSaveError(error);
          }
        }
      }
      startNextWorkerJob();
    };
    saveWorker.onerror = (event) => {
      activeJob = null;
      emitSaveError(event.message || "save worker failed");
      startNextWorkerJob();
    };
    return saveWorker;
  } catch (error) {
    console.warn("save worker unavailable", error);
    return null;
  }
}

function queueSave(world, slot) {
  const worker = ensureSaveWorker();
  if (!worker) return false;
  const json = JSON.stringify(world);
  const job = {
    token: ++saveToken,
    slot,
    json,
    meta: metaFromWorld(world),
  };
  latestTokenBySlot.set(slot, job.token);
  pendingJsonBySlot.set(slot, json);
  queuedJobs.set(slot, job);
  startNextWorkerJob();
  return true;
}

function slotKey(slot) {
  return `${SLOT_PREFIX}${slot}`;
}

function oldSlotKey(slot) {
  return `${OLD_SLOT_PREFIX}${slot}`;
}

/** 把旧 vc_fm_* 键迁到 vcfm_*（只迁一次，不删旧键以免丢档） */
function migrateKeyNames() {
  try {
    if (!localStorage.getItem(ACTIVE_KEY) && localStorage.getItem(OLD_ACTIVE_KEY)) {
      localStorage.setItem(ACTIVE_KEY, localStorage.getItem(OLD_ACTIVE_KEY));
    }
    if (!localStorage.getItem(META_KEY) && localStorage.getItem(OLD_META_KEY)) {
      localStorage.setItem(META_KEY, localStorage.getItem(OLD_META_KEY));
    }
    for (let i = 1; i <= SLOT_COUNT; i++) {
      const nk = slotKey(i);
      const ok = oldSlotKey(i);
      if (!localStorage.getItem(nk) && localStorage.getItem(ok)) {
        localStorage.setItem(nk, localStorage.getItem(ok));
      }
    }
    if (!localStorage.getItem(LEGACY_KEY) && localStorage.getItem(OLD_LEGACY_KEY)) {
      localStorage.setItem(LEGACY_KEY, localStorage.getItem(OLD_LEGACY_KEY));
    }
  } catch (e) {
    console.error(e);
  }
}

function readMeta() {
  migrateKeyNames();
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function writeMeta(meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch (e) {
    console.error(e);
  }
}

function metaFromWorld(world) {
  if (!world) return null;
  const club = (world.clubs || []).find((c) => c.id === world.userClubId);
  const branding = clubBrandingById[world.userClubId];
  let lang = "zh";
  try {
    if (localStorage.getItem("vcfm-lang") === "en") lang = "en";
  } catch (_) {
    /* non-browser test environment */
  }
  return {
    season: world.season,
    day: world.day,
    manager: world.managerName || world.manager || "",
    clubId: world.userClubId,
    clubName: branding
      ? localizedClubName(branding, lang)
      : club?.name || world.userClubId || "—",
    money: club?.money ?? null,
    savedAt: Date.now(),
  };
}

/** 一次性：旧单键存档迁到槽 1 */
export function migrateLegacySave() {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return false;
    if (localStorage.getItem(slotKey(1))) {
      // 槽 1 已有内容：只删 legacy 避免双份（可选保留 legacy 作备份）
      return false;
    }
    localStorage.setItem(slotKey(1), legacy);
    const world = decodeWorld(legacy);
    const meta = readMeta();
    meta[1] = metaFromWorld(world);
    writeMeta(meta);
    if (!localStorage.getItem(ACTIVE_KEY)) {
      localStorage.setItem(ACTIVE_KEY, "1");
    }
    // 保留 LEGACY_KEY 一段时间作兼容；读写优先槽位
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export function getActiveSlot() {
  migrateKeyNames();
  migrateLegacySave();
  const n = parseInt(localStorage.getItem(ACTIVE_KEY) || "1", 10);
  if (n >= 1 && n <= SLOT_COUNT) return n;
  return 1;
}

export function setActiveSlot(slot) {
  const s = Math.max(1, Math.min(SLOT_COUNT, Number(slot) || 1));
  localStorage.setItem(ACTIVE_KEY, String(s));
  return s;
}

export function listSlots() {
  migrateKeyNames();
  migrateLegacySave();
  const meta = readMeta();
  const out = [];
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const pending = pendingJsonBySlot.get(i);
    const raw = pending || localStorage.getItem(slotKey(i));
    let info = meta[i] || null;
    if (raw && !info) {
      try {
        info = metaFromWorld(pending ? JSON.parse(pending) : decodeWorld(raw));
        meta[i] = info;
        writeMeta(meta);
      } catch {
        info = { clubName: "损坏存档", season: "?", day: "?" };
      }
    }
    const branding = clubBrandingById[info?.clubId];
    if (branding) {
      const latestName = localizedClubName(
        branding,
        localStorage.getItem("vcfm-lang") === "en" ? "en" : "zh"
      );
      if (info.clubName !== latestName) {
        info = { ...info, clubName: latestName };
        meta[i] = info;
        writeMeta(meta);
      }
    }
    out.push({
      slot: i,
      empty: !raw,
      ...info,
    });
  }
  return out;
}

export function hasAnySave() {
  migrateKeyNames();
  migrateLegacySave();
  for (let i = 1; i <= SLOT_COUNT; i++) {
    if (pendingJsonBySlot.has(i) || localStorage.getItem(slotKey(i))) return true;
  }
  return !!localStorage.getItem(LEGACY_KEY);
}

export function hasSave(slot = null) {
  migrateKeyNames();
  migrateLegacySave();
  if (slot == null) {
    return pendingJsonBySlot.has(getActiveSlot()) || !!localStorage.getItem(slotKey(getActiveSlot())) || !!localStorage.getItem(LEGACY_KEY);
  }
  return pendingJsonBySlot.has(Number(slot)) || !!localStorage.getItem(slotKey(slot));
}

export function saveGame(world, slot = null, { immediate = false } = {}) {
  try {
    migrateKeyNames();
    const s = slot != null ? slot : getActiveSlot();
    if (!immediate && queueSave(world, s)) {
      setActiveSlot(s);
      return true;
    }
    const key = slotKey(s);
    localStorage.setItem(key, encodeWorld(world));
    // 槽位已成为唯一写入源，清理旧单键副本避免大型世界存档翻倍。
    if (s === 1) localStorage.removeItem(LEGACY_KEY);
    const meta = readMeta();
    meta[s] = metaFromWorld(world);
    writeMeta(meta);
    setActiveSlot(s);
    pendingJsonBySlot.delete(s);
    latestTokenBySlot.set(s, ++saveToken);
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export function loadGame(slot = null) {
  try {
    migrateKeyNames();
    migrateLegacySave();
    const s = slot != null ? slot : getActiveSlot();
    const pending = pendingJsonBySlot.get(s);
    let raw = pending || localStorage.getItem(slotKey(s));
    if (!raw && s === 1) raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    setActiveSlot(s);
    return pending ? JSON.parse(pending) : decodeWorld(raw);
  } catch (e) {
    console.error(e);
    return null;
  }
}

/** 删除指定槽存档（含旧键名兼容清理） */
export function clearSave(slot = null) {
  migrateKeyNames();
  const s = slot != null ? slot : getActiveSlot();
  try {
    localStorage.removeItem(slotKey(s));
    pendingJsonBySlot.delete(s);
    queuedJobs.delete(s);
    latestTokenBySlot.set(s, ++saveToken);
    localStorage.removeItem(oldSlotKey(s));
    if (s === 1) {
      localStorage.removeItem(LEGACY_KEY);
      localStorage.removeItem(OLD_LEGACY_KEY);
    }
    const meta = readMeta();
    delete meta[s];
    writeMeta(meta);
    // 同步清理旧 meta 里的同槽（若仍存在独立旧 meta）
    try {
      const oldRaw = localStorage.getItem(OLD_META_KEY);
      if (oldRaw) {
        const oldMeta = JSON.parse(oldRaw) || {};
        if (oldMeta[s]) {
          delete oldMeta[s];
          localStorage.setItem(OLD_META_KEY, JSON.stringify(oldMeta));
        }
      }
    } catch (_) {
      /* ignore */
    }
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export function formatSlotLabel(info) {
  if (!info || info.empty) return `槽 ${info?.slot ?? "?"} · 空`;
  const when = info.savedAt
    ? new Date(info.savedAt).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const base = `槽 ${info.slot} · ${info.clubName || "—"} · S${info.season ?? "?"} D${info.day ?? "?"}`;
  return when ? `${base} · ${when}` : base;
}

/** 下载 JSON 存档文件 */
export function exportSaveDownload(world) {
  if (!world) return false;
  try {
    const blob = new Blob([JSON.stringify(world)], { type: "application/json" });
    const a = document.createElement("a");
    const club = world.userClubId || "club";
    a.href = URL.createObjectURL(blob);
    a.download = `vcfm_${world.season || "s"}_D${world.day || 0}_${club}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

/** 从 JSON 文本解析存档（导入用） */
export function importSaveText(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.clubs) || !data.userClubId) {
    throw new Error("invalid save");
  }
  return data;
}
