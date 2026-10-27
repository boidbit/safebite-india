// promo/shorts/app-screen.mjs -- the real app's report page for one product,
// captured for the short's "in the app" scene (a phone that scrolls through it).
//
// Opens <APP_URL>#/p/<id> at phone size, waits for the report, and saves:
//   app-page.jpg    the whole page, without the fixed bottom tab bar
//   app-nav.png     that tab bar, drawn back over the bottom of the phone
//   + where the score's reasons, Nutrition and Ingredients sit on the page,
//     so the scene can scroll to them.
// A still of the real page, moved frame by frame, plays smoother than a live
// screen recording and is the same on every run.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const WIDTH = 390;   // css px, a common phone
const HEIGHT = 844;
const DPR = 2;

/**
 * @returns {Promise<null | { width: number, height: number, viewH: number, navH: number, marks: { reasons: number[]|null, nutrition: number|null, ingredients: number|null } }>}
 *   page sizes in css px; null when the page didn't show this product's report.
 */
export async function captureAppScreen(reportId, productName, dir, { appUrl = process.env.APP_URL || 'https://foodguards.space/app/' } = {}) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DPR });
    // Light theme, like the shots on the Play Store listing.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`${appUrl.replace(/\/?$/, '/')}#/p/${reportId}`, { waitUntil: 'networkidle', timeout: 60000 });
    const first = productName.split(/\s+/).find((w) => w.length > 3) || productName;
    await page.getByText(first, { exact: false }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(4500); // the score ring and the opening burst finish

    const info = await page.evaluate(() => {
      const fixedBottom = [...document.querySelectorAll('body *')].filter((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.position === 'fixed' && r.bottom >= window.innerHeight - 2 && r.height < 140 && r.width > window.innerWidth * 0.9;
      });
      const nav = fixedBottom.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
      const top = (el) => (el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null);
      const byText = (re) => [...document.querySelectorAll('span, p, div')].find((el) => el.children.length === 0 && re.test(el.textContent.trim()));
      // The reason chips: the first row of rounded chips inside the score card.
      const chip = [...document.querySelectorAll('span.rounded-full')].find((el) => /^(▲|!|✓)/.test(el.textContent.trim()));
      const chipRow = chip?.parentElement;
      const rr = chipRow?.getBoundingClientRect();
      return {
        navH: nav ? Math.round(nav.getBoundingClientRect().height) : 0,
        navTag: nav ? nav.tagName : null,
        height: document.documentElement.scrollHeight,
        marks: {
          reasons: rr ? [Math.round(rr.left), Math.round(rr.top + window.scrollY), Math.round(rr.width), Math.round(rr.height)] : null,
          nutrition: top(byText(/^Nutrition$/)),
          ingredients: top(byText(/^Ingredients \(\d+\)$/)),
        },
      };
    });

    // The tab bar as it looks at the bottom of the screen...
    if (info.navH) {
      await page.screenshot({ path: path.join(dir, 'app-nav.png'), clip: { x: 0, y: HEIGHT - info.navH, width: WIDTH, height: info.navH } });
    }
    // ...and the page without it (fixed bits would otherwise land mid-page).
    await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('body *')) if (getComputedStyle(el).position === 'fixed') el.style.visibility = 'hidden';
    });
    await page.screenshot({ path: path.join(dir, 'app-page.jpg'), type: 'jpeg', quality: 90, fullPage: true });
    return { width: WIDTH, height: info.height, viewH: HEIGHT, navH: info.navH, marks: info.marks };
  } catch (e) {
    console.log(`app screen not captured (${e.message.split('\n')[0]}) -- the short is made without it`);
    return null;
  } finally {
    await browser.close();
  }
}
