// A teammate who is not receiving a purposeful pass need not reach out for it.
// Keep near-foot contact, contested crosses, off-course balls and abandoned runs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const marker = "  _resolvePossession(dt) {";
  assert.equal(source.split(marker).length, 2);
  source = source.replace(marker, `  _yieldsToPassReceiver(a, ballDistance) {
    const b = this.ball;
    if (b.state !== "pass" || b.isCrossPass || a.team !== b.kickTeam ||
        a.id === b.receiverId || ballDistance <= 1.1 ||
        !Number.isFinite(b.targetX) || !Number.isFinite(b.targetY) ||
        this.t >= b.expectedAt) return false;
    const receiver = b.receiverId && this.agentById(b.receiverId);
    if (!receiver || receiver.team !== a.team || receiver.sentOff || receiver.injuredOff) return false;
    const target = pitchVectorMetres(b.targetX - b.x, b.targetY - b.y);
    const velocity = pitchVectorMetres(b.vx, b.vy);
    const speed = Math.hypot(velocity.x, velocity.y);
    if (speed <= 1 || Math.hypot(target.x, target.y) <= SIM.CONTROL_RADIUS_METRES) return false;
    const along = (target.x * velocity.x + target.y * velocity.y) / speed;
    const across = Math.abs(target.x * velocity.y - target.y * velocity.x) / speed;
    if (along <= 0 || across > SIM.CONTROL_RADIUS_METRES) return false;
    const rx = b.targetX - receiver.x, ry = b.targetY - receiver.y;
    const gap = Math.hypot(rx, ry);
    if (gap > 1e-6) {
      const runSpeed = playerRunSpeed(receiver);
      const accel = playerAcceleration(receiver, runSpeed);
      const current = Math.max(0, (receiver.vx * rx + receiver.vy * ry) / gap);
      const available = b.expectedAt - this.t;
      const accelerateFor = Math.min(available, Math.max(0, runSpeed - current) / accel);
      const reachable = current * accelerateFor + 0.5 * accel * accelerateFor ** 2 +
        runSpeed * (available - accelerateFor);
      const metresPerUnit = pitchDistanceBetween(receiver.x, receiver.y, b.targetX, b.targetY) / gap;
      if ((gap - reachable) * metresPerUnit > SIM.CONTROL_RADIUS_METRES) return false;
    }
    return true;
  }

` + marker);
  const begin = source.indexOf("    let bestD = SIM.CONTROL_RADIUS_METRES + speedMps * 0.04;");
  const end = source.indexOf("    // 小禁区慢球", begin);
  assert.ok(begin > 0 && end > begin);
  let block = source.slice(begin, end);
  const measure = "      const d = pitchDistanceBetween(a.x, a.y, b.x, b.y);";
  assert.equal(block.split(measure).length, 2);
  assert.equal(block.split("      if (d < bestD) {").length, 2);
  block = block.replace("      if (d < bestD) {", "      if (d < bestD && !this._yieldsToPassReceiver(a, d)) {");
  source = source.slice(0, begin) + block + source.slice(end);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ passReceiverAgencyCandidate: { loadedEngineSha256 } })));
