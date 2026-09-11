// Record new global-movement work separately from the completed v253 archive.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [label, ...args] = process.argv.slice(2);
assert.match(label || "", /^[a-z0-9-]+$/);
assert.ok(args.length);
const root = new URL("../", import.meta.url);
const directory = new URL(".tmp-continuity/global-movement/checks/", root);
mkdirSync(directory, { recursive: true });
for (const suffix of [".json", ".log", ".err.log"]) {
  assert.ok(!existsSync(new URL(`${label}${suffix}`, directory)), "use a new evidence label");
}
const hash = (data) => createHash("sha256").update(data).digest("hex");
const startedAt = new Date().toISOString();
const engine = new URL("js/sim/engine.js", root);
const sourceHash = hash(readFileSync(engine));
const entryHashes = Object.fromEntries(args.filter((arg) => /\.(?:m?js)$/.test(arg))
  .map((arg) => [arg, hash(readFileSync(new URL(arg, root)))]));
const child = spawn(process.execPath, args, {
  cwd: fileURLToPath(root), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
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
  const record = { label, args, startedAt, completedAt: new Date().toISOString(), exitCode,
    sourceHash, entryHashes, sourceHashAfter: hash(readFileSync(engine)),
    stdoutSha256: hash(stdout), stderrSha256: hash(stderr) };
  writeFileSync(new URL(`${label}.json`, directory), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record));
  console.log(stdout.slice(-2000));
  if (stderr) console.error(stderr.slice(-2000));
  process.exitCode = exitCode ?? 1;
});
