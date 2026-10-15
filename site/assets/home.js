// site/assets/home.js -- the Label Decoder on the home page.
// Lights up each ingredient of the example label in turn, shows what it is,
// and fills the score ring; then waits and plays again. With reduced motion
// it shows the finished state straight away.
(function () {
  var box = document.getElementById('decoder');
  if (!box) return;
  var toks = Array.prototype.slice.call(box.querySelectorAll('.tok'));
  var feed = box.querySelector('.dec-feed');
  var ring = box.querySelector('.dec-ring');
  var ringNum = ring.querySelector('span');
  var verdict = box.querySelector('.dec-verdict');
  var live = box.querySelector('.dec-live');
  var FINAL = 48;
  var STEP = 900;
  var PAUSE = 5000;
  var timers = [];
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clear() {
    timers.forEach(clearTimeout);
    timers = [];
  }
  function setRing(v, color) {
    ring.style.setProperty('--v', v);
    if (color) ring.style.setProperty('--c', color);
    ringNum.textContent = Math.round(v);
  }
  function feedItem(t) {
    var li = document.createElement('li');
    li.className = 'dec-item ' + (t.dataset.t === 'c' ? 'is-c' : 'is-s');
    li.innerHTML = '<b></b><span></span>';
    li.querySelector('b').textContent = t.textContent;
    li.querySelector('span').textContent = t.dataset.note;
    feed.insertBefore(li, feed.firstChild);
    while (feed.children.length > 3) feed.removeChild(feed.lastChild);
  }
  function finish() {
    toks.forEach(function (t) { t.classList.add('on'); t.classList.remove('now'); });
    var flagged = toks.filter(function (t) { return t.dataset.t === 'c'; }).length;
    setRing(FINAL, 'var(--t-moderate)');
    verdict.innerHTML = '<b style="color:var(--t-moderate)">Moderate</b> · ' + flagged + ' of ' + toks.length + ' worth a closer look';
    live.classList.add('done');
    live.lastChild.textContent = 'Decoded';
  }
  function play() {
    clear();
    toks.forEach(function (t) { t.classList.remove('on', 'now'); });
    feed.innerHTML = '';
    setRing(0, 'var(--ink-3)');
    verdict.textContent = 'Reading the label…';
    live.classList.remove('done');
    live.lastChild.textContent = 'Decoding';
    if (reduced) { finish(); toks.slice(-3).forEach(feedItem); return; }
    toks.forEach(function (t, i) {
      timers.push(setTimeout(function () {
        toks.forEach(function (x) { x.classList.remove('now'); });
        t.classList.add('on', 'now');
        feedItem(t);
        setRing(FINAL * (i + 1) / toks.length, 'var(--t-moderate)');
      }, 600 + i * STEP));
    });
    timers.push(setTimeout(finish, 600 + toks.length * STEP));
    timers.push(setTimeout(play, 600 + toks.length * STEP + PAUSE));
  }

  box.querySelector('.dec-replay').addEventListener('click', play);
  // Start when it scrolls into view (it's in the hero, so usually at once).
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { io.disconnect(); play(); }
    }, { threshold: 0.3 });
    io.observe(box);
  } else {
    play();
  }
})();
