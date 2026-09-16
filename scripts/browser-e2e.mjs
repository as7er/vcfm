import assert from "node:assert/strict";
import { spawn } from "node:child_process";

import { chromium } from "playwright";

const port = 8876;
const baseUrl = `http://127.0.0.1:${port}/`;
const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
  stdio: "ignore",
  windowsHide: true,
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("local browser test server did not start");
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    metrics.scrollWidth <= metrics.clientWidth + 1,
    `${label} overflows horizontally: ${metrics.scrollWidth} > ${metrics.clientWidth}`
  );
}

async function assertCrestLoaded(locator, label) {
  await locator.waitFor({ state: "visible" });
  const image = await locator.evaluate((element) => ({
    complete: element.complete,
    naturalWidth: element.naturalWidth,
    naturalHeight: element.naturalHeight,
    source: element.currentSrc || element.src,
  }));
  assert.equal(image.complete, true, `${label} did not finish loading`);
  assert.ok(image.naturalWidth > 0 && image.naturalHeight > 0, `${label} has no decoded pixels`);
  assert.ok(image.source.startsWith("data:image/svg+xml"), `${label} must use an offline SVG data URI`);
}

async function assertStraightPassRendering(page) {
  const result = await page.evaluate(async () => {
    const { MatchView } = await import("./js/matchview.js?v=229");
    const positions = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
    const makeClub = (id, color) => {
      const players = positions.map((pos, index) => ({
        id: `${id}-${index}`,
        name: `${id} ${index}`,
        pos,
        number: index + 1,
        age: 25,
        ovr: 12,
        potential: 12,
        fitness: 100,
        morale: 70,
        injured: 0,
        suspended: 0,
        attrs: {
          pace: 12,
          strength: 12,
          passing: 12,
          vision: 12,
          shooting: 12,
          finishing: 12,
          dribbling: 12,
          tackling: 12,
          marking: 12,
          stamina: 12,
          positioning: 12,
          reflexes: 12,
          handling: 12,
          kicking: 12,
          heading: 12,
          crossing: 12,
          decisions: 12,
        },
      }));
      return {
        id,
        name: id,
        short: id,
        color,
        players,
        tactics: {
          formation: "4-3-3",
          lineup: players.map((player) => player.id),
          style: "balanced",
          pressing: 3,
          tempo: 3,
          width: 3,
          defensiveLine: 3,
          roles: [],
          duties: [],
        },
      };
    };

    const root = document.createElement("div");
    root.style.cssText = "position:fixed;left:0;top:0;width:420px;height:650px;z-index:99999";
    document.body.appendChild(root);
    const view = new MatchView(root);
    const home = makeClub("trail-home", "#2563eb");
    const away = makeClub("trail-away", "#dc2626");
    const motionStatusUpdates = [];
    view.mount(home, away, {
      onMotionStatus: (status) => motionStatusUpdates.push({
        frames: status.frames,
        incidents: status.incidents,
      }),
    });
    view.stopLoop();
    view.setSimDrive(true);
    view.refreshLayout();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const playerFrames = view.players.map((player) => ({
      id: player.id,
      team: player.team,
      role: player.pos,
      num: player.num,
      x: player.x,
      y: player.y,
      heading: player.heading || 0,
    }));
    const passerId = home.players[6].id;
    const receiverId = home.players[7].id;
    const withActors = (passer, receiver) => playerFrames.map((player) => {
      if (player.id === passerId) return { ...player, x: passer.x, y: passer.y };
      if (player.id === receiverId) return {
        ...player,
        x: receiver.x,
        y: receiver.y,
        fsm: "support",
        shapePhase: "in-possession",
        movementTarget: { x: 58, y: 48, source: "layered", setAt: 0, until: 1.5, phase: "in-possession", ownerId: passerId },
      };
      return player;
    });
    const frames = [
      {
        t: 0,
        ball: { x: 20, y: 40, z: 0, owner: passerId, state: "held" },
        players: withActors({ x: 20, y: 40 }, { x: 50, y: 55 }),
      },
      {
        t: 0.1,
        ball: { x: 30, y: 45, z: 0.1, owner: null, state: "pass" },
        players: withActors({ x: 20, y: 40 }, { x: 50, y: 55 }),
      },
      {
        t: 0.2,
        ball: { x: 40, y: 50, z: 0.05, owner: null, state: "pass" },
        players: withActors({ x: 20, y: 40 }, { x: 50, y: 55 }),
      },
      {
        t: 0.3,
        ball: { x: 50, y: 55, z: 0, owner: receiverId, state: "held" },
        players: withActors({ x: 20, y: 40 }, { x: 50, y: 55 }),
      },
    ];

    const samples = [];
    view.applySimSnapshot(frames[0], { soft: false });
    for (let frameIndex = 0; frameIndex < frames.length - 1; frameIndex++) {
      for (const alpha of [0.2, 0.4, 0.6, 0.8]) {
        view.applySimSnapshotLerped(frames[frameIndex], frames[frameIndex + 1], alpha);
        samples.push({
          frameIndex,
          alpha,
          x: view.ball.x,
          y: view.ball.y,
          carrierId: view.carrier?.id || null,
        });
      }
      view.applySimSnapshot(frames[frameIndex + 1], { soft: false });
    }
    view._drawCanvas();

    const crossErrors = samples.map((sample) => Math.abs(
      (sample.x - 20) * 15 - (sample.y - 40) * 30
    ));
    const kickSamples = samples.filter((sample) => sample.frameIndex === 0);
    const receiveSamples = samples.filter((sample) => sample.frameIndex === 2);
    const flightTrail = view._ballTrail.slice();
    const recordedFinalCarrierId = view.carrier?.id || null;
    const motionClip = view.createMotionClip({
      reason: "browser-audit",
      createdAt: "2026-08-18T00:00:00.000Z",
      metadata: { fixtureId: "browser-motion", matchSeed: 229 },
    });
    const motionStatus = view.getMotionDiagnosticStatus();
    const context = view.canvas.getContext("2d");
    const pixels = context.getImageData(0, 0, view.canvas.width, view.canvas.height).data;
    let nonBlankPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) nonBlankPixels++;
    }
    const canvas = {
      width: view.canvas.width,
      height: view.canvas.height,
      nonBlankPixels,
    };
    const replayScene = view.captureSceneSnapshot();
    const presentationBeforeReplay = {
      passNetwork: JSON.stringify([...view.passNetwork.entries()]),
      heat: JSON.stringify(view.heatCells.map(({ home: valueHome, away: valueAway }) => [valueHome, valueAway])),
    };
    let replayBadgeVisible = false;
    let replayGoalSequenceVisible = false;
    let replayNonBlankPixels = 0;
    const replayCaptions = [];
    const replayPlayed = await view.playGoalHighlight(
      {
        type: "goal",
        minute: 12,
        teamId: home.id,
        playerId: receiverId,
        text: "Goal replay browser audit",
      },
      { homeGoals: 1, awayGoals: 0, minute: 12 },
      { home: home.id, away: away.id },
      {
        speed: 1,
        lang: "en",
        rewatch: true,
        scene: replayScene,
        sleepFn: async () => {
          view._drawCanvas();
          replayCaptions.push(view.captionEl?.textContent || "");
          replayBadgeVisible ||= !view.replayBadgeEl?.classList.contains("hidden");
          replayGoalSequenceVisible ||= view.fsm.current() === "GOAL_SEQUENCE";
          const replayPixels = view.canvas
            .getContext("2d")
            .getImageData(0, 0, view.canvas.width, view.canvas.height)
            .data;
          let nonBlank = 0;
          for (let index = 3; index < replayPixels.length; index += 4) {
            if (replayPixels[index] > 0) nonBlank++;
          }
          replayNonBlankPixels = Math.max(replayNonBlankPixels, nonBlank);
          await Promise.resolve();
        },
      }
    );
    const replayReturn = {
      state: view.fsm.current(),
      subState: view.fsm.subState,
      simDrive: view.simDrive,
    };
    const presentationAfterSyntheticReplay = {
      passNetwork: JSON.stringify([...view.passNetwork.entries()]),
      heat: JSON.stringify(view.heatCells.map(({ home: valueHome, away: valueAway }) => [valueHome, valueAway])),
    };
    const goalFrames = [
      { ...frames[0], t: 8 },
      { ...frames[1], t: 8.03 },
      { ...frames[2], t: 8.06 },
      { ...frames[3], t: 8.09 },
      {
        t: 8.12,
        ball: { x: 50, y: 30, z: 0.25, owner: null, state: "shot" },
        players: withActors({ x: 20, y: 40 }, { x: 50, y: 55 }),
      },
      {
        t: 8.15,
        ball: { x: 50, y: 1.5, z: 0.1, owner: null, state: "shot", netHit: true },
        players: withActors({ x: 20, y: 40 }, { x: 50, y: 55 }),
      },
    ];
    const recordedSamples = [];
    const recordedReplayPlayed = await view.playRecordedGoalReplay({
      frames: goalFrames,
      climaxAt: 8.15,
      lang: "en",
      getSpeed: () => 8,
      onSimT: (simT) => recordedSamples.push(simT),
      returnToLiveSim: true,
    });
    const recordedReplayReturn = {
      state: view.fsm.current(),
      subState: view.fsm.subState,
      simDrive: view.simDrive,
    };
    view.fsm.transition("GOAL_SEQUENCE", "STRIKE", { replay: true });
    const goalSequenceReplayPlayed = await view.playRecordedGoalReplay({
      frames: goalFrames,
      climaxAt: 8.15,
      lang: "en",
      getSpeed: () => 8,
      returnToLiveSim: true,
    });
    const goalSequenceReplayReturn = {
      state: view.fsm.current(),
      subState: view.fsm.subState,
      simDrive: view.simDrive,
    };
    view.fsm.transition("FULL_TIME");
    view._legacyFrozen = true;
    view.simDrive = false;
    const fullTimeReplayPlayed = await view.playRecordedGoalReplay({
      frames: goalFrames,
      climaxAt: 8.15,
      lang: "en",
      getSpeed: () => 8,
    });
    const fullTimeReplayReturn = {
      state: view.fsm.current(),
      subState: view.fsm.subState,
      simDrive: view.simDrive,
      frozen: view._legacyFrozen,
    };
    const presentationAfterRecordedReplay = {
      passNetwork: JSON.stringify([...view.passNetwork.entries()]),
      heat: JSON.stringify(view.heatCells.map(({ home: valueHome, away: valueAway }) => [valueHome, valueAway])),
    };
    view.ball.x = 84;
    view.ball.y = 8;
    view.setCameraPreset("full", { persist: false });
    view._updateSimCamera(0.1);
    const fullCamera = { x: view.cam.tx, y: view.cam.ty, scale: view.cam.tScale };
    view.setCameraPreset("tv", { persist: false });
    view.camMode = "box";
    view._updateSimCamera(0.1);
    const tvCamera = { x: view.cam.tx, y: view.cam.ty, scale: view.cam.tScale };
    view.setCameraPreset("tactical", { persist: false });
    view._updateSimCamera(0.1);
    view._drawCanvas();
    const tacticalCamera = {
      x: view.cam.tx,
      y: view.cam.ty,
      scale: view.cam.tScale,
      classApplied: view.fieldEl.classList.contains("mp-camera-tactical"),
    };
    // 几何断言：复核弹窗的小球场和传球网络节点都曾经用 viewBox="0 0 100 100" 配 68/105 的
    // 盒子，preserveAspectRatio="none" 把圆横向压到 0.6476 倍，而元素计数断言完全看不出来。
    // 现在按渲染后的实际像素量宽高比，圆必须接近 1.0（getBoundingClientRect 会带上祖先
    // transform，这两处都没有 transform，所以量到的就是真实像素）。
    const renderedAspect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return 0;
      const box = el.getBoundingClientRect();
      return box.height > 0 ? box.width / box.height : 0;
    };
    // 传球网络节点：开网后量第一个节点。passNetwork 为空时补一条合成边，保证真的画出了节点
    // （否则这条断言会因为「没有节点」而静默变成 0 通过）。
    view.networkEnabled = true;
    view.networkSvg?.classList.remove("hidden");
    if (!view.passNetwork.size && view.players?.length >= 2) {
      view.passNetwork.set("e2e-geometry-probe", {
        fromId: view.players[0].id,
        toId: view.players[1].id,
        team: view.players[0].team,
        count: 3,
        last: performance.now(),
      });
    }
    view.networkDirty = true;
    view._redrawNetwork(true);
    const networkGeometry = {
      nodes: document.querySelectorAll("#mp-network .mp-net-node").length,
      nodeAspect: renderedAspect("#mp-network .mp-net-node"),
      boxAspect: (() => {
        const el = document.querySelector("#mp-network");
        return el?.clientHeight ? el.clientWidth / el.clientHeight : 0;
      })(),
      // 同一容器里球场自己的中圈。本用例的容器是固定 420×650 的合成盒子，球场盒被
      // max-height:100% 压成 418×560（相机 0.6643 而不是 68/105），所以这里不能断言
      // 绝对圆度——改为要求「网络圆点与球场中圈一样圆」，这才是叠层与球场一致的意思。
      liveCircleAspect: renderedAspect(".mp-lines > ellipse"),
    };
    view.networkEnabled = false;
    view.networkSvg?.classList.add("hidden");
    view._redrawNetwork(true);

    // 复核弹窗挂在 #screen-match 里，本用例还没开赛（它自建的是一个独立的 420×650 根节点），
    // 祖先 display:none 时量出来全是 0×0。临时切到比赛屏，量完还原，否则几何断言量的是空气。
    const screenMain = document.querySelector("#screen-main");
    const screenMatch = document.querySelector("#screen-match");
    const screenMainWasActive = screenMain?.classList.contains("active") || false;
    const screenMatchWasActive = screenMatch?.classList.contains("active") || false;
    screenMain?.classList.remove("active");
    screenMatch?.classList.add("active");
    const motionReviewOpened = window.vcfmMainApi?.showMotionDiagnostic(motionClip) || false;
    const enginePitchBox = document.querySelector("#match-motion-engine-pitch");
    const enginePitchSvg = enginePitchBox?.querySelector("svg");
    const motionReview = {
      visible: !document.querySelector("#match-motion-review")?.classList.contains("hidden"),
      enginePlayers: document.querySelectorAll("#match-motion-engine-pitch svg g:not(.motion-target)").length,
      displayPlayers: document.querySelectorAll("#match-motion-display-pitch svg g:not(.motion-target)").length,
      engineTargets: document.querySelectorAll("#match-motion-engine-pitch .motion-target").length,
      displayTargets: document.querySelectorAll("#match-motion-display-pitch .motion-target").length,
      incidentRows: document.querySelectorAll("#match-motion-review-incidents [data-motion-frame]").length,
      rangeMax: Number(document.querySelector("#match-motion-review-range")?.max || 0),
      viewBox: enginePitchSvg?.getAttribute("viewBox") || "",
      preserveAspectRatio: enginePitchSvg?.getAttribute("preserveAspectRatio") || "",
      // 球场盒本身必须是 68/105（clientWidth 不吃 transform，比 rect 稳）
      pitchAspect: enginePitchBox?.clientHeight ? enginePitchBox.clientWidth / enginePitchBox.clientHeight : 0,
      // 中圈是 svg 的第一个直接子 ellipse；球是最后一个直接子 ellipse
      engineCircleAspect: renderedAspect("#match-motion-engine-pitch svg > ellipse"),
      engineBallAspect: renderedAspect("#match-motion-engine-pitch svg > ellipse:last-of-type"),
      enginePlayerAspect: renderedAspect("#match-motion-engine-pitch svg g:not(.motion-target) ellipse"),
      displayCircleAspect: renderedAspect("#match-motion-display-pitch svg > ellipse"),
      displayPlayerAspect: renderedAspect("#match-motion-display-pitch svg g:not(.motion-target) ellipse"),
    };
    window.vcfmMainApi?.closeMotionDiagnostic();
    if (screenMainWasActive) screenMain?.classList.add("active");
    if (screenMatchWasActive) screenMatch?.classList.add("active");
    else screenMatch?.classList.remove("active");
    view.destroy();
    root.remove();
    return {
      maxCrossError: Math.max(...crossErrors),
      kickCarriers: kickSamples.map((sample) => sample.carrierId),
      receiveCarriers: receiveSamples.map((sample) => sample.carrierId),
      finalCarrierId: recordedFinalCarrierId,
      flightTrail,
      canvas,
      receiverId,
      replayPlayed,
      replayBadgeVisible,
      replayGoalSequenceVisible,
      replayNonBlankPixels,
      replayReturn,
      replayCaptions,
      presentationBeforeReplay,
      presentationAfterSyntheticReplay,
      presentationAfterRecordedReplay,
      recordedReplayPlayed,
      recordedSamples,
      recordedReplayReturn,
      goalSequenceReplayPlayed,
      goalSequenceReplayReturn,
      fullTimeReplayPlayed,
      fullTimeReplayReturn,
      fullCamera,
      tvCamera,
      tacticalCamera,
      motionClip: {
        kind: motionClip.kind,
        frames: motionClip.frames.length,
        incidents: motionClip.incidents.length,
        seed: motionClip.metadata.matchSeed,
      },
      motionStatus,
      motionStatusUpdates,
      motionReviewOpened,
      motionReview,
      networkGeometry,
    };
  });

  assert.ok(result.maxCrossError < 1e-7, `rendered pass bent off line: ${result.maxCrossError}`);
  assert.deepEqual(result.kickCarriers, [null, null, null, null], "the kicked ball reattached to the passer");
  assert.deepEqual(result.receiveCarriers, [null, null, null, null], "the arriving ball attached before its receiving frame");
  assert.equal(result.finalCarrierId, result.receiverId, "the receiver did not own the ball at the recorded frame");
  assert.equal(result.flightTrail.length, 1, "the completed pass trail leaked into the receiving phase");
  assert.ok(result.canvas.width > 0 && result.canvas.height > 0, "match canvas has no stable dimensions");
  assert.ok(result.canvas.nonBlankPixels > 1000, "match canvas rendered no meaningful pixels");
  assert.equal(result.replayPlayed, true, "spatial goal replay did not start");
  assert.equal(result.replayBadgeVisible, true, "spatial goal replay never displayed replay chrome");
  assert.equal(result.replayGoalSequenceVisible, true, "spatial goal replay never entered GOAL_SEQUENCE");
  assert.ok(result.replayNonBlankPixels > 1000, "spatial goal replay canvas was blank");
  assert.equal(
    result.replayCaptions.some((caption) => /(?:\bA:|\bAssist)/i.test(caption)),
    false,
    "an unassisted goal replay fabricated an assist"
  );
  assert.deepEqual(
    result.presentationAfterSyntheticReplay,
    result.presentationBeforeReplay,
    "synthetic replay mutated pass-network or heatmap data"
  );
  assert.deepEqual(
    result.presentationAfterRecordedReplay,
    result.presentationBeforeReplay,
    "recorded replay mutated pass-network or heatmap data"
  );
  assert.equal(result.recordedReplayPlayed, true, "recorded goal frames did not replay");
  assert.ok(result.recordedSamples.length > 0, "recorded goal replay never advanced through its frames");
  assert.deepEqual(
    result.replayReturn,
    { state: "PLAYING", subState: "SIM_DRIVEN", simDrive: true },
    "spatial goal replay did not restore SIM_DRIVEN playback"
  );
  assert.deepEqual(
    result.recordedReplayReturn,
    { state: "PLAYING", subState: "SIM_DRIVEN", simDrive: true },
    "recorded goal replay did not restore SIM_DRIVEN playback"
  );
  assert.equal(result.goalSequenceReplayPlayed, true, "goal-sequence frames did not replay");
  assert.deepEqual(
    result.goalSequenceReplayReturn,
    { state: "PLAYING", subState: "SIM_DRIVEN", simDrive: true },
    "goal-sequence replay did not restore SIM_DRIVEN playback"
  );
  assert.equal(result.fullTimeReplayPlayed, true, "full-time goal frames did not replay");
  assert.deepEqual(
    result.fullTimeReplayReturn,
    { state: "FULL_TIME", subState: null, simDrive: false, frozen: true },
    "recorded goal replay did not restore the full-time state"
  );
  assert.deepEqual(result.fullCamera, { x: 0, y: 0, scale: 1 }, "full-pitch camera moved during box action");
  assert.ok(result.tvCamera.scale > 1.04, "TV camera did not push in for box action");
  assert.notEqual(result.tvCamera.y, 0, "TV camera did not follow deep play");
  assert.deepEqual(
    result.tacticalCamera,
    { x: 0, y: 0, scale: 1, classApplied: true },
    "tactical camera was not fixed or did not enable live structure rendering"
  );
  assert.equal(result.motionClip.kind, "vcfm-motion-clip");
  assert.ok(result.motionClip.frames >= 4, "motion clip did not retain the rendered pass frames");
  assert.ok(result.motionClip.incidents >= 1, "synthetic high-speed pass did not receive an automatic marker");
  assert.equal(result.motionClip.seed, 229);
  assert.ok(result.motionStatusUpdates.some((status) => status.frames >= 2), "motion status callback never enabled capture");
  assert.equal(result.motionReviewOpened, true);
  assert.equal(result.motionReview.visible, true);
  assert.equal(result.motionReview.enginePlayers, 22);
  assert.equal(result.motionReview.displayPlayers, 22);
  assert.ok(result.motionReview.engineTargets >= 1);
  assert.ok(result.motionReview.displayTargets >= 1);
  assert.ok(result.motionReview.incidentRows >= 1);
  assert.equal(result.motionReview.rangeMax, result.motionClip.frames - 1);
  // 传球网络节点：容器是 .mp-camera（viewBox 0 0 100 100），节点必须画成屏幕上的正圆，
  // 而不是被 preserveAspectRatio="none" 横向压成 0.6476 倍的椭圆。
  assert.ok(result.networkGeometry.nodes >= 1, "pass network drew no nodes to measure");
  assert.ok(
    result.networkGeometry.nodeAspect > 0.97 && result.networkGeometry.nodeAspect < 1.03,
    `pass network node aspect ${result.networkGeometry.nodeAspect} should render round`
  );
  // 与同一容器里球场自己的中圈对齐：两者必须一样圆（差 >2% 说明叠层和球场用了两套几何）
  assert.ok(
    result.networkGeometry.liveCircleAspect > 0,
    "live pitch center circle was not measurable"
  );
  assert.ok(
    Math.abs(result.networkGeometry.nodeAspect - result.networkGeometry.liveCircleAspect) < 0.02,
    `pass network node aspect ${result.networkGeometry.nodeAspect} disagrees with live pitch circle ${result.networkGeometry.liveCircleAspect}`
  );
  // 复核弹窗小球场的几何：坐标系与主球场一致，且画出来的圆真的是圆
  assert.equal(result.motionReview.viewBox, "0 0 100 150");
  assert.equal(result.motionReview.preserveAspectRatio, "none");
  assert.ok(
    Math.abs(result.motionReview.pitchAspect - 68 / 105) < 0.005,
    `motion review pitch aspect ${result.motionReview.pitchAspect} should be 68/105`
  );
  for (const [key, limit] of [
    ["engineCircleAspect", 0.02],
    ["displayCircleAspect", 0.02],
    ["enginePlayerAspect", 0.03],
    ["displayPlayerAspect", 0.03],
    ["engineBallAspect", 0.03],
  ]) {
    const value = result.motionReview[key];
    assert.ok(
      value > 1 - limit && value < 1 + limit,
      `motion review ${key} ${value} should render round (${1 - limit}..${1 + limit})`
    );
  }
}

