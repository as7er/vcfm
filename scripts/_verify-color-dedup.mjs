// Verify that every colour literal replaced by scripts/_color-dedup.mjs is a
// value-preserving no-op.
//
// For each line that differs from the pre-change revision, pair the `var(--token)`
// introduced with the hex literal it replaced, resolve the token in the theme
// scope that contains that line, and assert the two values are identical.
//
// Usage: node scripts/_verify-color-dedup.mjs [rev]   (default rev = HEAD)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const rev = process.argv[2] || "HEAD";

const oldCss = execFileSync("git", ["show", `${rev}:css/style.css`], { cwd: root, encoding: "utf8" });
const newCss = readFileSync(`${root}css/style.css`, "utf8");

// git stores LF while the working copy on Windows is CRLF; without normalising,
// every single line looks changed and the pairing below is meaningless.
const strip = (s) => s.replace(/\r\n/g, "\n");
const oldNorm = strip(oldCss);
const newNorm = strip(newCss);

function tokenBlock(css, re) {
  const m = css.match(re);
  if (!m) throw new Error("token block not found");
  const out = {};
  for (const d of m[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[d[1]] = d[2].trim().toLowerCase();
  return out;
}
const themes = {
  dark: tokenBlock(oldCss, /:root,\s*\nhtml\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/),
  light: tokenBlock(oldCss, /html\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/),
};

// theme scope ranges, computed on the OLD file (line numbers align per line index)
function scopesOf(css) {
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
  return scoped;
}
const scopes = scopesOf(oldNorm);
const themeAt = (n) => scopes.find((s) => n >= s.start && n <= s.end)?.theme || null;

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const TOKREF = /var\((--[a-z0-9-]+)\)/g;

// canonical 6-digit form, so #fff and #ffffff compare equal
function canon(h) {
  const s = h.toLowerCase();
  if (s.length === 4) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return s;
}

// every colour-bearing item on a line, in source order: either a var() reference
// or a literal. Pairing these 1:1 against the old line's literals covers both the
// token aliases and the spelling-only change.
function itemsOf(line, resolve) {
  const out = [];
  const re = /var\((--[a-z0-9-]+)\)|#[0-9a-fA-F]{3,8}\b/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m[1]) out.push({ kind: "token", token: m[1], value: resolve(m[1]) });
    else out.push({ kind: "hex", value: canon(m[0]) });
  }
  return out;
}

const oldLines = oldNorm.split("\n");
const newLines = newNorm.split("\n");
if (oldLines.length !== newLines.length) {
  console.log(JSON.stringify({ fatal: "line count changed; cannot pair lines", oldLines: oldLines.length, newLines: newLines.length }));
  process.exit(1);
}

let checked = 0;
const mismatches = [];
const unpaired = [];

for (let i = 0; i < oldLines.length; i++) {
  const o = oldLines[i];
  const n = newLines[i];
  if (o === n) continue;
  const theme = themeAt(i + 1);
  const table = theme ? themes[theme] : null;
  const resolve = (t) => (table ? table[t] : undefined);
  const oldItems = itemsOf(o, resolve);
  const newItems = itemsOf(n, resolve);
  if (oldItems.length !== newItems.length) {
    unpaired.push({ line: i + 1, old: oldItems.map((x) => x.value), new: newItems.map((x) => x.value), theme });
    continue;
  }
  for (let k = 0; k < oldItems.length; k++) {
    const a = oldItems[k];
    const b = newItems[k];
    checked++;
    const bv = b.kind === "token" ? b.value : b.value;
    if (bv === undefined) {
      mismatches.push({ line: i + 1, from: a.value, to: b.token || b.value, reason: `token not resolvable in ${theme || "base"} scope` });
      continue;
    }
    if (a.value !== bv) {
      mismatches.push({ line: i + 1, from: a.value, to: b.token || b.value, theme, resolved: bv, reason: "value differs" });
    }
  }
}

console.log(JSON.stringify({
  rev,
  changedLines: oldLines.filter((l, i) => l !== newLines[i]).length,
  replacementsChecked: checked,
  mismatches: mismatches.length,
  unpairedLines: unpaired.length,
}));

// ── cycle check ─────────────────────────────────────────────────────────────
// The value-preservation check above reads token values from the PREVIOUS
// revision, so it is blind to a replacement that rewrites a token's own
// definition: `--bg: #0b1220` -> `--bg: var(--bg)` "matches" (both sides resolve
// to #0b1220) while actually creating a custom-property cycle that invalidates
// the token and kills the whole palette. That bug shipped once; this check is
// what catches it.
const SELF_REF = /^\s*--([a-z0-9-]+):\s*var\(--\1\);\s*$/;
const cycles = [];
for (let i = 0; i < newLines.length; i++) {
  const m = newLines[i].match(SELF_REF);
  if (m) cycles.push({ line: i + 1, token: m[1], text: newLines[i].trim() });
}
console.log(JSON.stringify({ selfReferentialTokens: cycles.length }));
if (cycles.length) {
  console.log("--- CUSTOM-PROPERTY CYCLES ---");
  for (const c of cycles.slice(0, 10)) console.log("  ", JSON.stringify(c));
}

const ok = mismatches.length === 0 && unpaired.length === 0 && cycles.length === 0;
console.log(ok ? "PASS: every replacement is value-preserving and no token cycles exist" : "FAIL");
