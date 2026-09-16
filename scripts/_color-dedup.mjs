// One-off migration: replace colour literals that are *provably* equivalent to a
// token with a token reference.
//
// Dry run:  node scripts/_color-dedup.mjs
// Apply:    node scripts/_color-dedup.mjs --write
//
// Only two classes are touched, both of which are provable no-ops:
//
//   A. a literal inside a rule already scoped to one theme, whose value equals
//      THAT theme's token value. (Replacing it with var(--token) resolves to the
//      same value, because the token is redefined in that very scope.)
//   B. #ffffff -> #fff  (identical colour, two spellings)
//
// Base-scope literals are NOT touched: every project token is theme-dependent, so
// aliasing a base-scope literal would silently make it theme-aware — a real
// change, not a dedup. Those need per-rule design decisions.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const write = process.argv.includes("--write");

function tokenBlock(css, re) {
  const m = css.match(re);
  if (!m) throw new Error("token block not found");
  const out = {};
  for (const d of m[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    const v = d[2].trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) out[d[1]] = v.toLowerCase();
  }
  return out;
}

const FILES = ["css/style.css"];
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

let totalA = 0;
let totalB = 0;
const moved = [];

for (const rel of FILES) {
  const path = `${root}${rel}`;
  let css = readFileSync(path, "utf8");

  const dark = tokenBlock(css, /:root,\s*\nhtml\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
  const light = tokenBlock(css, /html\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/);
  // Only values that map to EXACTLY ONE token are usable. A value shared by
  // several tokens (e.g. #1e293b is --toast-bg, --surface-inset and --bar-track)
  // cannot be aliased without *inventing* which role the rule meant — that is not
  // dedup, so those are skipped.
  const byValue = (t) => {
    const seen = {};
    for (const [k, v] of Object.entries(t)) (seen[v] ||= []).push(k);
    const o = {};
    for (const [v, names] of Object.entries(seen)) if (names.length === 1) o[v] = names[0];
    return o;
  };
  const darkBy = byValue(dark);
  const lightBy = byValue(light);

  // line ranges of data-theme-scoped rules
  const lines = css.split("\n");
  const scoped = [];
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].replace(/\/\*[\s\S]*?\*\//g, "");
    const o = (code.match(/\{/g) || []).length;
    const c = (code.match(/\}/g) || []).length;
    if (o > c && /data-theme\s*=\s*"(light|dark)"/.test(code)) {
      scoped.push({ theme: /data-theme\s*=\s*"light"/.test(code) ? "light" : "dark", start: i + 1, depth: depth + o - c, open: true });
    }
    depth += o - c;
    for (const s of scoped) if (s.open && depth < s.depth) { s.end = i + 1; s.open = false; }
  }
  for (const s of scoped) if (s.open) s.end = lines.length;
  const themeAt = (n) => scoped.find((s) => n >= s.start && n <= s.end)?.theme || null;

  const out = lines.map((line, idx) => {
    const n = idx + 1;
    const theme = themeAt(n);
    return line.replace(HEX, (hexRaw) => {
      const hex = hexRaw.toLowerCase();
      if (theme) {
        const token = (theme === "light" ? lightBy : darkBy)[hex];
        if (token) {
          totalA++;
          moved.push({ rel, line: n, from: hexRaw, to: `var(${token})`, theme });
          return `var(${token})`;
        }
      }
      if (hex === "#ffffff") {
        totalB++;
        moved.push({ rel, line: n, from: hexRaw, to: "#fff", theme: "spelling" });
        return "#fff";
      }
      return hexRaw;
    });
  });

  const next = out.join("\n");
  if (write && next !== css) {
    writeFileSync(path, next);
    css = next;
    console.log(JSON.stringify({ wrote: rel }));
  }
}

console.log(JSON.stringify({ mode: write ? "write" : "dry-run", classA_tokenAliases: totalA, classB_spelling: totalB, total: moved.length }));
const byTo = {};
for (const m of moved) {
  const k = `${m.from} -> ${m.to}`;
  byTo[k] = (byTo[k] || 0) + 1;
}
console.log("--- 明细 ---");
for (const [k, v] of Object.entries(byTo).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(42)} x${v}`);
}
