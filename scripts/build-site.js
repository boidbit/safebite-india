// scripts/build-site.js
//
// Runs after `vite build` (see package.json "build"): the app is built into
// dist/app, and the website at the domain root -- site/ -- is copied to dist/.
// GitHub Pages serves 404.html for any unknown path, so it gets the same
// forwarding page: an old link like /something/#/p/123 still reaches the app.
import fs from 'fs';
import path from 'path';

const from = 'site';
const to = 'dist';
fs.mkdirSync(to, { recursive: true });
for (const name of fs.readdirSync(from)) {
  fs.cpSync(path.join(from, name), path.join(to, name), { recursive: true });
}
fs.copyFileSync(path.join(from, 'index.html'), path.join(to, '404.html'));
console.log(`site/ copied to dist/ (app is in dist/app)`);
