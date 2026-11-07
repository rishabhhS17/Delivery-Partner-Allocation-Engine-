import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWeights, setWeights, DEFAULT_WEIGHTS } from '../config/constants.js';

test('DEFAULT_WEIGHTS exists with the expected shape', () => {
  assert.equal(typeof DEFAULT_WEIGHTS, 'object');
  for (const key of ['etar', 'load']) {
    assert.equal(typeof DEFAULT_WEIGHTS[key], 'number');
  }
});

test('getWeights returns positive etar/load numbers', () => {
  const w = getWeights();
  for (const key of ['etar', 'load']) {
    assert.equal(typeof w[key], 'number');
    assert.ok(w[key] > 0, `${key} should be > 0`);
  }
});

test('setWeights normalizes custom values so they sum to 1', () => {
  setWeights({ etar: 3, load: 1 }); // total 4 → 0.75 / 0.25
  const w = getWeights();
  assert.ok(Math.abs(w.etar - 0.75) < 1e-9);
  assert.ok(Math.abs(w.load - 0.25) < 1e-9);

  const sum = w.etar + w.load;
  assert.ok(Math.abs(sum - 1) < 1e-9, 'normalized weights should sum to 1');
});

test('setWeights throws when all weights are zero', () => {
  assert.throws(
    () => setWeights({ etar: 0, load: 0 }),
    /weights must sum to a positive number/i
  );
});

test('setWeights does not accept negative total', () => {
  assert.throws(
    () => setWeights({ etar: -1, load: -1 }),
    /weights must sum to a positive number/i
  );
});

test('the search range widens 5 → 7 → 10 km at 60 s and 120 s (decision G1)', async () => {
  const { searchRangeKm } = await import('../config/constants.js');
  assert.equal(searchRangeKm(0), 5);
  assert.equal(searchRangeKm(59_999), 5);
  assert.equal(searchRangeKm(60_000), 7);
  assert.equal(searchRangeKm(119_999), 7);
  assert.equal(searchRangeKm(120_000), 10);
  assert.equal(searchRangeKm(10 * 60_000), 10);
});
