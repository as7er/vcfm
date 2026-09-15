// Print the transitive local-import closure of one or more candidate modules.
//
// Candidate bundles in this repo are built by importing a chain of smaller
// candidate modules, so the patch actually applied by a bundle is the union of
// every module in the closure. Attribution therefore needs the closure tree,
// not just the top-level file.
//
// Usage:
//   node scripts/_candidate-import-closure.mjs <candidate.mjs> [...]
//
// Output: one line per module, indented by depth, in load order, plus a flat
// list of unique modules in the order Node would execute them.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const IMPORT_RE = /^\s*import\s+(?:[^"']*?\sfrom\s+)?["']([^"']+)["']/gm;

function localImports(file) {
  const text = fs.readFileSync(file, "utf8");
  const out = [];
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (!spec.startsWith(".")) continue;
    out.push(path.resolve(path.dirname(file), spec));
  }
  return out;
}

function walk(file, depth, seen, order, lines, stack) {
  const label = path.relative(HERE, file).replace(/\\/g, "/");
  const isCycle = stack.includes(file);
  lines.push(`${"  ".repeat(depth)}${path.basename(file)}${isCycle ? "  [cycle]" : ""}`);
  if (isCycle) return;
  if (seen.has(file)) {
    lines[lines.length - 1] += "  [already loaded]";
    return;
  }
  seen.add(file);
  order.push(label);
  stack.push(file);
  for (const child of localImports(file)) walk(child, depth + 1, seen, order, lines, stack);
  stack.pop();
}

const roots = process.argv.slice(2).map((p) => path.resolve(HERE, p));
if (roots.length === 0) {
  console.error("usage: node scripts/_candidate-import-closure.mjs <candidate.mjs> [...]");
  process.exit(2);
}

const seen = new Set();
const order = [];
const lines = [];
for (const root of roots) {
  if (!fs.existsSync(root)) throw new Error(`missing candidate: ${root}`);
  walk(root, 0, seen, order, lines, []);
}

console.log(lines.join("\n"));
console.log("");
console.log(`# closure size: ${order.length}`);
order.forEach((label, i) => console.log(`${String(i + 1).padStart(3, " ")}. ${label}`));
