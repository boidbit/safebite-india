import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveInlinePhotoToStorage, isInlinePhoto } from './productPhotoStorage.js';

const INLINE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

test('only base64 image data URLs count as an inline photo', () => {
  assert.equal(isInlinePhoto(INLINE), true);
  assert.equal(isInlinePhoto('https://x.supabase.co/storage/v1/object/public/product-photos/a.webp'), false);
  assert.equal(isInlinePhoto(null), false);
  assert.equal(isInlinePhoto(undefined), false);
});

test('an inline photo is swapped for the uploaded URL and the rest of the report is kept', async () => {
  const calls = [];
  const upload = async (url) => { calls.push(url); return 'https://cdn/p.jpg'; };
  const out = await moveInlinePhotoToStorage({ imageUrl: INLINE, overallScore: 61 }, upload);
  assert.deepEqual(out, { imageUrl: 'https://cdn/p.jpg', overallScore: 61 });
  assert.deepEqual(calls, [INLINE]);
});

test('nothing is uploaded when the photo is already a URL or missing', async () => {
  const upload = async () => { throw new Error('should not be called'); };
  const url = { imageUrl: 'https://cdn/p.jpg' };
  const none = { imageUrl: null };
  assert.equal(await moveInlinePhotoToStorage(url, upload), url);
  assert.equal(await moveInlinePhotoToStorage(none, upload), none);
});

test('the inline photo is kept when the upload fails, so the save still works', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const report = { imageUrl: INLINE };
    const out = await moveInlinePhotoToStorage(report, async () => { throw new Error('policy'); });
    assert.equal(out, report);
  } finally {
    console.warn = warn;
  }
});
