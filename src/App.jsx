// src/App.jsx
//
// HashRouter, not BrowserRouter: this deploys to GitHub Pages, which
// serves plain static files with no server-side rewrite rule (unlike
// Netlify's _redirects). A direct link or refresh on a route like
// /result/abc123 would 404 under HashRouter -- HashRouter keeps
// every route after the # (e.g. /#/result/abc123), which GitHub Pages
// always resolves to index.html since it's just a URL fragment as far
// as the server is concerned. The tradeoff is a visible # in the URL.
// It also happens to suit the Android app build just as well, since
// Capacitor serves local files the same server-less way.
import { syncNotifications, listenForTaps } from './services/notifications';
import { getRecentlyAddedProducts } from './services/productCache';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { LanguageProvider } from './contexts/LanguageContext';
import { FamilyProvider } from './contexts/FamilyContext';
import Header from './components/Header';
import BottomTabBar from './components/BottomTabBar';
import SplashScreen from './components/SplashScreen';
import Onboarding, { ONBOARDING_KEY } from './components/Onboarding';
import Home from './pages/Home';
import Result from './pages/Result';
import PersonalScore from './pages/PersonalScore';
import SharedProduct from './pages/SharedProduct';
import History from './pages/History';
import Compare from './pages/Compare';
import CompareManage from './pages/CompareManage';
import Family from './pages/Family';
import About from './pages/About';
import Settings from './pages/Settings';
import MyIntake from './pages/MyIntake';
import Category from './pages/Category';
import PopularSearches from './pages/PopularSearches';
import News from './pages/News';
import AdminLogin from './pages/admin/AdminLogin';
import AdminGuard from './pages/admin/AdminGuard';
import AdminReviewList from './pages/admin/AdminReviewList';
import AdminBarcodeLinks from './pages/admin/AdminBarcodeLinks';
import AdminProductList from './pages/admin/AdminProductList';
import AdminProductForm from './pages/admin/AdminProductForm';
import AdminFlagsList from './pages/admin/AdminFlagsList';
import AdminDataIssuesList from './pages/admin/AdminDataIssuesList';
import AdminScrapeProgress from './pages/admin/AdminScrapeProgress';
import AdminDuplicates from './pages/admin/AdminDuplicates';
import AdminImport from './pages/admin/AdminImport';
import AdminActivityLog from './pages/admin/AdminActivityLog';
import AdminProductHistory from './pages/admin/AdminProductHistory';
import AdminBarcodeCheck from './pages/admin/AdminBarcodeCheck';
import AdminSubmissionsList from './pages/admin/AdminSubmissionsList';
import SubmitProduct from './pages/SubmitProduct';

// The Android app's hardware/gesture back button doesn't do anything by
// default in a Capacitor WebView -- without this, it would just sit
// there doing nothing instead of the "go back a screen" every Android
// user expects. No-ops entirely on the web build (isNativePlatform is
// false there), so this only ever runs inside the actual app.
//
// On the home screen specifically, a single back press used to exit the
// app immediately -- a real, reported annoyance (one accidental tap on
// the way to somewhere else on the screen closes the whole app). Now
// mirrors the standard Android "press back again to exit" pattern: the
// first press at home shows a toast and starts a 2s window: a second
// press inside that window exits for real, anything else (letting it
// time out, navigating away) just cancels it.
const EXIT_CONFIRM_WINDOW_MS = 2000;

// Keeps the opt-in notifications scheduled (start + every return to the
// app, so the tip/product content stays current) and opens the right
// screen when one is tapped. Renders nothing; a no-op outside the app.
function NotificationBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    syncNotifications(getRecentlyAddedProducts);
    let stopTaps = () => {};
    listenForTaps(navigate).then((stop) => { stopTaps = stop; });

    let resumeHandle = null;
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) syncNotifications(getRecentlyAddedProducts);
      }).then((h) => { resumeHandle = h; });
    }
    return () => {
      stopTaps();
      resumeHandle?.remove();
    };
  }, [navigate]);

  return null;
}

function AndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showExitToast, setShowExitToast] = useState(false);
  const exitTimerRef = useRef(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const listenerPromise = CapacitorApp.addListener('backButton', () => {
      if (location.pathname !== '/') {
        navigate(-1);
        return;
      }

      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
        setShowExitToast(false);
        CapacitorApp.exitApp();
        return;
      }

      setShowExitToast(true);
      exitTimerRef.current = setTimeout(() => {
        exitTimerRef.current = null;
        setShowExitToast(false);
      }, EXIT_CONFIRM_WINDOW_MS);
    });

    return () => { listenerPromise.then((listener) => listener.remove()); };
  }, [location, navigate]);

  // Leaving the home screen (or the component unmounting) should cancel
  // a pending exit confirmation rather than leave a stale timer armed.
  useEffect(() => {
    if (location.pathname !== '/' && exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
      setShowExitToast(false);
    }
  }, [location.pathname]);

  if (!showExitToast) return null;

  return createPortal(
    <div
      className="fixed left-1/2 z-[9999] -translate-x-1/2 px-4 py-2.5 rounded-full text-white text-[13px] font-semibold shadow-lg"
      style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))', background: 'rgba(30,41,59,0.92)' }}
    >
      Press back again to exit
    </div>,
    document.body
  );
}

// Keyed by react-router's own per-history-entry location.key (not
// pathname -- the same route, e.g. /result/:id, can be visited more
// than once with a different scroll position each time, and pathname
// alone would conflate them). Module-level so it survives this
// component's own remounts, only reset by a real app reload -- which is
// exactly the lifetime scroll position should have.
const scrollPositions = new Map();

