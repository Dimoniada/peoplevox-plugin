const test = require('node:test');
const assert = require('node:assert/strict');
const { searchLocations, printLocation, readPrintOptions, isPrinterSet, OPTIONS_KEY } = require('../peoplevox-range-printer.user.js');
const fakeFetch = (respond) => {
  const fn = async (url, init) => { fn.calls.push({ url, init }); return respond(); };
  fn.calls = [];
  return fn;
};
const json = (body, status = 200) => () => new Response(JSON.stringify(body), { status });
const opts = { PrintObjectName: 'Location', TerminalId: 288, TemplateId: 103, NumberOfCopies: 1, UseRules: false, RememberSelectedOptions: false };

test('search request shape and items', async () => {
  const f = fakeFetch(json({ Items: [{ Id: 1, Barcode: 'HB6.B1.L1' }], IsSuccess: true, Faults: [] }));
  assert.deepEqual(await searchLocations('HB6.B', f), [{ Id: 1, Barcode: 'HB6.B1.L1' }]);
  const { url, init } = f.calls[0];
  assert.equal(url, '/rkb4952/backend/warehouse/locations/search');
  assert.deepEqual([init.method, init.credentials, init.headers['Content-Type']], ['POST', 'include', 'application/json']);
  assert.deepEqual(JSON.parse(init.body), { Barcode: 'HB6.B', Paging: { PageSize: 1000, PageNo: 1 } });
});
test('search failures', async () => {
  await assert.rejects(searchLocations('X', fakeFetch(json({ IsSuccess: false, Faults: [{ ErrorMessage: 'Bad' }] }))), { message: 'Bad' });
  await assert.rejects(searchLocations('X', fakeFetch(json({}, 500))), { message: 'HTTP 500' });
  await assert.rejects(searchLocations('X', fakeFetch(() => new Response('<html>login</html>'))), { message: 'Unexpected reply (signed out?)' });
  await assert.rejects(searchLocations('X', fakeFetch(() => { throw new TypeError('Failed to fetch'); })), { message: 'Network error: Failed to fetch' });
});
test('print request shape and success', async () => {
  const f = fakeFetch(json({ IsSuccess: true, SuccessfulPrints: [5728832], FailedPrints: [], Faults: [] }));
  await printLocation(5728832, opts, f);
  assert.equal(f.calls[0].url, '/rkb4952/backend/printing/print');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { IdsToPrint: [5728832], PrintingOptions: opts });
});
test('print failures', async () => {
  await assert.rejects(printLocation(7, opts, fakeFetch(json({ IsSuccess: true, SuccessfulPrints: [], FailedPrints: [7], Faults: [] }))), { message: 'No matching print template' });
  await assert.rejects(printLocation(7, opts, fakeFetch(json({ IsSuccess: true, SuccessfulPrints: [], FailedPrints: [], Faults: [] }))), { message: 'Print not confirmed' });
  await assert.rejects(printLocation(7, opts, fakeFetch(json({ IsSuccess: false, Faults: [{ ErrorCode: 'Offline' }] }))), { message: 'Offline' });
});
test('print options from storage', () => {
  const store = (v) => ({ getItem: (k) => (k === OPTIONS_KEY ? v : null) });
  assert.equal(OPTIONS_KEY, 'PVX_PrintingOptions_rkb4952_Location');
  assert.deepEqual(readPrintOptions(store(JSON.stringify(opts))), opts);
  assert.equal(readPrintOptions(store(null)), null);
  assert.equal(readPrintOptions(store('{bad')), null);
});
test('isPrinterSet uses Peoplevox rule', () => {
  assert.equal(isPrinterSet(opts), true);
  assert.equal(isPrinterSet({ ...opts, TemplateId: -1 }), true); // "[Use rules]"
  for (const bad of [null, { ...opts, TerminalId: null }, { ...opts, TemplateId: null }, { ...opts, TemplateId: -2 }, { ...opts, NumberOfCopies: 0 }]) {
    assert.equal(isPrinterSet(bad), false);
  }
});
