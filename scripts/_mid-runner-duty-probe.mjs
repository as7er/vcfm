import { SimEngine } from "../js/sim/engine.js";
const attrs = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
  "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning",
  "kicking", "decisions", "crossing"];
function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-p${i}`, name: `${id}-p${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(attrs.map((key) => [key, 15 + ((i * 7 + 15) % 5) - 2])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id),
    pressing: 3, tempo: 3, defensiveLine: 3 } };
}
const rows = [];
for (const seed of [372000, 372001, 372002, 372003, 372004, 372005]) {
  const e = new SimEngine(club(`h${seed}`), club(`a${seed}`), { random: () => 0.5 });
  for (const a of e.agents.filter((p) => p.role === "MID")) {
    rows.push({ seed, id: a.id, role: a.roleId, duty: a.dutyId, position: a.detailedPosition,
      habits: [...a.habits], primary: e._isPrimaryMidRunner(a), core: a.isCore,
      support: e._roleBehavior(a, "support"), depth: e._roleBehavior(a, "depth"),
      wantsToComeDeep: e._hasHabit(a, "comes_deep") ||
        (!e._hasHabit(a, "gets_forward") && e._roleBehavior(a, "support") > 0.52) });
  }
}
console.log(JSON.stringify(rows, null, 2));
