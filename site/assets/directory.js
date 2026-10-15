// site/assets/directory.js -- search box on /products/: filters products and
// brands as you type (all on the page already, nothing fetched).
(function () {
  var input = document.querySelector('.dir-search');
  if (!input) return;
  var brands = Array.prototype.slice.call(document.querySelectorAll('.dir-brand'));
  var empty = document.querySelector('.dir-empty');
  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase();
    var any = false;
    brands.forEach(function (b) {
      var brandHit = !q || b.querySelector('h2').textContent.toLowerCase().indexOf(q) !== -1;
      var shown = 0;
      Array.prototype.forEach.call(b.querySelectorAll('li'), function (li) {
        var hit = brandHit || li.textContent.toLowerCase().indexOf(q) !== -1;
        li.hidden = !hit;
        if (hit) shown++;
      });
      b.hidden = shown === 0;
      if (shown) any = true;
    });
    empty.style.display = any ? 'none' : 'block';
  });
})();
