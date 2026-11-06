const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSettings, saveSettings, textColorFor, SETTINGS_KEY } = require('../peoplevox-range-printer.user.js');
const mem = (init = {}) => ({ data: { ...init }, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = String(v); } });

test('defaults', () => assert.deepEqual(loadSettings(mem()), { opacity: 0.9, theme: 'auto', color: '#1e1e1e', delayMs: 500 }));
test('partial and invalid values', () => {
  assert.equal(loadSettings(mem({ [SETTINGS_KEY]: '{"delayMs":2000}' })).delayMs, 2000);
  assert.deepEqual(loadSettings(mem({ [SETTINGS_KEY]: '{"opacity":5,"delayMs":-1,"theme":"pink","color":"red"}' })),
    { opacity: 1, theme: 'auto', color: '#1e1e1e', delayMs: 0 });
  assert.deepEqual(loadSettings(mem({ [SETTINGS_KEY]: '{bad' })).theme, 'auto');
});
test('round trip', () => {
  const s = mem();
  saveSettings(s, { opacity: 0.5, theme: 'color', color: '#ffcc00', delayMs: 100 });
  assert.deepEqual(loadSettings(s), { opacity: 0.5, theme: 'color', color: '#ffcc00', delayMs: 100 });
});
test('readable text on solid colour', () => {
  assert.equal(textColorFor('#ffffff'), '#000000');
  assert.equal(textColorFor('#1e1e1e'), '#ffffff');
});
test('Range field text is at least 16px so iPhone Safari does not zoom on tap', () => {
  const { WINDOW_CSS } = require('../peoplevox-range-printer.user.js');
  const m = String(WINDOW_CSS).match(/\.field\s*\{[^}]*font-size:\s*(\d+)px/);
  assert.ok(m && Number(m[1]) >= 16);
});
test('page background: first mostly-opaque colour up the ancestor chain', () => {
  const { pickPageBackground } = require('../peoplevox-range-printer.user.js');
  assert.equal(pickPageBackground(['rgba(0, 0, 0, 0)', 'rgb(245, 245, 245)', 'rgb(0, 0, 0)']), '#f5f5f5');
  assert.equal(pickPageBackground(['transparent', 'rgba(24, 26, 27, 1)']), '#181a1b');
  assert.equal(pickPageBackground(['rgba(10, 20, 30, 0.3)', 'rgb(1 2 3)']), '#010203');
  assert.equal(pickPageBackground(['transparent', 'rgba(0, 0, 0, 0)']), '#ffffff');
  assert.equal(pickPageBackground([]), '#ffffff');
});
test('settings panel: wording, one control column, drawn icons, readable dropdown items', () => {
  const { WINDOW_HTML, WINDOW_CSS } = require('../peoplevox-range-printer.user.js');
  assert.match(String(WINDOW_HTML), />Delay between printing, ms</);
  assert.doesNotMatch(String(WINDOW_HTML), /⚙|×/); // drawn icons sit on the same line on every system
  assert.match(WINDOW_CSS, /\.settings\s*\{[^}]*display:\s*grid/);
  assert.match(WINDOW_CSS, /option\s*\{[^}]*background:/);
});
test('colour picker has a greyed-out disabled look', () => {
  const { WINDOW_CSS } = require('../peoplevox-range-printer.user.js');
  assert.match(WINDOW_CSS, /\.settings input:disabled\s*\{[^}]*opacity/);
});