// React Router doesn't restore scroll position on its own -- going back
// from a product's Result page used to always land back at the TOP of
// Home/History/search results instead of wherever the person actually
// was, a real reported annoyance. Records each page's own scroll
// position continuously (a scroll listener, not a snapshot read on the
// way out -- reading it lazily on unmount races with the next page
// already being painted) and restores it on a POP (back/forward)
// navigation; any other navigation (clicking into something new) always
// starts at the top, same as every app already expects.
function ScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    const onScroll = () => scrollPositions.set(location.key, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [location.key]);

  useEffect(() => {
    if (navigationType !== 'POP') {
      window.scrollTo(0, 0);
      return;
    }
    const saved = scrollPositions.get(location.key);
    if (typeof saved !== 'number') {
      window.scrollTo(0, 0);
      return;
    }
    // The page being returned to may still be short (its own async data
    // hasn't painted yet) on the very first frame -- one immediate
    // attempt plus one short retry covers real content that grows in
    // shortly after mount without a heavier "wait until stable" scheme.
    window.scrollTo(0, saved);
    const retry = setTimeout(() => window.scrollTo(0, saved), 120);
    return () => clearTimeout(retry);
  }, [location.key, navigationType]);

  return null;
}

// The admin panel is a separate internal tool sharing this same app
// shell for convenience (one deploy, one build) -- it gets its own
// plain layout, not the consumer app's header/bottom tab bar, and
// isn't linked from anywhere in the public UI.
function AppShell() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-grouped)' }}>
      {!isAdmin && <Header />}
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/result/:id" element={<Result />} />
          <Route path="/result/:id/personal" element={<PersonalScore />} />
          <Route path="/p/:reportId" element={<SharedProduct />} />
          <Route path="/history" element={<History />} />
          <Route path="/compare" element={<CompareManage />} />
          <Route path="/compare/result" element={<Compare />} />
          <Route path="/family" element={<Family />} />
          <Route path="/about" element={<About />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/my-intake" element={<MyIntake />} />
          <Route path="/browse" element={<Navigate to="/" replace />} />
          <Route path="/category/:id" element={<Category />} />
          <Route path="/popular" element={<PopularSearches />} />
          <Route path="/news" element={<News />} />
          <Route path="/submit-product" element={<SubmitProduct />} />
          <Route path="/admin" element={<AdminLogin />} />
          <Route path="/admin/review" element={<AdminGuard><AdminReviewList /></AdminGuard>} />
          <Route path="/admin/barcode-links" element={<AdminGuard><AdminBarcodeLinks /></AdminGuard>} />
          <Route path="/admin/products" element={<AdminGuard><AdminProductList /></AdminGuard>} />
          <Route path="/admin/products/new" element={<AdminGuard><AdminProductForm /></AdminGuard>} />
          <Route path="/admin/products/:id/edit" element={<AdminGuard><AdminProductForm /></AdminGuard>} />
          <Route path="/admin/products/:id/copy" element={<AdminGuard><AdminProductForm copyMode /></AdminGuard>} />
          <Route path="/admin/products/:id/history" element={<AdminGuard><AdminProductHistory /></AdminGuard>} />
          <Route path="/admin/flags" element={<AdminGuard><AdminFlagsList /></AdminGuard>} />
          <Route path="/admin/data-issues" element={<AdminGuard><AdminDataIssuesList /></AdminGuard>} />
          <Route path="/admin/scrape-progress" element={<AdminGuard><AdminScrapeProgress /></AdminGuard>} />
          <Route path="/admin/submissions" element={<AdminGuard><AdminSubmissionsList /></AdminGuard>} />
          <Route path="/admin/duplicates" element={<AdminGuard><AdminDuplicates /></AdminGuard>} />
          <Route path="/admin/barcode-check" element={<AdminGuard><AdminBarcodeCheck /></AdminGuard>} />
          <Route path="/admin/import" element={<AdminGuard><AdminImport /></AdminGuard>} />
          <Route path="/admin/activity" element={<AdminGuard><AdminActivityLog /></AdminGuard>} />
        </Routes>
      </main>
      {!isAdmin && <BottomTabBar />}
    </div>
  );
}

export default function App() {
  // Shown once per fresh load, like a native app's launch screen -- not
  // a one-time "first ever visit" flag, so it doesn't need localStorage.
  // Native-only: the web build has no equivalent "cold start" moment to
  // paper over (Vite/the browser already shows its own loading state),
  // so it would just be a few extra seconds of green screen for nothing.
  const [showSplash, setShowSplash] = useState(() => Capacitor.isNativePlatform());

  // Unlike the splash screen, this genuinely is a one-time "first ever
  // visit" flag -- read once at startup so a returning user's very
  // first render never shows onboarding, not even for a flash.
  //
  // Skipped (not marked as seen) when the app was opened from a shared
  // WhatsApp link: that person came to read one specific report, and
  // three intro slides in front of it is a good way to lose them. They
  // still get onboarding the next time they open the app on its own.
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (window.location.hash.startsWith('#/p/') || window.location.hash.startsWith('#/admin')) return false;
    try { return !localStorage.getItem(ONBOARDING_KEY); } catch { return false; }
  });

  return (
    <LanguageProvider>
      <FamilyProvider>
        <HashRouter>
          <AndroidBackButton />
          <NotificationBridge />
          <ScrollRestoration />
          <AppShell />
          {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
          {!showSplash && showOnboarding && <Onboarding onDone={() => setShowOnboarding(false)} />}
        </HashRouter>
      </FamilyProvider>
    </LanguageProvider>
  );
}
