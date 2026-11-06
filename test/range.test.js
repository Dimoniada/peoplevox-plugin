const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRange, expandParts } = require('../peoplevox-range-printer.user.js');
const expand = (s) => expandParts(parseRange(s));

test('parts shape', () => {
  assert.deepEqual(parseRange('HB6.B[1-2].L[3-4]'), ['HB6.B', ['1', '2'], '.L', ['3', '4'], '']);
});
test('TS.md example, leftmost range outermost', () => {
  assert.deepEqual(expand('HB6.B[1-2].L[3-9]'), [
    'HB6.B1.L3', 'HB6.B1.L4', 'HB6.B1.L5', 'HB6.B1.L6', 'HB6.B1.L7', 'HB6.B1.L8', 'HB6.B1.L9',
    'HB6.B2.L3', 'HB6.B2.L4', 'HB6.B2.L5', 'HB6.B2.L6', 'HB6.B2.L7', 'HB6.B2.L8', 'HB6.B2.L9']);
});
test('no brackets is one label', () => assert.deepEqual(expand('HB6.B1.L3'), ['HB6.B1.L3']));
test('three ranges', () => {
  const r = expand('A[1-2]B[1-2]C[1-2]');
  assert.equal(r.length, 8);
  assert.deepEqual([r[0], r[1], r[7]], ['A1B1C1', 'A1B1C2', 'A2B2C2']);
});
test('descending numbers', () => assert.deepEqual(expand('X[5-3]'), ['X5', 'X4', 'X3']));
test('letters up and down', () => {
  assert.deepEqual(expand('X[A-C]'), ['XA', 'XB', 'XC']);
  assert.deepEqual(expand('X[c-a]'), ['Xc', 'Xb', 'Xa']);
});
test('zero padding only when typed', () => {
  const a = expand('X[01-100]');
  assert.deepEqual([a.length, a[0], a[98], a[99]], [100, 'X01', 'X99', 'X100']);
  const b = expand('X[001-100]');
  assert.deepEqual([b[0], b[99]], ['X001', 'X100']);
  assert.equal(expand('X[1-100]')[0], 'X1');
  const c = expand('X[100-01]');
  assert.deepEqual([c[0], c[99]], ['X100', 'X01']);
  assert.deepEqual(expand('X[01-001]'), ['X001']); // both padded: longer width wins
});
test('whitespace tolerated', () => assert.deepEqual(expand('  HB6.B[ 1 - 2 ] '), ['HB6.B1', 'HB6.B2']));
test('invalid input', () => {
  assert.throws(() => parseRange(''), { message: 'Empty input' });
  assert.throws(() => parseRange('   '), { message: 'Empty input' });
  assert.throws(() => parseRange('HB6.B[1-2'), { message: 'Missing ]' });
  assert.throws(() => parseRange('HB6.B1-2]'), { message: 'Missing [' });
  for (const bad of ['A-9', 'a-C', 'AA-AC', '-2', '1-', '1.5-2', '1-2-3', '']) {
    assert.throws(() => parseRange(`X[${bad}]`), { message: `Bad range [${bad}]` });
  }
  assert.throws(() => parseRange('X[[1-2]]'), /Bad range/);
});
