/**
 * 「死球摆位 / 中场回归阵型」到底缓动了没有？（2026-09-22，用户点名两类）
 *
 * 用户报的两个复现：
 *   ① 开角球的时候，球员还是会**瞬移到目标站位**
 *   ② 中场暂停回归阵容站位的时候也是瞬移
 *
 * 已知（读代码）：
 *   · 引擎 `_restart()` 对球员是**直接写 `a.x/a.y`**（`engine.js:7882~7928`
 *     角球按 `attackBoxX/Y`、`defendBoxX/Y` 分槽硬置）—— 引擎侧就是瞬移。
 *   · 画面是否瞬移，取决于 `matchview.applySimSnapshot` 的 `relocate()` 能不能武装：
 *         `adjacent && restartFrame && !entity._relocAt && (距离 > 门槛 || followOwner)`
 *     其中 `restartFrame = sim.ball?.restartType || sim.motionContext?.discontinuity`，
 *     球员的 `followOwner` 传的是 **true** ⇒ 距离门槛被绕过，只差 `adjacent` 与 `_relocAt`。
 *   · `_relocAt` 在 `sceneCut` 时被显式清零（`entity._relocAt = 0`）。
 *
 * 所以本探针只回答一个问题：**每一个 >6m 的位移帧，落在哪一档？**
 *   A. `sceneCut`（段首）—— 按设计就是剪辑，由 260ms 淡场遮住
 *   B. `adjacent && restartFrame` 却仍然大位移 —— **缓动该武装没武装**，是 bug
 *   C. 两者都不是 —— 另一条没被识别的路径
 *
 * 用法：node scripts/_restart-placement-probe.mjs [秒数=180]
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const seconds = Math.max(60, Number(process.argv[2]) || 180);
const port = 8941;
const baseUrl = `http://127.0.0.1:${port}/`;
const OUT = ".tmp-restart-placement";
mkdirSync(OUT, { recursive: true });

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: process.cwd(),
  stdio: "ignore",
  windowsHide: true,
});
process.on("exit", () => server.kill());

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("static server did not come up");
}

async function closeModalIfAny(page) {
  const closed = await page
    .evaluate(() => {
      const m = document.querySelector("#modal");
      if (!m) return false;
      const cs = getComputedStyle(m);
      if (cs.display === "none" || cs.visibility === "hidden" || m.classList.contains("hidden")) {
        return false;
      }
      const btn =
        m.querySelector("#modal-close, [data-close], .modal-close, .modal-x, button.close") ||
        [...m.querySelectorAll("button")].find((b) => /关闭|确定|继续|知道了|OK|×/i.test(b.text()));
      if (btn) {
        btn.click();
        return true;
      }
      m.click();
      return true;
    })
    .catch(() => false);
  if (closed) await page.waitForTimeout(400);
  return closed;
}

/**
 * 包住 `applySimSnapshot`，对**每一个 >6m 的位移帧**记录完整上下文。
 * 判据与 `matchview` 内部逐字一致（`sceneCut` / `adjacent` 的公式照抄）。
 */
