/** 本地存档：IndexedDB 多槽位，localStorage 兼容回退，支持导出/导入。 */

import { compressToUTF16, decompressFromUTF16 } from "./compress.js";
import { clubBrandingById } from "./clubs.js";
import { localizedClubName } from "./branding.js";
import { validateSaveStructure } from "./save-schema.js";
import { stringifyWorldForSave } from "./save-serialization.js";

// 新键名（VCFM）；旧键兼容读取后迁移
const LEGACY_KEY = "vcfm_save_v1";
const SLOT_PREFIX = "vcfm_slot_";
const ACTIVE_KEY = "vcfm_active_slot";
const ACTIVE_SESSION_KEY = "vcfm_active_slot_session";
const META_KEY = "vcfm_slots_meta";
const OLD_LEGACY_KEY = "vc_fm_save_v1";
const OLD_SLOT_PREFIX = "vc_fm_slot_";
const OLD_ACTIVE_KEY = "vc_fm_active_slot";
const OLD_META_KEY = "vc_fm_slots_meta";
export const SLOT_COUNT = 3;
const COMPRESSED_PREFIX = "VCFMZ1:";
const SAVE_DB_NAME = "vcfm-saves";
const SAVE_DB_VERSION = 1;
const SAVE_STORE = "slots";

function encodeWorld(world) {
  return COMPRESSED_PREFIX + compressToUTF16(stringifyWorldForSave(world));
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
let saveWorkerDisabled = false;
let activeJob = null;
let saveDb = null;
let storageInitialization = null;
let activeDurableJob = null;
let saveToken = 0;
const queuedJobs = new Map();
const queuedDurableJobs = new Map();
const latestTokenBySlot = new Map();
const pendingJsonBySlot = new Map();
const pendingJobsBySlot = new Map();
const durableSlots = new Set();
const deletedDurableSlots = new Set();
const durableIdleWaiters = new Set();

function emitSaveError(error) {
  console.error(error);
  try {
    window.dispatchEvent(new CustomEvent("vcfm-save-error", { detail: String(error) }));
  } catch (_) {
    /* non-browser test environment */
  }
}

function openSaveDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SAVE_DB_NAME, SAVE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SAVE_STORE)) {
        db.createObjectStore(SAVE_STORE, { keyPath: "slot" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("save database could not be opened"));
    request.onblocked = () => reject(new Error("save database upgrade was blocked"));
  });
}

