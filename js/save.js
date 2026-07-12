/** 本地存档：localStorage + 导出/导入文件 */

const KEY = "vc_fm_save_v1";

export function saveGame(world) {
  try {
    localStorage.setItem(KEY, JSON.stringify(world));
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error(e);
    return null;
  }
}

export function hasSave() {
  return !!localStorage.getItem(KEY);
}

export function clearSave() {
  localStorage.removeItem(KEY);
}

/** 下载 JSON 存档文件 */
export function exportSaveDownload(world) {
  if (!world) return false;
  try {
    const blob = new Blob([JSON.stringify(world)], { type: "application/json" });
    const a = document.createElement("a");
    const club = world.userClubId || "club";
    a.href = URL.createObjectURL(blob);
    a.download = `vc_fm_${world.season || "s"}_D${world.day || 0}_${club}.json`;
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
