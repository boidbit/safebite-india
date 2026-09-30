// src/pages/admin/AdminDashboard.jsx
//
// The admin home: what's waiting, at a glance, each line a link straight
// to where it's dealt with. Every number reads live from the same tables
// the pages behind it use.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminLayout from './AdminLayout';
import { adminReviewCounts } from '../../services/adminReviewRepo';
import { adminInboxCounts, adminBarcodeSummary, adminLastScrapeAt } from '../../services/adminDashboardRepo';
import { adminListBarcodeLinks, adminAssessBarcodeLinks } from '../../services/adminBarcodeLinksRepo';

function timeAgo(iso) {
  if (!iso) return 'never';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Card({ title, children }) {
  return (
    <div className="rounded-[14px] p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
      <p className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--label-3)' }}>{title}</p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

// One "N things -> go there" line. A zero reads as done, not as a task.
function Line({ to, label, value, hint, urgent = true }) {
  const n = typeof value === 'number' ? value : null;
  const todo = urgent && n > 0;
  return (
    <Link to={to} className="tap-scale flex items-center justify-between gap-3 py-2" style={{ borderTop: '1px solid var(--separator)' }}>
      <span className="min-w-0">
        <span className="text-[14px] font-semibold" style={{ color: 'var(--label-1)' }}>{label}</span>
        {hint && <span className="block text-[11.5px]" style={{ color: 'var(--label-3)' }}>{hint}</span>}
      </span>
      <span className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[18px] font-bold tabular-nums" style={{ color: todo ? 'var(--v-moderate)' : 'var(--label-2)' }}>
          {value === null || value === undefined ? '…' : typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        <span style={{ color: 'var(--label-3)' }}>›</span>
      </span>
    </Link>
  );
}

export default function AdminDashboard() {
  const [review, setReview] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [barcodes, setBarcodes] = useState(null);
  const [safeBarcodes, setSafeBarcodes] = useState(null);
  const [lastScrape, setLastScrape] = useState(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    const fail = (err) => setError(err.message || String(err));
    adminReviewCounts().then(setReview, fail);
    adminInboxCounts().then(setInbox, fail);
    adminBarcodeSummary().then(setBarcodes, fail);
    adminLastScrapeAt().then(setLastScrape, () => setLastScrape(null));
    // The safe-to-approve check reads a lot (every link and product), so
    // it fills in after everything else.
    adminListBarcodeLinks({ status: 'pending' })
      .then((list) => adminAssessBarcodeLinks(list))
      .then(({ verdicts }) => setSafeBarcodes([...verdicts.values()].filter((v) => v.safe).length), () => setSafeBarcodes('—'));
  }, []);

  const backfill = barcodes?.backfill;
  const backfillQuiet = backfill && Date.now() - new Date(backfill.updated_at).getTime() > 5 * 60 * 1000;
  const backfillText = !barcodes ? null
    : !backfill ? 'not started'
    : backfill.status === 'running' && !backfillQuiet ? 'running'
    : backfill.status === 'running' ? 'not responding'
    : backfill.status;

  return (
    <AdminLayout>
      <p className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--label-1)' }}>Dashboard</p>
      <p className="text-[12.5px] mb-4" style={{ color: 'var(--label-3)' }}>What’s waiting for you. Tap a line to go there.</p>
      {error && <p className="text-[13px] mb-3" style={{ color: 'var(--v-poor)' }}>{error}</p>}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <Card title="Products to review">
          <Line to="/admin/products?tab=newScraped" label="New from scraping" hint="Hidden in the app until approved" value={review?.newScraped} />
          <Line to="/admin/products?tab=newScans" label="New from user scans" hint="Hidden in the app until approved" value={review?.newScans} />
          <Line to="/admin/products?tab=live" label="Live, not reviewed" hint="Already in the app — check when you can" value={review?.live} urgent={false} />
          <Line to="/admin/products?tab=all" label="Live in the app" hint="Approved + live, not reviewed" value={review ? (review.approved || 0) + (review.live || 0) : null} urgent={false} />
        </Card>

        <Card title="Inbox">
          <Line to="/admin/flags" label="Flags" hint="Problems users reported" value={inbox?.flags} />
          <Line to="/admin/data-issues" label="Manual review" hint="Data problems found automatically" value={inbox?.dataIssues} />
          <Line to="/admin/submissions" label="Submissions" hint="Products users sent in" value={inbox?.submissions} />
          <Line to="/admin/duplicates" label="Duplicates" hint="Same product saved twice" value="Check" urgent={false} />
        </Card>

        <Card title="Barcodes">
          <Line to="/admin/barcode-links" label="Safe to approve" hint="One click: “Approve all safe”" value={safeBarcodes} />
          <Line to="/admin/barcode-links" label="Waiting in Barcode matches" hint="Safe ones + ones that need a look" value={barcodes?.waiting} />
          <Line to="/admin/barcode-backfill" label="Barcode backfill" hint={backfill ? `Last update ${timeAgo(backfill.updated_at)}` : null} value={backfillText} urgent={false} />
        </Card>

        <Card title="Background jobs">
          <Line to="/admin/scrape-progress" label="Blinkit scraper" hint="Last product saved" value={lastScrape === undefined ? null : timeAgo(lastScrape)} urgent={false} />
          <Line to="/admin/activity" label="Activity log" hint="Every admin change" value="Open" urgent={false} />
        </Card>
      </div>
    </AdminLayout>
  );
}
