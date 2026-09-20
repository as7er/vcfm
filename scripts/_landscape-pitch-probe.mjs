/**
 * 横向球场渲染层探针：隔离挂载 MatchView，量用户看见的层。
 *
 * 证人形状 = 中圈渲染宽高比 ≈ 1.0。
 * 方位证人 = 球门在左右、看台在上下、viewBox 0 0 150 100。
 *
 * 用法：node scripts/_landscape-pitch-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8927;
const baseUrl = `http://127.0.0.1:${port}/`;
const out = join(root, ".tmp-continuity", `landscape-pitch-${Date.now()}`);
mkdirSync(out, { recursive: true });

const VIEWPORTS = [
  { label: "phone", width: 390, height: 844 },
  { label: "desktop", width: 1440, height: 1000 },
];

const SETUP = `
(async () => {
  const mod = await import("./js/matchview.js?v=273");
  document.body.innerHTML = "";
  document.documentElement.style.height = "100%";
  document.body.style.margin = "0";
  document.body.style.height = "100%";
  document.body.style.background = "#0b1220";
  // 生产外壳：index.html 恒带 .fmm-match，开赛后加 .live-kick。
  // 不套这层会落到 .mp-field 的 max-height:560px 死规则上，桌面盒比会被拉扁。
  const shell = document.createElement("div");
  shell.className = "match-layout fm-match fmm-match live-kick";
  shell.innerHTML = '<div class="fm-match-body fmm-match-body"><div class="fm-pitch-col"><div id="match-pitch-root" class="match-pitch-root"></div></div></div>';
  document.body.appendChild(shell);
  const host = shell.querySelector("#match-pitch-root");
  const view = new mod.MatchView(host);
  const mkClub = (id, name, color) => {
    const players = [];
    for (let i = 0; i < 11; i++) {
      players.push({
        id: id + "-p" + i,
        name: name + " 球员" + i,
        number: i + 1,
        pos: i === 0 ? "GK" : i < 5 ? "DEF" : i < 9 ? "MID" : "FWD",
        nationality: "CN",
        ovr: 70,
      });
    }
    return {
      id, name, color, players,
      tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) },
    };
  };
  view.mount(mkClub("h", "主队", "#3d8bfd"), mkClub("a", "客队", "#f87171"), {});
  window.__view = view;
  return { count: view.players.length, cw: view._cw, ch: view._ch };
})()
`;

function measure() {
  const field = document.querySelector("#mp-field");
  const cam = document.querySelector("#mp-camera");
  const canvas = document.querySelector("#mp-canvas");
  const svg = document.querySelector(".mp-lines");
  const circle = document.querySelector(".mp-lines ellipse");
  const leftGoal = document.querySelector(".mp-goal-mouth.left");
  const rightGoal = document.querySelector(".mp-goal-mouth.right");
  const topStand = document.querySelector(".mp-stands.top");
  const botStand = document.querySelector(".mp-stands.bot");
  const homeLabel = document.querySelector(".mp-end-home");
  const awayLabel = document.querySelector(".mp-end-away");
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, aspect: r.height ? r.width / r.height : null };
  };
  const fieldBox = box(field);
  const camBox = box(cam);
  const circleBox = box(circle);
  const chain = [];
  let n = field;
  while (n && n !== document.body && chain.length < 10) {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    chain.push({
      el: (n.id ? "#" + n.id : "") + "." + [...n.classList].join(".") || n.tagName,
      w: Math.round(r.width),
      h: Math.round(r.height),
      display: cs.display,
      flex: cs.flex,
      height: cs.height,
      maxH: cs.maxHeight,
      minH: cs.minHeight,
      ar: cs.aspectRatio,
      cq: cs.containerType,
    });
    n = n.parentElement;
  }
  return {
    field: fieldBox,
    slot: box(document.querySelector(".mp-pitch-slot")),
    wrap: box(document.querySelector(".mp-wrap")),
    chain,
    camera: camBox,
    canvas: canvas ? { css: box(canvas), backing: { w: canvas.width, h: canvas.height } } : null,
    viewBox: svg?.getAttribute("viewBox") || null,
    circle: circleBox,
    circleWOverH: circleBox && circleBox.h ? circleBox.w / circleBox.h : null,
    goals: {
      left: leftGoal ? box(leftGoal) : null,
      right: rightGoal ? box(rightGoal) : null,
    },
    stands: {
      top: topStand ? box(topStand) : null,
      bot: botStand ? box(botStand) : null,
    },
    labels: {
      home: homeLabel ? box(homeLabel) : null,
      away: awayLabel ? box(awayLabel) : null,
    },
    leftoverVerticalGoals: !!document.querySelector(".mp-goal-mouth.top, .mp-goal-mouth.bot"),
    leftoverSideStands: !!document.querySelector(".mp-stands.left, .mp-stands.right"),
  };
}

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root,
  stdio: "ignore",
  windowsHide: true,
});

const TARGET_FIELD = 93.45 / 68;
const TARGET_PITCH = 105 / 68;
const problems = [];

try {
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { ready = (await fetch(baseUrl)).ok; } catch {}
    if (!ready) await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw new Error("preview server did not start");

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "serviceWorker", {
          value: {
            register: () => Promise.resolve({}),
            addEventListener: () => {},
            controller: null,
            ready: new Promise(() => {}),
          },
          configurable: true,
        });
      } catch {}
      try { window.location.reload = () => {}; } catch {}
    });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    let setup;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        setup = await page.evaluate(SETUP);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        await page.waitForTimeout(400);
        await page.reload({ waitUntil: "domcontentloaded" });
      }
    }
    if (lastErr) throw lastErr;
    await page.waitForTimeout(200);
    const data = await page.evaluate(measure);
    try {
      await page.locator("#mp-field").screenshot({ path: join(out, `${vp.label}-field.png`) });
    } catch (err) {
      console.log(`  field screenshot failed: ${err.message}`);
    }
    await page.screenshot({ path: join(out, `${vp.label}-page.png`), fullPage: true });
    await context.close();

    const round = (n) => (n == null ? null : Number(n.toFixed(4)));
    console.log(`\n== ${vp.label} ${vp.width}x${vp.height} ==`);
    console.log(`  players=${setup.count} canvas=${setup.cw}x${setup.ch}`);
    console.log(`  field ${Math.round(data.field?.w)}x${Math.round(data.field?.h)} aspect=${round(data.field?.aspect)} target=${round(TARGET_FIELD)}`);
    console.log(`  slot ${Math.round(data.slot?.w)}x${Math.round(data.slot?.h)} wrap ${Math.round(data.wrap?.w)}x${Math.round(data.wrap?.h)}`);
    console.log(`  camera ${Math.round(data.camera?.w)}x${Math.round(data.camera?.h)} aspect=${round(data.camera?.aspect)} target=${round(TARGET_PITCH)}`);
    if ((data.field?.h || 0) < 40) {
      for (const c of data.chain || []) {
        console.log(`    chain ${c.el} ${c.w}x${c.h} display=${c.display} flex=${c.flex} h=${c.height} maxH=${c.maxH} cq=${c.cq}`);
      }
    }
    console.log(`  viewBox=${data.viewBox}`);
    console.log(`  circle w/h=${round(data.circleWOverH)} size=${data.circle ? `${data.circle.w.toFixed(1)}x${data.circle.h.toFixed(1)}` : "missing"}`);
    console.log(`  leftGoal=${data.goals.left ? `${Math.round(data.goals.left.x)},${Math.round(data.goals.left.y)} ${Math.round(data.goals.left.w)}x${Math.round(data.goals.left.h)}` : "missing"}`);
    console.log(`  rightGoal=${data.goals.right ? `${Math.round(data.goals.right.x)},${Math.round(data.goals.right.y)} ${Math.round(data.goals.right.w)}x${Math.round(data.goals.right.h)}` : "missing"}`);
    console.log(`  topStand=${data.stands.top ? `${Math.round(data.stands.top.w)}x${Math.round(data.stands.top.h)}` : "missing"}`);
    console.log(`  botStand=${data.stands.bot ? `${Math.round(data.stands.bot.w)}x${Math.round(data.stands.bot.h)}` : "missing"}`);
    if (data.labels.home && data.labels.away) {
      console.log(`  homeLabel.x=${Math.round(data.labels.home.x)} awayLabel.x=${Math.round(data.labels.away.x)}`);
    }

    if (data.viewBox !== "0 0 150 100") problems.push(`${vp.label}: viewBox ${data.viewBox}`);
    if (!data.field?.aspect || Math.abs(data.field.aspect - TARGET_FIELD) > 0.04) {
      problems.push(`${vp.label}: field aspect ${round(data.field?.aspect)} ≠ ${round(TARGET_FIELD)}`);
    }
    if (!data.camera?.aspect || Math.abs(data.camera.aspect - TARGET_PITCH) > 0.04) {
      problems.push(`${vp.label}: camera aspect ${round(data.camera?.aspect)} ≠ ${round(TARGET_PITCH)}`);
    }
    if (!data.circleWOverH || Math.abs(data.circleWOverH - 1) > 0.04) {
      problems.push(`${vp.label}: centre circle w/h ${round(data.circleWOverH)} ≠ 1`);
    }
    if (!data.goals.left || !data.goals.right) problems.push(`${vp.label}: missing left/right goal mouths`);
    if (data.goals.left && data.goals.right && data.goals.left.x >= data.goals.right.x) {
      problems.push(`${vp.label}: left goal is not to the left of right goal`);
    }
    if (data.goals.left && data.goals.left.w > data.goals.left.h) {
      problems.push(`${vp.label}: left goal still looks like a horizontal mouth`);
    }
    if (!data.stands.top || !data.stands.bot) problems.push(`${vp.label}: missing top/bot stands`);
    if (data.leftoverVerticalGoals) problems.push(`${vp.label}: leftover .mp-goal-mouth.top/.bot`);
    if (data.leftoverSideStands) problems.push(`${vp.label}: leftover .mp-stands.left/.right`);
    if (data.labels.home && data.labels.away && data.labels.home.x >= data.labels.away.x) {
      problems.push(`${vp.label}: home label is not left of away label`);
    }
  }
  await browser.close();
} finally {
  server.kill();
}

console.log(`\nshots: ${out}`);
if (problems.length) {
  console.log("PROBLEMS:");
  for (const p of problems) console.log(" - " + p);
  process.exit(1);
}
console.log("OK landscape pitch geometry");
