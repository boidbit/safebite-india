// Renders promo frames deterministically: render(t) -> screenshot.
//   node render.cjs <outDir> <startFrame> <endFrame>          (30 fps)
//   node render.cjs <outDir> --at 1.5,3,7.2                   (preview stills)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = __dirname + '/..';           // repo root so ../assets/* resolves
const FPS = 30;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.css': 'text/css' };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(p, (e, buf) => {
        if (e) { rsp.writeHead(404); rsp.end(); return; }
        rsp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        rsp.end(buf);
      });
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

(async () => {
  const [outDir, a, b] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/promo/index.html`);
  await page.waitForFunction('window.READY===true', null, { timeout: 60000 });

  const shot = async (t, file) => {
    await page.evaluate(tt => window.render(tt), t);
    await page.screenshot({ path: file, type: 'jpeg', quality: 93 });
  };

  if (a === '--at') {
    for (const s of b.split(',')) await shot(parseFloat(s), path.join(outDir, `t_${s}.jpg`));
  } else {
    const s = parseInt(a, 10), e = parseInt(b, 10);
    for (let f = s; f < e; f++) {
      await shot(f / FPS, path.join(outDir, `f_${String(f).padStart(4, '0')}.jpg`));
    }
  }
  await browser.close();
  srv.close();
})().catch(e => { console.error(e); process.exit(1); });
