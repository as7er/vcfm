// The arrival task is valid only for an active defender in the same live pass.
import "./_defensive-pass-momentum-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const anchor = "      a._passIntercept && a._passIntercept.passAt === this.ball.lastPassAt && this.ball.kickTeam !== a.team";
  assert.equal(source.split(anchor).length, 2);
  source = source.replace(anchor, anchor + ` &&
        !a.sentOff && !a.injuredOff && a.role !== "GK" && a.fsm === "press" &&
        !this.ball.restartType && !this.ball.isCrossPass && this.t >= (this.deadBallUntil || 0)`);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ defensivePassLifetimeCandidate: { loadedEngineSha256 } })));
