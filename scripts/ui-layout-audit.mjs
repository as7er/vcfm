import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(resolve(repo, file), "utf8");
const html = read("index.html");
const main = read("js/main.js");
const css = read("css/style.css");
const i18n = read("js/i18n.js");
const workbench = read("js/ui/manager-workbench.js");

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "HTML ids must be unique after dashboard reflow");

const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]);
assert.equal(tabs.length, 16, "all existing game pages must remain reachable");
for (const tab of tabs) {
  if (tab !== "table") assert.ok(html.includes(`id="tab-${tab}"`), `missing panel for ${tab}`);
  assert.ok(main.includes(`"${tab}"`), `navigation groups must include ${tab}`);
}

assert.equal((html.match(/data-nav-group=/g) || []).length, 5, "five primary navigation groups required");
assert.ok(html.includes('data-squad-view="compact"'));
assert.ok(html.includes('data-squad-view="full"'));
assert.ok(main.includes("squadTableView"));
assert.doesNotMatch(main, /(?<!\$)\$\(\"\.(?:primary-tab|tab|tab-panel)\"\)\.forEach/, "navigation loops must use the multi-element selector");
assert.ok(css.includes("#squad-table.squad-compact .squad-detail"));
assert.ok(css.includes(".dashboard-layout"));
assert.ok(html.includes('id="dashboard-priorities"'), "manager workbench priority region required");
assert.ok(html.includes('id="dashboard-onboarding"'), "first-week onboarding region required");
assert.ok(html.includes('id="dashboard-quick-actions"'), "manager workbench quick actions required");
assert.ok(html.includes('id="dashboard-advance-summary"'), "calendar change summary required");
assert.ok(main.includes("collectDashboardWorkbench"), "dashboard must derive priorities from live world state");
assert.ok(main.includes("managerOnboardingView"), "dashboard must derive onboarding from save state");
assert.ok(main.includes("captureAdvanceSnapshot") && main.includes("buildAdvanceDigest"), "calendar advancement must compare before/after state");
assert.ok(main.includes('closest("[data-dashboard-link]")'), "workbench links must use delegated tab navigation");
assert.ok(workbench.includes("renderManagerWorkbench"));
assert.ok(workbench.includes('focus.title || (en ? "No focus yet" : "暂无重点")'), "focus title must not be swallowed by ternary precedence");
assert.ok(workbench.includes("const list = sorted.slice(1, 5)"), "priority list must not repeat the enlarged focus item");
assert.ok(html.includes('id="calendar-advance-status"'), "calendar advancement needs an accessible live status");
assert.ok(main.includes('setAttribute("aria-current", active ? "page" : "false")'), "navigation must expose its current page");
assert.ok(css.includes(".dashboard-priority-item") && css.includes(".dashboard-advance-summary"));
assert.ok(css.includes(".finance-layout"));
assert.ok(css.includes(".btn:focus-visible"));
assert.ok(css.includes("min-height: 100dvh"), "mobile modals should use the viewport");
assert.match(css, /html\[data-theme="light"\] \.staff-diff-tag\.elite \{[^}]*color: #9a3412;/s, "elite-club staff tags need high-contrast light-theme text");
assert.match(css, /html\[data-theme="light"\] \.staff-diff-tag\.star \{[^}]*color: #166534;/s, "top-rated staff tags must remain distinct and readable in the light theme");

// 赛季快照「联赛排名」摘要（#my-rank）是一行**密集信息**
// （「联赛 第 N 名 · 积分 · 战绩 · 升降级」），不是标题。
// 它曾经用 `--fs-4xl`（22px，页面标题级）⇒ 窄栏里折成 3~5 行，看起来像坏了。
// 这里锁死它是正文级字号 + 有行高：任何人再把它调回 `--fs-4xl` 都会红。
{
  const rankBlock = css.match(/\.rank-box \{[^}]*\}/s);
  assert.ok(rankBlock, ".rank-box must be defined");
  assert.match(rankBlock[0], /font-size: var\(--fs-base\)/, "#my-rank summary must use body-scale type, not a page-title size");
  assert.doesNotMatch(rankBlock[0], /font-size: var\(--fs-4xl\)/, "#my-rank must not regress to the 22px page-title size");
  assert.match(rankBlock[0], /line-height:\s*1\.5/, "#my-rank needs an explicit line-height so wrapping stays even");
  assert.ok(html.includes('id="my-rank"'), "#my-rank must stay in the snapshot card");
}

// 赛季快照「近期战绩」标题下的容器一直是空的（自 f1bbd46 起无人写入，
// 详见 docs/overview-snapshot-typography-2026-09-19.md）。要么补渲染，要么删元素；
// 不允许留一个「有标题、无内容」的空白块而不被注意到。
// ⚠ 若将来补回了渲染逻辑（会写 `$("#form-strip").innerHTML`），把这条换成
//   「必须有写入点」的正向断言即可。
assert.ok(
  html.includes('id="form-strip"') && !main.includes('#form-strip'),
  "if #form-strip has no renderer in js/main.js it is dead content; either wire it up or remove the block"
);

for (const key of [
  "nav.overview", "nav.team", "nav.matches", "nav.transfer", "nav.world",
  "squad.compact", "squad.full", "dash.workbenchEyebrow", "dash.todayPriorities",
  "dash.quickActions", "dash.advanceChanges", "dash.ready",
]) {
  assert.equal((i18n.match(new RegExp(`"${key.replace(".", "\\.")}"`, "g")) || []).length, 2, `${key} must exist in both languages`);
}

console.log(`UI layout audit passed: ${ids.length} unique IDs, ${tabs.length} pages, 5 navigation groups`);
