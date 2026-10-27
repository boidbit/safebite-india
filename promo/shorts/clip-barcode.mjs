// promo/shorts/clip-barcode.mjs -- finds the pack's barcode in a clip's frames
// (shorts/clip.mjs): which code it is, the frame it reads best on and where
// it sits in that frame, so the short can identify the product by it and
// lock its scan animation onto it. ZXing reads the bars themselves, no AI.
//
// A code only counts when it's read the same on several frames (one read
// can be a misread that still passes the checksum, see barcodeReader.js).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import sharp from 'sharp';
import { isValidGtin } from '../../src/services/barcodeReader.js';

const require = createRequire(import.meta.url);
let zxing = null;
async function reader() {
  if (!zxing) {
    zxing = await import('zxing-wasm/reader');
    zxing.prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) } });
  }
  return zxing;
}

/**
 * @param {string} srcDir  the clip's frames, s_0000.jpg ... at 30 fps
 * @param {{ from?: number, step?: number, minReads?: number }} [o]  from: first second to look at
 * @returns {Promise<null | { code: string, frame: number, at: number, box: number[], reads: number }>}
 *   box: [x, y, w, h] in the frame's pixels
 */
export async function findBarcode(srcDir, { from = 0, step = 3, minReads = 3 } = {}) {
  const { readBarcodes } = await reader();
  const files = fs.readdirSync(srcDir).filter((f) => /^s_\d{4}\.jpg$/.test(f)).sort();
  const hits = [];
  for (let n = Math.round(from * 30); n < files.length; n += step) {
    const { data, info } = await sharp(path.join(srcDir, files[n])).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const found = await readBarcodes({ data: new Uint8ClampedArray(data), width: info.width, height: info.height, colorSpace: 'srgb' },
      { formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'], tryHarder: true, maxNumberOfSymbols: 1 });
    const r = found.find((x) => x.isValid && isValidGtin(x.text));
    if (!r) continue;
    const p = r.position;
    const xs = [p.topLeft.x, p.topRight.x, p.bottomLeft.x, p.bottomRight.x];
    const ys = [p.topLeft.y, p.topRight.y, p.bottomLeft.y, p.bottomRight.y];
    hits.push({ code: r.text, frame: n, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] });
  }
  if (!hits.length) return null;
  const counts = {};
  for (const h of hits) counts[h.code] = (counts[h.code] || 0) + 1;
  const code = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  if (counts[code] < minReads) return null;
  // The frame where it reads biggest (closest, clearest) is the one to scan on.
  const best = hits.filter((h) => h.code === code).sort((a, b) => b.box[2] - a.box[2])[0];
  // ZXing places a 1D code as a line; how tall the bars are is found by
  // reading thin strips above and below it -- the rows where it still reads.
  const file = path.join(srcDir, files[best.frame]);
  const meta = await sharp(file).metadata();
  const [bx, by, bw] = best.box;
  const left = Math.max(0, Math.round(bx - bw * 0.08)), width = Math.min(meta.width - left, Math.round(bw * 1.16));
  const reads = async (y) => {
    const top = Math.max(0, Math.min(meta.height - 24, Math.round(y - 12)));
    const { data, info } = await sharp(file).extract({ left, top, width, height: 24 }).resize({ height: 72, fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const r = await readBarcodes({ data: new Uint8ClampedArray(data), width: info.width, height: info.height, colorSpace: 'srgb' }, { formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'], tryHarder: true, maxNumberOfSymbols: 1 });
    return r.some((x) => x.text === code);
  };
  let y0 = by, y1 = by;
  for (let y = by - 8; y > by - bw; y -= 8) { if (await reads(y)) y0 = y; else break; }
  for (let y = by + 8; y < by + bw; y += 8) { if (await reads(y)) y1 = y; else break; }
  // Without a strip that reads, fall back to an EAN's usual shape (bars ~0.6 of its width).
  const box = y1 - y0 >= 16 ? [bx, y0 - 6, bw, y1 - y0 + 12] : [bx, by - bw * 0.3, bw, bw * 0.6];
  return { code, frame: best.frame, at: best.frame / 30, box: box.map(Math.round), reads: counts[code] };
}
