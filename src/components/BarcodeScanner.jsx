// src/components/BarcodeScanner.jsx
// Full-screen live camera barcode reader -- point the phone at the pack
// instead of typing the number by hand.
//
// Two cameras behind one screen:
// - Android app: Google ML Kit (@capacitor-mlkit/barcode-scanning). It draws
//   the camera BEHIND the WebView (see .barcode-scanner-active in index.css),
//   focuses close up and reads small or curved barcodes far better than the
//   browser can.
// - Website: the browser's own BarcodeDetector (Chrome/Edge/Android; not iOS
//   Safari -- the caller feature-detects with isBarcodeScanSupported()).
//
// Small barcodes were the problem: the camera opened at the browser's default
// (often 640x480) and, moved close to make the barcode bigger, went out of
// focus. Now it asks for 1080p, starts at 2x zoom where the phone has it (hold
// it farther away and the barcode is still big), focuses continuously or where
// you tap, and every other frame reads only the framed area, enlarged.
//
// Manual typing, a photo from the gallery or a fresh photo keep working
// everywhere regardless.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
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

const HINT_AFTER_MS = 6000; // nothing read by then -> "small barcode?" help
const TIP_EVERY_MS = 3500;
const TIPS = ['scanTip1', 'scanTip2', 'scanTip3', 'scanTip4'];
const SUCCESS_PAUSE_MS = 380; // long enough to see the tick, short enough not to wait

function isNativeScanner() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BarcodeScanner');
}

export function isBarcodeScanSupported() {
  if (isNativeScanner()) return true;
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Reads a barcode out of a photo (gallery or a fresh one). The browser's
 * detector first; if it finds nothing (or doesn't exist, e.g. iOS), ZXing --
 * the same decoder the Blinkit photo reader uses, which reads small barcodes
 * on a full-resolution photo well. Returns the digits, or null.
 */
export async function readBarcodeFromImage(file) {
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const detector = new window.BarcodeDetector({ formats: FORMATS });
      const bitmap = await createImageBitmap(file);
      try {
        const codes = await detector.detect(bitmap);
        const valid = codes.find((c) => hasValidChecksum(c.rawValue, c.format));
        if (valid) return valid.rawValue;
      } finally {
        bitmap.close?.();
      }
    } catch { /* fall through to ZXing */ }
  }
  try {
    const [zxing, wasm] = await Promise.all([import('zxing-wasm/reader'), import('zxing-wasm/reader/zxing_reader.wasm?url')]);
    zxing.prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasm.default : prefix + path) } });
    const results = await zxing.readBarcodes(file, { formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'], tryHarder: true, maxNumberOfSymbols: 2 });
    const valid = results.find((r) => r.isValid && hasValidChecksum(r.text, r.format.toLowerCase().replace('-', '_')));
    return valid ? valid.text : null;
  } catch {
    return null;
  }
}

/**
 * The part of the video frame under the on-screen scan frame (plus a margin),
 * drawn enlarged onto `canvas`. The video is shown object-cover, so screen
 * position -> video pixel needs that scale and offset.
 */
function cropToFrame(video, frameEl, canvas) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || !frameEl) return null;
  const vr = video.getBoundingClientRect();
  const fr = frameEl.getBoundingClientRect();
  const scale = Math.max(vr.width / vw, vr.height / vh);
  const offX = (vr.width - vw * scale) / 2;
  const offY = (vr.height - vh * scale) / 2;
  const pad = 0.15;
  let sw = (fr.width / scale) * (1 + 2 * pad);
  let sh = (fr.height / scale) * (1 + 2 * pad);
  let sx = (fr.left - vr.left - offX) / scale - (fr.width / scale) * pad;
  let sy = (fr.top - vr.top - offY) / scale - (fr.height / scale) * pad;
  sx = Math.max(0, sx); sy = Math.max(0, sy);
  sw = Math.min(vw - sx, sw); sh = Math.min(vh - sy, sh);
  if (sw < 20 || sh < 20) return null;
  const up = Math.min(2, 1600 / sw); // a small barcode reads better enlarged
  canvas.width = Math.round(sw * up);
  canvas.height = Math.round(sh * up);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// onManual: switch to typing the number instead. onDetected also receives
