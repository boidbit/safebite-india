// src/utils/share.test.js
//
// Run with: node --test src/utils/share.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, interpolate } from '../i18n/strings.js';
import { buildProductShareText, productShareUrl, whatsappShareUrl, xShareUrl, PUBLIC_APP_URL } from './share.js';

const t = (key, vars) => interpolate(STRINGS.en[key], vars || {});

test('a shared report links to the public web app, never a local device address', () => {
  // Inside the Android app window.location is a capacitor/localhost
  // address the recipient could never open.
  const url = productShareUrl('3f1c-uuid');
  assert.equal(url, 'https://boidbit.github.io/safebite-india/#/p/3f1c-uuid');
});

test('the message carries the product, score, verdict, top two concerns and the link', () => {
  const text = buildProductShareText({
    productName: 'Maggi 2-Minute Noodles',
    score: 44,
    verdict: 'Poor',
    flags: ['Refined Wheat Flour', 'Palm Oil', 'Flavour Enhancer (INS 635)'],
    link: productShareUrl('abc'),
  }, t);

  assert.match(text, /\*Maggi 2-Minute Noodles\*/);
  assert.match(text, /\*44\/100 \(Poor\)\*/);
  assert.match(text, /Refined Wheat Flour, Palm Oil/);
  assert.doesNotMatch(text, /INS 635/, 'only the two worst concerns, to stay readable in a chat bubble');
  assert.match(text, /#\/p\/abc/);
});

test('a clean product with no concerns sends no empty "worth knowing" line', () => {
  const text = buildProductShareText({ productName: 'Rock Salt', score: 96, verdict: 'Excellent', flags: [], link: 'x' }, t);
  assert.doesNotMatch(text, /Worth knowing/);
});

test('a product never saved to the shared cache shares the app itself instead of a dead link', () => {
  const text = buildProductShareText({ productName: 'Home Mix', score: 70, verdict: 'Good', link: null }, t);
  assert.match(text, new RegExp(PUBLIC_APP_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(text, /#\/p\//);
});

test('the WhatsApp link encodes the whole message, including line breaks and asterisks', () => {
  const url = whatsappShareUrl('*Bold* line\nnext & more');
  assert.equal(url, 'https://wa.me/?text=*Bold*%20line%0Anext%20%26%20more');
});

test('the X link drops WhatsApp’s *bold* marks and keeps the line breaks', () => {
  assert.equal(xShareUrl('*Maggi* scored *48*\nsee more'), 'https://twitter.com/intent/tweet?text=Maggi%20scored%2048%0Asee%20more');
});
