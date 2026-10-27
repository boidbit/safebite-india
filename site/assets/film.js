// site/assets/film.js -- "Where this sugar goes" on a website product page.
// Opens the app's 1-minute sugar film (/app/film/sugar-film.html, filled with
// this product's numbers by site/products.js) over the page, the way the app's
// SugarFilm.jsx does: a dark sheet, the film in a frame, a close button.
(function () {
  var open = null;

  function close() {
    if (!open) return;
    open.remove();
    open = null;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-film]');
    if (!btn) return;
    e.preventDefault();
    var shade = document.createElement('div');
    shade.className = 'film-shade';
    shade.innerHTML = '<div class="film-box" role="dialog" aria-label="Where this sugar goes"><iframe title="Where this sugar goes" allow="autoplay"></iframe><button class="film-x" type="button" aria-label="Close">×</button></div>';
    shade.querySelector('iframe').src = btn.getAttribute('data-film');
    shade.addEventListener('click', function (ev) { if (ev.target === shade || ev.target.closest('.film-x')) close(); });
    document.body.appendChild(shade);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    open = shade;
  });
})();
