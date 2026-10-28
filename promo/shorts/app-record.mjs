// promo/shorts/app-record.mjs -- the real app's report page for one product,
// recorded frame by frame for a short's phone scene (shorts/clip.mjs): the
// opening burst and the score ring filling, then a scroll to Nutrition and
// Ingredients, like a screen recording.
//
// Playwright's clock drives the app's own timers and requestAnimationFrame
// (the score ring, the "adds up" counters), CSS animations are stepped
// through the Web Animations API, and the scroll is set per frame -- so every
// frame is exact and smooth, the same on every run, unlike a live capture.
//
// Saves <dir>/app/a_0000.jpg ... at `fps`. Returns null (and the short uses
// app-screen.mjs's still instead) when the page didn't show the product.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const WIDTH = 390;   // css px, a common phone
const HEIGHT = 844;

/**
 * @returns {Promise<null | { frames: number, fps: number, width: number, height: number, ys: number[], marks: object }>}
 *   ys: the page's scroll position on each frame (css px)
 */
export async function recordAppScreen(reportId, productName, dir, { seconds = 6, fps = 30, appUrl = process.env.APP_URL || 'https://foodguards.space/app/' } = {}) {
  const out = path.join(dir, 'app');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
    // A returning user: no intro slides over the report.
    await page.addInitScript(() => { try { localStorage.setItem('foodguard-onboarding-seen', '1'); } catch { /* no storage */ } });
    await page.clock.install();
    // (Not 'networkidle': with the clock installed the app never looks idle.)
    await page.goto(`${appUrl.replace(/\/?$/, '/')}#/`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('#root *', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));
    // Stop the app's clock, then open the report: its animations wait at
    // their first frame until the capture moves time on.
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 50);
    await page.evaluate((id) => { window.location.hash = `#/p/${id}`; }, reportId);
    const first = productName.split(/\s+/).find((w) => w.length > 3) || productName;
    const t0 = Date.now();
    // Loading may wait on the app's own timers; nudge them while it loads.
    while (!(await page.evaluate((w) => document.body.innerText.includes(w), first))) {
      if (Date.now() - t0 > 30000) throw new Error('the report never showed');
      await page.clock.runFor(16);
      await new Promise((r) => setTimeout(r, 120));
    }
    await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
    const flush = () => page.evaluate(() => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); }));
    await flush();

    const marks = await page.evaluate(() => {
      const top = (el) => (el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null);
      const byText = (re) => [...document.querySelectorAll('span, p, div, h2, h3')].find((el) => el.children.length === 0 && re.test(el.textContent.trim()));
      const chip = [...document.querySelectorAll('span.rounded-full')].find((el) => /^(▲|!|✓)/.test(el.textContent.trim()));
      const rr = chip?.parentElement?.getBoundingClientRect();
      return {
        height: document.documentElement.scrollHeight,
        reasons: rr ? [Math.round(rr.left), Math.round(rr.top + window.scrollY), Math.round(rr.width), Math.round(rr.height)] : null,
        nutrition: top(byText(/^Nutrition$/)),
        ingredients: top(byText(/^Ingredients \(\d+\)$/)),
        alternatives: top(byText(/^Safer alternatives/)),
      };
    });
    // Where to be on screen when: the score and its reasons first, then
    // Nutrition, then Ingredients, each eased in -- stopping short of the
    // alternatives (other brands' products have no place in this one's short).
    const maxY = Math.max(0, Math.min(marks.height, marks.alternatives ?? Infinity) - HEIGHT - 90);
    const to = (m) => Math.min(maxY, Math.max(0, m - 70));
    const stops = [];
    if (marks.nutrition != null) stops.push({ at: seconds * 0.42, y: to(marks.nutrition) });
    if (marks.ingredients != null) stops.push({ at: seconds * 0.7, y: to(marks.ingredients) });
    const easeIO = (x) => { x = Math.min(1, Math.max(0, x)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
    const yAt = (t) => { let y = 0; for (const st of stops) y += (st.y - y) * easeIO((t - st.at) / 0.8); return Math.round(y); };

    const n = Math.round(seconds * fps);
    const dt = 1000 / fps;
    const ys = [];
    for (let i = 0; i < n; i++) {
      const y = yAt(i / fps);
      ys.push(y);
      await page.evaluate(({ y, i, dt }) => {
        window.scrollTo(0, y);
        // CSS animations and transitions: held, then moved on one frame at a time.
        for (const a of document.getAnimations()) {
          if (a.__f0 === undefined) { a.__f0 = i; a.__c0 = Number(a.currentTime) || 0; a.pause(); }
          a.currentTime = a.__c0 + (i - a.__f0) * dt;
        }
      }, { y, i, dt });
      await flush();
      await page.screenshot({ path: path.join(out, `a_${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 88 });
      await page.clock.runFor(dt);
      await flush();
    }
    return { frames: n, fps, width: WIDTH, height: HEIGHT, ys, marks };
  } catch (e) {
    console.log(`app not recorded (${e.message.split('\n')[0]}) -- the short uses a still of it`);
    return null;
  } finally {
    await browser.close();
  }
}