function saveDbRequest(mode, operation) {
  if (!saveDb) return Promise.reject(new Error("save database is unavailable"));
  return new Promise((resolve, reject) => {
    const transaction = saveDb.transaction(SAVE_STORE, mode);
    const store = transaction.objectStore(SAVE_STORE);
    let request;
    try {
      request = operation(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error || request?.error || new Error("save transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("save transaction was aborted"));
  });
}

function durableRecord(slot) {
  return saveDbRequest("readonly", (store) => store.get(Number(slot)));
}

function writeDurableRecord(job) {
  return saveDbRequest("readwrite", (store) => store.put({
    slot: job.slot,
    json: job.json,
    meta: job.meta,
  }));
}

function deleteDurableRecord(slot) {
  return saveDbRequest("readwrite", (store) => store.delete(Number(slot)));
}

function progressKey(world) {
  if (!world) return 0;
  const season = Number(world.season) || 0;
  const day = Number(world.day) || 0;
  return season * 10000 + day;
}

function localSaveIsNewer(localMeta, localWorld, durableMeta, durableWorld) {
  const localSavedAt = Number(localMeta?.savedAt) || 0;
  const durableSavedAt = Number(durableMeta?.savedAt) || 0;
  if (localSavedAt && durableSavedAt && localSavedAt !== durableSavedAt) {
    return localSavedAt > durableSavedAt;
  }
  return progressKey(localWorld) > progressKey(durableWorld);
}

function resolveDurableIdleWaiters() {
  if (activeDurableJob || queuedDurableJobs.size) return;
  for (const resolve of durableIdleWaiters) resolve();
  durableIdleWaiters.clear();
}

function startNextDurableJob() {
  if (activeDurableJob || !saveDb || !queuedDurableJobs.size) {
    resolveDurableIdleWaiters();
    return;
  }
  const job = queuedDurableJobs.values().next().value;
  queuedDurableJobs.delete(job.slot);
  activeDurableJob = job;
  writeDurableRecord(job)
    .then(async () => {
      if (deletedDurableSlots.has(job.slot)) {
        await deleteDurableRecord(job.slot);
      } else if (latestTokenBySlot.get(job.slot) === job.token) {
        durableSlots.add(job.slot);
        pendingJsonBySlot.delete(job.slot);
        pendingJobsBySlot.delete(job.slot);
      }
    })
    .catch((error) => emitSaveError(error))
    .finally(() => {
      activeDurableJob = null;
      startNextDurableJob();
    });
}

function queueDurableSave(world, slot) {
  if (!saveDb) return false;
  const json = stringifyWorldForSave(world);
  const job = {
    token: ++saveToken,
    slot,
    json,
    meta: metaFromWorld(world),
  };
  deletedDurableSlots.delete(slot);
  durableSlots.add(slot);
  latestTokenBySlot.set(slot, job.token);
  pendingJsonBySlot.set(slot, json);
  pendingJobsBySlot.set(slot, job);
  queuedDurableJobs.set(slot, job);
  const meta = readMeta();
  meta[slot] = job.meta;
  writeMeta(meta);
  startNextDurableJob();
  return true;
}

export function waitForPendingSaves() {
  if (!saveDb || (!activeDurableJob && !queuedDurableJobs.size)) return Promise.resolve();
  return new Promise((resolve) => durableIdleWaiters.add(resolve));
}

async function initializeDurableStorage() {
  if (typeof indexedDB === "undefined") return false;
  try {
    saveDb = await openSaveDatabase();
    const keys = await saveDbRequest("readonly", (store) => store.getAllKeys());
    for (const key of keys || []) durableSlots.add(Number(key));

    migrateKeyNames();
    migrateLegacySave();
    const meta = readMeta();
    for (let slot = 1; slot <= SLOT_COUNT; slot++) {
      const key = slotKey(slot);
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const durable = durableSlots.has(slot) ? await durableRecord(slot) : null;
      let world = null;
      try {
        world = decodeWorld(raw);
      } catch (error) {
        if (!durable?.json) throw error;
      }
      const localMeta = meta[slot] || metaFromWorld(world, 0);
      const durableWorld = durable?.json ? JSON.parse(durable.json) : null;
      if (world && (!durable?.json || localSaveIsNewer(localMeta, world, durable.meta, durableWorld))) {
        await saveDbRequest("readwrite", (store) => store.put({
          slot,
          json: stringifyWorldForSave(world),
          meta: localMeta,
        }));
        durableSlots.add(slot);
        meta[slot] = localMeta;
      } else {
        meta[slot] = durable.meta || metaFromWorld(durableWorld, 0);
      }
      writeMeta(meta);
      localStorage.removeItem(key);
      localStorage.removeItem(oldSlotKey(slot));
      if (slot === 1) localStorage.removeItem(LEGACY_KEY);
    }
    localStorage.removeItem(OLD_LEGACY_KEY);
    return true;
  } catch (error) {
    try {
      saveDb?.close();
    } catch (_) {
      /* already closed */
    }
    saveDb = null;
    console.warn("IndexedDB save storage unavailable; using localStorage fallback", error);
    return false;
  }
}

/** Opens the durable browser store and migrates legacy localStorage slots once. */
export function initializeSaveStorage() {
  if (!storageInitialization) storageInitialization = initializeDurableStorage();
  return storageInitialization;
}

function writeEncodedSave(job, encoded) {
  localStorage.setItem(slotKey(job.slot), encoded);
  if (job.slot === 1) localStorage.removeItem(LEGACY_KEY);
  const meta = readMeta();
  meta[job.slot] = job.meta;
  writeMeta(meta);
}

function disableSaveWorker() {
  if (saveWorker) {
    saveWorker.onmessage = null;
    saveWorker.onerror = null;
    try {
      saveWorker.terminate();
    } catch (_) {
      /* already stopped */
    }
  }
  saveWorker = null;
  saveWorkerDisabled = true;
  activeJob = null;
  queuedJobs.clear();
}

/** Synchronously persists the latest pending snapshot for every slot. */
export function flushPendingSaves({ reportError = true, disableWorker = false } = {}) {
  // IndexedDB writes are already in flight and cannot be made synchronous during unload.
  if (saveDb) return true;
  if (disableWorker) disableSaveWorker();
  let ok = true;
  for (const [slot, job] of [...pendingJobsBySlot]) {
    try {
      writeEncodedSave(job, encodeJson(job.json));
      if (pendingJobsBySlot.get(slot)?.token === job.token) {
        pendingJobsBySlot.delete(slot);
        pendingJsonBySlot.delete(slot);
        queuedJobs.delete(slot);
      }
    } catch (error) {
      ok = false;
      if (reportError) emitSaveError(error);
    }
  }
  return ok;
}

function recoverFromWorkerFailure(error) {
  emitSaveError(error);
  flushPendingSaves({ reportError: true, disableWorker: true });
}

function startNextWorkerJob() {
  if (activeJob || !saveWorker || !queuedJobs.size) return;
  const job = queuedJobs.values().next().value;
  queuedJobs.delete(job.slot);
  activeJob = job;
  try {
    saveWorker.postMessage({ token: job.token, json: job.json });
  } catch (error) {
    recoverFromWorkerFailure(error);
  }
}

function ensureSaveWorker() {
  if (saveWorker) return saveWorker;
  if (saveWorkerDisabled) return null;
  if (typeof Worker === "undefined") return null;
  try {
    saveWorker = new Worker(new URL("./save-worker.js", import.meta.url), { type: "module" });
    saveWorker.onmessage = (event) => {
      const job = activeJob;
      activeJob = null;
      if (!job || event.data?.token !== job.token) {
        recoverFromWorkerFailure("save worker returned an unexpected response");
        return;
      }
      if (event.data.error) {
        recoverFromWorkerFailure(event.data.error);
        return;
      } else if (latestTokenBySlot.get(job.slot) === job.token) {
        try {
          writeEncodedSave(job, COMPRESSED_PREFIX + event.data.packed);
          pendingJsonBySlot.delete(job.slot);
          pendingJobsBySlot.delete(job.slot);
        } catch (error) {
          recoverFromWorkerFailure(error);
          return;
        }
      }
      startNextWorkerJob();
    };
    saveWorker.onerror = (event) => {
      recoverFromWorkerFailure(event.message || "save worker failed");
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
  const json = stringifyWorldForSave(world);
  const job = {
    token: ++saveToken,
    slot,
    json,
    meta: metaFromWorld(world),
  };
  latestTokenBySlot.set(slot, job.token);
  pendingJsonBySlot.set(slot, json);
  pendingJobsBySlot.set(slot, job);
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

function metaFromWorld(world, savedAt = Date.now()) {
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
    savedAt,
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
    meta[1] = metaFromWorld(world, 0);
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
  let sessionValue = null;
  try {
    sessionValue = sessionStorage.getItem(ACTIVE_SESSION_KEY);
  } catch (_) {
    /* non-browser test environment */
  }
  const n = parseInt(sessionValue || localStorage.getItem(ACTIVE_KEY) || "1", 10);
  if (n >= 1 && n <= SLOT_COUNT) return n;
  return 1;
}

export function setActiveSlot(slot) {
  const n = Math.trunc(Number(slot));
  const s = Number.isFinite(n)
    ? Math.max(1, Math.min(SLOT_COUNT, n))
    : 1;
  localStorage.setItem(ACTIVE_KEY, String(s));
  try {
    sessionStorage.setItem(ACTIVE_SESSION_KEY, String(s));
  } catch (_) {
    /* non-browser test environment */
  }
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
    const durable = durableSlots.has(i);
    let info = meta[i] || null;
    if (raw && !info) {
      try {
        info = metaFromWorld(pending ? JSON.parse(pending) : decodeWorld(raw), 0);
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
      empty: !raw && !durable,
      ...info,
    });
  }
  return out;
}

export function hasAnySave() {
  migrateKeyNames();
  migrateLegacySave();
  for (let i = 1; i <= SLOT_COUNT; i++) {
    if (pendingJsonBySlot.has(i) || durableSlots.has(i) || localStorage.getItem(slotKey(i))) return true;
  }
  return !!localStorage.getItem(LEGACY_KEY);
}

export function hasSave(slot = null) {
  migrateKeyNames();
  migrateLegacySave();
  if (slot == null) {
    return pendingJsonBySlot.has(getActiveSlot()) || durableSlots.has(getActiveSlot()) || !!localStorage.getItem(slotKey(getActiveSlot())) || !!localStorage.getItem(LEGACY_KEY);
  }
  return pendingJsonBySlot.has(Number(slot)) || durableSlots.has(Number(slot)) || !!localStorage.getItem(slotKey(slot));
}

/** 仅允许 1..SLOT_COUNT；非法值回落到活动槽或 1，避免写出 vcfm_slot_0 等孤儿键 */
function resolveSlot(slot) {
  if (slot == null || slot === "") return getActiveSlot();
  const n = Math.trunc(Number(slot));
  if (!Number.isFinite(n)) return getActiveSlot();
  return Math.max(1, Math.min(SLOT_COUNT, n));
}

export function saveGame(world, slot = null, { immediate = false } = {}) {
  try {
    migrateKeyNames();
    const s = resolveSlot(slot);
    if (queueDurableSave(world, s)) {
      setActiveSlot(s);
      return true;
    }
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
    pendingJobsBySlot.delete(s);
    queuedJobs.delete(s);
    latestTokenBySlot.set(s, ++saveToken);
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function loadGame(slot = null) {
  try {
    await initializeSaveStorage();
    migrateKeyNames();
    migrateLegacySave();
    const s = resolveSlot(slot);
    const pending = pendingJsonBySlot.get(s);
    if (pending) {
      setActiveSlot(s);
      return JSON.parse(pending);
    }
    if (saveDb && durableSlots.has(s)) {
      const record = await durableRecord(s);
      if (record?.json) {
        setActiveSlot(s);
        return JSON.parse(record.json);
      }
    }
    let raw = localStorage.getItem(slotKey(s));
    if (!raw && s === 1) raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    setActiveSlot(s);
    return decodeWorld(raw);
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
    pendingJobsBySlot.delete(s);
    queuedJobs.delete(s);
    queuedDurableJobs.delete(s);
    durableSlots.delete(s);
    deletedDurableSlots.add(s);
    latestTokenBySlot.set(s, ++saveToken);
    if (saveDb) deleteDurableRecord(s).catch(emitSaveError);
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
    const blob = new Blob([stringifyWorldForSave(world)], { type: "application/json" });
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
  return validateSaveStructure(data);
}

try {
  const flushBeforeExit = () => {
    flushPendingSaves({ reportError: false });
  };
  window.addEventListener("pagehide", flushBeforeExit);
  window.addEventListener("beforeunload", flushBeforeExit);
} catch (_) {
  /* non-browser test environment */
}
