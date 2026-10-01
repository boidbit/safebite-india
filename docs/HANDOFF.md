# FoodGuard India — handoff notes

Written to move work to another machine. Point a new Claude Code session at this file first
("read docs/HANDOFF.md") and it can carry on from here. State as of 1 Oct 2026.

## Working with the owner
- Chat in Hinglish, plain language. The owner isn't a programmer: explain what changes and why.
- Small, verifiable steps. Before any big or destructive change, give the plan as bullet points
  and wait for approval. "Only review / only check" means change nothing.
- Never bypass a site's bot protection or access block (BigBasket, Instamart, Zepto, JioMart and
  Amazon all block automated access; we stopped at the block).
- Never print or commit key values. Keys live in `.env` (local) and GitHub/Supabase secrets.
- Background scripts: start them with a plain process (PowerShell `Start-Process` on Windows),
  not system-level launchers.

## What the app is
React 19 + Vite + Tailwind web app, wrapped as an Android app with Capacitor
(`com.foodguard.india`). Scans a packaged-food barcode, label photo or pasted ingredients, and
scores it 0–100 against FSSAI / EU rules. Supabase (Postgres + Edge Functions) is the backend.
Gemini (free tier) researches unknown ingredients; Cloudflare Workers AI translates to Hindi.

- Website: https://boidbit.github.io/safebite-india/ (pushing to `main` deploys it via
  `.github/workflows/deploy-pages.yml`)
- Repo: https://github.com/boidbit/safebite-india (the GitHub username changed from
  `talibmohd0099` to `boidbit` on 1 Oct 2026 — the old github.io URL now 404s)
- Privacy policy: https://boidbit.github.io/safebite-india/#/privacy
- Admin panel: https://boidbit.github.io/safebite-india/#/admin (Supabase email login)

## Set up on a new machine
1. `git clone https://github.com/boidbit/safebite-india.git`, then `npm ci`.
2. `npx playwright install chromium` (the Blinkit scraper gets Cloudflare cookies with it).
3. Create `.env` (never commit it) with: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   (the publishable key), `VITE_GEMINI_API_KEY` … `VITE_GEMINI_API_KEY_6`,
   `VITE_CLOUDFLARE_ACCOUNT_ID`, `VITE_CLOUDFLARE_API_TOKEN`, and `SUPABASE_SERVICE_ROLE_KEY`
   (the `sb_secret_…` key — scripts only, never a `VITE_` name). Copy the values from the old
   machine's `.env`. Node scripts read AI keys from `.env`; the website/APK never contain them
   (they go through the `ai-proxy` Edge Function).
4. Copy the Android signing folder `KEEP-SAFE-android-signing` (keystore + README) by hand —
   it is not in git. Its 4 values are already GitHub secrets; the APK/AAB build reads them there.
5. `npm run dev` → http://localhost:5173/safebite-india/ ; `npm test` runs the unit tests.

## Play Store status
- Closed testing (Alpha) release 1.0 (1) submitted 28 Sep 2026; was "In review".
- Next: 12+ testers for 14 days, then Production.
- **To do now:** in Play Console, update the privacy policy, data-deletion and website URLs to
  `boidbit.github.io/safebite-india/...` (the old ones 404 since the username change).
- The APK in review has the old share URL built in; the next build has the new one.
- Store graphics: `play-store-assets` folder next to the repo on the old machine.

## Data and rules that matter
- `product_reports.review_status`: `pending` (new, hidden from search/categories),
  `live` (pre-review, visible), `approved`, `rejected`. Public key can't change it.
- `supabase/lock_public_writes_migration.sql`: the public key can't rewrite live products or
  existing ingredients; counters only go +1. Admin session and service key can.
- Blinkit products: `blinkit_products` (raw scrape) → `scripts/generate-reports.js` → reports
  keyed `blinkit:<brand> <name>` (`blinkitLookupKey`). Never change a product's lookup key on
  edit — it creates duplicates.
- Barcodes: a Blinkit product's barcode lives in `barcode_links` (pending → approved), not in its
  key. Read off gallery photos with ZXing (`src/services/barcodeReader.js`): 5 decodes per photo,
  kept only when the same number is read twice. Admin "safe" check:
  `src/services/barcodeLinkSafety.js`.
- The scraper skips multi-packs (`3 x 250 ml`, `Pack of 2`, `Buy 1 Get 1`) and gift packs/combos
  (`src/services/packNormalize.js`, `src/services/bundleListing.js`).
- Sugar stays "concerning" (owner's decision, 29 Sep) — don't re-litigate.
- Product photos are stored small (~20 KB) and shown as thumbnails only (no zoom viewer).
- Scripts with the public key can't rewrite live rows; maintenance scripts need
  `SUPABASE_SERVICE_ROLE_KEY` (e.g. `scripts/normalize-pack-listings.js --apply`).

## Admin panel (5 sections)
Dashboard (what's waiting) · Products (one list: status tabs, filters, barcode search, edit /
approve / reject / crop / delete) · Inbox (flags, manual review, submissions, duplicates) ·
Barcodes (matches with "Approve all safe", check, backfill progress) · Tools (scrape progress,
import, activity log).

## Background jobs
- Blinkit scraper: `node --env-file=.env scripts/scrape-blinkit.js --all --no-ai --image-fallback`
  (resumes per category; saves a category when it finishes). Not running now.
- Barcode backfill for already-scraped products:
  `node --env-file=.env scripts/backfill-blinkit-barcodes.js` — finished (≈1,400 products with a
  photo barcode). Progress table: `barcode_backfill_progress`.
- Report generation for scraped products: `node --env-file=.env scripts/generate-reports.js`
  (also a GitHub Actions workflow). ~41 Blinkit products with approved barcodes have no report yet.

## Open tasks (owner to pick)
1. Play Console URLs → new username (above). Highest priority.
2. Delete the 275 leftover combo / gift-pack rows in `blinkit_products` (no reports, not in the
   app), reject their ~40 barcode links, and make the backfill/safety check skip combos.
   Plan agreed in principle, not done.
3. Barcodes for the ~565 big-brand products still without one (of 1,376 from ~50 top brands):
   better photo re-reads, Gemini digit reads for just these, store/tester scans in the app,
   admin 🔍 lookups. A tested proposal to match Open Food Facts' India list (24k barcodes, many
   without ingredients) to our products by brand + name + pack size is written up but on hold.
4. GS1 India DataKart (official barcode database) — email to ask about access and fees.
5. 12 "needs a look" multi-pack sizes to fix by hand (see `pack-normalize-applied.csv`);
   Britannia Jim Jam: press Recalculate score in the admin form.
6. Reject the barcode `9901841503334` (Very Marathi) — a 99x number is a coupon/store code.
7. Restart the Blinkit scraper + report generation when wanted.
