const test = require('node:test');
const assert = require('node:assert/strict');
const { createJob, viewFor } = require('../peoplevox-range-printer.user.js');
const opts = { TerminalId: 288, TemplateId: 103, NumberOfCopies: 1 };
const make = ({ rows = [], printImpl, options = opts, enabled = true } = {}) => {
  const t = { now: 1000, printed: [], sleeps: [], states: [], searches: 0, options, timers: [], flagReads: 0 };
  const job = createJob({
    search: async () => { t.searches++; return rows; },
    print: async (id, o) => { t.printed.push([id, o]); if (printImpl) await printImpl(id, job, t); },
    readOptions: () => t.options, getDelayMs: () => 500, now: () => t.now,
    sleep: async (ms) => { t.sleeps.push(ms); },
    later: (ms, fn) => t.timers.push([ms, fn]),
    checkEnabled: async () => { t.flagReads++; if (enabled === 'throw') throw new Error('offline'); return enabled; },
    onChange: (s) => t.states.push(viewFor(s)),
  });
  return { job, t };
};
const rows3 = [{ Id: 1, Barcode: 'X1' }, { Id: 2, Barcode: 'X2' }, { Id: 3, Barcode: 'X3' }];
const last = (t) => t.states.at(-1);

test('printer not set: Print does nothing', async () => {
  const { job, t } = make({ options: null });
  await job.start('X[1-3]');
  assert.equal(t.searches, 0);
  assert.deepEqual(viewFor(job.state()), { fieldDisabled: false, button: 'Print', status: 'Printer is not set', statusError: true, list: [] });
});
test('bad range', async () => {
  const { job } = make();
  await job.start('X[A-9]');
  assert.deepEqual([viewFor(job.state()).status, viewFor(job.state()).statusError], ['Bad range [A-9]', true]);
});
test('happy path prints in order with delay between labels', async () => {
  const { job, t } = make({ rows: rows3 });
  await job.start('X[1-3]');
  assert.deepEqual(t.printed.map(([id]) => id), [1, 2, 3]);
  assert.deepEqual(t.sleeps, [500, 500]);
  assert.ok(t.states.some((v) => v.status === 'Checking…' && v.button === 'Stop' && v.fieldDisabled));
  assert.ok(t.states.some((v) => v.status === '1/3' && v.statusError));
  assert.deepEqual([last(t).status, last(t).statusError, last(t).button], ['3/3', false, 'Print']);
});
test('missing barcodes print nothing', async () => {
  const { job, t } = make({ rows: rows3.slice(0, 2) });
  await job.start('X[1-3]');
  assert.deepEqual([t.printed.length, last(t).status, last(t).list], [0, '1 not found', ['X3']]);
});
test('duplicates print nothing', async () => {
  const { job, t } = make({ rows: [...rows3, { Id: 9, Barcode: 'x3' }] });
  await job.start('X[1-3]');
  assert.deepEqual([t.printed.length, last(t).status, last(t).list], [0, 'Duplicate barcodes', ['X3']]);
});
test('search failure prints nothing', async () => {
  const printed = [];
  const j = createJob({ search: async () => { throw new Error('Network error'); }, print: async (id) => printed.push(id), readOptions: () => opts, getDelayMs: () => 0, sleep: async () => {}, onChange: () => {} });
  await j.start('X[1-3]');
  assert.deepEqual([printed.length, viewFor(j.state()).status], [0, 'Search failed: Network error']);
});
test('print failure stops at that label', async () => {
  const { job, t } = make({ rows: rows3, printImpl: async (id) => { if (id === 2) throw new Error('No matching print template'); } });
  await job.start('X[1-3]');
  assert.deepEqual(t.printed.map(([id]) => id), [1, 2]);
  assert.deepEqual([last(t).status, last(t).list, last(t).statusError], ['Failed at X2 (2/3)', ['No matching print template'], true]);
});
test('Stop after the guard stops before the next label', async () => {
  const { job, t } = make({ rows: rows3, printImpl: async (id, j, tt) => { if (id === 1) { tt.now += 600; j.stop(); } } });
  await job.start('X[1-3]');
  assert.deepEqual([t.printed.length, last(t).status], [1, 'Stopped 1/3']);
});
test('double-click guard ignores early Stop, × forces it', async () => {
  const a = make({ rows: rows3, printImpl: async (id, j, tt) => { if (id === 1) { tt.now += 100; j.stop(); } } });
  await a.job.start('X[1-3]');
  assert.equal(a.t.printed.length, 3);
  const b = make({ rows: rows3, printImpl: async (id, j) => { if (id === 1) j.stop(true); } });
  await b.job.start('X[1-3]');
  assert.equal(b.t.printed.length, 1);
});
test('options snapshot survives changes mid-run', async () => {
  const { job, t } = make({ rows: rows3, printImpl: async (id, j, tt) => { tt.options = { ...opts, TerminalId: 999 }; } });
  await job.start('X[1-3]');
  assert.ok(t.printed.every(([, o]) => o.TerminalId === 288));
});
test('start while running is ignored', async () => {
  const { job, t } = make({ rows: rows3, printImpl: async (id, j) => { if (id === 1) await j.start('X[1-3]'); } });
  await job.start('X[1-3]');
  assert.equal(t.searches, 1);
});
test('refreshPrinter clears the red label', async () => {
  const { job, t } = make({ options: null });
  await job.start('X1');
  t.options = opts;
  job.refreshPrinter();
  assert.equal(last(t).status, '');
});
test('Stop during the check sends no further searches', async () => {
  const junk = Array.from({ length: 1000 }, (_, i) => ({ Id: i + 100, Barcode: `J${i}` }));
  let searches = 0;
  const printed = [];
  const job = createJob({
    search: async () => { searches++; if (searches === 2) job.stop(true); return junk; },
    print: async (id) => printed.push(id), readOptions: () => opts, getDelayMs: () => 0, sleep: async () => {}, later: () => {}, onChange: () => {},
  });
  await job.start('X[1-50]Y');
  assert.deepEqual([searches, printed.length, viewFor(job.state()).status], [2, 0, 'Stopped']);
});
test('a second Print right after a quick run is ignored', async () => {
  const { job, t } = make({ rows: [{ Id: 1, Barcode: 'X1' }] });
  await job.start('X1');
  t.now += 200;
  await job.start('X1');
  assert.equal(t.printed.length, 1);
  t.now += 400;
  await job.start('X1');
  assert.equal(t.printed.length, 2);
});
test('done and stopped clear after 5 s; errors stay', async () => {
  const a = make({ rows: rows3 });
  await a.job.start('X[1-3]');
  assert.deepEqual(a.t.timers.map(([ms]) => ms), [5000]);
  a.t.timers[0][1]();
  assert.equal(last(a.t).status, '');
  const b = make({ rows: rows3, printImpl: async (id, j, tt) => { if (id === 1) { tt.now += 600; j.stop(); } } });
  await b.job.start('X[1-3]');
  b.t.timers[0][1]();
  assert.equal(last(b.t).status, '');
  const c = make({ rows: rows3.slice(0, 2) });
  await c.job.start('X[1-3]');
  assert.equal(c.t.timers.length, 0);
});
test('a stale clear does not wipe a newer run', async () => {
  const { job, t } = make({ rows: rows3 });
  await job.start('X[1-3]');
  t.now += 1000;
  await job.start('X[1-2]');
  t.timers[0][1]();
  assert.equal(last(t).status, '2/2');
});
test('disabled flag: Print shows Plugin disabled and does nothing else', async () => {
  const { job, t } = make({ rows: rows3, enabled: false });
  await job.start('X[1-3]');
  assert.deepEqual([t.searches, t.printed.length], [0, 0]);
  assert.deepEqual(viewFor(job.state()), { fieldDisabled: false, button: 'Print', status: 'Plugin disabled', statusError: true, list: [] });
});
test('disabled wins over printer not set', async () => {
  const { job } = make({ options: null, enabled: false });
  await job.start('X1');
  assert.equal(viewFor(job.state()).status, 'Plugin disabled');
});
test('the flag is read on every Print', async () => {
  const { job, t } = make({ rows: rows3 });
  await job.start('X1');
  t.now += 1000;
  await job.start('X1');
  assert.deepEqual([t.flagReads, t.printed.length], [2, 2]);
});
test('unreachable config does not block printing', async () => {
  const { job, t } = make({ rows: rows3, enabled: 'throw' });
  await job.start('X1');
  assert.equal(t.printed.length, 1);
});
