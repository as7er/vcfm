// Decode a PNG (8-bit, non-interlaced, color type 0/2/3/4/6) and render it as
// coarse ASCII luminance art, so the layout structure of a screenshot can be
// inspected without a vision model. Also prints per-row and per-column
// luminance profiles to spot bands and anomalies.
//
// Usage: node _png-ascii.mjs <file> [cols]
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const file = process.argv[2];
const cols = Number(process.argv[3] || 120);
const buf = readFileSync(file);

// --- parse chunks ---
let off = 8;
let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
const idat = [];
let palette = null;
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString("ascii", off + 4, off + 8);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === "IHDR") {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
    interlace = data[12];
  } else if (type === "IDAT") {
    idat.push(data);
  } else if (type === "PLTE") {
    palette = data;
  } else if (type === "IEND") break;
  off += 12 + len;
}
if (bitDepth !== 8 || interlace !== 0) {
  console.error(`unsupported: bitDepth=${bitDepth} interlace=${interlace}`);
  process.exit(1);
}
const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
if (!channels) { console.error(`unsupported colorType=${colorType}`); process.exit(1); }

const raw = inflateSync(Buffer.concat(idat));
const stride = width * channels;

// --- unfilter ---
const out = Buffer.alloc(width * height * channels);
let prev = Buffer.alloc(stride);
let p = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[p++];
  const line = raw.subarray(p, p + stride);
  p += stride;
  const cur = out.subarray(y * stride, (y + 1) * stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= channels ? cur[x - channels] : 0;
    const b = prev[x];
    const c = x >= channels ? prev[x - channels] : 0;
    let v = line[x];
    switch (filter) {
      case 0: break;
      case 1: v = (v + a) & 0xff; break;
      case 2: v = (v + b) & 0xff; break;
      case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
      case 4: {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 0xff; break;
      }
    }
    cur[x] = v;
  }
  prev = cur;
}

// --- luminance grid ---
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const gray = new Float32Array(width * height);
for (let i = 0; i < width * height; i++) {
  const o = i * channels;
  let v;
  if (colorType === 0 || colorType === 4) v = out[o];
  else if (colorType === 3) { const idx = out[o] * 3; v = lum(palette[idx], palette[idx + 1], palette[idx + 2]); }
  else v = lum(out[o], out[o + 1], out[o + 2]);
  gray[i] = v;
}

// --- downsample to ASCII ---
const rows = Math.max(1, Math.round((cols * height) / width / 2)); // chars are ~2x tall
const chars = " .:-=+*#%@";
let art = [];
for (let r = 0; r < rows; r++) {
  let line = "";
  for (let c = 0; c < cols; c++) {
    let sum = 0, n = 0;
    const x0 = Math.floor((c * width) / cols), x1 = Math.max(x0 + 1, Math.floor(((c + 1) * width) / cols));
    const y0 = Math.floor((r * height) / rows), y1 = Math.max(y0 + 1, Math.floor(((r + 1) * height) / rows));
    for (let y = y0; y < y1 && y < height; y++) {
      for (let x = x0; x < x1 && x < width; x++) { sum += gray[y * width + x]; n++; }
    }
    const v = sum / n; // 0..255
    const idx = Math.min(chars.length - 1, Math.floor((v / 256) * chars.length));
    line += chars[chars.length - 1 - idx]; // dark bg → space, bright text → @
  }
  art.push(line);
}

// --- row profile: mean luminance per horizontal band (16 bands) ---
const bands = 24;
const profile = [];
for (let b = 0; b < bands; b++) {
  const y0 = Math.floor((b * height) / bands), y1 = Math.floor(((b + 1) * height) / bands);
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < width; x++) { sum += gray[y * width + x]; n++; }
  profile.push(Math.round(sum / n));
}
console.log(`PNG ${width}x${height} colorType=${colorType} channels=${channels} | ASCII ${cols}x${rows} (dark=space, bright=@)`);
console.log("row luminance bands (top->bottom):", profile.join(" "));
console.log(art.join("\n"));
