// src/components/BottomTabBar.jsx
// The app's 4 core destinations, thumb-reachable at the bottom instead
// of buried in the top header -- the standard pattern for an app with
// only a handful of top-level screens. Family/About/Notifications live
// one level deeper, under Settings (see src/pages/Settings.jsx), rather
// than each owning its own permanent tab.
import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';

const TABS = [
  { path: '/', key: 'navScan', icon: '🔍' },
  { path: '/history', key: 'navHistory', icon: '📋' },
  { path: '/discover', key: 'navDiscover', icon: '🧭' },
  { path: '/settings', key: 'navSettings', icon: '⚙️' },
];

export default function BottomTabBar() {
  const location = useLocation();
  const { t } = useLanguage();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-2xl mx-auto grid grid-cols-4">
        {TABS.map((tab) => {
          // Settings also lights up for its sub-pages (Family, About,
          // My Intake) -- they no longer have their own tab, so this is
          // the only way back into it, and it should still read as
          // "you're here".
          const active =
            tab.path === '/settings'
              ? ['/settings', '/family', '/about', '/my-intake'].includes(location.pathname)
              : location.pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className="tap-scale flex flex-col items-center gap-0.5 py-2"
            >
              <span className={`text-lg leading-none transition-transform ${active ? 'scale-110' : 'opacity-50'}`}>
                {tab.icon}
              </span>
              <span className={`text-[10px] font-semibold ${active ? 'text-green-700 dark:text-green-400' : 'text-slate-400 dark:text-slate-500'}`}>
                {t(tab.key)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
