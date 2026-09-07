import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.VCFM_BASE_URL || "http://127.0.0.1:8765";
let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/__save_audit__`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("vcfm-saves");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("save database deletion was blocked"));
    });
    const [{ CLUB_TEMPLATES, START_DIVISIONS }, { createWorld }, { compressToUTF16 }] = await Promise.all([
      import("/js/data.js"),
      import("/js/models.js"),
      import("/js/compress.js"),
    ]);
    const start = CLUB_TEMPLATES.find((club) => START_DIVISIONS.includes(club.division));
    const world = createWorld(start.id, "Legacy Migration Audit");
    world.day = 11;
    localStorage.setItem("vc_fm_slot_1", `VCFMZ1:${compressToUTF16(JSON.stringify(world))}`);
    localStorage.setItem("vc_fm_active_slot", "1");
  });

  await page.goto(`${baseUrl}/?menu=1`, { waitUntil: "networkidle" });
  const migrated = await page.evaluate(async () => {
    const save = await import("/js/save.js");
    const world = await save.loadGame(1);
    return {
      day: world?.day,
      hasSave: save.hasSave(1),
      oldPresent: localStorage.getItem("vc_fm_slot_1") != null,
      newPresent: localStorage.getItem("vcfm_slot_1") != null,
    };
  });
  assert.equal(migrated.day, 11);
  assert.equal(migrated.hasSave, true);
  assert.equal(migrated.oldPresent, false, "successful durable migration must remove the old large key");
  assert.equal(migrated.newPresent, false, "durable slots must not remain duplicated in localStorage");

  const saved = await page.evaluate(async () => {
    const [{ CLUB_TEMPLATES, START_DIVISIONS }, { createWorld }, onboarding, save, serialization] = await Promise.all([
      import("/js/data.js"),
      import("/js/models.js"),
      import("/js/manager-onboarding.js"),
      import("/js/save.js"),
      import("/js/save-serialization.js"),
    ]);
    const start = CLUB_TEMPLATES.find((club) => START_DIVISIONS.includes(club.division));
    const world = createWorld(start.id, "Durable Queue Audit");
    onboarding.ensureManagerOnboarding(world);
    onboarding.completeManagerOnboardingStep(world, "squad");
    const player = world.clubs[0].players[0];
    player.playingTime = {
      role: "squad",
      history: [{ key: "fixture", season: world.season, day: 2, competitionType: "league", started: true, appeared: true, available: true, minutes: 90 }],
    };
    world.clubs[0].squadPlan = { derived: true, payload: "x".repeat(1000) };
    world.day = 20;
    save.saveGame(world, 2);
    world.day = 21;
    save.saveGame(world, 2);
    const slotThree = structuredClone(world);
    slotThree.managerName = "Isolated Slot Audit";
    slotThree.day = 30;
    save.saveGame(slotThree, 3);
    await save.waitForPendingSaves();
    const json = serialization.stringifyWorldForSave(world);
    const imported = save.importSaveText(json);
    const slotTwo = await save.loadGame(2);
    const slotThreeLoaded = await save.loadGame(3);
    const slots = save.listSlots();
    return {
      loadedDay: slotTwo?.day,
      slotThreeDay: slotThreeLoaded?.day,
      slotThreeManager: slotThreeLoaded?.managerName,
      slotDays: slots.map((slot) => ({ slot: slot.slot, day: slot.day ?? null, empty: slot.empty })),
      localRaw: localStorage.getItem("vcfm_slot_2"),
      compactHistory: JSON.parse(json).clubs[0].players[0].playingTime.history[0],
      containsSquadPlan: json.includes("squadPlan"),
      importedDay: imported.day,
      importedOnboarding: imported.managerOnboarding,
      savedOnboarding: slotTwo?.managerOnboarding,
    };
  });
  assert.equal(saved.loadedDay, 21, "a coalesced save queue must expose its newest snapshot");
  assert.equal(saved.slotThreeDay, 30, "a second slot must retain its own snapshot");
  assert.equal(saved.slotThreeManager, "Isolated Slot Audit", "slot data must not bleed across saves");
  assert.equal(saved.slotDays.find((slot) => slot.slot === 2)?.day, 21);
  assert.equal(saved.slotDays.find((slot) => slot.slot === 3)?.day, 30);
  assert.equal(saved.localRaw, null);
  assert.ok(Array.isArray(saved.compactHistory), "playing-time history must use the compact save format");
  assert.equal(saved.containsSquadPlan, false, "derived squad plans must not inflate saves");
  assert.equal(saved.importedDay, 21, "compact exports must pass structural import validation");
  assert.equal(saved.savedOnboarding?.steps?.squad, true, "durable saves must retain onboarding progress");
  assert.equal(saved.importedOnboarding?.steps?.squad, true, "export/import must retain onboarding progress");

  await page.reload({ waitUntil: "networkidle" });
  const reloaded = await page.evaluate(async () => {
    const save = await import("/js/save.js");
    const world = await save.loadGame(2);
    const otherSlot = await save.loadGame(3);
    save.clearSave(2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      day: world?.day,
      onboardingStep: world?.managerOnboarding?.steps?.squad === true,
      otherSlotDay: otherSlot?.day,
      hasAfterClear: save.hasSave(2),
      otherSlotAfterClear: (await save.loadGame(3))?.day,
    };
  });
  assert.equal(reloaded.day, 21, "the newest durable snapshot must survive a reload");
  assert.equal(reloaded.onboardingStep, true, "onboarding progress must survive a reload");
  assert.equal(reloaded.otherSlotDay, 30, "the other slot must survive a reload");
  assert.equal(reloaded.hasAfterClear, false);
  assert.equal(reloaded.otherSlotAfterClear, 30, "clearing one slot must not remove another slot");

  await page.evaluate(async () => {
    const save = await import("/js/save.js");
    window.slotOneWorld = await save.loadGame(1);
  });
  const otherTab = await context.newPage();
  await otherTab.goto(`${baseUrl}/__save_audit__`);
  await otherTab.evaluate(async () => (await import("/js/save.js")).loadGame(3));
  const crossTab = await page.evaluate(async () => {
    const save = await import("/js/save.js");
    const active = save.getActiveSlot();
    window.slotOneWorld.day = 12;
    save.saveGame(window.slotOneWorld);
    await save.waitForPendingSaves();
    return { active, first: (await save.loadGame(1)).day, third: (await save.loadGame(3)).day };
  });
  assert.deepEqual(crossTab, { active: 1, first: 12, third: 30 },
    "another tab's selection must not redirect an autosave into its career");
  await otherTab.reload();
  assert.equal(await otherTab.evaluate(async () => (await import("/js/save.js")).getActiveSlot()), 3,
    "a reloaded tab must retain its selected slot");
  await otherTab.close();

  const recoveryResults = [];
  const cases = [
    { name: "newer fallback", localDay: 9, localTime: 200, durableDay: 5, durableTime: 100, expectedDay: 9 },
    { name: "stale fallback", localDay: 9, localTime: 100, durableDay: 12, durableTime: 200, expectedDay: 12 },
    { name: "timestamp tie", localDay: 9, localTime: 100, durableDay: 5, durableTime: 100, expectedDay: 9 },
    { name: "missing metadata", localDay: 3, durableDay: 12, durableTime: 200, expectedDay: 12 },
    { name: "newer undated fallback", localDay: 16, durableDay: 12, durableTime: 200, expectedDay: 16 },
    { name: "old single-key save", localDay: 3, legacy: true, durableDay: 12, durableTime: 200, expectedDay: 12 },
    { name: "damaged fallback", corrupt: true, durableDay: 12, durableTime: 200, expectedDay: 12 },
  ];
  for (const scenario of cases) {
    const recovery = await browser.newContext({ serviceWorkers: "block" });
    try {
      const recoveryPage = await recovery.newPage();
      await recoveryPage.goto(`${baseUrl}/__save_audit__`);
      const result = await recoveryPage.evaluate(async (scenario) => {
        const world = (day) => ({ season: 2026, day, managerName: "Recovery", clubs: [] });
        const durableWorld = world(scenario.durableDay);
        const localWorld = world(scenario.localDay);
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open("vcfm-saves", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("slots", { keyPath: "slot" });
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const transaction = db.transaction("slots", "readwrite");
          transaction.objectStore("slots").put({
            slot: 1, json: JSON.stringify(durableWorld),
            meta: { season: 2026, day: scenario.durableDay, savedAt: scenario.durableTime },
          });
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
        db.close();
        localStorage.setItem(scenario.legacy ? "vcfm_save_v1" : "vcfm_slot_1",
          scenario.corrupt ? "{broken" : JSON.stringify(localWorld));
        if (scenario.localTime != null) {
          localStorage.setItem("vcfm_slots_meta", JSON.stringify({
            1: { season: 2026, day: scenario.localDay, savedAt: scenario.localTime },
          }));
        }
        const save = await import("/js/save.js");
        const loaded = await save.loadGame(1);
        return { day: loaded?.day, metadataDay: save.listSlots()[0]?.day,
          fallbackPresent: localStorage.getItem("vcfm_slot_1") != null };
      }, scenario);
      assert.equal(result.day, scenario.expectedDay, `${scenario.name}: recovery selected the wrong snapshot`);
      assert.equal(result.metadataDay, scenario.expectedDay, `${scenario.name}: slot metadata must describe the loaded snapshot`);
      assert.equal(result.fallbackPresent, false, `${scenario.name}: reconciled fallback must be removed`);
      recoveryResults.push({ name: scenario.name, ...result });
    } finally {
      await recovery.close();
    }
  }

  const offline = await browser.newContext();
  let cacheScope;
  try {
    const offlinePage = await offline.newPage();
    await offlinePage.goto(`${baseUrl}/__save_audit__`);
    const foreignCaches = ["unrelated-project-v1", "vcfm-export-backup", "vcfm-v1-preview"];
    await offlinePage.evaluate(async (names) => {
      for (const name of [...names, "vcfm-v1"]) await caches.open(name);
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    }, foreignCaches);
    await offlinePage.waitForFunction(() => !!navigator.serviceWorker.controller);
    const afterActivation = await offlinePage.evaluate(() => caches.keys());
    for (const name of foreignCaches) assert.ok(afterActivation.includes(name), `activation removed ${name}`);
    assert.ok(!afterActivation.includes("vcfm-v1"), "activation must remove old game versions");
    await offlinePage.goto(`${baseUrl}/?menu=1`, { waitUntil: "networkidle" });
    await offlinePage.waitForFunction(() => !!window.vcfmMainApi);
    const afterBoot = await offlinePage.evaluate(() => caches.keys());
    for (const name of foreignCaches) assert.ok(afterBoot.includes(name), `page startup removed ${name}`);
    await offline.setOffline(true);
    await offlinePage.reload({ waitUntil: "networkidle" });
    await offlinePage.waitForFunction(() => !!window.vcfmMainApi);
    await offlinePage.evaluate(() => navigator.serviceWorker.controller.postMessage({ type: "CLEAR_ALL_CACHES" }));
    await offlinePage.waitForFunction(async () => !(await caches.keys()).some((name) => /^vcfm-v\d+$/.test(name)));
    const afterClear = await offlinePage.evaluate(() => caches.keys());
    assert.deepEqual(afterClear.sort(), foreignCaches.sort(), "explicit clearing must preserve other applications' caches");
    cacheScope = { offlineBoot: true, preserved: afterClear };
  } finally {
    await offline.close();
  }

  console.log(JSON.stringify({ migrated, saved, reloaded, crossTab, recoveryResults, cacheScope }, null, 2));
} finally {
  await browser?.close();
}
