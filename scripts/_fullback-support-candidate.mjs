// A full-back who is far from the ball first connects to play. Distance blends
// readiness to overlap; it never switches the target back to his own half.
import "./_wing-centering-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const begin = source.indexOf("    // —— 边后卫：进攻时套边前插 / 提供传中 ——");
  const end = source.indexOf("    // —— 中卫：近球少接应，否则回位略前压 ——", begin);
  assert.ok(begin > 0 && end > begin);
  source = source.slice(0, begin) + `    // 边后卫先接近进攻队形，同侧且有保护时再套边。
    if (this._isFullback(a)) {
      const wide = a.baseX < 50 ? -1 : 1;
      const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
      const goalY = this.targetGoalY(a.team);
      const ballDepth = Math.abs(b.y - goalY) * my;
      const ballSide = clamp(wide * (b.x - 50) / 25, 0, 1);
      const advance = clamp((prog - 0.38) / 0.2, 0, 1);
      const baseY = clamp(a.baseY + dir * (4 + prog * 5), 6, 94);
      const baseDepth = Math.abs(baseY - goalY) * my;
      const supportDepth = Math.min(baseDepth,
        Math.max(40 - ballSide * 20, ballDepth + 24 - ballSide * 12 + roleHold * 8));
      const supportY = baseY + (goalY - dir * supportDepth / my - baseY) * advance;
      const supportX = clamp(a.baseX + wide * 2 + (b.x - 50) * 0.08, 4, 96);
      const bombOn = prog > 0.38 && (prog > 0.55 ||
        this.random() < 0.32 + a.attr.pace * 0.25 + (getsForward ? 0.12 : 0) + roleDepth * 0.1 - roleHold * 0.08);
      let overlap = 0;
      let overlapX = supportX;
      let overlapY = supportY;
      if (bombOn) {
        overlapX = clamp(wide < 0 ? 8 + this.random() * 6 : 86 + this.random() * 6, 4, 96);
        overlapY = clamp(b.y + dir * (8 + this.random() * 12 + prog * 8), 8, 92);
        const cover = this.agents.filter((m) => m.team === a.team && m.role === "DEF" &&
          !this._isFullback(m) && !m.sentOff && !m.injuredOff && (b.y - m.y) * dir * my >= 5).length;
        const ready = clamp((45 - pitchDistanceBetween(a.x, a.y, b.x, b.y)) / 20, 0, 1);
        if (cover >= 2 && a.dutyId !== "defend" && a.roleId !== "fb_inverted") {
          overlap = advance * ballSide * ready;
        }
      }
      a.tx = supportX + (overlapX - supportX) * overlap;
      a.ty = supportY + (overlapY - supportY) * overlap;
      a.fsm = advance > 0 ? "support" : "home";
      a.offBallTargetKind = advance > 0 ? (overlap > 0.5 ? "overlap-run" : "fullback-support") : null;
      this._clampOffside(a);
      return;
    }

` + source.slice(end);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ fullbackSupportCandidate: { loadedEngineSha256 } })));
