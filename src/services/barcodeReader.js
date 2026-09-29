// src/services/barcodeReader.js
//
// Reads a product barcode (EAN-13 / EAN-8 / UPC) off Blinkit gallery photos
// with ZXing -- a barcode decoder that reads the bars themselves, no AI.
// Blinkit product pages carry no barcode, so this is how a scraped product
// gets one; it's saved as a PENDING barcode link an admin approves
// (Admin > Barcode matches), never straight onto the product.
//
// A code only counts once it's been read the same TWICE (confirmBarcode):
// the same photo decoded two different ways, or two different photos. One
// read alone can be a misread that still passes the checksum.
//
// Node only (scrapers) -- uses sharp and loads ZXing's wasm from node_modules.
import { createRequire } from 'module';
import fs from 'fs';
import sharp from 'sharp';

const FORMATS = ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'];
let zxing = null;

async function reader() {
  if (!zxing) {
    zxing = await import('zxing-wasm/reader');
    const wasmPath = createRequire(import.meta.url).resolve('zxing-wasm/reader/zxing_reader.wasm');
    zxing.prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(wasmPath) } });
  }
  return zxing;
}

/** Standard GS1 check digit -- catches most single-digit misreads. */
export function isValidGtin(code) {
  if (!/^(\d{8}|\d{12,14})$/.test(code || '')) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// RGBA pixels only -- a greyscale sharp pipeline outputs 2 channels, which
// ZXing then misreads as garbage (found in testing: every greyscale variant
// read nothing).
async function decode(image, options = {}) {
  const { readBarcodes } = await reader();
  const { data, info } = await image.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const results = await readBarcodes(
    { data: new Uint8ClampedArray(data), width: info.width, height: info.height, colorSpace: 'srgb' },
    { formats: FORMATS, tryHarder: true, maxNumberOfSymbols: 2, ...options },
  );
  return results.filter((r) => r.isValid && isValidGtin(r.text)).map((r) => r.text);
}

// Several ways to decode the same photo: as-is, enlarged to three sizes
// (barcodes on a 1000px product shot are often small, and some only read
// once enlarged), and with a different binarizer. Tested on 47 real Blinkit
// products: 11 confirmed codes this way, each matching Gemini wherever
// Gemini also read one -- while a 2x enlargement once produced a different,
// checksum-valid misread, which is why one read is never enough.
const READS = [
  ['plain', (buf) => [sharp(buf), {}]],
  ['enlarged', (buf) => [sharp(buf).resize({ width: 1500 }), {}]],
  ['enlarged-more', (buf) => [sharp(buf).resize({ width: 1800 }), {}]],
  ['enlarged-less', (buf) => [sharp(buf).resize({ width: 1250 }), {}]],
  ['histogram', (buf) => [sharp(buf), { binarizer: 'GlobalHistogram' }]],
];

/**
 * Every barcode ZXing finds on one photo, decoded each way above.
 * Each way is its own read for confirmBarcode.
 * @returns {Promise<Array<{ code: string, read: string }>>}
 */
export async function readBarcodesFromPhoto(buf, photoIndex) {
  const reads = [];
  for (const [name, prepare] of READS) {
    try {
      const [image, options] = prepare(buf);
      for (const code of await decode(image, options)) reads.push({ code, read: `${photoIndex}:${name}` });
    } catch {
      // Not an image sharp can read, or ZXing failed on it -- no read.
    }
  }
  return reads;
}

/**
 * The barcode that was read the same at least twice, or null. Two
 * different codes both confirmed (e.g. a multipack showing two products)
 * is ambiguous, so null too.
 */
export function confirmBarcode(reads) {
  const byCode = new Map();
  for (const { code, read } of reads) {
    if (!byCode.has(code)) byCode.set(code, new Set());
    byCode.get(code).add(read);
  }
  const confirmed = [...byCode].filter(([, r]) => r.size >= 2);
  return confirmed.length === 1 ? confirmed[0][0] : null;
}
