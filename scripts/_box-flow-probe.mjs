// Passive attribution of the exact six-match box-possession audit fixture.
// Do not call decision helpers to obtain counterfactual choices: copy real calls.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SimEngine, SIM } from "../js/sim/engine.js";

const count = Math.max(1, Number(process.argv[2]) || 6);
const profile = process.argv[3] === "background" ? "background" : "standard";
const label = process.argv[4] || "current";
assert.match(label, /^[a-z0-9-]+$/);
const dt = profile === "background" ? 0.3 : SIM.DT;
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const round = (n) => Number(n.toFixed(4));
const distance = (a, b) => Math.hypot((a.x - b.x) * mx, (a.y - b.y) * my);
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const other = (team) => team === "home" ? "away" : "home";
const directory = new URL("../.tmp-continuity/global-movement/box-flow/", import.meta.url);
mkdirSync(directory, { recursive: true });
const output = new URL(`${label}-${profile}.json`, directory);
assert.ok(!existsSync(output), "use a fresh evidence label");
function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
function club(name) {
  const keys = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
    "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning",
    "kicking", "decisions"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${name}-p${i}`, name: `${name}-p${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 15 + ((i * 7 + 15) % 5) - 2])) }));
  return { id: name, name, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id),
    pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced" } };
}
function player(a) {
  return { id: a.id, team: a.team, role: a.role, roleId: a.roleId, dutyId: a.dutyId,
    x: a.x, y: a.y, vx: a.vx, vy: a.vy, tx: a.tx, ty: a.ty, fsm: a.fsm,
    intent: a.intent && { ...a.intent }, offBallTarget: a.offBallTarget && structuredClone(a.offBallTarget),
    decisionUntil: a.decisionUntil, protectUntil: a.protectUntil, tackleCdUntil: a.tackleCdUntil,
    sentOff: !!a.sentOff, injuredOff: !!a.injuredOff };
}
function choice(p) {
  return { id: p.agent?.id, value: p.value, tx: p.tx, ty: p.ty,
    through: !!p.through, cross: !!p.cross, cutback: !!p.cutback, detour: p.detour || 0 };
}
const spells = [], decisions = [], acquisitions = [], passes = [], matches = [], carryContacts = [];
const timeByOrigin = {}, timeByDefenseBlock = {}, timeByControl = {}, timeByRole = {};
const bump = (obj, key, amount = 1) => { obj[key] = (obj[key] || 0) + amount; };