async function assertInboxEntityLinks(page) {
  const fixture = await page.evaluate(async () => {
    const { getActiveSlot, loadGame, saveGame } = await import("./js/save.js");
    const { pushInbox } = await import("./js/inbox.js");
    const snapshot = await loadGame(getActiveSlot());
    const user = snapshot.clubs.find((club) => club.id === snapshot.userClubId);
    const other = snapshot.clubs.find((club) => club.id !== snapshot.userClubId);
    const player = user.players[0];
    const staff = Object.values(user.staff || {}).find(Boolean);
    const nationCode = player.nationality;
    const mail = pushInbox(snapshot, {
      category: "system",
      priority: 1,
      title: `${player.name} 与 ${other.name} 的资料查阅`,
      body: `${player.name}、${other.name}、${staff.name} 和 ${nationCode} 均应可直接打开详情。`,
      ref: {
        kind: "browser_entity_audit",
        playerId: player.id,
        playerClubId: user.id,
        clubId: other.id,
        nationCode,
        staffId: staff.id,
        staffClubId: user.id,
      },
      actions: [{ id: "ack", label: "知道了", labelEn: "OK" }],
    });
    saveGame(snapshot, getActiveSlot(), { immediate: true });
    return {
      mailId: mail.id,
      player: player.name,
      club: other.name,
      staff: staff.name,
      nation: nationCode,
    };
  });
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 90_000 });
  await page.locator('[data-tab="inbox"]').click();
  await page.waitForSelector("#tab-inbox.active .inbox-item");
  const item = page.locator(`#inbox-list [data-mail-id="${fixture.mailId}"]`);
  await item.waitFor();
  assert.ok(await item.locator("[data-player-link]").count() > 0, "inbox player should be a detail link");
  assert.ok(await item.locator("[data-club-link]").count() > 0, "inbox club should be a detail link");
  assert.ok(await item.locator("[data-staff-link]").count() > 0, "inbox staff should be a detail link");
  assert.ok(await item.locator("[data-nation]").count() > 0, "inbox nation should be a detail link");

  const openAndCheck = async (selector, expected) => {
    await item.locator(selector).first().click();
    await page.waitForSelector("#modal:not(.hidden)");
    assert.match(await page.locator("#modal-body").innerText(), expected, `${selector} opened the wrong detail`);
    await page.keyboard.press("Escape");
    if (await page.locator("#modal:not(.hidden)").count()) await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("#modal")?.classList.contains("hidden"));
  };
  await openAndCheck("[data-player-link]", new RegExp(fixture.player));
  await openAndCheck("[data-club-link]", new RegExp(fixture.club));
  await openAndCheck("[data-staff-link]", new RegExp(fixture.staff));
  await openAndCheck("[data-nation]", /国家队名单|National squad/);
  await assertNoHorizontalOverflow(page, "desktop inbox entity links");
  await page.locator('[data-tab="dashboard"]').click();
  await page.waitForSelector("#tab-dashboard.active");
  assert.ok(await page.locator("#dash-inbox [data-player-link]").count() > 0, "dashboard inbox summary should preserve entity links");
}

