import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidGtin, confirmBarcode } from './barcodeReader.js';

test('isValidGtin checks the GS1 check digit', () => {
  assert.equal(isValidGtin('8901725004910'), true);
  assert.equal(isValidGtin('8901725004911'), false);
  assert.equal(isValidGtin('0702142121512'), true);
  assert.equal(isValidGtin('12345'), false);
  assert.equal(isValidGtin(''), false);
});

test('a code read only once is not confirmed', () => {
  assert.equal(confirmBarcode([{ code: '8901725004910', read: '10:plain' }]), null);
});

test('the same code read twice is confirmed', () => {
  assert.equal(confirmBarcode([
    { code: '8901725004910', read: '10:plain' },
    { code: '8901725004910', read: '10:enlarged' },
  ]), '8901725004910');
});

test('the same read counted twice is still one read', () => {
  assert.equal(confirmBarcode([
    { code: '8901725004910', read: '10:plain' },
    { code: '8901725004910', read: '10:plain' },
  ]), null);
});

test('a one-off misread beside a confirmed code does not block it', () => {
  // Real case: photo 11 misread as ...0805, photo 13 read ...0812 every way.
  assert.equal(confirmBarcode([
    { code: '8901725010805', read: '11:enlarged-more' },
    { code: '8901725010812', read: '13:plain' },
    { code: '8901725010812', read: '13:enlarged' },
  ]), '8901725010812');
});

test('two different confirmed codes are ambiguous', () => {
  assert.equal(confirmBarcode([
    { code: '8901725004910', read: '1:plain' },
    { code: '8901725004910', read: '1:enlarged' },
    { code: '8906189352430', read: '2:plain' },
    { code: '8906189352430', read: '2:enlarged' },
  ]), null);
});
