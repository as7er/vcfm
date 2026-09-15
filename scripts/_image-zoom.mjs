// Zoom into a region of an existing screenshot so small rendering details are
// actually inspectable. No app boot, so this runs in a few seconds.
//
// Usage:
//   node scripts/_image-zoom.mjs <image> <out.png> [x,y,w,h] [scale]
//
// x,y,w,h are in the source image's pixels; omit them to take the whole image.
// The image is served over http (file:// from setContent is blocked), so paths
// must live inside the repo.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const [imageArg, outArg, cropArg, scaleArg] = process.argv.slice(2);
if (!imageArg || !outArg) {
  console.error("usage: node scripts/_image-zoom.mjs <image> <out.png> [x,y,w,h] [scale]");
  process.exit(2);
}
const imagePath = isAbsolute(imageArg) ? imageArg : resolve(root, imageArg);
const outPath = isAbsolute(outArg) ? outArg : resolve(root, outArg);
const scale = Number(scaleArg) || 4;
const rel = relative(root, imagePath).split(sep).join("/");
if (rel.startsWith("..")) throw new Error("image must live inside the repo");

// Read the intrinsic size straight out of the PNG IHDR (bytes 16..24).
const buf = readFileSync(imagePath);
const imgW = buf.readUInt32BE(16);
const imgH = buf.readUInt32BE(20);
const [cx, cy, cw, ch] = cropArg ? cropArg.split(",").map(Number) : [0, 0, imgW, imgH];

const port = 8896;
const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

let browser;
try {
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/${rel}`)).ok; } catch { /* retry */ }
    if (!ready) await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error("static server did not serve the image");

  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: Math.round(cw * scale), height: Math.round(ch * scale) },
  });
  await page.setContent(`
    <style>
      html, body { margin: 0; padding: 0; background: #000; }
      .win { width: ${cw * scale}px; height: ${ch * scale}px; overflow: hidden; position: relative; }
      img { position: absolute; left: ${-cx * scale}px; top: ${-cy * scale}px;
            width: ${imgW * scale}px; height: ${imgH * scale}px;
            image-rendering: pixelated; }
    </style>
    <div class="win"><img src="http://127.0.0.1:${port}/${rel}"></div>
  `);
  await page.waitForFunction(() => {
    const im = document.querySelector("img");
    return im && im.complete && im.naturalWidth > 0;
  });
  await page.screenshot({ path: outPath });
  console.log(JSON.stringify({ image: imagePath, source: `${imgW}x${imgH}`, crop: [cx, cy, cw, ch], scale, out: outPath }));
} finally {
  if (browser) await browser.close();
  server.kill();
}
