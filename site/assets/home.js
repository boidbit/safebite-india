// site/assets/home.js -- the "Paste a label" box on the home page.
// The scoring needs the ingredient library and AI, which live in the app,
// so the box hands the text over: /app/#/?paste=<text> opens the app's
// Paste view with it filled in and runs it (src/pages/Home.jsx).
(function () {
  var form = document.getElementById('paste');
  if (!form) return;
  var box = form.querySelector('textarea');
  var err = form.querySelector('.paste-err');

  form.querySelectorAll('[data-label]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      box.value = btn.getAttribute('data-label');
      err.hidden = true;
      box.focus();
    });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = box.value.trim();
    if (!text) { err.hidden = false; box.focus(); return; }
    location.href = form.getAttribute('action') + '#/?paste=' + encodeURIComponent(text.slice(0, 3000));
  });
})();
