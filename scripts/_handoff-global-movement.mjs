// Portable evidence for the 2026-09-11 handoff. Production files are never
// restored, and an existing local evidence file is never silently overwritten.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const [mode = "verify", destination] = process.argv.slice(2);
assert.ok(["pack", "verify", "restore"].includes(mode), "use pack, verify or restore [directory]");
assert.ok(!destination || mode === "restore", "a destination is only valid with restore");
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = resolve(root, "docs/evidence/global-movement-handoff-2026-09-11");
const evidenceFile = resolve(root, "docs/evidence/match-global-movement-2026-09-10.json");
const evidence = JSON.parse(readFileSync(evidenceFile, "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const evidenceValueSha256 = hash(JSON.stringify(evidence));
const manifestPath = resolve(directory, "manifest.json");
function targetPath(base, file) {
  assert.match(file, /^\.tmp-continuity\/(?:global-movement|shot-chain)\/[a-zA-Z0-9._/-]+$/);
  assert.ok(!file.split("/").some((part) => part === "." || part === ".."));
  const target = resolve(base, file);
  const within = relative(base, target);
  assert.ok(within && !isAbsolute(within) && within !== ".." && !within.startsWith(`..${sep}`));
  return target;
}

if (mode === "pack") {
  assert.ok(!existsSync(manifestPath), "the existing handoff is immutable; use a new dated handoff");
  const checks = evidence.runs.flatMap((run) => [
    `.tmp-continuity/global-movement/checks/${run.label}.json`, run.stdoutFile, run.stderrFile,
  ]);
  const movement = ["v253-standard", "v253-background", "support-release-standard", "support-release-background"]
    .map((label) => `.tmp-continuity/global-movement/${label}.json`);
  const binaryLabels = new Set(["6-standard-1789111345443", "6-standard-1789118905997", "6-background-1789118865448"]);
  const shots = evidence.shotArtifacts.flatMap(({ label, artifacts }) => [
    artifacts.json.file, ...(binaryLabels.has(label) ? [artifacts.bin.file] : []),
  ]);
  const expected = new Map();
  for (const run of evidence.runs) {
    expected.set(run.stdoutFile, run.stdoutSha256);
    expected.set(run.stderrFile, run.stderrSha256);
  }
  for (const row of evidence.observations) expected.set(row.file, row.sha256);
  for (const row of evidence.shotArtifacts) for (const artifact of Object.values(row.artifacts)) {
    expected.set(artifact.file, artifact.sha256);
  }
  const groups = [];
  mkdirSync(directory, { recursive: true });
  for (const [name, paths] of Object.entries({ checks, movement, shots })) {
    const records = [...new Set(paths)].sort().map((file) => {
      const bytes = readFileSync(targetPath(root, file));
      const sha256 = hash(bytes);
      if (expected.has(file)) assert.equal(sha256, expected.get(file), `archived source changed: ${file}`);
      return { file, bytes: bytes.length, sha256, base64: bytes.toString("base64") };
    });
    const payload = Buffer.from(JSON.stringify(records));
    const packed = gzipSync(payload, { level: 9 });
    const bundle = `${name}.json.gz`;
    writeFileSync(resolve(directory, bundle), packed, { flag: "wx" });
    groups.push({ bundle, sha256: hash(packed), packedBytes: packed.length, payloadBytes: payload.length,
      files: records.map(({ base64, ...record }) => record) });
  }
  const manifest = { version: 1, createdAt: new Date().toISOString(), node: process.version,
    evidenceValueSha256, baselineGit: evidence.baselineGit, finalValidation: evidence.finalValidation,
    scope: "All recorded check logs; baseline/latest movement raw reports; all shot JSON; three selected shot-state binaries. Historical multi-gigabyte observations stay on the original computer.",
    groups };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ mode, groups: groups.map(({ bundle, packedBytes, files }) =>
    ({ bundle, packedBytes, files: files.length })) }, null, 2));
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.evidenceValueSha256, evidenceValueSha256, "the handoff and full evidence summary differ");
  const restoredRoot = destination ? resolve(root, destination) : root;
  const records = [], seen = new Set();
  for (const group of manifest.groups) {
    assert.match(group.bundle, /^[a-z]+\.json\.gz$/);
    const packed = readFileSync(resolve(directory, group.bundle));
    assert.equal(packed.length, group.packedBytes);
    assert.equal(hash(packed), group.sha256, `bundle changed: ${group.bundle}`);
    const payload = gunzipSync(packed, { maxOutputLength: 128 * 1024 * 1024 });
    assert.equal(payload.length, group.payloadBytes);
    const values = JSON.parse(payload);
    assert.equal(values.length, group.files.length);
    for (let index = 0; index < values.length; index++) {
      const { base64, ...record } = values[index];
      assert.deepEqual(record, group.files[index]);
      assert.ok(!seen.has(record.file), `duplicate path: ${record.file}`);
      seen.add(record.file);
      const target = targetPath(restoredRoot, record.file);
      const bytes = Buffer.from(base64, "base64");
      assert.equal(bytes.length, record.bytes);
      assert.equal(hash(bytes), record.sha256, `payload changed: ${record.file}`);
      const present = existsSync(target);
      // Validate the entire restore before writing anything.
      if (mode === "restore" && present) assert.equal(hash(readFileSync(target)), record.sha256,
        `local file differs; preserve it before restoring: ${record.file}`);
      records.push({ target, bytes, present });
    }
  }
  let written = 0;
  if (mode === "restore") for (const record of records) {
    if (record.present) continue;
    mkdirSync(dirname(record.target), { recursive: true });
    writeFileSync(record.target, record.bytes, { flag: "wx" });
    written++;
  }
  console.log(JSON.stringify({ mode, verifiedFiles: records.length, written,
    ...(mode === "restore" ? { destination: restoredRoot } : {}), finalValidation: manifest.finalValidation }));
}
