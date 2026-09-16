// One-off migration: replace literal font-size values with the --fs-* tokens.
//
// Dry run:  node scripts/_migrate-font-size.mjs
// Apply:    node scripts/_migrate-font-size.mjs --write
//
// Only touches `font-size: <number><unit>`. Leaves `inherit`, `clamp(...)`,
// `max(...)` and the two SVG user-unit sizes (2.8px / 3.2px) alone.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const write = process.argv.includes("--write");

// literal -> token. Chosen to sit on the existing dense clusters so almost every
// declaration moves by <= 0.5px (see the scale comment in css/style.css).
const MAP = {
  "0.5rem": "--fs-4xs", "0.52rem": "--fs-4xs", "0.54rem": "--fs-4xs",
  "0.55rem": "--fs-4xs", "0.56rem": "--fs-4xs", "0.58rem": "--fs-4xs",
  "9.5px": "--fs-3xs",
  "0.62rem": "--fs-3xs", "0.65rem": "--fs-3xs", "10.5px": "--fs-3xs",
  "0.66rem": "--fs-2xs", "0.68rem": "--fs-2xs", "0.69rem": "--fs-2xs", "0.7rem": "--fs-2xs",
  "0.72rem": "--fs-xs", "0.73rem": "--fs-xs", "0.74rem": "--fs-xs",
  "0.75rem": "--fs-xs", "0.76rem": "--fs-xs", "0.78rem": "--fs-xs",
  "0.8rem": "--fs-sm", "0.82rem": "--fs-sm", "0.84rem": "--fs-sm",
  "0.85rem": "--fs-base", "0.86rem": "--fs-base", "0.88rem": "--fs-base", "0.9rem": "--fs-base",
  "0.92rem": "--fs-md", "0.95rem": "--fs-md",
  "0.98rem": "--fs-lg", "1rem": "--fs-lg", "1.02rem": "--fs-lg",
  "1.05rem": "--fs-xl",
  "1.08rem": "--fs-2xl", "1.1rem": "--fs-2xl", "1.15rem": "--fs-2xl",
  "1.25rem": "--fs-3xl",
  "1.35rem": "--fs-4xl", "1.4rem": "--fs-4xl", "1.45rem": "--fs-4xl",
  "1.55rem": "--fs-5xl", "1.6rem": "--fs-5xl",
  "1.75rem": "--fs-6xl", "1.8rem": "--fs-6xl",
};

// px equivalent per token, for the delta report
const TOKEN_PX = {
  "--fs-4xs": 9, "--fs-3xs": 10, "--fs-2xs": 11, "--fs-xs": 12, "--fs-sm": 13,
  "--fs-base": 14, "--fs-md": 15, "--fs-lg": 16, "--fs-xl": 17, "--fs-2xl": 18,
  "--fs-3xl": 20, "--fs-4xl": 22, "--fs-5xl": 25, "--fs-6xl": 28,
};

const FILES = ["css/style.css", "js/main.js", "index.html"];
const RE = /font-size:(\s*)([0-9.]+(?:rem|px))/g;

const changes = [];
const skipped = new Map();
const deltaHist = new Map();

for (const rel of FILES) {
  const path = `${root}${rel}`;
  const src = readFileSync(path, "utf8");
  const lines = src.split("\n");
  let out = "";
  let last = 0;
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(src)) !== null) {
    const [full, gap, literal] = m;
    const token = MAP[literal];
    if (!token) {
      // 2.8px / 3.2px are SVG user units; anything else here is unexpected.
      skipped.set(literal, (skipped.get(literal) || 0) + 1);
      continue;
    }
    const line = src.slice(0, m.index).split("\n").length;
    const fromPx = literal.endsWith("rem") ? parseFloat(literal) * 16 : parseFloat(literal);
    const delta = +(TOKEN_PX[token] - fromPx).toFixed(2);
    changes.push({ rel, line, literal, token, delta });
    deltaHist.set(delta, (deltaHist.get(delta) || 0) + 1);
    out += src.slice(last, m.index) + `font-size:${gap}var(${token})`;
    last = m.index + full.length;
  }
  out += src.slice(last);
  if (write && out !== src) {
    writeFileSync(path, out);
    console.log(JSON.stringify({ wrote: rel, bytes: src.length }));
  }
}

console.log(JSON.stringify({ mode: write ? "write" : "dry-run", total: changes.length }));
console.log(JSON.stringify({ skipped: Object.fromEntries(skipped) }));

// where the change is not tiny — the ones a reviewer should look at
const big = changes.filter((c) => Math.abs(c.delta) > 0.5);
console.log(JSON.stringify({ movedMoreThanHalfPx: big.length }));
for (const c of big.slice(0, 40)) {
  console.log(`  ${c.rel}:${c.line}  ${c.literal} -> var(${c.token})  (${c.delta > 0 ? "+" : ""}${c.delta}px)`);
}
console.log("--- delta histogram (px) ---");
for (const d of [...deltaHist.keys()].sort((a, b) => a - b)) {
  console.log(`  ${d > 0 ? "+" : ""}${d}px : ${deltaHist.get(d)}`);
}
