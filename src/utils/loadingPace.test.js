import test from 'node:test';
import assert from 'node:assert/strict';
import { randomLoadDelayMs, waitForMinimum, remainingBudgetMs, OPEN_BUDGET_MS } from './loadingPace.js';

test('delay is always between 0.25s and 0.35s', () => {
  for (let i = 0; i < 2000; i++) {
    const ms = randomLoadDelayMs();
    assert.ok(ms >= 250 && ms <= 350, String(ms));
  }
  assert.equal(randomLoadDelayMs(() => 0), 250);
  assert.equal(randomLoadDelayMs(() => 1), 350);
});

test('the minimum leaves room in the one-second budget for the ring to finish', () => {
  assert.ok(OPEN_BUDGET_MS < 1000);
  assert.ok(OPEN_BUDGET_MS - randomLoadDelayMs(() => 1) >= 300);
});

test('remainingBudgetMs counts down from the budget and goes negative once spent', () => {
  assert.equal(remainingBudgetMs(1000, 1000), OPEN_BUDGET_MS);
  assert.equal(remainingBudgetMs(1000, 1400), OPEN_BUDGET_MS - 400);
  assert.ok(remainingBudgetMs(1000, 2500) < 0);
});

test('waitForMinimum does not wait when the minimum has already passed', async () => {
  const t = Date.now();
  await waitForMinimum(Date.now() - 5000, 1000);
  assert.ok(Date.now() - t < 100);
});

test('waitForMinimum waits out the remainder', async () => {
  const start = Date.now();
  await waitForMinimum(start, 120);
  assert.ok(Date.now() - start >= 115);
});