const navGroupByTab = {
  dashboard: "overview",
  finance: "overview",
  career: "overview",
  media: "overview",
  squad: "team",
  staff: "team",
  training: "team",
  tactics: "team",
  facilities: "team",
  fixtures: "matches",
  table: "matches",
  transfer: "transfer",
  clubs: "world",
};

async function openTab(page, tab) {
  await page.locator(`[data-nav-group="${navGroupByTab[tab]}"]`).click();
  await page.locator(`[data-tab="${tab}"]:visible`).click();
}

async function assertPhaseShapeReport(page) {
  await page.evaluate(async () => {
    const main = window.vcfmMainApi;
    if (!main) throw new Error("main page test API is unavailable");
    const positions = [
      [50, 8], [18, 28], [40, 24], [60, 24], [82, 28],
      [28, 48], [50, 52], [72, 48], [20, 72], [50, 78], [80, 72],
    ];
    const analysisSide = {
      xg: 1.1,
      openPlayXg: 0.9,
      shots: [{ minute: 32, playerName: "Audit Forward", x: 50, y: 88, xg: 0.2, outcome: "saved" }],
      progression: { passCompletionPct: 82, progressivePasses: 17, finalThirdEntries: 29, boxEntries: 8 },
      pressing: { pressures: 32, pressureSuccessPct: 28, highPressures: 7, regains: 12, highRegains: 2 },
      shape: { averageActionHeight: 54 },
      heatmap: { cols: 6, rows: 10, max: 1, cells: Array(60).fill(0) },
      network: { nodes: [], edges: [], hub: null },
    };
    const usageSide = (prefix) => ({
      totalSeconds: 5400,
      phasePct: {
        "in-possession": 38.5,
        "out-of-possession": 43.5,
        "attacking-transition": 9.5,
        "defensive-transition": 8.5,
      },
      averagePositions: positions.map(([x, y], index) => ({
        playerId: `${prefix}-${index}`,
        name: `${prefix} Player ${index + 1}`,
        number: index + 1,
        role: index ? "MID" : "GK",
        x,
        y,
        samples: 5000,
      })),
    });
    main.showMatchReport({
      score: "1 - 1",
      weather: { icon: "", name: "Clear" },
      home: { name: "Audit Home", short: "Home", xg: 1.1, shots: 10, shotsOn: 4, possession: 52, corners: 4, fouls: 11, yellows: 2, reds: 0, saves: 3, woodwork: 0 },
      away: { name: "Audit Away", short: "Away", xg: 1.0, shots: 9, shotsOn: 4, possession: 48, corners: 3, fouls: 12, yellows: 1, reds: 0, saves: 3, woodwork: 0 },
      scorers: [],
      ratings: null,
      narrative: [],
      analysis: { home: structuredClone(analysisSide), away: structuredClone(analysisSide) },
      phaseShapes: {
        version: 1,
        usage: { home: usageSide("Home"), away: usageSide("Away") },
        timeline: [
          { minute: 0, team: "home", trigger: "pre-match", source: "player", reason: "manual-plan", baseFormation: "4-3-3", possessionFormation: "3-4-3", outOfPossessionFormation: "5-3-2", scoreGap: 0 },
          { minute: 0, team: "away", trigger: "pre-match", source: "coach", reason: "pre-match-guard", baseFormation: "4-2-3-1", possessionFormation: "4-2-3-1", outOfPossessionFormation: "4-4-2", scoreGap: 0 },
          { minute: 45, team: "away", trigger: "half-time", source: "coach", reason: "chasing-game", baseFormation: "4-2-3-1", possessionFormation: "3-4-3", outOfPossessionFormation: "4-4-2", scoreGap: -1 },
          { minute: 75, team: "away", trigger: "review", source: "coach", reason: "protecting-lead", baseFormation: "4-2-3-1", possessionFormation: "4-2-3-1", outOfPossessionFormation: "5-3-2", scoreGap: 1 },
        ],
      },
    }, { review: true });
    document.querySelector("#screen-main")?.classList.remove("active");
    document.querySelector("#screen-match")?.classList.add("active");
  });
  await page.locator('[data-analysis-tab="shapes"]').click();
  assert.equal(await page.locator(".analysis-average-position").count(), 22);
  assert.equal(await page.locator(".shape-timeline-row").count(), 4);
  assert.match(await page.locator('[data-analysis-panel="shapes"]').innerText(), /3-4-3.*5-3-2/s);
  await assertNoHorizontalOverflow(page, "desktop phase-shape report");
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow(page, "mobile phase-shape report");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    document.querySelector("#screen-match")?.classList.remove("active");
    document.querySelector("#screen-main")?.classList.add("active");
    document.querySelector("#match-report")?.classList.add("hidden");
  });
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", async (dialog) => {
    const urgentInbox = /紧急信箱|urgent inbox/i.test(dialog.message());
    await dialog[urgentInbox ? "dismiss" : "accept"]();
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  // SW 重载哨兵按前缀匹配（index.html 的键名带缓存版本号，写死会随升版过期——
  // v235 时代留下的硬编码让本脚本在全新 headless 档上必然超时）。
  await page.waitForFunction(() => (
    !("serviceWorker" in navigator)
    || Object.keys(sessionStorage).some((k) => k.startsWith("vcfm-sw-reloaded-"))
  ));
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 90_000 });
  await assertStraightPassRendering(page);
  await assertCrestLoaded(page.locator("#start-club-preview .club-crest"), "career setup crest");
  await assertNoHorizontalOverflow(page, "desktop start screen");
  await page.fill("#input-manager", "Browser Audit");
  await page.click("#btn-new-game");
  try {
    await page.waitForSelector("#screen-main.active", { timeout: 90_000 });
  } catch (error) {
    const hint = await page.locator("#start-hint").textContent().catch(() => "");
    throw new Error(`new game did not open: ${hint || "no start hint"}; ${pageErrors.join(" | ") || error.message}`);
  }
  await assertCrestLoaded(page.locator("#club-name .club-crest"), "topbar crest");
  await assertNoHorizontalOverflow(page, "desktop dashboard");
  await assertInboxEntityLinks(page);
  await page.waitForSelector("#dashboard-priorities > *");
  assert.ok((await page.locator("#dashboard-priorities").innerText()).trim().length > 0, "manager workbench must render priorities or an explicit ready state");
  assert.ok(await page.locator("#dashboard-quick-actions [data-dashboard-link]").count() > 0, "manager workbench must expose contextual actions");
  await page.waitForSelector("#dashboard-onboarding:not([hidden])");
  assert.match(await page.locator("#dashboard-onboarding").innerText(), /0\/4/, "new careers must begin with four onboarding steps");
  const dashboardAction = page.locator("#dashboard-quick-actions [data-dashboard-link]").first();
  const dashboardTarget = await dashboardAction.getAttribute("data-dashboard-link");
  await dashboardAction.click();
  await page.waitForSelector(`#tab-${dashboardTarget}.active`);
  await openTab(page, "dashboard");
  const dateBeforeWorkerAdvance = await page.locator("#date-label").innerText();
  await page.locator("#btn-advance").click();
  await page.waitForFunction(
    (before) => document.querySelector("#date-label")?.textContent !== before,
    dateBeforeWorkerAdvance,
    { timeout: 90_000 }
  );
  assert.notEqual(await page.locator("#date-label").innerText(), dateBeforeWorkerAdvance);
  assert.equal(await page.locator("#btn-advance").isEnabled(), true);
  assert.match(await page.locator("#dashboard-advance-summary").innerText(), /推进 1 天|Advanced 1 day/);
  assert.ok((await page.locator("#dashboard-advance-summary").innerText()).trim().length > 0, "calendar advance must explain what changed");
  await page.waitForSelector("#dashboard-onboarding:not([hidden])");
  assert.match(await page.locator("#dashboard-onboarding").innerText(), /0\/4/, "onboarding must survive pre-match date progression");

  for (const onboardingTab of ["squad", "tactics", "training"]) {
    await openTab(page, onboardingTab);
    await page.waitForSelector(`#tab-${onboardingTab}.active`);
    await openTab(page, "dashboard");
  }
  await page.waitForFunction(
    () => document.querySelectorAll("#dashboard-onboarding .dashboard-onboarding-step.done").length === 3
  );
  assert.match(await page.locator("#dashboard-onboarding").innerText(), /3\/4/, "three management onboarding steps must be complete");
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 90_000 });
  await page.waitForSelector("#screen-main.active", { timeout: 90_000 });
  await page.waitForSelector("#dashboard-onboarding:not([hidden])");
  assert.match(await page.locator("#dashboard-onboarding").innerText(), /3\/4/, "onboarding progress must persist across reload");

  const dateBeforeFirstMatch = await page.locator("#date-label").innerText();
  await page.locator("#btn-advance").click();
  await page.waitForFunction(
    (before) => document.querySelector("#date-label")?.textContent !== before,
    dateBeforeFirstMatch,
    { timeout: 150_000 }
  );
  await page.waitForFunction(() => !document.querySelector("#btn-play-match")?.disabled, null, { timeout: 90_000 });
  await page.locator("#btn-play-match").click();
  await page.waitForSelector("#screen-match.active", { timeout: 90_000 });

  // 解说栏折叠开关。此前只有「源码里存在这个选择器」的断言，折叠行为本身没被测过。
  const commentary = page.locator(".fmm-commentary");
  const commentaryToggle = page.locator("#match-com-toggle");
  const isCollapsed = () => commentary.evaluate((el) => el.classList.contains("is-collapsed"));
  // 底栏一旦溢出 .fm-match-body 就会盖住折叠按钮让它点不到（它是 position:relative，
  // 解说栏是 static，所以画在解说栏之上）。约束在 .fm-pitch-col 的 max-height。
  const toggleOverlap = await page.evaluate(() => {
    const button = document.querySelector("#match-com-toggle");
    const dock = document.querySelector(".mp-fmm-dock");
    const body = document.querySelector(".fm-match-body");
    if (!button || !dock || !body) return { missing: true };
    const rect = button.getBoundingClientRect();
    const topMost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      coveredByDock: dock.contains(topMost),
      dockBottom: Math.round(dock.getBoundingClientRect().bottom),
      bodyBottom: Math.round(body.getBoundingClientRect().bottom),
    };
  });
  assert.notEqual(toggleOverlap.missing, true, "match dock and commentary toggle must both exist");
  assert.ok(
    toggleOverlap.dockBottom <= toggleOverlap.bodyBottom + 1,
    `match dock must stay inside the pitch area (dock ${toggleOverlap.dockBottom} > body ${toggleOverlap.bodyBottom})`
  );
  assert.equal(
    toggleOverlap.coveredByDock,
    false,
    `match dock must not cover the commentary toggle (dock ${toggleOverlap.dockBottom}, body ${toggleOverlap.bodyBottom})`
  );
  // 1b26120 有意把解说栏初始态从折叠翻成展开（class/aria/图标一起翻转），
  // 本断言没跟着改，且 SW 哨兵超时把脚本挡在更早处，从未暴露。按产品现状对齐：
  // 初始展开 → 点一下折叠 → 再点展开。
  assert.equal(await isCollapsed(), false, "commentary must start expanded (1b26120 flipped the default)");
  await commentaryToggle.click();
  assert.equal(await isCollapsed(), true, "commentary must collapse on toggle");
  assert.equal(await commentaryToggle.getAttribute("aria-expanded"), "false", "collapsed commentary must announce itself");
  await commentaryToggle.click();
  assert.equal(await isCollapsed(), false, "commentary must expand again");
  assert.equal(await commentaryToggle.getAttribute("aria-expanded"), "true", "expanded commentary must announce itself");

  // 替补席是五列网格，空的一侧必须留住自己的列；display:none 会让后面的元素
  // 前移一列，把分隔线挤进替补席的位置。
  await page.waitForSelector("#mp-bench-strip", { timeout: 90_000 });
  assert.equal(
    await page.locator("#mp-bench-strip > *").count(),
    5,
    "bench strip must keep its five grid columns"
  );
  assert.equal(
    await page.locator("#mp-bench-strip .mp-bench-list").evaluateAll(
      (nodes) => nodes.filter((node) => getComputedStyle(node).display === "none").length
    ),
    0,
    "an empty bench side must keep its column instead of collapsing it"
  );

  await page.waitForFunction(() => !document.querySelector("#btn-sim-instant")?.disabled, null, { timeout: 90_000 });
  await page.locator("#btn-sim-instant").click();
  await page.waitForFunction(() => !document.querySelector("#btn-match-continue")?.disabled, null, { timeout: 90_000 });
  await page.locator("#btn-match-continue").click();
  await page.waitForSelector("#screen-main.active", { timeout: 90_000 });
  assert.equal(await page.locator("#dashboard-onboarding").isHidden(), true, "onboarding must close after the first match");
  // 关闭状态必须真的落盘。这一步只靠 finishMatchUI 之后调用方的 saveGame 保证，
  // 少了它，重开存档引导会再次出现，而纯内存断言看不出来。
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 90_000 });
  await page.waitForSelector("#screen-main.active", { timeout: 90_000 });
  // 面板本来就带 hidden，要等工作台渲染完再断言，否则是假阳性。
  await page.waitForFunction(
    () => !!document.querySelector("#dashboard-priorities")?.innerHTML.trim(),
    null,
    { timeout: 90_000 }
  );
  assert.equal(
    await page.locator("#dashboard-onboarding").isHidden(),
    true,
    "a completed onboarding must stay closed across reload"
  );

  for (const tab of ["finance", "squad", "staff", "training", "tactics", "facilities", "media", "fixtures", "table", "career"]) {
    await openTab(page, tab);
    await page.waitForTimeout(100);
    await assertNoHorizontalOverflow(page, `desktop ${tab}`);
    if (tab === "tactics") {
      const possessionShape = page.locator("#possession-formation-select");
      const defensiveShape = page.locator("#out-possession-formation-select");
      assert.equal(await possessionShape.locator("option").count(), 9, "possession shape must include follow-base plus all formations");
      assert.equal(await defensiveShape.locator("option").count(), 9, "defensive shape must include follow-base plus all formations");
      await possessionShape.selectOption("3-4-3");
      await defensiveShape.selectOption("5-3-2");
      assert.match(await page.locator("#tac-summary").innerText(), /3-4-3.*5-3-2/s);
      // v209 角色/职责面板：每个首发槽都有角色徽章，点击可打开角色面板并切换角色/职责
      await page.waitForSelector("#pitch .tac-slot");
      assert.equal(await page.locator("#pitch .tac-slot").count(), 11);
      const roleBadges = page.locator("#pitch .tac-role-badge");
      assert.ok((await roleBadges.count()) >= 11, "every on-pitch slot must show a role badge");
      await roleBadges.first().click();
      await page.waitForSelector("#tac-role-panel .tac-role-card");
      const cards = page.locator("#tac-role-panel .tac-role-card");
      assert.ok((await cards.count()) >= 2, "role panel must offer multiple candidate roles");
      assert.ok((await page.locator("#tac-role-panel .tac-duty-btn").count()) >= 1, "role panel must show duty options");
      const beforeRole = await page.locator("#tac-role-panel .tac-role-card.active").innerText();
      await cards.nth(1).click();
      await page.waitForFunction(
        (prev) => document.querySelector("#tac-role-panel .tac-role-card.active")?.textContent !== prev,
        beforeRole
      );
      await page.waitForSelector("#tac-role-panel .tac-duty-btn");
      const dutyButtons = page.locator("#tac-role-panel .tac-duty-btn");
      if ((await dutyButtons.count()) > 1) {
        await dutyButtons.nth(1).click();
        await page.waitForTimeout(80);
      }
      assert.equal(await page.locator("#tac-role-panel .tac-role-card.active").count(), 1, "exactly one role must stay active");
      assert.ok((await page.locator("#tac-role-panel .tac-role-habit-facts").innerText()).trim().length > 0,
        "role panel must explain habit fit or conflict");
    }
    if (tab === "finance") {
      await page.waitForSelector("#finance-sponsorship .sponsor-offer");
      assert.equal(await page.locator("#finance-sponsorship .sponsor-offer").count(), 3);
      assert.ok((await page.locator("#finance-debt").innerText()).trim().length > 0);
      assert.ok((await page.locator("#finance-budget-projection").innerText()).trim().length > 0);
    }
    if (tab === "facilities") {
      await page.waitForSelector("#facilities-grid .facility-card");
      assert.equal(await page.locator("#facilities-grid .facility-card").count(), 3);
      assert.equal(await page.locator("#facilities-grid .facility-level").count(), 3);
      for (const effect of await page.locator("#facilities-grid .facility-effect").allInnerTexts()) {
        assert.ok(effect.trim().length > 0, "each facility card must explain its current effect");
      }
      assert.ok((await page.locator("#facilities-hint").innerText()).trim().length > 0);
    }
    if (tab === "media") {
      // 开局有揭幕报道；即使为空也必须渲染出占位文案，不能是空白面板
      assert.ok((await page.locator("#media-count").innerText()).trim().length > 0);
      assert.ok((await page.locator("#media-feed").innerText()).trim().length > 0);
    }
    if (tab === "table") {
      await page.waitForSelector("#league-table tbody tr");
      assert.equal(await page.locator("#league-table tbody tr").count(), 18);
      assert.equal(await page.locator("#league-table tbody tr.me").count(), 1, "user club must be highlighted once");
      assert.ok((await page.locator("#table-title").innerText()).trim().length > 0);
      assert.ok((await page.locator("#table-hint").innerText()).trim().length > 0);
      // 数据榜与积分榜共享筛选状态，切过去必须同样渲染出来
      await page.locator('[data-league-centre-view="stats"]:visible').click();
      await page.waitForSelector("#stats-goals tbody tr");
      assert.ok((await page.locator("#stats-scope-summary").innerText()).trim().length > 0);
      assert.ok(await page.locator("#stats-goals tbody tr").count() > 0);
      assert.ok(await page.locator("#stats-keepers tbody tr").count() > 0);
      await page.locator('[data-league-centre-view="table"]:visible').click();
    }
    if (tab === "squad") {
      await page.waitForSelector("#squad-plan-summary .squad-plan-table");
      assert.equal(await page.locator("#squad-plan-summary .squad-plan-table tbody tr").count(), 4);
      assert.match(await page.locator("#squad-plan-summary").innerText(), /多年阵容规划|Multi-year squad plan/);
      // 更衣室：领袖/小圈子/不合三块必须都渲染出来（空队也要有占位文案）
      await page.waitForSelector("#dressing-room-summary .dressing-room-block");
      assert.equal(await page.locator("#dressing-room-summary .dressing-room-block").count(), 3);
      assert.match(await page.locator("#dressing-room-summary").innerText(), /更衣室|Dressing room/);
      for (const block of await page.locator("#dressing-room-summary .dressing-room-block ul").allInnerTexts()) {
        assert.ok(block.trim().length > 0, "each dressing-room block must render content or a placeholder");
      }
    }
    if (tab === "staff") {
      const coachCard = page.locator("#staff-current .staff-card").first();
      assert.match(await coachCard.innerText(), /4-3-3|4-2-3-1|4-4-2|3-5-2|5-3-2|4-1-4-1|4-5-1|3-4-3/);
      await coachCard.locator("[data-staff-link]").last().click();
      await page.waitForSelector('#modal:not(.hidden) .staff-impact-list');
      assert.match(await page.locator('#modal:not(.hidden) .staff-impact-list').innerText(), /足球理念|Identity:/);
      await page.keyboard.press("Escape");
    }
  }

  await openTab(page, "transfer");
  await page.waitForSelector("#scout-mission-pos:visible");
  assert.equal(await page.locator("#scout-mission-pos option").count(), 5);
  assert.equal(await page.locator("#scout-mission-profile option").count(), 3);
  assert.equal(await page.locator("#scout-mission-budget option").count(), 4);
  await page.selectOption("#scout-mission-pos", "GK");
  await page.selectOption("#scout-mission-profile", "first_team");
  await page.selectOption("#scout-mission-budget", "500000");
  await page.locator('[data-scout-mission="div3"]').click();
  await page.waitForTimeout(250);
  const scoutingStatus = await page.locator("#scout-mission-status").innerText();
  assert.match(scoutingStatus, /GK.*即战力.*500/, pageErrors.join(" | ") || "scouting mission status did not update");
  assert.equal(await page.locator("[data-scout-mission]:disabled").count(), 3);
  await assertNoHorizontalOverflow(page, "desktop scouting mission");

  await openTab(page, "clubs");
  const externalClubRow = page.locator("#clubs-table tbody tr:not(.me)").first();
  await assertCrestLoaded(externalClubRow.locator(".club-link-crest"), "club table crest");
  assert.match(await externalClubRow.locator("td").nth(5).innerText(), /^\d+-\d+$/);
  await externalClubRow.locator("[data-open-club]").click();
  await page.waitForSelector('#modal:not(.hidden) .club-modal-grid');
  await assertCrestLoaded(page.locator('#modal:not(.hidden) .club-modal-crest'), "club profile crest");
  const externalPlayerAbility = page.locator(".club-modal-grid .compact-table tbody tr").first().locator("td").nth(4);
  assert.match(await externalPlayerAbility.innerText(), /^\d+-\d+$/);
  await page.keyboard.press("Escape");

  await assertPhaseShapeReport(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "transfer");
  await assertNoHorizontalOverflow(page, "mobile scouting mission");
  await openTab(page, "finance");
  await assertNoHorizontalOverflow(page, "mobile finance");
  await openTab(page, "squad");
  await assertNoHorizontalOverflow(page, "mobile squad planning");
  await openTab(page, "tactics");
  await page.waitForSelector("#pitch .tac-slot");
  assert.equal(await page.locator("#possession-formation-select").inputValue(), "3-4-3", "possession shape must persist across navigation");
  assert.equal(await page.locator("#out-possession-formation-select").inputValue(), "5-3-2", "defensive shape must persist across navigation");
  await page.locator("#pitch .tac-role-badge").first().click();
  await page.waitForSelector("#tac-role-panel .tac-role-card");
  await assertNoHorizontalOverflow(page, "mobile tactics role panel");
  await openTab(page, "dashboard");
  await assertNoHorizontalOverflow(page, "mobile dashboard");
  await openTab(page, "clubs");
  await assertCrestLoaded(page.locator("#clubs-table .club-link-crest").first(), "mobile club table crest");
  await assertNoHorizontalOverflow(page, "mobile clubs");
  await page.locator("#btn-global-search").focus();
  await page.keyboard.press("Control+K");
  await page.waitForSelector('#modal:not(.hidden)[role="dialog"][aria-modal="true"]');
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#btn-global-search").evaluate((element) => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);

  console.log("Browser E2E passed: first-week onboarding persistence and first-match completion, broadcast cameras, motion clip diagnostics, spatial goal replay, straight-pass rendering, nonblank match canvas, phase-shape evidence, manager identity, squad planning, club crests, finance, scouting knowledge, desktop/mobile overflow, navigation and modal focus");
} finally {
  await browser?.close();
  server.kill();
}