// a barcode read from a photo, so the caller treats both the same.
export default function BarcodeScanner({ onDetected, onClose, onManual }) {
  const { t } = useLanguage();
  const native = isNativeScanner();
  const videoRef = useRef(null);
  const frameRef = useRef(null);
  const galleryRef = useRef(null);
  const cameraRef = useRef(null);
  const doneRef = useRef(false);
  const pendingRef = useRef({ value: null, count: 0 });
  const seenTimerRef = useRef(null);
  const controlsRef = useRef({}); // { zoom(z), torch(on), focus(x, y) } -- set by whichever camera started
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const [error, setError] = useState('');
  const [phase, setPhase] = useState('searching'); // 'searching' | 'seen' | 'done'
  const [zoom, setZoom] = useState({ levels: [], value: 1 });
  const [torch, setTorch] = useState({ available: false, on: false });
  const [showHint, setShowHint] = useState(false);
  const [tip, setTip] = useState(0);
  const [focusAt, setFocusAt] = useState(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');

  const finish = useCallback((code) => {
    doneRef.current = true;
    setPhase('done');
    navigator.vibrate?.(40);
    setTimeout(() => onDetectedRef.current(code), SUCCESS_PAUSE_MS);
  }, []);

  // One read from either camera.
  const handleRead = useCallback((rawValue, format) => {
    if (doneRef.current || !rawValue) return;
    if (!hasValidChecksum(rawValue, format)) {
      // Almost certainly a misread digit, not a real barcode -- don't let
      // it count towards a match streak either.
      pendingRef.current = { value: null, count: 0 };
      return;
    }
    if (pendingRef.current.value === rawValue) pendingRef.current.count += 1;
    else pendingRef.current = { value: rawValue, count: 1 };
    setPhase('seen');
    setShowHint(false);
    clearTimeout(seenTimerRef.current);
    seenTimerRef.current = setTimeout(() => { if (!doneRef.current) setPhase('searching'); }, 1200);
    if (pendingRef.current.count >= CONSECUTIVE_READS_REQUIRED) finish(rawValue);
  }, [finish]);

  // ---- Android app: ML Kit ----
  useEffect(() => {
    if (!native) return undefined;
    let cancelled = false;
    let listener = null;
    let Mlkit = null;
    const root = [document.documentElement, document.body];

    (async () => {
      try {
        const mod = await import('@capacitor-mlkit/barcode-scanning');
        Mlkit = mod.BarcodeScanner;
        const perm = await Mlkit.requestPermissions();
        if (perm.camera !== 'granted' && perm.camera !== 'limited') { setError(t('scanErrCameraBlocked')); return; }
        if (cancelled) return;
        root.forEach((el) => el.classList.add('barcode-scanner-active'));
        listener = await Mlkit.addListener('barcodesScanned', (event) => {
          for (const b of event.barcodes || []) handleRead(b.rawValue, String(b.format || '').toLowerCase());
        });
        const F = mod.BarcodeFormat;
        await Mlkit.startScan({ formats: [F.Ean13, F.Ean8, F.UpcA, F.UpcE], resolution: mod.Resolution['1920x1080'] });
        if (cancelled) { Mlkit.stopScan(); return; }

        const [{ zoomRatio: min }, { zoomRatio: max }] = await Promise.all([Mlkit.getMinZoomRatio(), Mlkit.getMaxZoomRatio()]);
        const levels = [1, 2, 3].filter((z) => z >= min && z <= max);
        if (levels.includes(2)) { await Mlkit.setZoomRatio({ zoomRatio: 2 }); setZoom({ levels, value: 2 }); }
        else setZoom({ levels, value: 1 });
        const { available } = await Mlkit.isTorchAvailable();
        setTorch({ available, on: false });
        controlsRef.current = {
          zoom: (z) => Mlkit.setZoomRatio({ zoomRatio: z }),
          torch: (on) => (on ? Mlkit.enableTorch() : Mlkit.disableTorch()),
        };
      } catch {
        if (!cancelled) setError(t('scanErrUnsupported'));
      }
    })();

    return () => {
      cancelled = true;
      listener?.remove();
      Mlkit?.stopScan().catch(() => {});
      root.forEach((el) => el.classList.remove('barcode-scanner-active'));
    };
  }, [native, handleRead]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Website: the browser's BarcodeDetector ----
  useEffect(() => {
    if (native) return undefined;
    let cancelled = false;
    let stream = null;
    let raf = null;

    (async () => {
      let detector;
      try {
        detector = new window.BarcodeDetector({ formats: FORMATS });
      } catch {
        setError(t('scanErrUnsupported'));
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } catch {
        setError(t('scanErrCameraBlocked'));
        return;
      }
      if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }

      // What this phone's camera can do -- each one only where it exists.
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.() || {};
      const apply = (c) => track.applyConstraints({ advanced: [c] }).catch(() => {});
      const focusModes = caps.focusMode || [];
      if (focusModes.includes('continuous')) apply({ focusMode: 'continuous' });
      if (caps.zoom && caps.zoom.max >= 1.5) {
        const levels = [1, 2, 3].filter((z) => z >= (caps.zoom.min || 1) && z <= caps.zoom.max);
        const start = levels.includes(2) ? 2 : levels[levels.length - 1];
        apply({ zoom: start });
        setZoom({ levels, value: start });
      }
      if (caps.torch) setTorch({ available: true, on: false });
      controlsRef.current = {
        zoom: (z) => apply({ zoom: z }),
        torch: (on) => apply({ torch: on }),
        focus: focusModes.includes('single-shot') || focusModes.includes('manual')
          ? (x, y) => {
            apply({ focusMode: 'single-shot', pointsOfInterest: [{ x, y }] });
            if (focusModes.includes('continuous')) setTimeout(() => apply({ focusMode: 'continuous' }), 1500);
          }
          : null,
      };

      const canvas = document.createElement('canvas');
      let lastCheck = 0;
      let cropTurn = false;
      const loop = async (time) => {
        if (cancelled || doneRef.current) return;
        // Detecting on every frame burns battery for no benefit --
        // ~200ms between attempts is plenty for a barcode held steady.
        if (time - lastCheck > 200 && video?.readyState >= 2) {
          lastCheck = time;
          // Every other try reads only the framed area, enlarged -- what
          // catches a small barcode the whole frame is too coarse for.
          cropTurn = !cropTurn;
          const source = (cropTurn && cropToFrame(video, frameRef.current, canvas)) || video;
          try {
            const codes = await detector.detect(source);
            if (codes.length > 0) handleRead(codes[0].rawValue, codes[0].format);
          } catch {
            // A transient decode error on one frame isn't fatal -- keep scanning.
          }
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [native, handleRead]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Small barcode?" help once a few seconds pass with nothing read, and a
  // tip that changes under the frame.
  useEffect(() => {
    const hint = setTimeout(() => { if (!doneRef.current && !pendingRef.current.value) setShowHint(true); }, HINT_AFTER_MS);
    const tips = setInterval(() => setTip((i) => (i + 1) % TIPS.length), TIP_EVERY_MS);
    return () => { clearTimeout(hint); clearInterval(tips); clearTimeout(seenTimerRef.current); };
  }, []);

  const changeZoom = (z) => {
    setZoom((s) => ({ ...s, value: z }));
    controlsRef.current.zoom?.(z);
  };
  const toggleTorch = () => {
    const on = !torch.on;
    setTorch((s) => ({ ...s, on }));
    controlsRef.current.torch?.(on);
  };
  const tapToFocus = (e) => {
    if (!controlsRef.current.focus || error) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    controlsRef.current.focus(x, y);
    setFocusAt({ x: e.clientX - r.left, y: e.clientY - r.top, key: Date.now() });
  };

  const handlePhoto = async (file) => {
    if (!file) return;
    setPhotoError('');
    setReadingPhoto(true);
    try {
      const code = await readBarcodeFromImage(file);
      if (code) finish(code);
      else setPhotoError(t('scanErrNoBarcodeInPhoto'));
    } catch {
      setPhotoError(t('scanErrNoBarcodeInPhoto'));
    } finally {
      setReadingPhoto(false);
    }
  };

  const accent = phase === 'searching' ? '#ffffff' : '#22c55e';
  const corner = 'absolute w-7 h-7 transition-colors duration-200';
  const cornerStyle = (sides) => Object.fromEntries(sides.map((s) => [`border${s}`, `4px solid ${accent}`]));

  return createPortal(
    <div className={`barcode-scanner-modal fixed inset-0 z-[999] flex flex-col ${native ? 'bg-transparent' : 'bg-black'}`}>
      <div className="relative z-10 flex-shrink-0 flex items-start justify-between gap-3 px-4 pt-[calc(env(safe-area-inset-top,0px)+12px)] pb-3 bg-black/55 backdrop-blur-sm">
        <div className="min-w-0">
          <p className="text-white text-[15px] font-semibold">{t('scanTitle')}</p>
          <p className="text-white/70 text-xs mt-0.5">{t('scanSubtitle')}</p>
        </div>
        <button
          onClick={onClose}
          aria-label={t('ariaClose')}
          className="tap-scale flex-shrink-0 w-9 h-9 rounded-full bg-white/15 text-white text-xl leading-none flex items-center justify-center"
        >
          ×
        </button>
      </div>

      <div className="relative flex-1 flex items-center justify-center overflow-hidden" onClick={tapToFocus}>
        {error ? (
          <p className="text-white/90 text-sm text-center px-8 leading-relaxed bg-black/60 py-6 rounded-2xl mx-6">{error}</p>
        ) : (
          <>
            {!native && <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />}

            {/* The scan frame: barcode-shaped, the rest of the view dimmed. */}
            <div
              ref={frameRef}
              className="relative w-[84%] max-w-sm aspect-[2/1] rounded-2xl"
              style={{ boxShadow: '0 0 0 2000px rgba(0,0,0,0.5)' }}
            >
              <span className={`${corner} top-0 left-0 rounded-tl-2xl`} style={cornerStyle(['Top', 'Left'])} />
              <span className={`${corner} top-0 right-0 rounded-tr-2xl`} style={cornerStyle(['Top', 'Right'])} />
              <span className={`${corner} bottom-0 left-0 rounded-bl-2xl`} style={cornerStyle(['Bottom', 'Left'])} />
              <span className={`${corner} bottom-0 right-0 rounded-br-2xl`} style={cornerStyle(['Bottom', 'Right'])} />
              {phase !== 'done' && (
                <span
                  className="scanner-laser absolute left-[6%] right-[6%] h-[2px] rounded-full"
                  style={{ background: accent, boxShadow: `0 0 12px 2px ${phase === 'seen' ? 'rgba(34,197,94,0.8)' : 'rgba(34,197,94,0.6)'}` }}
                />
              )}
              {phase === 'done' && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="scanner-pop w-14 h-14 rounded-full bg-green-500 text-white text-3xl font-bold flex items-center justify-center shadow-lg">✓</span>
                </span>
              )}
            </div>

            {focusAt && (
              <span
                key={focusAt.key}
                className="scanner-focus pointer-events-none absolute w-16 h-16 rounded-full border-2 border-yellow-300"
                style={{ left: focusAt.x, top: focusAt.y }}
              />
            )}

            {/* Status, then the "small barcode?" help or a rotating tip. */}
            <div className="absolute left-0 right-0 bottom-4 flex flex-col items-center gap-2 px-6 pointer-events-none">
              {zoom.levels.length > 1 && phase !== 'done' && (
                <div className="pointer-events-auto flex gap-1.5 bg-black/55 rounded-full p-1 mb-1">
                  {zoom.levels.map((z) => (
                    <button
                      key={z}
                      onClick={(e) => { e.stopPropagation(); changeZoom(z); }}
                      className={`tap-scale w-10 h-8 rounded-full text-xs font-bold ${zoom.value === z ? 'bg-white text-black' : 'text-white'}`}
                    >
                      {z}x
                    </button>
                  ))}
                </div>
              )}
              {phase === 'seen' && <p className="text-green-300 text-sm font-semibold">{t('scanFound')}</p>}
              {phase === 'done' && <p className="text-green-300 text-sm font-semibold">{t('scanDone')}</p>}
              {phase === 'searching' && showHint && (
                <div className="pointer-events-auto bg-amber-400/95 text-black rounded-2xl px-4 py-2.5 text-[13px] font-medium text-center shadow-lg max-w-sm">
                  {t('scanHintSmall')}
                  <button
                    onClick={(e) => { e.stopPropagation(); cameraRef.current?.click(); }}
                    className="tap-scale block mx-auto mt-2 px-4 py-1.5 rounded-full bg-black text-white text-xs font-semibold"
                  >
                    📸 {t('scanTakePhoto')}
                  </button>
                </div>
              )}
              {phase === 'searching' && !showHint && (
                <p key={tip} className="scanner-tip-in text-white/90 text-xs bg-black/45 rounded-full px-3 py-1.5">{t(TIPS[tip])}</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* The other ways in, one tap each -- no separate screen to find them on. */}
      <div className="relative z-10 flex-shrink-0 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] bg-black/55 backdrop-blur-sm">
        {photoError && <p className="text-amber-300 text-xs text-center mb-2.5">{photoError}</p>}
        <div className="flex gap-2">
          {onManual && (
            <button onClick={onManual} className="tap-scale flex-1 py-3 rounded-xl bg-white/15 text-white text-[13px] font-semibold">
              ⌨️ {t('scanEnterManually')}
            </button>
          )}
          <button
            onClick={() => galleryRef.current?.click()}
            disabled={readingPhoto}
            className="tap-scale flex-1 py-3 rounded-xl bg-white/15 text-white text-[13px] font-semibold disabled:opacity-60"
          >
            🖼️ {readingPhoto ? t('scanReadingPhoto') : t('scanFromGallery')}
          </button>
          {torch.available && (
            <button
              onClick={toggleTorch}
              aria-pressed={torch.on}
              className={`tap-scale flex-shrink-0 px-4 py-3 rounded-xl text-[13px] font-semibold ${torch.on ? 'bg-yellow-300 text-black' : 'bg-white/15 text-white'}`}
            >
              🔦 {t('scanTorch')}
            </button>
          )}
          <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={(e) => { handlePhoto(e.target.files?.[0]); e.target.value = ''; }} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { handlePhoto(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </div>
    </div>,
    document.body
  );
}
