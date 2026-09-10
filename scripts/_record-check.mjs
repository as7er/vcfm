// Run one audit with literal argv and keep stdout, stderr and its exit status.
// This avoids PowerShell redirection/encoding and preserves failed candidates.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [label, ...args] = process.argv.slice(2);
assert.match(label || "", /^[a-z0-9-]+$/);
assert.ok(args.length);
const directory = new URL("../.tmp-continuity/support-offer/", import.meta.url);
mkdirSync(directory, { recursive: true });
for (const suffix of [".json", ".log", ".err.log"]) {
  assert.ok(!existsSync(new URL(`${label}${suffix}`, directory)), "use a new label to preserve previous results");
}
const hash = (data) => createHash("sha256").update(data).digest("hex");
const startedAt = new Date().toISOString();
const sourceHash = hash(readFileSync(new URL("../js/sim/engine.js", import.meta.url)));
const entryHashes = Object.fromEntries(args.filter((arg) => /\.(?:m?js)$/.test(arg)).map((arg) =>
  [arg, hash(readFileSync(new URL(arg, new URL("../", import.meta.url))))]));
const child = spawn(process.execPath, args, {
  cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let stdout = "";
let stderr = "";
writeFileSync(new URL(`${label}.log`, directory), "");
writeFileSync(new URL(`${label}.err.log`, directory), "");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  appendFileSync(new URL(`${label}.log`, directory), chunk);
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
  appendFileSync(new URL(`${label}.err.log`, directory), chunk);
});
child.on("error", (error) => { stderr += String(error); });
child.on("close", (exitCode) => {
  writeFileSync(new URL(`${label}.log`, directory), stdout);
  writeFileSync(new URL(`${label}.err.log`, directory), stderr);
  const record = { label, args, startedAt, completedAt: new Date().toISOString(), exitCode, sourceHash,
    entryHashes, sourceHashAfter: hash(readFileSync(new URL("../js/sim/engine.js", import.meta.url))),
    stdoutSha256: hash(stdout), stderrSha256: hash(stderr) };
  writeFileSync(new URL(`${label}.json`, directory), JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
  console.log(stdout.slice(-2200));
  if (stderr) console.error(stderr.slice(-2200));
  process.exitCode = exitCode ?? 1;
});
