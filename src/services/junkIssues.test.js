import { test } from 'node:test';
import assert from 'node:assert/strict';
import { junkIssueReason, JUNK_ISSUE_PREFIX } from './junkIssues.js';

test('a clean ingredient list needs no review', () => {
  assert.equal(junkIssueReason({ ingredients: [{ name: 'Sugar', status: 'concerning', penalty: 6, recognized: true, reason: 'Refined sugar.' }] }), null);
  assert.equal(junkIssueReason(null), null);
});

test('junk left on the label is named in the review note', () => {
  const reason = junkIssueReason({ ingredients: [
    { name: 'Sugar', recognized: true, reason: 'Refined sugar.' },
    { name: 'Borechae', status: 'safe', penalty: 0, recognized: false, reason: 'This appears to be a typo.' },
    { name: 'Hide', recognized: true, whatIsIt: 'This appears to be a non-food term or typo.' },
  ] });
  assert.ok(reason.startsWith(JUNK_ISSUE_PREFIX));
  assert.match(reason, /"Borechae", "Hide"/);
  assert.doesNotMatch(reason, /Sugar/);
});
