// src/pages/admin/AdminProductForm.jsx
//
// Add and edit share this one form. "Analyze" runs the exact same
// pipeline a real text scan uses (analyzeText.js -> the same ingredient
// database and scoring rules every other product goes through), so a
// manually-added product is scored the same way as one a real user
// scanned -- never a separately-invented "admin score". The generated
// score/verdict/summary/recommendation are then directly editable
// below, for the real correction cases this session kept running into
// (a wrong AI verdict, a name that needs fixing).
import { getNutrientsPer100, toServing } from '../../services/nutrientBasis';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { adminMarkSubmissionApproved } from '../../services/adminSubmissionsRepo';
import AdminLayout from './AdminLayout';
import PhotoCropModal from './PhotoCropModal';
import { analyzeText } from '../../services/analyzeText';
import { buildReport } from '../../services/scoringEngine';
import { finalizeScore } from '../../services/finalizeScore';
import { adminSetReviewStatus } from '../../services/adminReviewRepo';
import { adminApprovedBarcodeFor } from '../../services/adminBarcodeLinksRepo';
import { StatusPill } from './AdminProducts';
import { extractIngredientsFromImage } from '../../services/geminiService';
import { lookupBarcode } from '../../services/openFoodFacts';
import { parseLabel, looksLikeNutritionPanel, findIngredientTextIssues } from '../../services/ingredientParser';
import { barcodeKey, textKey } from '../../services/productCache';
import {
  adminGetProduct,
  adminCreateProduct,
  adminUpdateProduct,
  adminFindByName,
  adminFindByBarcode,
} from '../../services/adminProductsRepo';
import { imageFileFromClipboard, compressImageToDataUrl } from '../../utils/adminImage';

const VERDICTS = ['Excellent', 'Good', 'Moderately Healthy', 'Poor', 'Very Poor'];
const FIELD = 'admin-field w-full px-3.5 py-2.5 rounded-[12px] text-[15px]';

// Opens Google's AI Mode (udm=50 -- a real, documented Google Search
// parameter) with a barcode-finding QUESTION as the query, or Google
// Lens's own "search by image URL" endpoint when there's a real
// (non-data:) photo URL -- a manual research aid for whatever the
// barcode/photo auto-fetch couldn't find. Lens's own upload-by-url
// endpoint has no text-query parameter, so the same question also
// goes on the clipboard, ready to paste into Lens's search box (or as
// a follow-up in AI Mode) once the page is open. Pack size is
// included whenever it's known, since different pack sizes of the
// same product have different real barcodes -- without it, the
// question (and whoever's reading the answer) can't tell which one
// this product actually is.
function searchBarcodeOnGoogleAi({ productName, brand, packSize, photoDataUrl }) {
  const sizePart = packSize?.trim() ? ` (${packSize.trim()})` : '';
  const command = `Find the barcode number (EAN/UPC/GTIN) for "${productName}"${sizePart}${brand?.trim() ? ` by ${brand.trim()}` : ''}`;
  const isRealUrl = typeof photoDataUrl === 'string' && /^https?:\/\//i.test(photoDataUrl);
  const url = isRealUrl
    ? `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(photoDataUrl)}`
    : `https://www.google.com/search?q=${encodeURIComponent(command)}&udm=50`;
  // Open first, synchronously in direct response to the click -- some
  // browsers treat a window.open after an awaited clipboard call as no
  // longer "in response to a user gesture" and silently block it.
  window.open(url, '_blank', 'noopener,noreferrer');
  navigator.clipboard?.writeText(command).catch(() => {});
}

// The 4 keys analyzeText.js's nutrientsInfo actually scores against
// (dailyHabitCheck.js's NUTRIENT_LIMITS), plus the rest kept purely for
// a complete, displayable nutrition record -- same fields Blinkit
// stores (see NUTRITION_FIELDS in services/blinkit.js), so a manually
// added product's data looks like every scraped one's. Keys match what
// geminiService.js's extraction prompt returns, so an extracted value
// drops straight into this shape with no remapping.
const NUTRIENT_FIELDS = [
  { key: 'energyKcal', label: 'Energy', unit: 'kcal' },
  { key: 'proteinG', label: 'Protein', unit: 'g' },
  { key: 'totalCarbG', label: 'Total Carbohydrates', unit: 'g' },
  { key: 'totalSugarG', label: 'Total Sugar', unit: 'g' },
  { key: 'addedSugarG', label: 'Added Sugar', unit: 'g', scored: true },
  { key: 'totalFatG', label: 'Total Fat', unit: 'g' },
  { key: 'saturatedFatG', label: 'Saturated Fat', unit: 'g', scored: true },
  { key: 'transFatG', label: 'Trans Fat', unit: 'g', scored: true },
  { key: 'fiberG', label: 'Fiber', unit: 'g' },
  { key: 'sodiumMg', label: 'Sodium', unit: 'mg', scored: true },
  { key: 'calciumMg', label: 'Calcium', unit: 'mg' },
];

// openFoodFacts.js's extractNutrientsForHabitCheck uses slightly
// different key names (caloriesKcal, carbohydrateG, fibreG) than this
// form's NUTRIENT_FIELDS (energyKcal, totalCarbG, fiberG) -- this maps
// OFF's keys onto this form's, for the barcode auto-fetch below.
const OFF_TO_ADMIN_NUTRIENT_KEY = {
  sodiumMg: 'sodiumMg',
  addedSugarG: 'addedSugarG',
  totalSugarG: 'totalSugarG',
  saturatedFatG: 'saturatedFatG',
  transFatG: 'transFatG',
  caloriesKcal: 'energyKcal',
  proteinG: 'proteinG',
  carbohydrateG: 'totalCarbG',
  totalFatG: 'totalFatG',
  fibreG: 'fiberG',
};

function NutrientField({ label, value, onChange, unit, scored }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold mb-1" style={{ color: 'var(--label-3)' }}>
        {label} {scored && <span title="Feeds the daily-habit score check">•</span>}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]"
        />
        <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--label-3)' }}>{unit}</span>
      </div>
    </div>
  );
}

function DuplicateWarning({ match, label, onOverride, overridden, blocking }) {
  if (!match) return null;
  return (
    <div
      className="rounded-[10px] px-3 py-2 mt-1.5 text-[12.5px] flex items-center justify-between gap-3"
      style={{ background: 'var(--v-poor-bg)', color: 'var(--v-poor)' }}
    >
      <span>{label} “{match.product_name}” already exists.{' '}
        <a href={`#/admin/products/${match.id}/edit`} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
          Open it
        </a>
      </span>
      {!blocking && (
        <label className="flex items-center gap-1.5 flex-shrink-0 cursor-pointer">
          <input type="checkbox" checked={overridden} onChange={(e) => onOverride(e.target.checked)} />
          Different product, save anyway
        </label>
      )}
    </div>
  );
}

