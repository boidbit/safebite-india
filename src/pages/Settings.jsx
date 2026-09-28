// src/pages/Settings.jsx
//
// A single hub for everything that isn't a core scan/browse flow --
// Family profiles, Notifications, Language, and About/how-scoring-works
// -- so the bottom tab bar stays 4 core destinations instead of 5, with
// the less-frequently-tapped ones one level deeper instead of each
// owning a permanent thumb-reach slot.
import { Link } from 'react-router-dom';
import NotificationSettings from '../components/NotificationSettings';
import BackupSettings from '../components/BackupSettings';
import { isNativeApp } from '../services/notifications';
import { PUBLIC_APP_URL } from '../utils/share';
import { useLanguage } from '../contexts/LanguageContext';

function NavRow({ to, icon, title, description }) {
  return (
    <Link
      to={to}
      className="tap-scale flex items-center gap-3 py-3.5 px-1 first:pt-0 last:pb-0"
    >
      <span className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-950 flex items-center justify-center text-lg flex-shrink-0">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-slate-800 dark:text-slate-100">{title}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
      </div>
      <span className="text-slate-300 dark:text-slate-600 text-lg flex-shrink-0">›</span>
    </Link>
  );
}

// A visible row, not just the small header icon (Header.jsx's own
// LanguageToggle) -- Settings is where someone actually goes looking
// for "change the language", and a labelled two-way switch (English /
// हिंदी, both names always shown so it's readable however it's
// currently set) is clearer there than a toggle that only shows the
// OTHER language's name.
function LanguageRow({ t }) {
  const { language, setLanguage } = useLanguage();
  return (
    <div className="flex items-center gap-3 py-3.5 px-1">
      <span className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-950 flex items-center justify-center text-lg flex-shrink-0">
        🌐
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-slate-800 dark:text-slate-100">{t('settingsLanguage')}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('settingsLanguageDesc')}</p>
      </div>
      <div className="flex-shrink-0 flex gap-1 bg-slate-100 dark:bg-slate-700 rounded-full p-0.5">
        {[['en', 'English'], ['hi', 'हिंदी']].map(([code, label]) => (
          <button
            key={code}
            onClick={() => setLanguage(code)}
            aria-pressed={language === code}
            className={`tap-scale px-3 py-1.5 rounded-full text-[13px] font-semibold transition-colors ${
              language === code ? 'bg-green-600 text-white' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  const { t } = useLanguage();

  const shareApp = () => {
    const text = t('settingsShareMessage');
    if (navigator.share) {
      navigator.share({ title: 'FoodGuard India', text, url: PUBLIC_APP_URL }).catch(() => {});
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${PUBLIC_APP_URL}`)}`, '_blank', 'noopener');
    }
  };

  return (
    <div className="page-in max-w-2xl mx-auto px-4 py-8 pb-24">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-1">{t('settingsTitle')}</h1>
      <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">{t('settingsSubtitle')}</p>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 divide-y divide-slate-100 dark:divide-slate-700 mb-4">
        <LanguageRow t={t} />
        <NavRow to="/my-intake" icon="🍽️" title={t('settingsMyIntake')} description={t('settingsMyIntakeDesc')} />
        <NavRow to="/family" icon="👪" title={t('settingsFamily')} description={t('settingsFamilyDesc')} />
        <NavRow to="/about" icon="🛡️" title={t('settingsAbout')} description={t('settingsAboutDesc')} />
        <NavRow to="/privacy" icon="🔒" title={t('settingsPrivacy')} description={t('settingsPrivacyDesc')} />
      </div>

      <BackupSettings />

      {/* Self-contained card; renders nothing on the web (Android-only feature). */}
      <NotificationSettings />

      <button
        onClick={shareApp}
        className="tap-scale w-full flex items-center gap-3 py-3.5 px-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl mb-4"
      >
        <span className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-950 flex items-center justify-center text-lg flex-shrink-0">📤</span>
        <div className="min-w-0 flex-1 text-left">
          <p className="text-[15px] font-semibold text-slate-800 dark:text-slate-100">{t('settingsShare')}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('settingsShareDesc')}</p>
        </div>
      </button>

      <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-2">
        {isNativeApp() ? t('settingsFooterAndroid') : t('settingsFooter')}
      </p>
    </div>
  );
}
