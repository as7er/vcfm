// Colour-literal audit for css/style.css.
//
// Question: which hardcoded hex literals can be replaced with a token reference
// and be *provably* a no-op?
//
// The catch that makes colours harder than font sizes: every project token is
// theme-dependent (--primary is #3d8bfd in dark, #2563eb in light). So a literal
// that happens to equal the dark value is NOT safe to alias in a rule that also
// applies to the light theme — aliasing would make it theme-aware, i.e. a real
// change. The only provably-safe class is:
//
//   a literal that appears inside a rule already scoped to one theme, whose
//   value equals THAT theme's token value.
//
// Everything else is reported, not rewritten.
//
// Usage: node scripts/_color-dedup-audit.mjs [--json]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(`${root}css/style.css`, "utf8");

// ── 1. Read the two token blocks so we know each theme's values ──────────────
function tokenBlock(re) {
  const m = css.match(re);
  if (!m) throw new Error(`token block not found: ${re}`);
  const out = {};
  for (const decl of m[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    const v = decl[2].trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) out[decl[1]] = v.toLowerCase();
  }
  return out;
}
const darkTokens = tokenBlock(/:root,\s*\nhtml\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
const lightTokens = tokenBlock(/html\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/);

// value -> token name (first wins), per theme
const darkByValue = {}, lightByValue = {};
for (const [k, v] of Object.entries(darkTokens)) if (!darkByValue[v]) darkByValue[v] = k;
for (const [k, v] of Object.entries(lightTokens)) if (!lightByValue[v]) lightByValue[v] = k;

// ── 2. Find every rule whose selector mentions data-theme, with its line span ─
const lines = css.split("\n");
const scoped = []; // {theme, start, end}
let depth = 0;
let pending = []; // selectors awaiting their block
for (let i = 0; i < lines.length; i++) {
  const code = lines[i].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/, "");
  if (!code.trim()) continue;
  const opens = (code.match(/\{/g) || []).length;
  const closes = (code.match(/\}/g) || []).length;
  if (opens > closes && /data-theme\s*=\s*"(light|dark)"/.test(code)) {
    const theme = /data-theme\s*=\s*"light"/.test(code) ? "light" : "dark";
    scoped.push({ theme, start: i + 1, depth: depth + opens - closes, open: true });
  }
  depth += opens - closes;
  for (const s of scoped) {
    if (s.open && depth < s.depth) { s.end = i + 1; s.open = false; }
  }
  pending.length = 0;
}
for (const s of scoped) if (s.open) s.end = lines.length;

function themeAt(line) {
  for (const s of scoped) if (line >= s.start && line <= s.end) return s.theme;
  return null;
}

// ── 3. Classify every hex occurrence ────────────────────────────────────────
const occ = [];
for (let i = 0; i < lines.length; i++) {
  const code = lines[i].replace(/\/\*[\s\S]*?\*\//g, "");
  for (const h of code.match(/#[0-9a-fA-F]{3,8}\b/g) || []) {
    occ.push({ line: i + 1, hex: h.toLowerCase(), theme: themeAt(i + 1), text: code.trim().slice(0, 100) });
  }
}

const safe = [];      // provably no-op alias
const spelling = [];  // #ffffff -> #fff (same colour, spelling only)
const rest = [];
for (const o of occ) {
  const canon = o.hex === "#ffffff" ? "#fff" : o.hex;
  if (o.theme) {
    const table = o.theme === "light" ? lightByValue : darkByValue;
    const token = table[canon];
    if (token) { safe.push({ ...o, token, theme: o.theme }); continue; }
  }
  if (o.hex === "#ffffff") { spelling.push(o); continue; }
  rest.push(o);
}

// ── 4. Report ───────────────────────────────────────────────────────────────
const byToken = {};
for (const s of safe) {
  const k = `${s.theme}  ${s.hex} -> var(${s.token})`;
  byToken[k] = (byToken[k] || 0) + 1;
}

console.log(JSON.stringify({
  hexOccurrences: occ.length,
  distinctHex: new Set(occ.map((o) => o.hex)).size,
  scopedRules: scoped.length,
  insideThemeScope: occ.filter((o) => o.theme).length,
  provablyNoopAliases: safe.length,
  spellingOnly: spelling.length,
  leftAlone: rest.length,
}));

console.log("\n=== A. 可证明无操作的令牌别名（主题作用域内，值等于该主题令牌）===");
for (const [k, v] of Object.entries(byToken).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(44)} x${v}`);
}

console.log("\n=== B. 仅拼写不一致（同色，两种写法）===");
console.log(`  #ffffff -> #fff   x${spelling.length}`);

console.log("\n=== C. 留在原处（需设计决策，本轮不动）===");
const restByHex = {};
for (const o of rest) {
  const k = `${o.hex}${o.theme ? ` [${o.theme}]` : " [base]"}`;
  restByHex[k] = (restByHex[k] || 0) + 1;
}
const restEntries = Object.entries(restByHex).sort((a, b) => b[1] - a[1]);
console.log(`  不同值 ${restEntries.length}，总次数 ${rest.length}`);
for (const [k, v] of restEntries.slice(0, 30)) console.log(`    ${k.padEnd(22)} x${v}`);

if (process.argv.includes("--json")) {
  console.log("\n=== JSON ===");
  console.log(JSON.stringify({ safe, spelling, rest }, null, 1));
}
