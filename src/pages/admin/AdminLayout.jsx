// src/pages/admin/AdminLayout.jsx
//
// Shared full-width shell for every logged-in admin page -- deliberately
// not the mobile-first max-w-2xl centered layout the rest of the app
// uses. This is a desktop tool used occasionally from a browser, not a
// phone screen, so it uses the width it actually has.
//
// Five top-level sections instead of a dozen links; a section with more
// than one page shows them as tabs underneath. Every page keeps its own
// URL, so old links and bookmarks still open the right tab.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabaseClient';
import { adminInboxCounts } from '../../services/adminDashboardRepo';

const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', to: '/admin/dashboard', tabs: [{ to: '/admin/dashboard' }] },
  { id: 'products', label: 'Products', to: '/admin/products', tabs: [{ to: '/admin/products' }] },
  {
    id: 'inbox', label: 'Inbox', to: '/admin/flags',
    tabs: [
      { to: '/admin/flags', label: 'Flags', countKey: 'flags' },
      { to: '/admin/data-issues', label: 'Manual review', countKey: 'dataIssues' },
      { to: '/admin/submissions', label: 'Submissions', countKey: 'submissions' },
      { to: '/admin/duplicates', label: 'Duplicates' },
    ],
  },
  {
    id: 'barcodes', label: 'Barcodes', to: '/admin/barcode-links',
    tabs: [
      { to: '/admin/barcode-links', label: 'Barcode matches' },
      { to: '/admin/barcode-check', label: 'Barcode check' },
      { to: '/admin/barcode-backfill', label: 'Backfill progress' },
    ],
  },
  {
    id: 'tools', label: 'Tools', to: '/admin/scrape-progress',
    tabs: [
      { to: '/admin/scrape-progress', label: 'Scrape progress' },
      { to: '/admin/import', label: 'Import' },
      { to: '/admin/activity', label: 'Activity log' },
    ],
  },
];

// Inbox badges -- fetched once per minute at most, not on every page.
let inboxCache = { at: 0, counts: null };

function useInboxCounts() {
  const [counts, setCounts] = useState(inboxCache.counts);
  useEffect(() => {
    if (Date.now() - inboxCache.at < 60_000 && inboxCache.counts) return;
    let alive = true;
    adminInboxCounts().then((c) => {
      inboxCache = { at: Date.now(), counts: c };
      if (alive) setCounts(c);
    }, () => {});
    return () => { alive = false; };
  }, []);
  return counts;
}

function Badge({ n }) {
  if (!n) return null;
  return (
    <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-bold text-white" style={{ background: 'var(--v-poor)' }}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

export default function AdminLayout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const counts = useInboxCounts();

  // The product form/history pages live under /admin/products too.
  const inTab = (tab) => location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`);
  const section = SECTIONS.find((s) => s.tabs.some(inTab)) || null;
  const inboxTotal = counts ? (counts.flags || 0) + (counts.dataIssues || 0) + (counts.submissions || 0) : 0;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/admin', { replace: true });
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-grouped)' }}>
      <div style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--separator)' }}>
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link to="/admin/dashboard" className="text-[15px] font-bold" style={{ color: 'var(--label-1)' }}>FoodGuard Admin</Link>
            <nav className="flex items-center gap-5">
              {SECTIONS.map((s) => (
                <Link
                  key={s.id}
                  to={s.to}
                  className="tap-scale text-[14px] font-semibold inline-flex items-center"
                  style={{ color: section?.id === s.id ? 'var(--tint)' : 'var(--label-3)' }}
                >
                  {s.label}
                  {s.id === 'inbox' && <Badge n={inboxTotal} />}
                </Link>
              ))}
            </nav>
          </div>
          <button onClick={handleSignOut} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--label-3)' }}>
            Sign out
          </button>
        </div>
        {section && section.tabs.length > 1 && (
          <div className="flex items-center gap-1.5 px-6 pb-2.5">
            {section.tabs.map((tab) => {
              const active = inTab(tab);
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className="tap-scale px-3 py-1 rounded-full text-[12.5px] font-semibold inline-flex items-center"
                  style={{ background: active ? 'var(--tint)' : 'var(--fill)', color: active ? '#fff' : 'var(--label-1)' }}
                >
                  {tab.label}
                  {tab.countKey && counts && counts[tab.countKey] > 0 && (
                    <span className="ml-1.5 text-[11px] font-bold" style={{ opacity: 0.85 }}>{counts[tab.countKey]}</span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <div className="px-6 py-6" style={{ maxWidth: 1400, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}
