import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWeights, setWeights, DEFAULT_WEIGHTS } from '../config/constants.js';

test('DEFAULT_WEIGHTS exists with the expected shape', () => {
  assert.equal(typeof DEFAULT_WEIGHTS, 'object');
  for (const key of ['etar', 'rating', 'load']) {
    assert.equal(typeof DEFAULT_WEIGHTS[key], 'number');
  }
});

test('getWeights returns positive etar/rating/load numbers', () => {
  const w = getWeights();
  for (const key of ['etar', 'rating', 'load']) {
    assert.equal(typeof w[key], 'number');
    assert.ok(w[key] > 0, `${key} should be > 0`);
  }
});

test('setWeights normalizes custom values so they sum to 1', () => {
  setWeights({ etar: 2, rating: 1, load: 1 }); // total 4 → 0.5 / 0.25 / 0.25
  const w = getWeights();
  assert.ok(Math.abs(w.etar - 0.5) < 1e-9);
  assert.ok(Math.abs(w.rating - 0.25) < 1e-9);
  assert.ok(Math.abs(w.load - 0.25) < 1e-9);

  const sum = w.etar + w.rating + w.load;
  assert.ok(Math.abs(sum - 1) < 1e-9, 'normalized weights should sum to 1');
});
