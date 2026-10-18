// src/components/body/SugarFilm.jsx
//
// The one-minute "Chiku" sugar film (public/film/sugar-film.html), opened for
// THIS product: its name, the sugar in one serving, the serving size, and the
// period / how-often picked on the result page all travel in the address, so
// the film's numbers are the same ones the result page shows. The film is a
// self-contained page; it sits in a frame so the app's own back stack is
// untouched.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

const FREQ = { 7: 'daily', 3: 'three', 1: 'once' };

function filmUrl({ productName, grams, servingGrams, unit, perWeek }) {
  const q = new URLSearchParams({
    name: productName || 'This product',
    g: String(grams),
    serving: `${servingGrams} ${unit}`,
    period: 'year',
    freq: FREQ[perWeek] || 'daily',
  });
  return `${import.meta.env.BASE_URL}film/sugar-film.html?${q}`;
}

export default function SugarFilm({ productName, grams, servingGrams, unit, perWeek, onClose, t }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[999] bg-black/80 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="relative w-full sm:max-w-[440px] h-[96vh] sm:h-[90vh] overflow-hidden rounded-t-[24px] sm:rounded-[22px]"
        style={{ background: '#090810' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('bjFilmTitle')}
      >
        <iframe
          title={t('bjFilmTitle')}
          src={filmUrl({ productName, grams, servingGrams, unit, perWeek })}
          className="w-full h-full block border-0"
          allow="autoplay"
        />
        <button
          onClick={onClose}
          aria-label={t('ariaClose')}
          className="tap-scale absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center text-lg"
          style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}
        >
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}
