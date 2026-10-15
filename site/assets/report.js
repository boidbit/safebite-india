// site/assets/report.js -- "Report a problem" on a website product page.
// Writes the same row the app's "Report an issue" sheet does
// (src/services/productFlags.js), so it lands in Admin > Flagged. Uses the
// public key, which the app ships too; the table only allows inserts.
(function () {
  var form = document.querySelector('form.report-form');
  if (!form) return;
  var status = form.querySelector('.report-status');
  var button = form.querySelector('button[type=submit]');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var picked = form.querySelector('input[name=reason]:checked');
    if (!picked) { status.textContent = 'Please pick what looks wrong.'; status.className = 'report-status err'; return; }
    var d = form.dataset;
    var remarks = form.querySelector('textarea').value.trim();
    button.disabled = true;
    status.textContent = 'Sending…';
    status.className = 'report-status';
    fetch(d.api + '/rest/v1/product_flags', {
      method: 'POST',
      headers: { apikey: d.key, Authorization: 'Bearer ' + d.key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        lookup_key: d.lookupKey || null,
        product_name: d.name || null,
        reason: picked.value,
        remarks: remarks || null,
        score_at_flag: d.score ? Number(d.score) : null,
        verdict_at_flag: d.verdict || null,
        report_snapshot: { source: 'website', url: location.href, productName: d.name, overallScore: d.score ? Number(d.score) : null, verdict: d.verdict },
      }),
    }).then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      form.innerHTML = '<p class="report-done">Thanks — we’ve got it. Someone will check this product.</p>';
    }).catch(function () {
      button.disabled = false;
      status.textContent = 'Couldn’t send that. Please try again, or email us.';
      status.className = 'report-status err';
    });
  });
})();
