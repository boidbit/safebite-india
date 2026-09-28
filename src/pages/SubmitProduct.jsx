// src/pages/SubmitProduct.jsx
// Reached from Home.jsx when a scanned barcode isn't in the catalog yet
// -- lets the person submit it themselves (product/ingredients/nutrition
// photos) instead of the dead end of "try pasting the ingredients
// instead". Goes into product_submissions for an admin to turn into a
// real product (see AdminSubmissionsList.jsx).
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { compressImageToDataUrl } from '../utils/adminImage';
import { submitProductSubmission } from '../services/productSubmissions';
import { useLanguage } from '../contexts/LanguageContext';

function PhotoField({ label, hint, required, dataUrl, onPick, onRemove, t }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {hint && <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">{hint}</p>}

      {dataUrl ? (
        <div className="relative inline-block">
          <img src={dataUrl} alt={label} className="w-28 h-28 rounded-2xl object-cover border border-slate-200 dark:border-slate-700" />
          <button
            onClick={onRemove}
            aria-label={t('ariaRemove')}
            className="tap-scale absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-800 text-white text-xs flex items-center justify-center"
          >
            ×
          </button>
        </div>
      ) : (
        <label className="tap-scale flex flex-col items-center justify-center w-28 h-28 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 text-slate-400 dark:text-slate-500 cursor-pointer">
          <span className="text-xl">📷</span>
          <span className="text-[10px] font-semibold mt-1">{t('submitAddPhoto')}</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0])}
          />
        </label>
      )}
    </div>
  );
}

export default function SubmitProduct() {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const barcode = searchParams.get('barcode') || '';
  const navigate = useNavigate();

  const [productName, setProductName] = useState('');
  const [productPhoto, setProductPhoto] = useState('');
  const [ingredientsPhoto, setIngredientsPhoto] = useState('');
  const [nutritionPhoto, setNutritionPhoto] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const pick = (setter) => async (file) => {
    if (!file) return;
    setError('');
    try {
      setter(await compressImageToDataUrl(file));
    } catch (err) {
      setError(err.message || t('submitErrPhotoUnreadable'));
    }
  };

  const handleSubmit = async () => {
    if (!ingredientsPhoto) {
      setError(t('submitErrIngredientsRequired'));
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await submitProductSubmission({ barcode, productName, productPhoto, ingredientsPhoto, nutritionPhoto, notes });
      setDone(true);
    } catch (err) {
      setError(err.message || t('genericErrorRetry'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!barcode) {
    return (
      <div className="page-in max-w-2xl mx-auto px-4 py-8 pb-24 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('submitNeedsBarcode')}
        </p>
        <button onClick={() => navigate('/')} className="tap-scale mt-4 text-sm font-semibold text-green-600 dark:text-green-400">
          ← {t('submitBackToScan')}
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="page-in max-w-2xl mx-auto px-4 py-8 pb-24 text-center">
        <div className="text-5xl mb-4">🙏</div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">{t('submitThanksTitle')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          {t('submitThanksBody')}
        </p>
        <button
          onClick={() => navigate('/')}
          className="tap-scale w-full py-3.5 bg-green-600 hover:bg-green-700 text-white font-bold text-base rounded-xl transition-colors"
        >
          {t('submitScanAnother')}
        </button>
      </div>
    );
  }

  return (
    <div className="page-in max-w-2xl mx-auto px-4 py-8 pb-24">
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">{t('submitTitle')}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">
        {t('submitIntroPre')}<span className="font-mono">{barcode}</span>{t('submitIntroPost')}
      </p>

      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mt-5 mb-1">
        {t('submitProductNameLabel')} <span className="text-slate-400 font-normal">{t('submitOptional')}</span>
      </label>
      <input
        type="text"
        value={productName}
        onChange={(e) => setProductName(e.target.value)}
        placeholder={t('submitProductNamePlaceholder')}
        className="w-full mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent placeholder:text-slate-400 dark:placeholder:text-slate-500"
      />

      <div className="flex gap-3 flex-wrap">
        <PhotoField
          t={t}
          label={t('submitFrontOfPack')}
          hint={t('submitFrontOfPackHint')}
          dataUrl={productPhoto}
          onPick={pick(setProductPhoto)}
          onRemove={() => setProductPhoto('')}
        />
        <PhotoField
          t={t}
          label={t('submitIngredientsList')}
          hint={t('submitIngredientsListHint')}
          required
          dataUrl={ingredientsPhoto}
          onPick={pick(setIngredientsPhoto)}
          onRemove={() => setIngredientsPhoto('')}
        />
        <PhotoField
          t={t}
          label={t('submitNutritionTable')}
          hint={t('submitNutritionTableHint')}
          dataUrl={nutritionPhoto}
          onPick={pick(setNutritionPhoto)}
          onRemove={() => setNutritionPhoto('')}
        />
      </div>

      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mt-2 mb-1">
        {t('submitAnythingElse')} <span className="text-slate-400 font-normal">{t('submitOptional')}</span>
      </label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder={t('submitNotesPlaceholder')}
        className="w-full mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent placeholder:text-slate-400 dark:placeholder:text-slate-500"
      />

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="tap-scale w-full py-3.5 bg-green-600 hover:bg-green-700 active:bg-green-800 disabled:opacity-60 text-white font-bold text-base rounded-xl transition-colors shadow-md shadow-green-200"
      >
        {submitting ? t('submitSubmitting') : `✅ ${t('submitForReview')}`}
      </button>
    </div>
  );
}
