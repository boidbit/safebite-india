// src/components/home/LooksHealthyStrip.jsx
//
// "Looks healthy, but…" -- approved products whose name sells health
// ("Multigrain", "Sugar Free", "Protein"…) but whose label scores low, a
// different random set every time the app opens. Each card shows the pack's
// own claim, stamped on like a sticker, and asks "Healthy?"; tapping flips it
// over to the score, the claim crossed out and what the label actually says.
// The first card peeks once so it reads as flippable before anyone's told.
//
// Both faces sit in one grid cell (index.css .flip-inner), so a card is as
// tall as its content and the row lines up on its tallest card -- no fixed
// height leaving empty space. The back is always built, so flipping never
// changes the card's size; its animated parts remount on each flip.
import { useState } from 'react';
import ScoreCircle from '../ScoreCircle';
import ProductImage from '../ProductImage';
import { getScoreColor } from '../../utils/storage';
import { hookLine } from '../../utils/homeHooks';
import { useLanguage } from '../../contexts/LanguageContext';

function FlipCard({ item, peek, onOpen, style }) {
  const { t, language } = useLanguage();
  const [flips, setFlips] = useState(0);
  const flipped = flips % 2 === 1;
  const colors = getScoreColor(item.score);
  const line = hookLine(item, t);
  const flip = () => setFlips((n) => n + 1);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      onClick={flip}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } }}
      style={style}
      className={`item-in flip-card flex-shrink-0 w-[168px] cursor-pointer ${flipped ? 'flipped' : ''} ${peek && flips === 0 ? 'flip-peek' : ''}`}
    >
      <div className="flip-inner">
        {/* Front: what the pack wants you to think. */}
        <div className="flip-face flex flex-col p-3 bg-white dark:bg-slate-800 border border-green-100 dark:border-green-900">
          {item.claim && (
            <span className="claim-sticker relative self-start overflow-hidden text-[11px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-lg -rotate-3">
              <span className="claim-shine absolute inset-0" />
              <span className="relative">{item.claim} ✓</span>
            </span>
          )}
          <div className="flex justify-center my-3">
            <ProductImage src={item.imageUrl} size={96} expandable={false} />
          </div>
          <p className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-100 leading-tight line-clamp-2">{item.productName}</p>
          <div className="flex items-center justify-between mt-auto pt-2.5">
            <span className="text-[15px] font-extrabold text-slate-800 dark:text-slate-100">{t('healthyQuestion')} 🤔</span>
            <span className="text-[10px] font-semibold text-slate-400">{t('healthyTapToFlip')} ↻</span>
          </div>
        </div>

        {/* Back: what the label says. */}
        <div className="flip-face flip-back flex flex-col items-center p-3 text-center" style={{ background: 'var(--bg-card)', border: `2px solid ${colors.color}` }}>
          {item.claim && (
            <span key={`claim-${flips}`} className={`${flipped ? 'claim-strike' : ''} text-[11px] font-extrabold uppercase tracking-wide text-slate-400`}>{item.claim}</span>
          )}
          <div key={`ring-${flips}`} className="mt-1.5">
            {flipped ? <ScoreCircle score={item.score} size="medium" fillMs={900} /> : <div className="w-[88px] h-[88px]" />}
          </div>
          <span key={`verdict-${flips}`} className="reel-pop mt-1 text-[10.5px] font-extrabold uppercase px-2 py-0.5 rounded-full" style={{ background: colors.bg, color: colors.color, animationDelay: '0.9s' }}>
            {colors.label}
          </span>
          {line && (
            <p key={`line-${flips}`} className="reel-rise text-[11.5px] leading-snug mt-1.5 font-semibold text-slate-700 dark:text-slate-200 line-clamp-4" style={{ animationDelay: '1.05s' }}>
              <span className={`block text-slate-400 font-bold mb-0.5 ${language === 'hi' ? 'text-[11px]' : 'text-[10px] uppercase tracking-wide'}`}>{t('healthyBut')}</span>{line}
            </p>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(item); }}
            className="tap-scale mt-auto pt-2 text-[12px] font-bold"
            style={{ color: 'var(--tint)' }}
          >
            {t('healthyOpen')} →
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LooksHealthyStrip({ items, onOpen }) {
  const { t } = useLanguage();
  return (
    <div className="mb-6">
      <div className="px-0.5 mb-2">
        <p className="text-[17px] font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">{t('healthyTitle')}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('healthySubtitle')}</p>
      </div>
      <div className="relative">
        <div className="flex items-stretch gap-3 overflow-x-auto pb-2 pr-8 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
          {items.map((item, i) => (
            <FlipCard key={item.lookupKey} item={item} peek={i === 0} onOpen={onOpen} style={{ animationDelay: `${Math.min(i * 50, 300)}ms` }} />
          ))}
        </div>
        <div className="pointer-events-none absolute top-0 right-0 bottom-2 w-10" style={{ background: 'linear-gradient(to right, transparent, var(--bg-grouped))' }} />
      </div>
    </div>
  );
}
