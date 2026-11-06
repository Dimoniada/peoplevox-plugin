const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRange, findLocations } = require('../peoplevox-range-printer.user.js');
const loc = (Id, Barcode) => ({ Id, Barcode });
const fakeSearch = (rows, cap) => {
  const fn = async (prefix) => {
    fn.calls.push(prefix);
    return rows.filter((r) => r.Barcode.toUpperCase().includes(prefix.toUpperCase())).slice(0, cap);
  };
  fn.calls = [];
  return fn;
};
const rows = [loc(1, 'HB6.B1.L1'), loc(2, 'HB6.B1.L2'), loc(3, 'HB6.B1.L3'), loc(4, 'HB6.B1.L4'), loc(5, 'HB6.B2.L3'), loc(6, 'HB6.B2.L4')];

test('one search when nothing is cut off', async () => {
  const s = fakeSearch(rows, 1000);
  const r = await findLocations(parseRange('HB6.B[1-2].L[3-4]'), s);
  assert.deepEqual(r.locations.map((l) => l.Id), [3, 4, 5, 6]);
  assert.deepEqual([r.missing, r.duplicates, s.calls], [[], [], ['HB6.B']]);
});
test('missing barcode reported, nothing else searched', async () => {
  const s = fakeSearch(rows.filter((r) => r.Id !== 6), 1000);
  const r = await findLocations(parseRange('HB6.B[1-2].L[3-4]'), s);
  assert.deepEqual([r.missing, s.calls], [['HB6.B2.L4'], ['HB6.B']]);
});
test('narrows only where wanted barcodes are still missing', async () => {
  const s = fakeSearch(rows, 3);
  const r = await findLocations(parseRange('HB6.B[1-2].L[3-4]'), s, 3);
  assert.deepEqual(r.locations.map((l) => l.Id), [3, 4, 5, 6]);
  assert.deepEqual(s.calls, ['HB6.B', 'HB6.B1.L', 'HB6.B1.L4', 'HB6.B2.L']);
});
test('input starting with [ never searches an empty prefix', async () => {
  const s = fakeSearch([loc(1, '1X'), loc(2, '2X')], 1000);
  await findLocations(parseRange('[1-2]X'), s);
  assert.deepEqual(s.calls, ['1X', '2X']);
});
test('case-insensitive match keeps the stored barcode', async () => {
  const r = await findLocations(parseRange('hb6.b[1-1].l[3-3]'), fakeSearch(rows, 1000));
  assert.deepEqual(r.locations, [loc(3, 'HB6.B1.L3')]);
});
test('two locations with the same barcode are duplicates', async () => {
  const r = await findLocations(parseRange('HB6.B1.L3'), fakeSearch([loc(3, 'HB6.B1.L3'), loc(9, 'hb6.b1.l3')], 1000));
  assert.deepEqual(r.duplicates, ['HB6.B1.L3']);
});
test('the same row seen by two searches is not a duplicate', async () => {
  const r = await findLocations(parseRange('HB6.B[1-2].L[3-4]'), fakeSearch(rows, 3), 3);
  assert.deepEqual(r.duplicates, []);
});