const INSTALL = ({ ms, mx, my }) => {
  const mv = window.vcfmMainApi?.matchView;
  const st = { frames: 0, big: [], cornerLike: [], restarts: 0, until: performance.now() + ms, done: false, notes: [],
    easingSamples: 0, easingFrames: 0, easingSum: 0, calmFrames: 0, calmEasingFrames: 0, calmEasingSum: 0 };
  window.__rp = st;
  if (!mv) {
    st.notes.push("no matchView");
    return;
  }

  const snap = () => {
    const out = { players: [], ball: null, officials: [] };
    for (const p of mv.players || []) out.players.push({ id: p.id, team: p.team, x: p.x, y: p.y });
    if (mv.ball) out.ball = { x: mv.ball.x, y: mv.ball.y };
    const o = mv.officials || {};
    for (const k of ["referee", "assistantA", "assistantB"]) {
      if (o[k]) out.officials.push({ key: k, x: o[k].x, y: o[k].y });
    }
    return out;
  };
  const disp = (a, b) => Math.hypot((b.x - a.x) * mx, (b.y - a.y) * my);

  const fadeOpacity = () => {
    try {
      return parseFloat(getComputedStyle(document.querySelector(".mp-field"), "::before").opacity);
    } catch {
      return null;
    }
  };

  const orig = mv.applySimSnapshot.bind(mv);
  mv.applySimSnapshot = function patched(sim, opts = {}) {
    const before = snap();
    const lastSimT = mv._relocLastSimT;
    const simT = Number(sim?.t);
    const sceneCut =
      !Number.isFinite(lastSimT) || simT < lastSimT - 1e-6 || simT - lastSimT > 0.55;
    const adjacent =
      Number.isFinite(simT) && Number.isFinite(lastSimT) && simT > lastSimT && simT - lastSimT <= 0.35;
    const restartType = sim?.ball?.restartType || null;
    const discontinuity = !!sim?.motionContext?.discontinuity;
    const ballState = sim?.ball?.state || null;

    const ret = orig(sim, opts);

    const after = snap();
    st.frames += 1;
    if (restartType || discontinuity) st.restarts += 1;

    // 缓动激活计数：`_relocAt` 非 0 表示这个实体此刻正被缓动。
    // 用途是**回归护栏** —— 如果把「武装条件」里的 `restartFrame` 拿掉
    // （见 AGENTS.md ⑤ 候选 B），必须证明缓动不会在运动战里**常开**。
    const easing = (mv.players || []).filter((p) => p._relocAt).length + (mv.ball?._relocAt ? 1 : 0);
    st.easingSamples += 1;
    st.easingSum += easing;
    if (easing > 0) st.easingFrames += 1;
    if (!restartType && !discontinuity && !sceneCut) {
      st.calmFrames += 1;
      st.calmEasingSum += easing;
      if (easing > 0) st.calmEasingFrames += 1;
    }

    const per = [];
    for (let i = 0; i < before.players.length && i < after.players.length; i += 1) {
      if (before.players[i].id !== after.players[i].id) continue;
      per.push({ k: "player", id: before.players[i].id, m: disp(before.players[i], after.players[i]) });
    }
    if (before.ball && after.ball) per.push({ k: "ball", id: "ball", m: disp(before.ball, after.ball) });
    for (const b of before.officials) {
      const a = after.officials.find((x) => x.key === b.key);
      if (a) per.push({ k: b.key, id: b.key, m: disp(b, a) });
    }
    if (!per.length) return ret;

    const sorted = per.map((e) => e.m).sort((a, b) => a - b);
    const maxM = sorted[sorted.length - 1];
    // 🔴 判据改成**速度**（m / sim 秒），不是位移。
    //
    // 为什么第一版量位移是错的：`relocate()` 的缓动是 **ease-out cubic**
    // （`e = 1 - (1-u)^3`），`u` 每帧只走 0.1/0.7 ≈ 0.143 ⇒ **第一帧就走掉 36%**。
    // 一次 15 m 的角球摆位首帧只有 **5.4 m**，落在我原来的 6 m 门槛**下面**
    // ⇒ 整类被漏掉（180 秒里 1608 个 restart 帧，一帧都没被记）。
    //
    // 物理上限：引擎球员最高约 10 m/s（`RELOCATE_PLAYER_MAX_SPEED_MPS`）。
    // 缓动把 40 m 的摆位压进 0.7 模拟秒 ⇒ **57 m/s**，是物理上限的 5.7 倍 ——
    // 眼睛看到的就是「一闪到位」。所以门槛取 **12 m/s**（物理上限的 1.2 倍）。
    const dtSec =
      Number.isFinite(simT) && Number.isFinite(lastSimT) && simT > lastSimT ? simT - lastSimT : null;
    const maxSpeed = dtSec && dtSec > 0 ? maxM / dtSec : null;

    // 角球帧 / 中场 discontinuity 帧：**不设门槛**，原样记录幅度。
    // 目的是看「引擎硬置之后，画面上第一帧到底走了多远」。
    if (restartType === "corner" || discontinuity) {
      st.cornerLike.push({
        simT: Number.isFinite(simT) ? +simT.toFixed(2) : null,
        dt: dtSec == null ? null : +dtSec.toFixed(3),
        restartType,
        ballState,
        discontinuity,
        sceneCut,
        adjacent,
        maxM: +maxM.toFixed(2),
        maxSpeed: maxSpeed == null ? null : +maxSpeed.toFixed(1),
        movedOver2m: per.filter((e) => e.m > 2).length,
        top: per
          .slice()
          .sort((a, b) => b.m - a.m)
          .slice(0, 3)
          .map((e) => ({ id: e.id, m: +e.m.toFixed(1) })),
      });
    }
    // ⚠ 速度判据必须**同时**卡住 dt：`applySimSnapshot` 会被以很小的 simT 增量调用
    //   （实测 dt 低到 0.009 s），那里 0.3 m 的插值残差就能算出 36 m/s 的假读数
    //   —— 第一版就是这么刷出 1161 帧「异常」的。
    //   只在**正常 sim 步长**上判：生产 `SIM.DT = 0.1`。物理上限 10 m/s
    //   ⇒ 一帧最多 1.0 m。取 **dt ≥ 0.08 且位移 > 2 m**（⇒ 速度 > 25 m/s）。
    if (dtSec == null || dtSec < 0.08 || maxM <= 2) return ret;

    const moved = per.filter((e) => e.m > 6).length;
    // 分档
    let bucket;
    if (sceneCut) bucket = "A_sceneCut";
    else if (adjacent && (restartType || discontinuity)) bucket = "B_should_have_eased";
    else bucket = "C_other";

    st.big.push({
      simT: Number.isFinite(simT) ? +simT.toFixed(2) : null,
      dt: Number.isFinite(simT) && Number.isFinite(lastSimT) ? +(simT - lastSimT).toFixed(3) : null,
      bucket,
      sceneCut,
      adjacent,
      restartType,
      ballState,
      discontinuity,
      fadeOpacity: fadeOpacity(),
      maxM: +maxM.toFixed(2),
      maxSpeed: +maxSpeed.toFixed(1),
      medianM: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
      movedOver6m: moved,
      entityCount: per.length,
      top: per
        .slice()
        .sort((a, b) => b.m - a.m)
        .slice(0, 5)
        .map((e) => ({ id: e.id, k: e.k, m: +e.m.toFixed(1) })),
    });
    return ret;
  };

  const watch = () => {
    if (performance.now() >= st.until) {
      st.done = true;
      return;
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
};

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  let ready = false;
  for (let i = 0; i < 90 && !ready; i += 1) {
    ready = await page.evaluate(() => !!window.vcfmMainApi).catch(() => false);
    if (!ready) await page.waitForTimeout(1000);
  }
  if (!ready) throw new Error("首屏未就绪");
  await page.fill("#input-manager", "Restart Placement Probe");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150_000 });
  await page.locator("#btn-advance-matchday").click();
  let kicked = false;
  for (let i = 0; i < 360 && !kicked; i += 1) {
    await page.waitForTimeout(2000);
    await closeModalIfAny(page);
    const st = await page.evaluate(() => {
      const b = document.querySelector("#btn-play-match");
      return { disabled: b ? b.disabled : null };
    });
    kicked = st.disabled === false;
  }
  if (!kicked) throw new Error("推进到比赛日后仍无「进入比赛」可点");
  await closeModalIfAny(page);
  await page.locator("#btn-play-match").click();
  await page.waitForSelector("#screen-match.active", { timeout: 90_000 });
  await page.locator("#btn-sim-live").click({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await page.evaluate(INSTALL, { ms: seconds * 1000, mx: 68 / 100, my: 105 / 100 });
  console.log(`测量已安装，采样 ${seconds} 秒…`);
  await page.waitForTimeout(seconds * 1000 + 2000);

  const raw = await page.evaluate(() => window.__rp);
  await page.screenshot({ path: join(OUT, "last-frame.png") });

  console.log(`\n=== 读数 ===`);
  console.log(`采样 sim 帧数：${raw.frames} ｜ 带 restart/discontinuity 语义的帧：${raw.restarts}`);

  const byBucket = {};
  for (const r of raw.big) byBucket[r.bucket] = (byBucket[r.bucket] || 0) + 1;
  console.log(`\n>6m 位移帧共 ${raw.big.length} 次，分档：`);
  for (const [k, v] of Object.entries(byBucket)) console.log(`  ${k}: ${v}`);

  const label = {
    A_sceneCut: "段首剪辑（设计如此，由淡场遮住）",
    B_should_have_eased: "**该缓动却没缓动**（bug）",
    C_other: "两者都不是（另一条路径）",
  };

  for (const bucket of ["B_should_have_eased", "C_other", "A_sceneCut"]) {
    const rows = raw.big.filter((r) => r.bucket === bucket);
    if (!rows.length) continue;
    console.log(`\n--- ${bucket} —— ${label[bucket]}（${rows.length} 次）---`);
    for (const r of rows.slice(0, 14)) {
      console.log(
        `  simT=${r.simT} dt=${r.dt} **${r.maxSpeed} m/s** (${r.maxM}m/帧) ` +
          `restart=${r.restartType} ballState=${r.ballState} ` +
          `disc=${r.discontinuity} sceneCut=${r.sceneCut} adjacent=${r.adjacent} ` +
          `fade=${r.fadeOpacity} 中位=${r.medianM}m >6m的=${r.movedOver6m}/${r.entityCount}`
      );
      console.log(`      top ${JSON.stringify(r.top)}`);
    }
    if (rows.length > 14) console.log(`  …还有 ${rows.length - 14} 次`);
  }

  const cl = raw.cornerLike || [];
  console.log(`\n=== 角球 / 中场 discontinuity 帧：${cl.length} 次（**不设门槛**，原样记录）===`);
  for (const r of cl.slice().sort((a, b) => b.maxM - a.maxM).slice(0, 16)) {
    console.log(
      `  simT=${r.simT} dt=${r.dt} restart=${r.restartType} ballState=${r.ballState} ` +
        `disc=${r.discontinuity} sceneCut=${r.sceneCut} adjacent=${r.adjacent} ` +
        `max=${r.maxM}m ${r.maxSpeed}m/s >2m的=${r.movedOver2m}  top ${JSON.stringify(r.top)}`
    );
  }
  console.log(
    `  合计：>2m 的 ${cl.filter((r) => r.maxM > 2).length} 次，` +
      `>5m 的 ${cl.filter((r) => r.maxM > 5).length} 次（共 ${cl.length}）`
  );

  const pc = (a, b) => (b ? ((a / b) * 100).toFixed(2) + "%" : "n/a");
  console.log(`\n=== 缓动激活（回归护栏）===`);
  console.log(`  全部帧 ${raw.easingSamples}：有实体在缓动的 ${raw.easingFrames} (${pc(raw.easingFrames, raw.easingSamples)})`);
  console.log(
    `  运动战帧（无 restart / 无 discontinuity / 非 sceneCut）${raw.calmFrames}：` +
      `有实体在缓动的 ${raw.calmEasingFrames} (${pc(raw.calmEasingFrames, raw.calmFrames)})`
  );
  console.log("\nNOTES " + JSON.stringify(raw.notes));
  console.log("ERRORS " + JSON.stringify(errors.slice(0, 3)));
} catch (err) {
  console.error("探针异常:", err?.stack || err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill();
}