function play(seed, observed) {
  const originalRandom = Math.random;
  const rng = seeded(seed);
  let draws = 0;
  Math.random = () => { draws++; return rng(); };
  try {
    const e = new SimEngine(club(`home-${seed}`), club(`away-${seed}`), {
      simulationProfile: profile, timeStep: dt, separationPasses: profile === "background" ? 4 : 8,
    });
    const lastAcquisition = new Map();
    let currentDecision = null;
    if (observed) {
      const contacts = new Map();
      const think = e._think;
      e._think = function(a, ...args) {
        const intent = a.intent;
        const carrying = this.ball.owner === a.id && this.ball.state === "held" &&
          intent?.type === "dribble" && this.t >= this.deadBallUntil && !this.ball.restartType;
        const dx = carrying ? intent.tx - a.x : 0, dy = carrying ? intent.ty - a.y : 0;
        const squared = dx * dx + dy * dy;
        const blocker = carrying && squared > 1e-8 ? this.agents.find((o) => {
          if (o.team === a.team || o.sentOff || o.injuredOff ||
              Math.hypot(o.x - a.x, o.y - a.y) > this.separationMinDistanceUnits + 1e-6) return false;
          const along = ((o.x - a.x) * dx + (o.y - a.y) * dy) / squared;
          return along > 0 && along < 1;
        }) : null;
        let contact = contacts.get(a.id);
        if (contact && contact.blocker.id !== blocker?.id) {
          contact.endAt = this.t;
          contacts.delete(a.id);
          contact = null;
        }
        if (blocker && !contact) {
          contact = { seed, t: this.t, owner: player(a), blocker: player(blocker),
            inBox: this._inOwnFoulBox(other(a.team), this.ball.x, this.ball.y),
            acquisition: lastAcquisition.get(a.id) || null };
          contacts.set(a.id, contact);
          carryContacts.push(contact);
        }
        const result = think.call(this, a, ...args);
        if (contact && contact.afterFirstThinkUntil == null) contact.afterFirstThinkUntil = a.decisionUntil;
        return result;
      };
      const begin = e._beginBallControl;
      e._beginBallControl = function(a, options) {
        const b = this.ball;
        const fromBox = this._inOwnFoulBox(other(a.team), b.kickX, b.kickY);
        const row = { seed, t: this.t, playerId: a.id, x: a.x, y: a.y, ballX: b.x, ballY: b.y,
          state: b.state, previousOwner: b.owner, kickTeam: b.kickTeam, kickX: b.kickX, kickY: b.kickY,
          passerId: b.lastPasserId, receiverId: b.receiverId, targetX: b.targetX, targetY: b.targetY,
          cross: !!b.isCrossPass, through: !!b.isThroughPass, fromBox,
          inBox: this._inOwnFoulBox(other(a.team), b.x, b.y), kind: options?.kind || "receive" };
        const result = begin.call(this, a, options);
        row.attackSince = this._teamAttackSince[a.team];
        row.controlUntil = a.controlUntil;
        row.decisionUntil = a.decisionUntil;
        row.intent = a.intent && { ...a.intent };
        acquisitions.push(row);
        lastAcquisition.set(a.id, row);
        return result;
      };
      for (const name of ["_passCandidates", "_bestCutback", "_bestCross"]) {
        const original = e[name];
        e[name] = function(...args) {
          const result = original.apply(this, args);
          if (currentDecision) currentDecision.choices.push({ method: name,
            options: (Array.isArray(result) ? result : result ? [result] : []).map(choice) });
          return result;
        };
      }
      const opportunity = e._goalOpportunity;
      e._goalOpportunity = function(...args) {
        const result = opportunity.apply(this, args);
        if (currentDecision) currentDecision.opportunity = Object.fromEntries(Object.entries(result)
          .filter(([, value]) => value == null || typeof value !== "object"));
        return result;
      };
      const pressure = e._pressureOn;
      e._pressureOn = function(a) {
        const result = pressure.call(this, a);
        if (currentDecision?.owner.id === a.id) currentDecision.pressure = result;
        return result;
      };
      const decide = e._decideOnBall;
      e._decideOnBall = function(a) {
        if (Math.abs(a.y - this.targetGoalY(a.team)) * my > 38 || this.t < this.deadBallUntil || this.ball.restartType) {
          return decide.call(this, a);
        }
        currentDecision = { seed, t: this.t, owner: player(a), ball: { x: this.ball.x, y: this.ball.y, state: this.ball.state },
          inBox: this._inOwnFoulBox(other(a.team), this.ball.x, this.ball.y),
          attackSince: this._teamAttackSince[a.team], shotCdUntil: this._teamShotUntil[a.team],
          choices: [], players: this.agents.map(player) };
        const result = decide.call(this, a);
        const action = a.pendingBallAction ? "prepare" : (this.ball.state === "pass" ? "pass" :
          this.ball.state === "shot" ? "shot" : a.intent?.type || "none");
        Object.assign(currentDecision, { action, after: a.intent && { ...a.intent },
          preparedAction: a.pendingBallAction?.action || null,
          afterBallState: this.ball.state, afterDecisionUntil: a.decisionUntil });
        decisions.push(currentDecision);
        const contact = contacts.get(a.id);
        if (contact && contact.firstDecisionAt == null) {
          contact.firstDecisionAt = this.t;
          contact.firstDecisionAction = a.pendingBallAction?.action || action;
        }
        currentDecision = null;
        return result;
      };
      const pass = e._pass;
      e._pass = function(a, option, prepared) {
        const before = { x: this.ball.x, y: this.ball.y, state: this.ball.state, owner: this.ball.owner };
        const result = pass.call(this, a, option, prepared);
        if (before.owner === a.id && this.ball.state === "pass" && !this.ball.owner && this.ball.lastPassAt === this.t) {
          passes.push({ seed, t: this.t, team: a.team, playerId: a.id, attackSince: this._teamAttackSince[a.team],
            x: before.x, y: before.y, ...choice(option),
            fromBox: this._inOwnFoulBox(other(a.team), before.x, before.y),
            toBox: this._inOwnFoulBox(other(a.team), option.tx, option.ty) });
        }
        return result;
      };
    }
    const frames = createHash("sha256");
    let nextSampleAt = 0, lastSampleAt = null, spell = null;
    const end = (reason) => {
      if (!spell) return;
      spells.push({ ...spell, seconds: round(spell.seconds), ending: reason, endAt: e.t });
      spell = null;
    };
    for (let step = 0; step < Math.round(5400 / dt); step++) {
      e.step(dt);
      if (seed === 372000) frames.update(JSON.stringify(e.snapshot()));
      if (!observed || e.t < nextSampleAt) continue;
      nextSampleAt = e.t + 0.1;
      const elapsed = lastSampleAt == null ? dt : e.t - lastSampleAt;
      lastSampleAt = e.t;
      const b = e.ball;
      const a = b.owner && e.agentById(b.owner);
      const defending = e._inOwnFoulBox("home", b.x, b.y) ? "home" : e._inOwnFoulBox("away", b.x, b.y) ? "away" : null;
      const inside = a && defending && a.team !== defending && ["held", "control"].includes(b.state);
      if (!inside) {
        end(b.state === "pass" ? "pass" : b.state === "shot" ? "shot" :
          a?.team === spell?.defending ? "lost" : !defending ? "cleared" : "other");
        continue;
      }
      if (spell && spell.team !== a.team) end("other");
      if (!spell) {
        const receipt = lastAcquisition.get(a.id);
        const justReceived = receipt && e.t - receipt.t <= dt + 0.01;
        const origin = b.restartType || e.t < e.deadBallUntil ? "restart" : !justReceived ? "carry-entry" :
          receipt.state === "pass" && receipt.kickTeam === a.team ?
            `${receipt.cross ? "cross" : receipt.through ? "through" : "pass"}-${receipt.fromBox ? "inside" : "outside"}` : receipt.kind;
        spell = { seed, at: e.t, team: a.team, defending, ownerId: a.id, role: a.role, roleId: a.roleId,
          x: b.x, y: b.y, attackSince: e._teamAttackSince[a.team], seconds: 0, origin,
          receipt: receipt ? { ...receipt } : null, defenseBlock: {},
          nearestSum: 0, presserSum: 0, snapshot: e.agents.map(player) };
      }
      spell.seconds += elapsed;
      bump(timeByOrigin, spell.origin, elapsed);
      bump(timeByRole, `${a.role}:${a.roleId}`, elapsed);
      const control = b.state === "control" ? "first-touch" : a.pendingBallAction ? "preparing" :
        a.intent?.type === "dribble" && e.t < a.decisionUntil ? "dribble-until-decision" : a.intent?.type || "other";
      bump(timeByControl, control, elapsed);
      const opponents = e.agents.filter((p) => p.team === defending && p.role !== "GK" && !p.sentOff && !p.injuredOff);
      const nearest = Math.min(...opponents.map((p) => distance(p, b)));
      const plan = e._defPlans[defending];
      const presser = opponents.find((p) => plan?.jobs.get(p.id)?.type === "press");
      const pressDistance = presser ? distance(presser, b) : Infinity;
      const block = e.t < e.deadBallUntil ? "restart" : e.t < (a.protectUntil || 0) ? "receiver-protected" :
        e.t - (e._teamAttackSince[a.team] || 0) < 6.5 ? "new-possession" :
        e.t < (e._teamTackleUntil[defending] || 0) ? "team-cooldown" : !presser ? "no-presser" :
        e.t < (presser.tackleCdUntil || 0) ? "player-cooldown" : pressDistance > 2.2 ? "presser-over-2.2m" : "presser-within-2.2m";
      bump(timeByDefenseBlock, block, elapsed);
      bump(spell.defenseBlock, block, elapsed);
      spell.nearestSum += nearest * elapsed;
      if (Number.isFinite(pressDistance)) spell.presserSum += pressDistance * elapsed;
    }
    end("match-end");
    return { seed, score: e.score, draws, stateHash: hash(e.snapshot()), eventsHash: hash(e.events),
      framesHash: seed === 372000 ? frames.digest("hex") : null };
  } finally { Math.random = originalRandom; }
}
for (let i = 0; i < count; i++) {
  const seed = 372000 + i;
  const bare = i === 0 ? play(seed, false) : null;
  const observed = play(seed, true);
  if (bare) assert.deepEqual(observed, bare, "observation changed match state, events, RNG or frames");
  matches.push(observed);
}
const per = (n) => round(n / count);
const groups = (rows, key) => rows.reduce((obj, row) => { bump(obj, key(row)); return obj; }, {});
const origin = Object.fromEntries(Object.entries(timeByOrigin).map(([key, value]) => {
  const rows = spells.filter((r) => r.origin === key);
  return [key, { spellsPerMatch: per(rows.length), secondsPerMatch: per(value),
    averageSeconds: round(value / rows.length), endings: groups(rows, (r) => r.ending) }];
}));
const summary = { label, profile, matches, observerComparedSeed: 372000,
  fixture: "box-possession-sampling-audit (same names, attributes, tactics, seeds and sampling clock)",
  engineSha256: createHash("sha256").update(readFileSync(new URL("../js/sim/engine.js", import.meta.url))).digest("hex"),
  preloads: process.execArgv, createdAt: new Date().toISOString(), boxSpellsPerMatch: per(spells.length),
  boxSecondsPerMatch: per(spells.reduce((n, r) => n + r.seconds, 0)), origin,
  controlSecondsPerMatch: Object.fromEntries(Object.entries(timeByControl).map(([key, value]) => [key, per(value)])),
  defenseBlockSecondsPerMatch: Object.fromEntries(Object.entries(timeByDefenseBlock).map(([key, value]) => [key, per(value)])),
  roleSecondsPerMatch: Object.fromEntries(Object.entries(timeByRole).map(([key, value]) => [key, per(value)])),
  inBoxDecisions: groups(decisions.filter((r) => r.inBox), (r) => r.action),
  passCountPerMatch: per(passes.length), passFlow: groups(passes, (r) => `${r.fromBox ? "inside" : "outside"}->${r.toBox ? "inside" : "outside"}`),
  longestSpells: [...spells].sort((a, b) => b.seconds - a.seconds).slice(0, 12).map(({ snapshot, ...row }) => row),
};
writeFileSync(output, `${JSON.stringify({ summary, spells, decisions, acquisitions, passes, carryContacts }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
