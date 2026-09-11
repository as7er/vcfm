// A fallback carry must not ignore a visible obstacle and a safe backward outlet.
// Reuse the choices already evaluated for this decision; no extra random draws,
// running speed, shooting accuracy, shot cooldown or tackle probability changes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const begin = source.indexOf("    // ——————————— 近距离/弧顶射门区");
  const end = source.indexOf("    // ——————————— 边锋高位", begin);
  assert.ok(begin > 0 && end > begin);
  let block = source.slice(begin, end);
  const pass = "      const passTo = this._bestPass(a);";
  assert.equal(block.split(pass).length, 2);
  block = block.replace(pass, "      const passOptions = this._passCandidates(a);\n      const passTo = passOptions[0] || null;");
  const fallback = `      a.intent = {
        type: "dribble",
        tx: clamp(a.x + (goalX - a.x) * tuckIn, 4, 96),
        ty: clamp(a.y + dir * (core || isWing ? 8 : 6), 3, 97),
      };`;
  const normalized = block.replace(/\r\n/g, "\n");
  assert.equal(normalized.split(fallback).length, 2);
  block = normalized.replace(fallback, fallback + `
      const release = this._blockedCarryRelease(a, a.intent, passOptions);
      if (release) {
        this._pass(a, release);
        return;
      }`);
  source = source.slice(0, begin) + block + source.slice(end);
  const anchor = "  _forwardDribbleIntent(a) {";
  assert.equal(source.split(anchor).length, 2);
  source = source.replace(anchor, `  _blockedCarryRelease(a, intent, options) {
    const dx = intent.tx - a.x, dy = intent.ty - a.y;
    const squared = dx * dx + dy * dy;
    if (squared < 1e-8) return null;
    // Use the same body envelope as the movement solver, including its current
    // anisotropy. No geometry change is hidden in this decision correction.
    const blocked = this.agents.some((o) => {
      if (o.team === a.team || o.sentOff || o.injuredOff) return false;
      const along = ((o.x - a.x) * dx + (o.y - a.y) * dy) / squared;
      return along > 0 && along < 1 && Math.hypot(o.x - a.x - dx * along, o.y - a.y - dy * along) <
        this.separationMinDistanceUnits;
    });
    if (!blocked) return null;
    const dir = this.attackDir(a.team);
    let best = null, bestSafety = -Infinity;
    for (const option of options) {
      if (!option.agent || option.agent.sentOff || option.agent.injuredOff || option.cross || option.through ||
          (option.ty - a.y) * dir >= 0) continue;
      const safety = this._laneSafety(a, option.agent, option.tx, option.ty);
      if (safety < 1.8 / 8 || safety <= bestSafety ||
          this.agents.some((o) => o.team !== a.team && o.role !== "GK" && !o.sentOff && !o.injuredOff &&
            pitchDistanceBetween(o.x, o.y, option.tx, option.ty) < 2)) continue;
      best = option;
      bestSafety = safety;
    }
    return best;
  }

` + anchor);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ blockedCarryReleaseCandidate: { loadedEngineSha256 } })));
