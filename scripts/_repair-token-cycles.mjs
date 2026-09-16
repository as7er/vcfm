// Repair the self-referential custom properties introduced by _color-dedup.mjs.
//
// The bug: that migration classified the token-definition blocks
// (`:root, html[data-theme="dark"]` and `html[data-theme="light"]`) as ordinary
// theme scopes, so it rewrote `--bg: #0b1220` into `--bg: var(--bg)`. A custom
// property that references itself is a cycle: it becomes invalid at
// computed-value time, every `var(--bg)` consumer falls back to the initial
// value, and the whole page loses its palette (black background, invisible text).
//
// Legitimate cross-references (`--input-bg: var(--bg2)`) are preserved: only a
// line whose property name equals the referenced token is a self-reference.
//
// Dry run: node scripts/_repair-token-cycles.mjs
// Apply:   node scripts/_repair-token-cycles.mjs --write
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const write = process.argv.includes("--write");
const rev = process.argv.find((a) => a.startsWith("--rev="))?.slice(6) || "HEAD~1";

const path = `${root}css/style.css`;
const current = readFileSync(path, "utf8");
const previous = execFileSync("git", ["show", `${rev}:css/style.css`], { cwd: root, encoding: "utf8" });

const SELF = /^(\s*)(--[a-z0-9-]+):\s*var\(\2\);\s*$/;

// Build name -> value from the previous revision, keeping the two token blocks
// separate so `--bg` in the dark block is not confused with `--bg` in light.
function blocks(css) {
  const out = [];
  const re = /(:root,\s*\nhtml\[data-theme="dark"\]\s*\{|html\[data-theme="light"\]\s*\{)([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const map = {};
    for (const d of m[2].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) map[d[1]] = d[2].trim();
    out.push({ start: m.index, end: m.index + m[0].length, map });
  }
  return out;
}
const prevBlocks = blocks(previous);
const curBlocks = blocks(current);

let repaired = 0;
const lines = current.split("\n");

// Walk the current file, tracking which token block each line belongs to by
// character offset.
let offset = 0;
const lineStarts = lines.map((l) => { const s = offset; offset += l.length + 1; return s; });

for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(SELF);
  if (!m) continue;
  const name = m[2];
  const at = lineStarts[i];
  const cur = curBlocks.find((b) => at >= b.start && at <= b.end);
  const prev = cur ? prevBlocks[curBlocks.indexOf(cur)] : null;
  const value = prev?.map[name];
  if (!value) {
    console.log(`  UNRESOLVED ${i + 1}: ${name} (no value in ${rev})`);
    continue;
  }
  if (/var\(/.test(value)) {
    console.log(`  SKIP ${i + 1}: ${name} -> ${value} (previous value is itself a reference)`);
    continue;
  }
  lines[i] = `${m[1]}${name}: ${value};`;
  repaired++;
  console.log(`  ${i + 1}: ${name}: var(${name}) -> ${value}`);
}

console.log(JSON.stringify({ rev, selfReferencesRepaired: repaired, mode: write ? "write" : "dry-run" }));
if (write && repaired) writeFileSync(path, lines.join("\n"));
