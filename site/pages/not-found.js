// site/pages/not-found.js -- served as 404.html. An old app address that
// carries a #/ route never sees this: layout.js forwards it to /app/ first.
import { APP_URL } from '../layout.js';

export default function notFound() {
  return {
    path: '/404.html',
    title: 'Page not found',
    description: 'This page doesn’t exist.',
    body: `
<div class="page-head"><div class="wrap">
  <div class="eyebrow">404</div>
  <h1>This shelf is empty.</h1>
  <p>The page you were looking for isn’t here. Try the <a href="/">home page</a> or <a href="${APP_URL}">open the app</a> to search for a product.</p>
</div></div>
<div class="wrap" style="height:120px"></div>
`,
  };
}
