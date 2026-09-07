import assert from "node:assert/strict";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }
  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null;
  }
  setItem(key, value) {
    this.values.set(String(key), String(value));
  }
  removeItem(key) {
    this.values.delete(String(key));
  }
}

const events = [];
const unloadListeners = [];
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};
globalThis.window = {
  addEventListener(type, listener) {
    if (type === "beforeunload") unloadListeners.push(listener);
  },
  dispatchEvent(event) {
    events.push(event);
    return true;
  },
};

const workerInstances = [];
globalThis.Worker = class FailingWorker {
  constructor() {
    this.terminated = false;
    workerInstances.push(this);
  }
  postMessage(message) {
    queueMicrotask(() => this.onmessage?.({ data: { token: message.token, error: "compression failed" } }));
  }
  terminate() {
    this.terminated = true;
  }
};

const save = await import("../js/save.js");
const schema = await import("../js/save-schema.js");

function makeWorld(day, clubId = "audit-club") {
  return {
    version: 7,
    season: 2026,
    day,
    managerName: "Save Audit",
    userClubId: clubId,
    clubs: [{ id: clubId, name: "Audit Club", money: 1000, players: [] }],
    fixtures: [],
    table: { [clubId]: { played: 0, pts: 0 } },
  };
}

assert.equal(save.saveGame(makeWorld(1), 1), true);
assert.equal(save.saveGame(makeWorld(2), 1), true);
assert.equal(save.saveGame(makeWorld(3, "second-club"), 2), true);
save.setActiveSlot(3);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(save.getActiveSlot(), 3, "a delayed fallback write must not change the selected slot");
assert.equal(localStorage.getItem("vcfm_active_slot"), "3");

assert.equal(workerInstances.length, 1, "one worker should serve the queue");
assert.equal(workerInstances[0].terminated, true, "failed worker should be terminated");
assert.equal((await save.loadGame(1)).day, 2, "fallback must persist the newest snapshot for slot 1");
assert.equal((await save.loadGame(2)).day, 3, "fallback must persist the queued snapshot for slot 2");
assert.ok(events.some((event) => event.type === "vcfm-save-error"), "worker failure should reach the UI");

assert.equal(save.saveGame(makeWorld(4), 1), true, "saving should continue after worker failure");
assert.equal((await save.loadGame(1)).day, 4);
assert.equal(workerInstances.length, 1, "disabled worker should not be recreated");
assert.equal(unloadListeners.length, 1, "pending saves should register an unload flush");

const legacy = makeWorld(5);
let repairCalls = 0;
const migrationStages = [];
schema.migrateSaveSchema(legacy, {
  migrations: {
    1: () => {
      repairCalls++;
      migrationStages.push(1);
    },
    2: () => {
      repairCalls++;
      migrationStages.push(2);
    },
    3: (world) => {
      repairCalls++;
      migrationStages.push(3);
      world.scoutingKnowledge = {
        version: 1,
        players: {},
        clubs: {},
        divisions: {},
        nations: {},
      };
    },
  },
});
assert.equal(repairCalls, 3);
assert.deepEqual(migrationStages, [1, 2, 3]);
assert.equal(legacy.schemaVersion, schema.CURRENT_SAVE_SCHEMA_VERSION);
assert.equal(save.importSaveText(JSON.stringify(legacy)).day, 5);

const currentMissingKnowledge = makeWorld(6);
currentMissingKnowledge.schemaVersion = schema.CURRENT_SAVE_SCHEMA_VERSION;
assert.throws(
  () => schema.validateSaveStructure(currentMissingKnowledge),
  /scouting knowledge is missing/
);
schema.migrateSaveSchema(currentMissingKnowledge, {
  ensureCurrent: (world) => {
    world.scoutingKnowledge = {
      version: 1,
      players: {},
      clubs: {},
      divisions: {},
      nations: {},
    };
  },
});
assert.equal(currentMissingKnowledge.schemaVersion, schema.CURRENT_SAVE_SCHEMA_VERSION);
assert.ok(currentMissingKnowledge.scoutingKnowledge);

assert.throws(
  () => save.importSaveText(JSON.stringify({ ...legacy, userClubId: "missing" })),
  /managed club/
);
assert.throws(
  () => save.importSaveText(JSON.stringify({ ...legacy, schemaVersion: 999 })),
  /newer VCFM/
);

console.log(JSON.stringify({
  fallbackSlots: [(await save.loadGame(1)).day, (await save.loadGame(2)).day],
  schemaVersion: legacy.schemaVersion,
  errorEvents: events.length,
}, null, 2));
