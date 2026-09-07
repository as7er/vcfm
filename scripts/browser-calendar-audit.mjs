import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.VCFM_BASE_URL || "http://127.0.0.1:8765";
let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  // Hold the real worker response so input can be checked during an advance.
  await context.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.calendarAudit = options?.name === "vcfm-calendar";
      }
      set onmessage(handler) {
        super.onmessage = (event) => {
          if (this.calendarAudit && event.data?.ok) {
            window.releaseCalendarAudit = () => handler.call(this, event);
          } else handler.call(this, event);
        };
      }
    };
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?menu=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.vcfmMainApi);
  await page.fill("#input-manager", "Calendar Audit");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 90000 });
  await page.click('[data-nav-group="team"]');
  await page.click('[data-tab="tactics"]');
  const before = await page.locator("#formation-select").inputValue();
  const desired = before === "4-4-2" ? "4-3-3" : "4-4-2";
  const slot = page.locator('.tac-slot[draggable="true"]').first();
  const bounds = await slot.boundingBox();
  assert.ok(bounds, "tactics must expose a draggable player before advancing");
  await page.click("#btn-topbar-continue");
  await page.waitForFunction(() => !!window.releaseCalendarAudit, null, { timeout: 150000 });
  assert.equal(await page.locator("#formation-select").isEnabled(), false);
  const locked = await slot.evaluate((element) => ({
    inert: !!element.closest("[inert]"), busy: document.querySelector("#screen-main").getAttribute("aria-busy"),
  }));
  assert.deepEqual(locked, { inert: true, busy: "true" }, "drag surfaces must be locked along with form controls");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  assert.equal(await page.locator("#modal").isVisible(), false, "locked player clicks must not open an editor");
  await page.evaluate(() => window.releaseCalendarAudit());
  await page.waitForFunction(() => !document.querySelector("#screen-main").inert);
  assert.equal(await page.locator("#formation-select").inputValue(), before);
  await page.selectOption("#formation-select", desired);
  const after = await page.evaluate(async () => {
    const save = await import("/js/save.js");
    await save.waitForPendingSaves();
    const world = await save.loadGame();
    return {
      formation: world.clubs.find((club) => club.id === world.userClubId).tactics.formation,
      displayed: document.querySelector("#formation-select").value,
      day: world.day,
      busy: document.querySelector("#screen-main").getAttribute("aria-busy"),
    };
  });
  assert.equal(after.day, 2);
  assert.equal(after.formation, desired, "tactical edits must persist after the calendar unlocks");
  assert.equal(after.displayed, desired);
  assert.equal(after.busy, "false");
  console.log(JSON.stringify({ before, locked, after }, null, 2));
  console.log("Browser calendar audit passed");
} finally {
  await browser?.close();
}
