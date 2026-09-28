// src/components/BarcodeNotFoundPanel.jsx
//
// A scanned barcode the catalog doesn't know -- but the product may well
// be in it already (Blinkit products carry no barcode). Instead of a dead
// end, this finds it by name in as few taps as possible: the search box is
// open and focused (pre-filled with Open Food Facts' name for the barcode
// when it knows one), results appear as you type, a front-of-pack photo
// fills the search in one tap, and tapping a product opens it. That tap is
// also recorded as a pending barcode link (see recordBarcodeLink).
import { useEffect, useRef, useState } from 'react';
import { findProductMatches } from '../services/productCache';
import { identifyProductFromPhoto } from '../services/geminiService';
import { getScoreColor } from '../utils/storage';
import { useLanguage } from '../contexts/LanguageContext';
import ProductImage from './ProductImage';

const SEARCH_DEBOUNCE_MS = 350;

/**
 * @param {object} props
 * @param {string} props.barcode
 * @param {null | { productName?: string, brand?: string }} props.offProduct - what Open Food Facts knows, if anything
 * @param {(match: object, source: string) => void} props.onPick
 * @param {() => void} [props.onAnalyzeNew] - only when Open Food Facts has this product's ingredients
 * @param {() => void} props.onSubmit
 */
export default function BarcodeNotFoundPanel({ barcode, offProduct, onPick, onAnalyzeNew, onSubmit }) {
  const { t } = useLanguage();
  const offName = [offProduct?.brand, offProduct?.productName].filter(Boolean).join(' ').trim();
  const [query, setQuery] = useState(offName);
  // What the current results were found from -- a typed/pre-filled name, or a photo read.
  const [lookup, setLookup] = useState(offName ? { productName: offProduct.productName || '', brand: offProduct.brand || '', source: 'off_name' } : null);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [photoNote, setPhotoNote] = useState('');
  const inputRef = useRef(null);
  const photoRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!lookup || `${lookup.brand || ''} ${lookup.productName || ''}`.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await findProductMatches(lookup).catch(() => []);
      if (!cancelled) {
        setResults(found);
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [lookup]);

  const onType = (value) => {
    setQuery(value);
    setPhotoNote('');
    setLookup({ productName: value, brand: '', source: 'name_search' });
  };

  const onPhoto = async (file) => {
    if (!file) return;
    setReadingPhoto(true);
    setPhotoNote('');
    try {
      const read = await identifyProductFromPhoto(file);
      if (!read.readable) {
        setPhotoNote(t('nfPhotoUnreadable'));
        return;
      }
      setQuery([read.brand, read.productName].filter(Boolean).join(' '));
      setLookup({ productName: read.productName, brand: read.brand, packSize: read.packSize, source: 'photo' });
    } catch {
      setPhotoNote(t('nfPhotoFailed'));
    } finally {
      setReadingPhoto(false);
    }
  };

  const hasQuery = query.trim().length >= 2;

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
      <p className="text-[15px] font-bold text-slate-800 dark:text-slate-100">{t('nfTitle')}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-3">
        {offName ? t('nfSubtitleKnown') : t('nfSubtitle')} <span className="font-mono">{barcode}</span>
      </p>

      <div className="flex gap-2">
        <label className="flex-1 min-w-0 flex items-center gap-2 rounded-xl border-2 border-green-600 dark:border-green-500 px-3 py-2.5">
          <span aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onType(e.target.value)}
            placeholder={t('nfSearchPlaceholder')}
            aria-label={t('nfSearchPlaceholder')}
            className="flex-1 min-w-0 bg-transparent text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
        </label>
        <button
          onClick={() => photoRef.current?.click()}
          disabled={readingPhoto}
          className="tap-scale flex-shrink-0 px-3 rounded-xl bg-green-600 text-white text-sm font-semibold disabled:opacity-60"
        >
          📷 {readingPhoto ? t('nfReadingPhoto') : t('nfPhotoBtn')}
        </button>
        <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {photoNote && <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">{photoNote}</p>}

      {searching && hasQuery && <p className="text-xs text-slate-400 mt-3">{t('homeSearching')}</p>}

      {!searching && results.length > 0 && (
        <>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-3 mb-1.5">{t('nfTapYours')}</p>
          <div className="space-y-1.5">
            {results.map((m) => {
              const colors = typeof m.score === 'number' ? getScoreColor(m.score) : null;
              return (
                <button
                  key={m.lookupKey}
                  onClick={() => onPick(m, lookup?.source || 'name_search')}
                  className="tap-scale w-full flex items-center gap-3 p-2 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-left"
                >
                  <ProductImage src={m.imageUrl} size={44} expandable={false} />
                  <span className="flex-1 min-w-0">
                    {m.brand && <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide truncate">{m.brand}</span>}
                    <span className="block text-sm text-slate-700 dark:text-slate-200 leading-tight line-clamp-2">{m.productName}</span>
                    {m.packSize && <span className="block text-[11px] text-slate-400">{m.packSize}</span>}
                  </span>
                  {m.isInfantFormula ? null : colors && (
                    <span className="flex-shrink-0 text-xs font-bold rounded-full px-2 py-0.5" style={{ background: colors.bg, color: colors.color }}>{m.score}/100</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {!searching && hasQuery && results.length === 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">{t('nfNoMatches')}</p>
      )}

      <div className="flex flex-wrap gap-2 mt-3.5">
        {onAnalyzeNew && (
          <button onClick={onAnalyzeNew} className="tap-scale flex-1 min-w-[140px] py-2.5 rounded-xl bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold">
            {t('nfAnalyzeNew')}
          </button>
        )}
        <button onClick={onSubmit} className="tap-scale flex-1 min-w-[140px] py-2.5 rounded-xl border-2 border-dashed border-green-300 text-green-700 dark:text-green-400 text-sm font-semibold">
          ➕ {t('homeSubmitProduct')}
        </button>
      </div>
    </div>
  );
}
