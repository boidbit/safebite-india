// src/components/BarcodeScanner.jsx
// Full-screen live camera barcode reader -- point the phone at the pack
// instead of typing the number by hand. Uses the browser's native
// BarcodeDetector API (no extra library to ship): supported on Chrome/
// Edge and Android's system WebView (which is what the Capacitor APK
// renders through), not on iOS Safari or older browsers. The caller
// feature-detects with `isBarcodeScanSupported()` and only shows the
// "Scan with camera" entry point when it returns true -- manual typing
// keeps working everywhere regardless.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { hasValidChecksum } from '../services/barcodeChecksum';
import { useLanguage } from '../contexts/LanguageContext';

// EAN-13/EAN-8/UPC cover essentially every Indian packaged-food barcode;
// keeping the format list narrow avoids the detector wasting cycles
// matching QR codes some packs also carry (contest/offer codes).
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

// Same reason as the checksum check (see barcodeChecksum.js): don't act on
// one frame's read. A genuine barcode held steady reads the same value
// repeatedly; a misread from blur/glare tends to change or fail its
// checksum from frame to frame.
const CONSECUTIVE_READS_REQUIRED = 2;

export function isBarcodeScanSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Reads a barcode out of a photo (e.g. one picked from the gallery) with
 * the same native detector the live camera uses -- no extra library.
 * Returns the digits, or null when no valid barcode is found in it.
 */
export async function readBarcodeFromImage(file) {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null;
  const detector = new window.BarcodeDetector({ formats: FORMATS });
  const bitmap = await createImageBitmap(file);
  try {
    const codes = await detector.detect(bitmap);
    const valid = codes.find((c) => hasValidChecksum(c.rawValue, c.format));
    return valid ? valid.rawValue : null;
  } finally {
    bitmap.close?.();
  }
}

// onManual: switch to typing the number instead. onDetected also receives
// a barcode read from a gallery photo, so the caller treats both the same.
export default function BarcodeScanner({ onDetected, onClose, onManual }) {
  const { t } = useLanguage();
  const videoRef = useRef(null);
  const fileRef = useRef(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const doneRef = useRef(false);
  const pendingRef = useRef({ value: null, count: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function start() {
      let detector;
      try {
        detector = new window.BarcodeDetector({ formats: FORMATS });
      } catch {
        setError(t('scanErrUnsupported'));
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setError(t('scanErrCameraBlocked'));
        return;
      }

      let lastCheck = 0;
      const loop = async (time) => {
        if (cancelled || doneRef.current) return;
        // Detecting on every frame burns battery for no benefit --
        // ~200ms between attempts is plenty for a barcode held steady.
        if (time - lastCheck > 200 && videoRef.current?.readyState >= 2) {
          lastCheck = time;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && !doneRef.current) {
              const { rawValue, format } = codes[0];
              if (!hasValidChecksum(rawValue, format)) {
                // Almost certainly a misread digit, not a real barcode --
                // don't let it count towards a match streak either.
                pendingRef.current = { value: null, count: 0 };
              } else if (pendingRef.current.value === rawValue) {
                pendingRef.current.count += 1;
                if (pendingRef.current.count >= CONSECUTIVE_READS_REQUIRED) {
                  doneRef.current = true;
                  onDetected(rawValue);
                  return;
                }
              } else {
                pendingRef.current = { value: rawValue, count: 1 };
              }
            }
          } catch {
            // A transient decode error on one frame isn't fatal -- keep scanning.
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetected]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePhoto = async (file) => {
    if (!file) return;
    setPhotoError('');
    setReadingPhoto(true);
    try {
      const code = await readBarcodeFromImage(file);
      if (code) {
        doneRef.current = true;
        onDetected(code);
      } else {
        setPhotoError(t('scanErrNoBarcodeInPhoto'));
      }
    } catch {
      setPhotoError(t('scanErrNoBarcodeInPhoto'));
    } finally {
      setReadingPhoto(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[999] bg-black flex flex-col">
      <div className="flex-shrink-0 flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top,0px)+12px)] pb-3">
        <span className="text-white text-sm font-semibold">{t('scanTitle')}</span>
        <button
          onClick={onClose}
          aria-label={t('ariaClose')}
          className="tap-scale w-9 h-9 rounded-full bg-white/15 text-white text-xl leading-none flex items-center justify-center backdrop-blur-sm"
        >
          ×
        </button>
      </div>

      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        {error ? (
          <p className="text-white/90 text-sm text-center px-8 leading-relaxed">{error}</p>
        ) : (
          <>
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
            <div className="relative w-[80%] max-w-xs aspect-[3/2] rounded-2xl border-2 border-white/80" style={{ boxShadow: '0 0 0 2000px rgba(0,0,0,0.45)' }} />
            <p className="absolute bottom-6 left-0 right-0 text-center text-white/85 text-xs px-8">
              {t('scanLineUp')}
            </p>
          </>
        )}
      </div>

      {/* The two other ways in, one tap each -- no separate screen to find them on. */}
      <div className="flex-shrink-0 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
        {photoError && <p className="text-amber-300 text-xs text-center mb-2.5">{photoError}</p>}
        <div className="flex gap-2.5">
          {onManual && (
            <button onClick={onManual} className="tap-scale flex-1 py-3 rounded-xl bg-white/15 text-white text-sm font-semibold backdrop-blur-sm">
              ⌨️ {t('scanEnterManually')}
            </button>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={readingPhoto}
            className="tap-scale flex-1 py-3 rounded-xl bg-white/15 text-white text-sm font-semibold backdrop-blur-sm disabled:opacity-60"
          >
            🖼️ {readingPhoto ? t('scanReadingPhoto') : t('scanFromGallery')}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { handlePhoto(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </div>
    </div>,
    document.body
  );
}
