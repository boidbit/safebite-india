// src/pages/admin/AdminLayout.jsx
//
// Shared full-width shell for every logged-in admin page -- deliberately
// not the mobile-first max-w-2xl centered layout the rest of the app
// uses. This is a desktop tool used occasionally from a browser, not a
// phone screen, so it uses the width it actually has.
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabaseClient';

const NAV = [
  { to: '/admin/review', label: 'Review' },
  { to: '/admin/products', label: 'Products' },
  { to: '/admin/scrape-progress', label: 'Scrape progress' },
  { to: '/admin/flags', label: 'Flags' },
  { to: '/admin/data-issues', label: 'Manual review' },
  { to: '/admin/submissions', label: 'Submissions' },
  { to: '/admin/duplicates', label: 'Duplicates' },
  { to: '/admin/barcode-check', label: 'Barcode check' },
  { to: '/admin/barcode-links', label: 'Barcode matches' },
  { to: '/admin/barcode-backfill', label: 'Barcode backfill' },
  { to: '/admin/import', label: 'Import' },
  { to: '/admin/activity', label: 'Activity' },
];

export default function AdminLayout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/admin', { replace: true });
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-grouped)' }}>
      <div
        className="flex items-center justify-between px-6 py-3"
        style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--separator)' }}
      >
        <div className="flex items-center gap-6">
          <span className="text-[15px] font-bold" style={{ color: 'var(--label-1)' }}>FoodGuard Admin</span>
          <nav className="flex items-center gap-4">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="tap-scale text-[13.5px] font-semibold"
                style={{ color: location.pathname.startsWith(item.to) ? 'var(--tint)' : 'var(--label-3)' }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <button onClick={handleSignOut} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--label-3)' }}>
          Sign out
        </button>
      </div>
      <div className="px-6 py-6" style={{ maxWidth: 1400, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}
