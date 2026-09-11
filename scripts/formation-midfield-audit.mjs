import assert from "node:assert/strict";
import { FORMATIONS, defaultRoleForSlot } from "../js/data.js";
import { slotPositionCode } from "../js/player-positions.js";
import { roleFitsPosition } from "../js/player-roles.js";
import { ensureLineupRoles, ensureTactics } from "../js/models.js";
const rows = Object.entries(FORMATIONS).map(([name, formation]) => ({ name,
  codes: formation.slots.map((slot, i, slots) => slotPositionCode(slot, i, slots)),
  roles: formation.slots.map((slot, i, slots) => defaultRoleForSlot(slot, i, slots)) }));
console.log(JSON.stringify(rows, null, 2));
const f433 = rows.find((r) => r.name === "4-3-3");
assert.deepEqual(f433.codes.slice(5, 8), ["CM", "CM", "CM"], "4-3-3 must have three central midfielders");
assert.deepEqual(f433.roles.slice(5, 8), ["cm_central", "cm_central", "cm_central"]);
for (const row of rows) {
  for (let i = 0; i < row.codes.length; i++) {
    assert.ok(roleFitsPosition(row.roles[i], row.codes[i]), `${row.name}: ${row.roles[i]} cannot play ${row.codes[i]}`);
  }
  const club = { tactics: { formation: row.name, roles: [], duties: [] } };
  ensureTactics(club);
  const before = JSON.stringify(club.tactics);
  ensureLineupRoles(club);
  assert.equal(JSON.stringify(club.tactics), before, "normalizing a valid formation must be stable");
}
for (const name of ["4-4-2", "4-2-3-1", "3-5-2", "3-4-3", "4-1-4-1", "4-5-1"]) {
  const row = rows.find((r) => r.name === name);
  assert.ok(row.codes.includes("LM") && row.codes.includes("RM"), `${name} must retain wide midfielders`);
}
const saved = { tactics: { formation: "4-3-3", roles: [...f433.roles], duties: [] } };
saved.tactics.roles[5] = "winger";
saved.tactics.roles[7] = "winger";
ensureTactics(saved);
assert.deepEqual(saved.tactics.roles.slice(5, 8), f433.roles.slice(5, 8), "saved incompatible roles must normalize");
console.log("Formation midfield audit passed");
