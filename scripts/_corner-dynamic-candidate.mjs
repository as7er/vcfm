// Corner experiment: a signalled approach run, goalmouth occupation and varied
// deliveries. Both markers and attackers react to the same pre-kick signal.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const routineURL = new URL("../js/corner-routines.js", import.meta.url).href;
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== routineURL && url !== engineURL) return result;
  let source = String(result.source).replace(/\r\n/g, "\n");
  const replace = (anchor, replacement) => {
    assert.equal(source.split(anchor).length, 2, `unique corner anchor: ${anchor}`);
    source = source.replace(anchor, replacement);
  };
  if (url === engineURL) {
    replace("cornerDelivery(this._cornerRoutine, this.agents, a) || best",
      "cornerDelivery(this._cornerRoutine, this.agents, a, this.random()) || best");
    return { ...result, source };
  }
  replace("const zones = [at(side * 3, 6.5), at(-side * 0.5, 8.5), at(-side * 4.5, 8)];",
    "const zones = [at(side * 3, 4.5), at(-side * 0.5, 8.5), at(-side * 4.5, 5)];");
  replace("(i === 0 ? 4 : 5) / MY", "(i === 0 ? 8 : 9) / MY");
  replace("const support = [at(side * 9, 9.5),", "const support = [at(side * 9, 4.5),");
  replace("at(-side * 8, 12)", "at(-side * 8, 9.5)");
  replace("export function cornerDelivery(routine, agents, taker) {",
    "export function cornerDelivery(routine, agents, taker, roll = null) {");
  replace("  let best = null;", "  let best = null;\n  const choices = [];");
  replace("    if (!best || value > best.value) best =",
    "    choices.push({ agent: null, value, cross: true, through: false, tx: target.x, ty: target.y });\n" +
    "    if (!best || value > best.value) best =");
  replace("  return best;\n}", `  if (!choices.length || !Number.isFinite(roll)) return best;
  const weights = choices.map((choice) => Math.exp((choice.value - best.value) / 0.16));
  let remaining = clamp(roll, 0, 1) * weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < choices.length; i++) {
    remaining -= weights[i];
    if (remaining <= 0) return choices[i];
  }
  return choices[choices.length - 1];
}`);
  replace(`  if (ball.state === "corner" && ball.owner === routine.takerId) {
    return routine.positions.get(player.id) || null;
  }`, `  if (ball.state === "corner" && ball.owner === routine.takerId) {
    const stage = routine.positions.get(player.id);
    if (now < routine.startedAt + 0.8) return stage || null;
    const arrival = routine.runs.get(player.id);
    if (arrival && stage) return {
      x: stage.x + (arrival.x - stage.x) * 0.35,
      y: stage.y + (arrival.y - stage.y) * 0.35,
    };
    const markedId = routine.marks.get(player.id);
    const marked = markedId ? agents.find((a) => a.id === markedId && active(a)) : null;
    if (marked && routine.runs.has(markedId)) return {
      x: clamp(marked.x - routine.side * 1.2 / MX, 3, 97),
      y: clamp(marked.y + routine.attackDirection * 1.8 / MY, 0.75, 99.25),
    };
    return stage || null;
  }`);
  return { ...result, source };
} });