/** One of up to two source photos used only to extract ingredients/nutrition -- never saved as the product's display image. */
function SourcePhotoSlot({ label, photo, onFile, onPaste, onRemove }) {
  const inputRef = useRef(null);
  return (
    <div
      tabIndex={0}
      onPaste={onPaste}
      className="rounded-[12px] p-3 flex items-center gap-2.5 outline-none"
      style={{ background: 'var(--bg-card)', border: '1px dashed var(--separator)' }}
    >
      {photo ? (
        <img src={photo.dataUrl} alt={label} className="w-14 h-14 rounded-[8px] object-cover flex-shrink-0" />
      ) : (
        <div className="w-14 h-14 rounded-[8px] flex items-center justify-center text-[20px] flex-shrink-0" style={{ background: 'var(--fill)' }}>
          📷
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[11.5px] font-semibold mb-0.5" style={{ color: 'var(--label-2)' }}>{label}</p>
        <p className="text-[11px]" style={{ color: 'var(--label-3)' }}>Click, then paste (Ctrl+V), or choose a file.</p>
        <div className="flex gap-3 mt-1">
          <button type="button" onClick={() => inputRef.current?.click()} className="tap-scale text-[11.5px] font-semibold" style={{ color: 'var(--tint)' }}>
            Choose file
          </button>
          {photo && (
            <button type="button" onClick={onRemove} className="tap-scale text-[11.5px] font-semibold" style={{ color: 'var(--v-poor)' }}>
              Remove
            </button>
          )}
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
    </div>
  );
}

/** Splits `text` into plain strings and highlighted <mark>s for each issue -- text outside any issue passes through untouched. */
function renderHighlightedText(text, issues) {
  if (!issues?.length) return text;
  const nodes = [];
  let cursor = 0;
  for (let i = 0; i < issues.length; i++) {
    const from = Math.max(issues[i].from, cursor);
    const to = Math.max(issues[i].to, from);
    if (from > cursor) nodes.push(text.slice(cursor, from));
    if (to > from) {
      nodes.push(
        <mark
          key={i}
          style={{
            background: issues[i].severity === 'error' ? 'rgba(220,53,69,0.38)' : 'rgba(230,180,20,0.4)',
            color: 'transparent',
            borderRadius: 2,
          }}
        >
          {text.slice(from, to)}
        </mark>
      );
    }
    cursor = Math.max(cursor, to);
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/**
 * A plain <textarea> with an exact-size copy of itself behind it
 * (same font/padding/wrapping via the same className) whose text is
 * invisible except for <mark> highlights at each issue's character
 * range -- the real, visible, editable text stays in the actual
 * textarea on top. Scroll position is synced by hand since a
 * transparent-text div doesn't otherwise track a sibling's scroll.
 */
function IngredientsTextArea({ value, onChange, onBlur, issues, className, placeholder, rows }) {
  const textareaRef = useRef(null);
  const overlayRef = useRef(null);

  const syncScroll = () => {
    if (overlayRef.current && textareaRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  return (
    <div className="relative">
      <div
        ref={overlayRef}
        aria-hidden="true"
        className={className}
        style={{
          position: 'absolute', inset: 0, color: 'transparent', background: 'transparent',
          border: '1px solid transparent', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          overflow: 'hidden', pointerEvents: 'none', fontFamily: 'inherit', zIndex: 1,
        }}
      >
        {renderHighlightedText(value, issues)}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        onScroll={syncScroll}
        rows={rows}
        placeholder={placeholder}
        className={className}
        style={{ position: 'relative', background: 'transparent', fontFamily: 'inherit', zIndex: 2 }}
      />
    </div>
  );
}

export default function AdminProductForm({ copyMode = false }) {
  const { id } = useParams();
  // A copy loads the same source row as edit mode but saves as a brand
  // new row (see handleSave) -- so for every "am I editing an existing
  // product" decision below, a copy counts as NOT editing.
  const isEdit = Boolean(id) && !copyMode;
  const navigate = useNavigate();
  const heroFileInputRef = useRef(null);

  const [loadingExisting, setLoadingExisting] = useState(Boolean(id));
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);

  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [barcode, setBarcode] = useState('');
  // "500 g", "2 x 2 kg" -- as printed on the pack. Auto-filled going
  // forward for Blinkit-scraped products (blinkit.js), typeable by
  // hand otherwise. See searchBarcodeOnGoogleAi's own comment for why
  // this matters: different pack sizes of the same product have
  // different real barcodes.
  const [packSize, setPackSize] = useState('');
  const [ingredientsText, setIngredientsText] = useState('');

  // The hero/display photo -- what actually gets saved as report.imageUrl.
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [showPhotoModal, setShowPhotoModal] = useState(false);

  // Up to 2 separate photos used ONLY to extract ingredients/nutrition
  // from (a pack's ingredients and nutrition table are often on
  // different faces, or one photo comes out too blurry to read) --
  // never saved anywhere, purely an input to the Extract action below.
  const [sourcePhotos, setSourcePhotos] = useState([null, null]);

  const [nutrients, setNutrients] = useState({});
  const [servingGrams, setServingGrams] = useState('');
  // 'g' for a solid/semi-solid pack, 'ml' for a liquid (a can/bottle) --
  // real bug this fixes: the field only ever showed/saved "g", so a
  // 200ml soda's own report told the reader "per 200g serving", wrong
  // unit for something you drink. Defaults to 'g' for every product
  // saved before this existed (see the report-load effect below), which
  // was the only unit ever recorded, so it's the correct backward-
  // compatible assumption, not a guess.
  const [servingUnit, setServingUnit] = useState('g');
  const setNutrient = (key, value) => setNutrients((prev) => ({ ...prev, [key]: value }));

  const [report, setReport] = useState(null);

  const [nameDuplicate, setNameDuplicate] = useState(null);
  const [nameDuplicateOverride, setNameDuplicateOverride] = useState(false);
  const [barcodeDuplicate, setBarcodeDuplicate] = useState(null);
  const [fetchingBarcode, setFetchingBarcode] = useState(false);
  const [autoAnalyzeTrigger, setAutoAnalyzeTrigger] = useState(0);
  const [existingSource, setExistingSource] = useState(null);
  // The row's identity as loaded -- an edit must keep it (see handleSave).
  const [existingLookupKey, setExistingLookupKey] = useState(null);
  // A barcode approved for this product in Barcode matches (a Blinkit
  // product's barcode lives there, not in its lookup key). Shown in the
  // barcode field; saving with it unchanged keeps the key as it is.
  const [linkedBarcode, setLinkedBarcode] = useState(null);
  // The name as loaded, for edit mode only -- checkNameDuplicate skips
  // its query entirely while the field still matches this, so simply
  // blurring an untouched name field never flags a product against
  // itself. Real, pre-existing duplicate names elsewhere in the catalog
  // do exist (confirmed live -- 28+ distinct names with 2+ rows each,
  // e.g. "Maggi" x4) and the check correctly finds them, but that's only
  // useful information when the admin is actively changing the name.
  const [originalProductName, setOriginalProductName] = useState(null);

  // Set when this form was opened from a user's product submission
  // (AdminSubmissionsList -> "Create product"): prefills the barcode,
  // name and photos, and marks the submission approved once the product
  // is actually saved -- see handleSave.
  const location = useLocation();
  const [reviewStatus, setReviewStatus] = useState(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [doneNote, setDoneNote] = useState('');

  // After a save or a review action, go back to wherever this form was
  // opened from -- Review, Flags, Manual review, Products... -- with that
  // list's filters and page intact (each list keeps them). It used to send
  // everyone to the Products list. Opened in a fresh tab (Duplicates,
  // Barcode check), there's nothing to go back to, so it stays here.
  // React Router records each in-app entry's position in history.state.idx.
  const goBackOrStay = (note, newId = null) => {
    if ((window.history.state?.idx ?? 0) > 0) {
      navigate(-1);
      return;
    }
    if (newId && newId !== id) navigate(`/admin/products/${newId}/edit`, { replace: true });
    setDoneNote(note);
  };
  const fromSubmission = !id ? location.state?.fromSubmission : null;
  const [submissionId] = useState(fromSubmission?.submissionId || null);

  useEffect(() => {
    if (!fromSubmission) return;
    setBarcode(fromSubmission.barcode || '');
    if (fromSubmission.productName) setProductName(fromSubmission.productName);
    if (fromSubmission.productPhoto) setPhotoDataUrl(fromSubmission.productPhoto);
    // The extraction action reads File objects, the submission stores
    // data: URLs -- turn them back into files so "Extract from photos"
    // works on them exactly as on photos the admin picked by hand.
    let cancelled = false;
    (async () => {
      const toSlot = async (dataUrl, name) => {
        if (!dataUrl) return null;
        const blob = await (await fetch(dataUrl)).blob();
        return { file: new File([blob], name, { type: blob.type || 'image/jpeg' }), dataUrl };
      };
      try {
        const slots = [
          await toSlot(fromSubmission.ingredientsPhoto, 'ingredients.jpg'),
          await toSlot(fromSubmission.nutritionPhoto, 'nutrition.jpg'),
        ];
        if (!cancelled) setSourcePhotos(slots);
      } catch {
        // Photos are a convenience -- the admin can still add them by hand.
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!id) return;
    adminGetProduct(id)
      .then((row) => {
        if (!row) { setError('Product not found.'); return; }
        const r = row.report || {};
        const name = row.product_name || r.productName || '';
        setProductName(name);
        if (!copyMode) setOriginalProductName(name);
        setBrand(r.brand || '');
        // Barcode, pack size and provenance are exactly the two things
        // that DO differ between pack sizes of the same product -- a
        // copy leaves these blank for the admin to fill in themselves,
        // rather than inheriting the source product's own barcode.
        if (!copyMode) {
          setBarcode(row.lookup_key?.startsWith('barcode:') ? row.lookup_key.slice('barcode:'.length) : '');
          setPackSize(r.packSize || '');
          setExistingSource(row.source || null);
          setExistingLookupKey(row.lookup_key || null);
          if (row.lookup_key && !row.lookup_key.startsWith('barcode:')) {
            adminApprovedBarcodeFor(row.lookup_key).then((code) => {
              if (!code) return;
              setLinkedBarcode(code);
              setBarcode((current) => current || code);
            }, () => {});
          }
        }
        setIngredientsText(row.ingredients_text || '');
        if (!copyMode) setReviewStatus(row.review_status || null);
        if (r.imageUrl) setPhotoDataUrl(r.imageUrl);
        if (r.nutritionPanel) setNutrients(r.nutritionPanel);
        else {
          // The form's fields are per 100 -- go through the canonical
          // per-100 view, not realNutrients (which may be per serving).
          const per100 = getNutrientsPer100(r);
          if (per100) {
            const asFormFields = {};
            for (const [reportKey, adminKey] of Object.entries(OFF_TO_ADMIN_NUTRIENT_KEY)) {
              if (typeof per100[reportKey] === 'number') asFormFields[adminKey] = per100[reportKey];
            }
            setNutrients(asFormFields);
          }
        }
        if (r.realNutrientsServingGrams) setServingGrams(r.realNutrientsServingGrams);
        if (r.realNutrientsServingUnit) setServingUnit(r.realNutrientsServingUnit);
        setReport(r);
        // The copy starts with the source product's exact name, so it
        // WILL look like a duplicate -- surface that warning right away
        // instead of waiting for the name field to be blurred, since the
        // admin never has to touch that field to hit Save.
        if (copyMode && name.trim()) {
          adminFindByName(name.trim(), null).then(setNameDuplicate).catch(() => {});
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingExisting(false));
  }, [id, copyMode]);

  // Every bracket-mismatch/missing-comma spot in the current text, with
  // exact character positions -- feeds both the highlight overlay below
  // and the summary message next to it.
  const ingredientIssues = useMemo(() => findIngredientTextIssues(ingredientsText), [ingredientsText]);

  // Live sanity-check on the ingredients text, reusing the exact same
  // checks analyzeText.js relies on (parseLabel/looksLikeNutritionPanel)
  // plus the bracket/comma issues above -- so a problem that would
  // otherwise only surface as a thrown error after clicking Analyze is
  // visible right under the field instead, while it's still easy to fix
  // by hand.
  const ingredientsQuality = useMemo(() => {
    const text = ingredientsText.trim();
    if (!text) return null;
    const bracketIssues = ingredientIssues.filter((i) => i.severity === 'error');
    if (bracketIssues.length > 0) {
      const extra = bracketIssues.length - 1;
      return { status: 'error', message: bracketIssues[0].message + (extra > 0 ? ` (+${extra} more bracket issue${extra === 1 ? '' : 's'} highlighted below)` : '') };
    }
    let parsed;
    try {
      parsed = parseLabel(text).ingredients;
    } catch {
      return null; // never let the sanity check itself break the page
    }
    if (parsed.length === 0) {
      return { status: 'error', message: 'No recognizable ingredients found in this text — check it, or re-extract.' };
    }
    if (looksLikeNutritionPanel(parsed)) {
      return { status: 'error', message: 'This looks like a nutrition panel, not an ingredients list.' };
    }
    const commaIssues = ingredientIssues.filter((i) => i.severity === 'warning');
    if (commaIssues.length > 0) {
      return { status: 'warn', message: `Looks parseable (${parsed.length} ingredient${parsed.length === 1 ? '' : 's'}), but ${commaIssues.length === 1 ? 'one spot' : `${commaIssues.length} spots`} highlighted below might be missing a comma.` };
    }
    return { status: 'ok', message: `Looks parseable — ${parsed.length} ingredient${parsed.length === 1 ? '' : 's'} found.` };
  }, [ingredientsText, ingredientIssues]);

  const checkNameDuplicate = async () => {
    if (!productName.trim()) { setNameDuplicate(null); return; }
    // Editing an existing product and the name hasn't actually changed
    // from what it was loaded as -- nothing new to warn about, even if
    // this exact name happens to also exist on another row elsewhere.
    if (isEdit && originalProductName !== null && productName.trim() === originalProductName.trim()) {
      setNameDuplicate(null);
      return;
    }
    const match = await adminFindByName(productName.trim(), isEdit ? id : null);
    setNameDuplicate(match);
    if (!match) setNameDuplicateOverride(false);
  };

  const checkBarcodeDuplicate = async () => {
    if (!barcode.trim()) { setBarcodeDuplicate(null); return; }
    const match = await adminFindByBarcode(barcode.trim(), isEdit ? id : null);
    setBarcodeDuplicate(match);
  };

  // Typing a barcode that's already on Open Food Facts fills in
  // everything it has -- name, brand, ingredients, photo, nutrition --
  // so most of the manual typing this form used to need only happens
  // for products OFF genuinely doesn't have. Only ever fills EMPTY
  // fields, so it never overwrites something already typed or (in edit
  // mode) already loaded from this product's existing report.
  const handleBarcodeBlur = async () => {
    checkBarcodeDuplicate();
    const cleaned = barcode.trim();
    if (!cleaned) return;

    setFetchingBarcode(true);
    try {
      const found = await lookupBarcode(cleaned);
      if (!found.found) return;

      if (!productName.trim() && found.productName && found.productName !== 'Unknown Product') setProductName(found.productName);
      if (!brand.trim() && found.brand) setBrand(found.brand);
      if (!photoDataUrl && found.imageUrl) setPhotoDataUrl(found.imageUrl);

      let filledIngredients = false;
      if (!ingredientsText.trim()) {
        if (found.readable === false) {
          setError(found.notes || "Found on Open Food Facts, but its ingredients look wrong there — type or extract them from a photo instead.");
        } else if (found.ingredientsText) {
          setIngredientsText(found.ingredientsText);
          filledIngredients = true;
        }
      }

      if (found.nutrientsInfo?.nutrients) {
        // These fields are per 100 g/ml -- so fill them from OFF's per-100
        // figures, never its pack-scaled ones (that mix-up is what made a
        // small pack's numbers read as if they were per 100 g).
        const per100 = found.nutrientsInfo.nutrientsPer100 || found.nutrientsInfo.nutrients;
        setNutrients((prev) => {
          const next = { ...prev };
          for (const [offKey, adminKey] of Object.entries(OFF_TO_ADMIN_NUTRIENT_KEY)) {
            const value = per100[offKey];
            if (value != null && (next[adminKey] === undefined || next[adminKey] === '')) next[adminKey] = value;
          }
          return next;
        });
        if (!servingGrams && found.nutrientsInfo.servingGrams) setServingGrams(found.nutrientsInfo.servingGrams);
      }

      // Enough to Analyze now -- do it automatically instead of making
      // scan-a-barcode-and-review three separate clicks. (Deferred to
      // the next render via the trigger below, since handleAnalyze
      // called right here would still see this render's pre-update
      // productName/ingredientsText.)
      if (filledIngredients && (productName.trim() || found.productName)) {
        setAutoAnalyzeTrigger((n) => n + 1);
      }
    } catch {
      // Open Food Facts being slow/unreachable shouldn't block manual entry.
    } finally {
      setFetchingBarcode(false);
    }
  };

  const applyHeroPhoto = async (file) => {
    if (!file) return;
    try {
      // Same ~20KB target as the Blinkit optimize pipeline
      // (blinkitImageOptimizer.js) -- a phone photo uploaded here is
      // what a real user actually sees, so it belongs on the same size
      // budget as every other product photo, not the ~150KB default.
      setPhotoDataUrl(await compressImageToDataUrl(file, { maxBytes: 20 * 1024 }));
    } catch (err) {
      setError(err.message);
    }
  };

  const applySourcePhoto = async (index, file) => {
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setSourcePhotos((prev) => prev.map((p, i) => (i === index ? { file, dataUrl } : p)));
    } catch (err) {
      setError(err.message);
    }
  };

  const removeSourcePhoto = (index) => setSourcePhotos((prev) => prev.map((p, i) => (i === index ? null : p)));

  const handleExtractInfo = async () => {
    const photos = sourcePhotos.filter(Boolean);
    if (photos.length === 0) { setError('Add at least one ingredients/nutrition photo first.'); return; }
    setError('');
    setExtracting(true);
    try {
      let foundIngredientsText = '';
      let foundProductName = '';
      const mergedNutrition = {};
      let foundServingGrams = '';
      const notes = [];
      let anyReadable = false;

      for (const photo of photos) {
        const extracted = await extractIngredientsFromImage(photo.file);
        if (extracted.readable) anyReadable = true;
        if (!foundIngredientsText && extracted.ingredientsText) foundIngredientsText = extracted.ingredientsText;
        if (!foundProductName && extracted.productName && extracted.productName !== 'Unknown Product') foundProductName = extracted.productName;
        if (extracted.nutrition) {
          for (const [k, v] of Object.entries(extracted.nutrition)) {
            if (mergedNutrition[k] === undefined && typeof v === 'number') mergedNutrition[k] = v;
          }
        }
        if (!foundServingGrams && extracted.servingGrams) foundServingGrams = extracted.servingGrams;
        if (extracted.notes) notes.push(extracted.notes);
      }

      if (foundIngredientsText) setIngredientsText(foundIngredientsText);
      if (foundProductName && !productName.trim()) setProductName(foundProductName);
      if (Object.keys(mergedNutrition).length > 0) {
        setNutrients((prev) => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(mergedNutrition)) {
            if (next[k] === undefined || next[k] === '') next[k] = v;
          }
          return next;
        });
      }
      if (foundServingGrams && !servingGrams) setServingGrams(foundServingGrams);

      const messages = [];
      if (!foundIngredientsText) {
        messages.push(anyReadable ? 'No ingredients list found in these photos — type it in manually.' : "Couldn't read these photos clearly.");
      }
      if (Object.keys(mergedNutrition).length === 0) messages.push('No nutrition table found in these photos.');
      if (notes.length) messages.push(notes.join(' '));
      if (messages.length) setError(messages.join(' '));
    } catch (err) {
      setError(err.message);
    } finally {
      setExtracting(false);
    }
  };

  // The form's numbers are per 100 g/ml (that's what a label's panel
  // states) -- they ARE the canonical basis; `nutrients` is the same
  // table scaled to the serving size when one is filled in.
  const buildNutrientsInfo = () => {
    const per100 = {};
    for (const [reportKey, adminKey] of Object.entries(OFF_TO_ADMIN_NUTRIENT_KEY)) {
      const v = nutrients[adminKey];
      if (v !== undefined && v !== '' && Number.isFinite(Number(v))) per100[reportKey] = Number(v);
    }
    if (Object.keys(per100).length === 0) return undefined;
    // Same convention as the OFF/Blinkit producers: with no separate
    // added-sugar figure the total stands in for it (WHO's limit is on
    // free sugars), and isn't then printed a second time under its own name.
    if (per100.addedSugarG === undefined && per100.totalSugarG !== undefined) {
      per100.addedSugarG = per100.totalSugarG;
      delete per100.totalSugarG;
    }
    const serving = servingGrams !== '' && Number(servingGrams) > 0 ? Number(servingGrams) : undefined;
    return {
      nutrients: serving ? toServing(per100, serving) : per100,
      nutrientsPer100: per100,
      servingGrams: serving,
      servingUnit,
    };
  };

  const buildNutritionPanel = () => {
    const panel = {};
    for (const field of NUTRIENT_FIELDS) {
      if (nutrients[field.key] !== undefined && nutrients[field.key] !== '') {
        panel[field.key] = Number(nutrients[field.key]);
      }
    }
    return Object.keys(panel).length > 0 ? panel : null;
  };

  const handleAnalyze = async () => {
    setError('');
    if (!productName.trim()) { setError('Product name is required.'); return; }
    if (!ingredientsText.trim()) { setError('Ingredients text is required.'); return; }
    if (barcodeDuplicate) { setError('That barcode already belongs to another product — fix or clear it first.'); return; }
    if (nameDuplicate && !nameDuplicateOverride) { setError('That name already exists — confirm it’s a different product first.'); return; }

    setAnalyzing(true);
    try {
      const result = await analyzeText(
        ingredientsText.trim(),
        productName.trim(),
        brand.trim() || undefined,
        null,
        photoDataUrl || undefined,
        buildNutrientsInfo(),
        packSize.trim() || undefined
      );
      setReport(result.report);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  // Fires once per successful barcode auto-fetch (see handleBarcodeBlur)
  // -- deferred to an effect so it runs against the render where
  // productName/ingredientsText/nutrients have actually updated,
  // instead of the stale, pre-update values a direct call would close
  // over.
  useEffect(() => {
    if (autoAnalyzeTrigger > 0) handleAnalyze();
  }, [autoAnalyzeTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateIngredient = (index, patch) => {
    setReport((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)),
    }));
  };

  // Re-runs the same deterministic scoring math (scoringEngine.js) on
  // the CURRENT (possibly hand-edited) ingredients array -- no AI call.
  // A per-ingredient status/penalty edit only changes the underlying
  // data; this is what actually recomputes score/verdict/flags/
  // positives/summary/recommendation from it.
  //
  // buildReport alone is only the ingredient math -- the Quick Health
  // Check's nutrient cap and the fried/energy-dense ceiling come after it
  // (finalizeScore.js), exactly as a fresh scan does. Running just
  // buildReport here made a recalculated fried snack lose that ceiling
  // and jump back up to its ingredient-only score. Uses the nutrition
  // values currently in this form, so an edited panel counts too.
  const handleRecalculate = () => {
    if (!report?.ingredients) return;
    const trimmedPack = packSize.trim() || null;
    const recalculated = buildReport(report.ingredients, {
      productName: productName.trim(),
      brand: brand.trim() || null,
      imageUrl: photoDataUrl || null,
      packSize: trimmedPack,
    });
    const next = { ...report, ...recalculated };
    const nutrientsInfo = buildNutrientsInfo();
    if (nutrientsInfo) next.nutrientsPer100 = nutrientsInfo.nutrientsPer100;
    finalizeScore(next, { nutrientsInfo, packSize: trimmedPack || undefined });
    setReport(next);
  };

  const handleSave = async ({ approve = false } = {}) => {
    if (!report) { setError('Run "Analyze" first — there’s nothing generated to save yet.'); return; }
    if (!productName.trim()) { setError('Product name is required.'); return; }
    if (barcodeDuplicate) { setError('That barcode already belongs to another product — fix or clear it first.'); return; }
    if (nameDuplicate && !nameDuplicateOverride) { setError('That name already exists — confirm it’s a different product first.'); return; }

    setError('');
    setSaving(true);
    try {
      const finalReport = {
        ...report,
        productName: productName.trim(),
        brand: brand.trim() || null,
        imageUrl: photoDataUrl || null,
        packSize: packSize.trim() || null,
        nutritionPanel: buildNutritionPanel(),
      };
      // Identity of the product. A new product gets barcode:/text: as
      // before, but an EDIT keeps the key it already has unless a barcode
      // was typed. Recomputing it from the edited ingredients (or turning
      // a blinkit:/text: key into a different one) left the original key
      // unowned, so the next scan/refresh/scrape of the very same pack
      // saved a second row for it -- "editing creates a new product".
      // The approved Barcode-matches barcode shown in the field isn't a
      // newly typed one -- keeping it must not turn the key into barcode:.
      const typedBarcode = barcode.trim() === linkedBarcode ? '' : barcode.trim();
      const keepKey = isEdit && existingLookupKey && !existingLookupKey.startsWith('barcode:') ? existingLookupKey : null;
      const lookupKey = typedBarcode ? barcodeKey(typedBarcode) : keepKey || textKey(ingredientsText.trim());
      // 'blinkit' is a real provenance marker (this row came from the
      // scraper) -- adding or editing a barcode on that product isn't a
      // change of WHERE it came from, so it must survive the save.
      // Everything else ('barcode'/'text'/'search'/'image', or brand
      // new) has no such provenance worth keeping and just re-derives
      // from whether a barcode is present, as before.
      const PROVENANCE_SOURCES = ['blinkit'];
      const source = isEdit && PROVENANCE_SOURCES.includes(existingSource)
        ? existingSource
        : barcode.trim() ? 'barcode' : 'text';
      const payload = { lookupKey, source, productName: finalReport.productName, ingredientsText: ingredientsText.trim(), report: finalReport };

      let savedId = id;
      if (isEdit) {
        await adminUpdateProduct(id, payload);
      } else {
        savedId = await adminCreateProduct(payload);
        // Only after the product really exists -- an approved submission
        // must never point at nothing.
        if (submissionId) {
          try { await adminMarkSubmissionApproved(submissionId, finalReport.productName); } catch { /* product is saved; the admin can tidy the status by hand */ }
        }
      }
      // A new row always starts 'pending' (the database forces it), so
      // approving is a separate step -- done here only after the save
      // itself succeeded.
      if (approve) {
        await adminSetReviewStatus([{ id: savedId, productName: finalReport.productName }], 'approved');
        setReviewStatus('approved');
      }
      if (submissionId) navigate('/admin/submissions');
      else goBackOrStay(approve ? 'Saved and approved — it’s now shown in the app.' : 'Saved.', savedId);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Status only, no save -- for a product that needs no changes.
  const handleSetReviewStatus = async (status) => {
    if (status === 'rejected' && !window.confirm('Reject this product? It will stay out of the app.')) return;
    setReviewBusy(true);
    setError('');
    try {
      await adminSetReviewStatus([{ id, productName: productName.trim() }], status);
      setReviewStatus(status);
      goBackOrStay({ approved: 'Approved — it’s now shown in the app.', rejected: 'Rejected — it stays out of the app.', pending: 'Moved back to review — hidden in the app until approved.' }[status]);
    } catch (err) {
      setError(err.message);
    } finally {
      setReviewBusy(false);
    }
  };

  if (loadingExisting) {
    return <AdminLayout><p style={{ color: 'var(--label-3)' }}>Loading…</p></AdminLayout>;
  }

  return (
    <AdminLayout>
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--label-1)' }}>
          {copyMode ? 'Copy product (as new)' : isEdit ? 'Edit product' : 'Add new product'}
        </p>
        {isEdit && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href={`#/p/${id}`}
              target="_blank"
              rel="noreferrer"
              title="Open the saved report in the main app, as a user sees it (save first to see unsaved edits)"
              className="tap-scale text-[12.5px] font-semibold px-3 py-2 rounded-[10px] flex-shrink-0"
              style={{ background: 'var(--tint-bg)', color: 'var(--tint)' }}
            >
              👁 View in app
            </a>
          <a
            href={`#/admin/products/${id}/copy`}
            target="_blank"
            rel="noreferrer"
            title="Open a copy of this product in a new tab -- for a different pack size that needs its own barcode"
            className="tap-scale text-[12.5px] font-semibold px-3 py-2 rounded-[10px] flex-shrink-0"
            style={{ background: 'var(--fill)', color: 'var(--label-2)' }}
          >
            📋 Copy as new product
          </a>
          </div>
        )}
      </div>
      {copyMode ? (
        <p className="text-[12.5px] mb-4 px-3 py-2 rounded-[10px]" style={{ background: 'var(--tint-bg)', color: 'var(--tint)' }}>
          Name, ingredients, nutrition and photo copied from the source product. Enter this pack size's own barcode below, then save — this creates a separate new product.
        </p>
      ) : (
        <div className="mb-3" />
      )}

      {/* Review: whether this product is shown in the app yet. Approve /
          Reject here change only the status; "Save & approve" at the
          bottom saves edits first, then approves. */}
      {isEdit && reviewStatus && (
        <div className="flex flex-wrap items-center gap-2 mb-4 px-3.5 py-2.5 rounded-[12px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
          <span className="text-[12.5px] font-semibold" style={{ color: 'var(--label-2)' }}>Review status</span>
          <StatusPill status={reviewStatus} />
          <span className="text-[12px]" style={{ color: 'var(--label-3)' }}>
            {reviewStatus === 'pending' ? 'Hidden in the app until approved.' : reviewStatus === 'rejected' ? 'Kept out of the app.' : reviewStatus === 'live' ? 'Shown in the app, not reviewed yet.' : 'Reviewed and shown in the app.'}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            {reviewStatus !== 'approved' && (
              <button type="button" disabled={reviewBusy} onClick={() => handleSetReviewStatus('approved')} className="tap-scale px-3 py-1.5 rounded-[8px] text-[13px] font-semibold text-white" style={{ background: 'var(--v-good)', opacity: reviewBusy ? 0.5 : 1 }}>
                Approve (no changes)
              </button>
            )}
            {reviewStatus !== 'rejected' && (
              <button type="button" disabled={reviewBusy} onClick={() => handleSetReviewStatus('rejected')} className="tap-scale px-3 py-1.5 rounded-[8px] text-[13px] font-semibold" style={{ background: 'var(--v-poor-bg)', color: 'var(--v-poor)', opacity: reviewBusy ? 0.5 : 1 }}>
                Reject
              </button>
            )}
            {(reviewStatus === 'approved' || reviewStatus === 'rejected') && (
              <button type="button" disabled={reviewBusy} onClick={() => handleSetReviewStatus('pending')} className="tap-scale px-3 py-1.5 rounded-[8px] text-[13px] font-semibold" style={{ background: 'var(--fill)', color: 'var(--label-1)', opacity: reviewBusy ? 0.5 : 1 }}>
                Back to review
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' }}>
        <div>
          <div className="rounded-[16px] p-4 mb-4" style={{ background: 'var(--bg-card)' }}>
            <p className="text-[13px] font-semibold mb-3" style={{ color: 'var(--label-2)' }}>Product details</p>

            <label className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--label-3)' }}>Product name *</label>
            <input value={productName} onChange={(e) => setProductName(e.target.value)} onBlur={checkNameDuplicate} className={FIELD} />
            <DuplicateWarning match={nameDuplicate} label="A product named" onOverride={setNameDuplicateOverride} overridden={nameDuplicateOverride} />

            <div className="grid grid-cols-2 gap-3 mt-3 mb-1">
              <div>
                <label className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--label-3)' }}>Brand</label>
                <input value={brand} onChange={(e) => setBrand(e.target.value)} className={FIELD} />
              </div>
              <div>
                <label className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--label-3)' }}>Pack size</label>
                <input value={packSize} onChange={(e) => setPackSize(e.target.value)} placeholder="e.g. 500 g, 2 x 2 kg" className={FIELD} />
              </div>
            </div>

            <div className="flex items-end gap-2 mt-3 mb-1">
              <div className="flex-1">
                <label className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--label-3)' }}>
                  Barcode (optional) {fetchingBarcode && <span style={{ color: 'var(--tint)' }}>— checking Open Food Facts…</span>}
                </label>
                <input value={barcode} onChange={(e) => setBarcode(e.target.value)} onBlur={handleBarcodeBlur} placeholder="Type or scan — auto-fills from Open Food Facts if known" className={FIELD} />
                {linkedBarcode && barcode.trim() === linkedBarcode && (
                  <p className="text-[11.5px] mt-1" style={{ color: 'var(--v-good)' }}>✓ Approved barcode match — scanning it opens this product</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => searchBarcodeOnGoogleAi({ productName: productName.trim() || '(unnamed)', brand, packSize, photoDataUrl })}
                title="Copy a 'find the barcode' question & search on Google AI Mode / Lens"
                className="tap-scale flex-shrink-0 px-3 rounded-[12px]"
                style={{ background: 'var(--fill)', height: 46 }}
              >
                🔍
              </button>
            </div>
            {packSize.trim() && (
              <p className="text-[11.5px] mb-1" style={{ color: 'var(--v-moderate)' }}>
                ⚠ Different pack sizes have different real barcodes — make sure whatever you enter matches "{packSize.trim()}", not another size.
              </p>
            )}
            <DuplicateWarning match={barcodeDuplicate} label="This barcode is already used by" blocking />

            <label className="block text-[12px] font-semibold mb-1 mt-3" style={{ color: 'var(--label-3)' }}>Ingredients text *</label>
            <IngredientsTextArea
              value={ingredientsText}
              onChange={(e) => setIngredientsText(e.target.value)}
              issues={ingredientIssues}
              rows={5}
              placeholder="Sugar, Refined Wheat Flour (Maida), Palm Oil, ..."
              className={`${FIELD} text-[14px] resize-none`}
            />
            {ingredientsQuality && (
              <p
                className="text-[12px] mt-1.5"
                style={{
                  color:
                    ingredientsQuality.status === 'ok' ? 'var(--v-good)'
                    : ingredientsQuality.status === 'warn' ? 'var(--v-moderate)'
                    : 'var(--v-poor)',
                }}
              >
                {ingredientsQuality.status === 'ok' ? '✓' : '⚠'} {ingredientsQuality.message}
              </p>
            )}
          </div>

          <div className="rounded-[16px] p-4 mb-4" style={{ background: 'var(--bg-card)' }}>
            <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--label-2)' }}>Ingredients &amp; nutrition photos</p>
            <p className="text-[11.5px] mb-3" style={{ color: 'var(--label-3)' }}>
              Up to 2 photos — the back-of-pack ingredients list and/or the nutrition table. Only used to fill the fields below, never saved.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <SourcePhotoSlot
                label="Photo 1"
                photo={sourcePhotos[0]}
                onFile={(f) => applySourcePhoto(0, f)}
                onPaste={(e) => { const f = imageFileFromClipboard(e); if (f) { e.preventDefault(); applySourcePhoto(0, f); } }}
                onRemove={() => removeSourcePhoto(0)}
              />
              <SourcePhotoSlot
                label="Photo 2 (optional)"
                photo={sourcePhotos[1]}
                onFile={(f) => applySourcePhoto(1, f)}
                onPaste={(e) => { const f = imageFileFromClipboard(e); if (f) { e.preventDefault(); applySourcePhoto(1, f); } }}
                onRemove={() => removeSourcePhoto(1)}
              />
            </div>
            <button
              type="button"
              onClick={handleExtractInfo}
              disabled={sourcePhotos.every((p) => !p) || extracting}
              className="tap-scale w-full mt-3 py-2.5 rounded-[12px] text-[13.5px] font-semibold"
              style={{ background: 'var(--tint-bg)', color: 'var(--tint)', opacity: sourcePhotos.every((p) => !p) || extracting ? 0.5 : 1 }}
            >
              {extracting ? 'Reading photos…' : '📷 Extract ingredients & nutrition'}
            </button>
          </div>

          {error && (
            <p className="text-[13px] mb-4 p-3 rounded-[12px]" style={{ background: 'var(--v-poor-bg)', color: 'var(--v-poor)' }}>
              {error}
            </p>
          )}
          {doneNote && !error && (
            <p className="text-[13px] mb-4 p-3 rounded-[12px]" style={{ background: 'var(--v-good-bg)', color: 'var(--v-good)' }}>
              ✓ {doneNote}
            </p>
          )}

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyzing}
            className="tap-scale w-full py-3 rounded-[12px] text-[15px] font-semibold text-white mb-4"
            style={{ background: 'var(--tint)', opacity: analyzing ? 0.6 : 1 }}
          >
            {analyzing ? 'Analyzing…' : report ? 'Re-analyze' : 'Analyze'}
          </button>

          {report && (
            <div className="rounded-[16px] p-4 mb-4" style={{ background: 'var(--bg-card)' }}>
              <p className="text-[13px] font-semibold mb-3" style={{ color: 'var(--label-2)' }}>
                Generated result — edit anything below before saving
              </p>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--label-3)' }}>Score (0-100)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={report.overallScore}
                    onChange={(e) => setReport({ ...report, overallScore: Number(e.target.value) })}
                    className={FIELD}
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--label-3)' }}>Verdict</label>
                  <select value={report.verdict} onChange={(e) => setReport({ ...report, verdict: e.target.value })} className={FIELD}>
                    {VERDICTS.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>

              <label className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--label-3)' }}>Summary</label>
              <textarea
                value={report.summary || ''}
                onChange={(e) => setReport({ ...report, summary: e.target.value })}
                rows={2}
                className={`${FIELD} text-[13.5px] mb-3 resize-none`}
              />

              <label className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--label-3)' }}>Recommendation</label>
              <textarea
                value={report.recommendation || ''}
                onChange={(e) => setReport({ ...report, recommendation: e.target.value })}
                rows={2}
                className={`${FIELD} text-[13.5px] resize-none`}
              />
            </div>
          )}

          {report?.ingredients?.length > 0 && (
            <div className="rounded-[16px] p-4 mb-4" style={{ background: 'var(--bg-card)' }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] font-semibold" style={{ color: 'var(--label-2)' }}>
                  Ingredients ({report.ingredients.length}) — edit status/penalty/reason, then recalculate
                </p>
                <button
                  type="button"
                  onClick={handleRecalculate}
                  className="tap-scale px-3 py-1.5 rounded-[8px] text-[12.5px] font-semibold flex-shrink-0"
                  style={{ background: 'var(--tint-bg)', color: 'var(--tint)' }}
                >
                  Recalculate score
                </button>
              </div>
              {/* Capped height + internal scroll rather than letting the
                  page itself grow -- a product with 20+ ingredients
                  (real examples run past 30) would otherwise push the
                  photo/nutrition/save button far down the page. */}
              <div className="rounded-[10px] overflow-y-auto" style={{ border: '1px solid var(--separator)', maxHeight: 420 }}>
                {report.ingredients.map((ing, i) => (
                  <div key={i} className="grid gap-2 px-3 py-2" style={{ gridTemplateColumns: '1.4fr 1fr 70px 1.6fr', borderBottom: i < report.ingredients.length - 1 ? '1px solid var(--separator)' : 'none' }}>
                    <span className="text-[12.5px] font-semibold truncate self-center" style={{ color: 'var(--label-1)' }}>{ing.name}</span>
                    <select value={ing.status} onChange={(e) => updateIngredient(i, { status: e.target.value })} className="admin-field px-2 py-1.5 rounded-[8px] text-[12px]">
                      <option value="safe">safe</option>
                      <option value="concerning">concerning</option>
                      <option value="harmful">harmful</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      max="40"
                      value={ing.penalty ?? 0}
                      onChange={(e) => updateIngredient(i, { penalty: Number(e.target.value) })}
                      className="admin-field px-2 py-1.5 rounded-[8px] text-[12px] w-full"
                    />
                    <input
                      value={ing.reason || ''}
                      onChange={(e) => updateIngredient(i, { reason: e.target.value })}
                      placeholder="Reason shown to users"
                      className="admin-field px-2 py-1.5 rounded-[8px] text-[12px] w-full"
                    />
                  </div>
                ))}
              </div>
              <p className="text-[11px] mt-2" style={{ color: 'var(--label-3)' }}>
                "Recalculate score" re-runs the same scoring rules on these ingredients — no AI call — and overwrites score/verdict/flags/summary/recommendation above with the result.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => handleSave()}
            disabled={!report || saving}
            className="tap-scale w-full py-3 rounded-[12px] text-[15px] font-semibold text-white"
            style={{ background: 'var(--v-very-healthy)', opacity: !report || saving ? 0.5 : 1 }}
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : copyMode ? 'Save as new product' : 'Save product'}
          </button>
          {reviewStatus !== 'approved' && (
            <button
              type="button"
              onClick={() => handleSave({ approve: true })}
              disabled={!report || saving}
              className="tap-scale w-full mt-2 py-3 rounded-[12px] text-[15px] font-semibold"
              style={{ background: 'var(--v-good-bg)', color: 'var(--v-good)', opacity: !report || saving ? 0.5 : 1 }}
            >
              {saving ? 'Saving…' : 'Save & approve (publish in app)'}
            </button>
          )}
        </div>

        <div>
          <div className="rounded-[16px] p-4 mb-4" style={{ background: 'var(--bg-card)' }}>
            <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--label-2)' }}>Product photo</p>
            <p className="text-[11.5px] mb-3" style={{ color: 'var(--label-3)' }}>The hero image shown on the product's card and report — a clean front-of-pack shot.</p>

            <div
              tabIndex={0}
              onPaste={(e) => { const f = imageFileFromClipboard(e); if (f) { e.preventDefault(); applyHeroPhoto(f); } }}
              className="rounded-[12px] p-4 flex items-center gap-3 outline-none"
              style={{ background: 'var(--bg-card)', border: '1px dashed var(--separator)' }}
            >
              {photoDataUrl ? (
                <button
                  type="button"
                  onClick={() => setShowPhotoModal(true)}
                  title="Preview / crop"
                  className="tap-scale w-16 h-16 rounded-[10px] flex-shrink-0 overflow-hidden"
                >
                  <img src={photoDataUrl} alt="Product" className="w-full h-full object-cover" />
                </button>
              ) : (
                <div className="w-16 h-16 rounded-[10px] flex items-center justify-center text-[24px] flex-shrink-0" style={{ background: 'var(--fill)' }}>
                  📷
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px]" style={{ color: 'var(--label-2)' }}>
                  Click here and paste (Ctrl+V) a copied photo, or choose a file.
                </p>
                <div className="flex gap-3 mt-1.5 flex-wrap">
                  <button type="button" onClick={() => heroFileInputRef.current?.click()} className="tap-scale text-[12.5px] font-semibold" style={{ color: 'var(--tint)' }}>
                    Choose file
                  </button>
                  {photoDataUrl && (
                    <>
                      <button type="button" onClick={() => setShowPhotoModal(true)} className="tap-scale text-[12.5px] font-semibold" style={{ color: 'var(--tint)' }}>
                        Preview / crop
                      </button>
                      <button type="button" onClick={() => setPhotoDataUrl('')} className="tap-scale text-[12.5px] font-semibold" style={{ color: 'var(--v-poor)' }}>
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
            <input ref={heroFileInputRef} type="file" accept="image/*" onChange={(e) => applyHeroPhoto(e.target.files?.[0])} className="hidden" />

            {showPhotoModal && photoDataUrl && (
              <PhotoCropModal
                imageUrl={photoDataUrl}
                onCropped={(cropped) => { setPhotoDataUrl(cropped); setShowPhotoModal(false); }}
                onClose={() => setShowPhotoModal(false)}
              />
            )}
          </div>

          <div className="rounded-[16px] p-4" style={{ background: 'var(--bg-card)' }}>
            <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--label-2)' }}>Nutrition (optional)</p>
            <p className="text-[11.5px] mb-3" style={{ color: 'var(--label-3)' }}>
              Per 100g/100ml. Fields marked • feed the daily-habit score check; the rest are kept for reference. "Extract ingredients &amp; nutrition" above fills these in automatically when a photo shows a nutrition table.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              {NUTRIENT_FIELDS.map((f) => (
                <NutrientField key={f.key} label={f.label} unit={f.unit} scored={f.scored} value={nutrients[f.key] ?? ''} onChange={(v) => setNutrient(f.key, v)} />
              ))}
            </div>
            <div>
              <label className="block text-[11.5px] font-semibold mb-1" style={{ color: 'var(--label-3)' }}>
                Real serving size
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  inputMode="decimal"
                  value={servingGrams}
                  onChange={(e) => setServingGrams(e.target.value)}
                  className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]"
                />
                {/* A liquid pack (a can, a bottle) is measured in ml, not
                    g -- this used to be hardcoded to "g" always, so a
                    200ml soda's own report said "per 200g serving". */}
                <div className="flex flex-shrink-0 rounded-[8px] overflow-hidden" style={{ border: '1px solid var(--separator)' }}>
                  {['g', 'ml'].map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setServingUnit(u)}
                      className="tap-scale px-2.5 py-2 text-[12px] font-semibold"
                      style={{ background: servingUnit === u ? 'var(--tint)' : 'transparent', color: servingUnit === u ? '#fff' : 'var(--label-3)' }}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
