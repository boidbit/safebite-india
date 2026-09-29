// src/components/ProductImage.jsx
// The product photo on the result/history screens, with a graceful
// fallback -- many Indian Open Food Facts entries (and anything from a
// text/photo scan, which never has a product photo at all) have no
// image, so this must never show a broken image icon.
//
// Thumbnail only. Our stored photos are small (~20 KB, 250-500px wide --
// blinkitImageOptimizer.js), sharp at thumbnail size but blocky when
// stretched to a full phone screen, so there's no tap-to-zoom viewer.
// Keep `size` at or below ~160px for the same reason.
import { useState } from 'react';

// `expandable` is no longer used (there's no viewer); still accepted so
// existing callers passing it don't need touching.
// eslint-disable-next-line no-unused-vars
export default function ProductImage({ src, size = 76, expandable }) {
  const [failed, setFailed] = useState(false);
  const showFallback = !src || failed;

  return (
    <div
      className="flex-shrink-0 rounded-2xl overflow-hidden flex items-center justify-center"
      style={{ width: size, height: size, background: 'var(--fill)' }}
    >
      {showFallback ? (
        <span style={{ fontSize: size * 0.4 }}>📦</span>
      ) : (
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
