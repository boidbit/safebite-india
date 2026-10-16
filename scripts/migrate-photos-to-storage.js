// scripts/migrate-photos-to-storage.js
//
// Moves product photos that are stored INSIDE the report (report.imageUrl =
// "data:image/...;base64,..." -- 25-315 KB each) into Supabase Storage and
// leaves a short public URL in report.imageUrl instead.
//
// Why: every time the app reads a report it downloads that photo too, from the
// database (counted as plain egress, 5 GB on the free plan). A Storage file is
// served from the CDN ("cached egress", a separate 5 GB) and is ~15-30 KB after
// resizing, so a product page drops from ~750 KB to ~150 KB.
//
// Per product: decode -> resize (longest side 600 px) -> WebP -> upload to the
// public "product-photos" bucket (name has a content hash, so a replaced photo
// is a new URL and never served stale) -> check the URL answers -> only then
// update report.imageUrl. The old data URL is written to a JSONL backup first;
// nothing else in the report is touched.
//
//   node --env-file=.env scripts/migrate-photos-to-storage.js              (preview, writes a CSV)
//   node --env-file=.env scripts/migrate-photos-to-storage.js --apply --limit=5
//   node --env-file=.env scripts/migrate-photos-to-storage.js --apply
//   node --env-file=.env scripts/migrate-photos-to-storage.js --restore=<backup.jsonl>
import fs from 'fs';
import crypto from 'crypto';
import sharp from 'sharp';
import { supabase } from '../src/services/supabaseClient.js';

const BUCKET = 'product-photos';
const MAX_SIDE = 600;
const OUT_DIR = '..'; // Desktop\Food Scanner, next to the other backups
const apply = process.argv.includes('--apply');
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
const restoreFile = (process.argv.find((a) => a.startsWith('--restore=')) || '').split('=')[1];
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('This needs SUPABASE_SERVICE_ROLE_KEY in .env.'); process.exit(1); }

const kb = (n) => Math.round(n / 1024);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function restore(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let ok = 0;
  for (const { id, imageUrl } of lines) {
    const { data, error } = await supabase.from('product_reports').select('report').eq('id', id).single();
    if (error) { console.error(id, error.message); continue; }
    const { error: upErr } = await supabase.from('product_reports').update({ report: { ...data.report, imageUrl } }).eq('id', id);
    if (upErr) console.error(id, upErr.message); else ok++;
  }
  console.log(`Restored ${ok} of ${lines.length} photos into the reports.`);
}

if (restoreFile) { await restore(restoreFile); process.exit(0); }

// 1. Which products still hold an inline photo. Small pages: the filter opens
//    every report on the server, and a big page can hit the statement timeout.
const ids = [];
for (let from = 0; ; from += 100) {
  const { data, error } = await supabase.from('product_reports')
    .select('id, product_name, review_status')
    .like('report->>imageUrl', 'data:%')
    .order('id').range(from, from + 99);
  if (error) { console.error(`list: ${error.message}`); process.exit(1); }
  ids.push(...data);
  if (data.length < 100) break;
}
console.log(`${ids.length} products have a photo stored inside the report.`);

if (apply) {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (error) { console.error(`bucket: ${error.message}`); process.exit(1); }
    console.log(`Created public bucket "${BUCKET}".`);
  }
}

const backupPath = `${OUT_DIR}/photo-base64-backup-${stamp}.jsonl`;
const csvPath = `${OUT_DIR}/photo-migration-${apply ? 'applied' : 'preview'}-${stamp}.csv`;
const csv = ['product,status,mime,old_kb,new_kb,url'];
const totals = { done: 0, failed: 0, old: 0, now: 0 };

for (const row of ids.slice(0, limit)) {
  const cell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  try {
    // 2. The whole row, read at the last moment so nothing else is overwritten.
    const { data, error } = await supabase.from('product_reports').select('id, product_name, report').eq('id', row.id).single();
    if (error) throw new Error(error.message);
    const old = data.report?.imageUrl;
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(old || '');
    if (!m) throw new Error('not a base64 image');
    const input = Buffer.from(m[2], 'base64');
    const webp = await sharp(input).rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 }).toBuffer();
    totals.old += old.length; totals.now += webp.length;
    if (!apply) { csv.push([cell(data.product_name), 'preview', m[1], kb(old.length), kb(webp.length), ''].join(',')); totals.done++; continue; }

    const name = `${data.id}-${crypto.createHash('sha1').update(webp).digest('hex').slice(0, 8)}.webp`;
    fs.appendFileSync(backupPath, `${JSON.stringify({ id: data.id, product: data.product_name, imageUrl: old })}\n`);
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(name, webp, { contentType: 'image/webp', cacheControl: '31536000', upsert: true });
    if (upErr) throw new Error(`upload: ${upErr.message}`);
    const url = supabase.storage.from(BUCKET).getPublicUrl(name).data.publicUrl;
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) throw new Error(`uploaded file not reachable (${head.status})`);
    const { error: saveErr } = await supabase.from('product_reports').update({ report: { ...data.report, imageUrl: url } }).eq('id', data.id);
    if (saveErr) throw new Error(`save: ${saveErr.message}`);
    csv.push([cell(data.product_name), 'moved', m[1], kb(old.length), kb(webp.length), url].join(','));
    totals.done++;
  } catch (err) {
    totals.failed++;
    csv.push([cell(row.product_name), `FAILED: ${err.message}`, '', '', '', ''].join(','));
    console.error(`${row.product_name}: ${err.message}`);
  }
}

fs.writeFileSync(csvPath, `﻿${csv.join('\n')}\n`);
console.log(`${apply ? 'Moved' : 'Would move'} ${totals.done}, failed ${totals.failed}. Photos ${kb(totals.old)} KB -> ${kb(totals.now)} KB (${totals.old ? Math.round((1 - totals.now / totals.old) * 100) : 0}% smaller).`);
console.log(`Report: ${csvPath}${apply ? `\nBackup of the old photos: ${backupPath}` : ''}`);
