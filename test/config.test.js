const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isEnabledYaml } = require('../peoplevox-range-printer.user.js');

test('application.yaml enabled flag', () => {
  assert.equal(isEnabledYaml('enabled: true\n'), true);
  assert.equal(isEnabledYaml('enabled: false\n'), false);
  assert.equal(isEnabledYaml('enabled: false\r\n'), false);
  assert.equal(isEnabledYaml('# remote switch\nenabled: False   # maintenance\n'), false);
  assert.equal(isEnabledYaml('enabled: "false"'), false);
  assert.equal(isEnabledYaml('enabled: no'), false);
  assert.equal(isEnabledYaml(''), true);
  assert.equal(isEnabledYaml('other:\n  enabled: false\n'), true); // only the top-level key counts
});
test('the application.yaml in this repo ships enabled', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'application.yaml'), 'utf8');
  assert.equal(isEnabledYaml(text), true);
  assert.match(text, /^enabled: true$/m);
});
