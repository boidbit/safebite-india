// src/services/productPhotoStorage.js
//
// Product photos live in the public "product-photos" Storage bucket, not inside
// the report. A photo stored as a data: URL in report.imageUrl is downloaded
// with every read of the report (database egress, 25-315 KB each); a Storage
// file is a short URL served from the CDN.
//
// The admin panel produces data: URLs (file picker, paste, crop). Saving a
// product goes through moveInlinePhotoToStorage(), which uploads it and puts
// the URL in its place. If the upload fails for any reason (bucket policy not
// installed yet, offline), the report is saved with the inline photo exactly as
// before -- a photo problem never blocks a save.
import { supabase } from './supabaseClient.js';

export const PHOTO_BUCKET = 'product-photos';
const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,/i;

export const isInlinePhoto = (url) => typeof url === 'string' && DATA_URL.test(url);

const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function uploadToBucket(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const name = `${crypto.randomUUID()}.${EXTENSION[blob.type] || 'jpg'}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(name, blob, {
    contentType: blob.type,
    cacheControl: '31536000', // the name is unique per photo, so it can be cached for good
  });
  if (error) throw new Error(error.message);
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(name).data.publicUrl;
}

/**
 * @param {object} report - the report about to be saved
 * @param {(dataUrl: string) => Promise<string>} [upload] - returns the public URL; replaceable in tests
 * @returns {Promise<object>} the report with imageUrl swapped for a Storage URL when it was inline
 */
export async function moveInlinePhotoToStorage(report, upload = uploadToBucket) {
  if (!report || !isInlinePhoto(report.imageUrl)) return report;
  try {
    return { ...report, imageUrl: await upload(report.imageUrl) };
  } catch (err) {
    console.warn(`Photo kept inside the report (Storage upload failed: ${err.message}).`);
    return report;
  }
}
