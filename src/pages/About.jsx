// src/pages/About.jsx
import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';

// A translated string can't carry JSX <strong> tags directly, so
// **this** marks bold the same way the English copy used <strong> --
// split on it and wrap the matched parts, in whichever language t()
// returned.
function renderBold(text) {
  const parts = String(text).split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

export default function About() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();

  // React Router doesn't auto-scroll to #hash targets on navigation —
  // do it ourselves so links like "How is this score calculated?" from
  // the Result page actually jump to the right section.
  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  const steps = [
    { step: '1', title: t('aboutStep1Title'), desc: t('aboutStep1Desc') },
    { step: '2', title: t('aboutStep2Title'), desc: t('aboutStep2Desc') },
    { step: '3', title: t('aboutStep4Title'), desc: t('aboutStep4Desc') },
  ];

  const tiers = [
    { range: '85–100', color: 'bg-green-500', label: t('weekTierExcellent'), desc: t('aboutTierExcellentDesc') },
    { range: '65–84', color: 'bg-green-400', label: t('weekTierGood'), desc: t('aboutTierGoodDesc') },
    { range: '45–64', color: 'bg-yellow-400', label: t('weekTierModerate'), desc: t('aboutTierModerateDesc') },
    { range: '25–44', color: 'bg-orange-400', label: t('weekTierPoor'), desc: t('aboutTierPoorDesc') },
    { range: '0–24', color: 'bg-red-500', label: t('aboutTierAvoidLabel'), desc: t('aboutTierAvoidDesc') },
  ];

  return (
    <div className="page-in max-w-2xl mx-auto px-4 py-8 pb-24">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-green-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">
          🛡️
        </div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">{t('aboutTitle')}</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          {t('aboutTagline')}
        </p>
      </div>

      {/* Mission */}
      <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-2xl p-5 mb-4">
        <h2 className="font-bold text-green-800 dark:text-green-300 mb-2">🎯 {t('aboutMissionTitle')}</h2>
        <p className="text-sm text-green-700 dark:text-green-400 leading-relaxed">
          {t('aboutMissionBody')}
        </p>
      </div>

      {/* How it works */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 mb-4">
        <h2 className="font-bold text-slate-800 dark:text-slate-100 mb-4">⚙️ {t('aboutHowItWorksTitle')}</h2>
        <div className="space-y-4">
          {steps.map((item) => (
            <div key={item.step} className="flex gap-3">
              <div className="w-7 h-7 bg-green-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                {item.step}
              </div>
              <div>
                <p className="font-semibold text-slate-800 dark:text-slate-100 text-sm">{item.title}</p>
                <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* How the score is actually calculated */}
      <div id="how-score-works" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 mb-4 scroll-mt-4">
        <h2 className="font-bold text-slate-800 dark:text-slate-100 mb-2">🧮 {t('aboutScoreCalcTitle')}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
          {renderBold(t('aboutScoreCalcIntro'))}
        </p>

        <div className="space-y-3 mb-5">
          <div className="flex gap-3">
            <span className="text-lg flex-shrink-0">1️⃣</span>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{renderBold(t('aboutScoreRule1'))}</p>
          </div>
          <div className="flex gap-3">
            <span className="text-lg flex-shrink-0">2️⃣</span>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{renderBold(t('aboutScoreRule2'))}</p>
          </div>
          <div className="flex gap-3">
            <span className="text-lg flex-shrink-0">3️⃣</span>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{renderBold(t('aboutScoreRule3'))}</p>
          </div>
        </div>

        {/* Worked example */}
        <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
          <p className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wide mb-2">📎 {t('aboutExampleLabel')}</p>
          <p className="text-sm text-amber-900 leading-relaxed mb-3">{renderBold(t('aboutExampleIntro'))}</p>
          <div className="bg-white dark:bg-slate-800 rounded-lg p-3 font-mono text-xs text-slate-700 dark:text-slate-200 mb-3 overflow-x-auto">
            weight = 0.5 + (68 ÷ 100) × 0.5 = <strong>0.84</strong><br />
            contribution = 15 × 0.84 = <strong>12.6 points</strong>
          </div>
          <p className="text-sm text-amber-900 leading-relaxed">{renderBold(t('aboutExampleOutro'))}</p>
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500 mt-4 leading-relaxed">
          {t('aboutScoreCalcNote')}
        </p>
      </div>

      {/* Score guide */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 mb-4">
        <h2 className="font-bold text-slate-800 dark:text-slate-100 mb-1">📊 {t('aboutScoreGuideTitle')}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          {t('aboutScoreGuideIntro')}
        </p>
        <div className="space-y-2">
          {tiers.map((item) => (
            <div key={item.range} className="flex items-center gap-3">
              <div className={`w-10 h-6 ${item.color} rounded text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                {item.range.split('–')[0]}
              </div>
              <div>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{item.label}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">{item.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Data sources */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 mb-4">
        <h2 className="font-bold text-slate-800 dark:text-slate-100 mb-3">📚 {t('aboutDataSourcesTitle')}</h2>
        <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-2">
          <li className="flex items-start gap-2">
            <span>🇮🇳</span>
            <span>{renderBold(t('aboutSourceFssai'))}</span>
          </li>
          <li className="flex items-start gap-2">
            <span>🇪🇺</span>
            <span>{renderBold(t('aboutSourceEu'))}</span>
          </li>
        </ul>
      </div>

      {/* Disclaimer */}
      <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl p-4 mb-6 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        <strong>⚠️ {t('aboutDisclaimerLabel')}</strong> {t('aboutDisclaimerBody')}
      </div>

      <button onClick={() => navigate('/privacy')} className="tap-scale w-full mb-3 text-sm font-semibold text-green-600 dark:text-green-400">
        🔒 {t('settingsPrivacy')}
      </button>

      <button
        onClick={() => navigate('/')}
        className="tap-scale w-full py-3.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-colors"
      >
        🔍 {t('aboutStartScanning')}
      </button>
    </div>
  );
}
