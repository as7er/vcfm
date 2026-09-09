// A cross must assess the same destination used by its flight and receiver.
// Keep the two existing target draws, including their order, for each candidate.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source).replace(/\r\n/g, "\n");
  const start = source.indexOf("  _bestCross(a) {");
  const end = source.indexOf("  _bestCutback(a) {", start);
  assert.ok(start >= 0 && end > start);
  let method = source.slice(start, end);
  const target = '      const tx = clamp(m.x * 0.55 + 50 * 0.45 + (this.random() - 0.5) * 6, 28, 72);\n' +
    '      const ty = clamp(goalY - dir * (8 + this.random() * 6), 4, 96);\n';
  assert.equal(method.split(target).length, 2, "unique cross destination");
  method = method.replace(target, "");
  method = method.replace("      const value =\n", `${target}      let value =\n`);
  method = method.replace("this._laneSafety(a, m)", "this._laneSafety(a, m, tx, ty)");
  method = method.replace('if (m === a || m.team !== a.team || m.role === "GK") continue;',
    'if (m === a || m.team !== a.team || m.role === "GK" || m.sentOff || m.injuredOff) continue;');
  if (process.argv.includes("--cross-offside")) {
    method = method.replace("      // 落点：禁区内前点/中点，不是脚下",
      '      if (!this.ball.offsideExemptRestart && this._isOffsidePosition(a.team, m)) {\n' +
      '        value *= 0.16 + (1 - a.attr.vision) * 0.34;\n' +
      '      }\n      // 落点：禁区内前点/中点，不是脚下');
  }
  source = source.slice(0, start) + method + source.slice(end);
  return { ...result, source };
} });
