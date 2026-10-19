import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplicateNameIds, exactNameKey } from './duplicateNames.js';

const p = (id, productName, packSize = null) => ({ id, productName, packSize });

test('the name key ignores capitals, spacing and accents', () => {
  assert.equal(exactNameKey('  Nestlé   MAGGI  Masala '), 'nestle maggi masala');
});

test('same name and same pack size is a duplicate', () => {
  const d = duplicateNameIds([p('a', 'Maggi Masala Noodles', '70 g'), p('b', 'MAGGI  masala noodles', '70g'), p('c', 'Maggi Atta Noodles', '70 g')]);
  assert.deepEqual([...d].sort(), ['a', 'b']);
});

test('same name but a different pack size is not a duplicate', () => {
  const d = duplicateNameIds([p('a', 'Maggi Masala Noodles', '70 g'), p('b', 'Maggi Masala Noodles', '280 g'), p('c', 'Maggi Masala Noodles', '1 kg')]);
  assert.equal(d.size, 0);
});

test('1 L and 1000 ml are the same pack size', () => {
  const d = duplicateNameIds([p('a', 'Mountain Dew', '1 l'), p('b', 'Mountain Dew', '1000 ml')]);
  assert.deepEqual([...d].sort(), ['a', 'b']);
});

test('a missing pack size can not prove the products differ, so it counts as a possible duplicate', () => {
  const d = duplicateNameIds([p('a', 'Parle G', '55 g'), p('b', 'Parle G', null)]);
  assert.deepEqual([...d].sort(), ['a', 'b']);
  assert.equal(duplicateNameIds([p('a', 'Parle G', null), p('b', 'Parle G', '')]).size, 2);
});

test('a name that appears once is never a duplicate, and a different name never matches', () => {
  assert.equal(duplicateNameIds([p('a', 'Sprite', '250 ml'), p('b', 'Sprite Zero', '250 ml')]).size, 0);
  assert.equal(duplicateNameIds([p('a', ''), p('b', null)]).size, 0);
});
