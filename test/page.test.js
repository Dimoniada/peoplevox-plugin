const test = require('node:test');
const assert = require('node:assert/strict');
const { isLocationsPage } = require('../peoplevox-range-printer.user.js');
test('only the Manage locations page', () => {
  assert.equal(isLocationsPage('/rkb4952/ui/warehouse/locations'), true);
  assert.equal(isLocationsPage('/rkb4952/ui/warehouse/locations/'), true);
  for (const p of ['/rkb4952/ui/warehouse/locations/123', '/rkb4952/ui/warehouse/locationgroups', '/rkb3841/ui/warehouse/locations']) {
    assert.equal(isLocationsPage(p), false);
  }
});
