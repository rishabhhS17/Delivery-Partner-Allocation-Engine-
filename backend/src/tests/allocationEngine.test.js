import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEtar, allocateOrder } from '../services/allocationEngine.js';

const RESTAURANT = { lat: 23.35, lng: 85.33 };

// Build an IDLE rider candidate with sensible defaults that callers can override.
function idleRider(overrides = {}) {
  return {
    _id: 'r',
    latitude: 23.35,
    longitude: 85.33,
    status: 'IDLE',
    deliveryTimestamps: [],
    currentOrderId: null,
    ...overrides,
  };
}

test('computeEtar returns a finite number for a normal IDLE rider', () => {
  const rider = idleRider({ latitude: 23.351, longitude: 85.331 });
  const etar = computeEtar(rider, RESTAURANT, Date.now());
  assert.equal(Number.isFinite(etar), true);
  assert.ok(etar >= 0);
});

test('computeEtar returns Infinity when inputs would produce NaN', () => {
  // Busy rider with a started leg but missing duration fields → NaN ETAR.
  const rider = idleRider({
    status: 'ACCEPTED',
    currentOrderId: { legStartedAt: new Date(), leg1Duration_s: undefined, leg2Duration_s: undefined },
  });
  const etar = computeEtar(rider, RESTAURANT, Date.now());
  assert.equal(etar, Infinity);
});

test('allocateOrder picks the rider with the best composite score', () => {
  const order = { restaurantLat: 23.35, restaurantLng: 85.33 };
  const now = new Date();
  const candidates = [
    // Best: closest, lowest load.
    idleRider({ _id: 'A', latitude: 23.351, longitude: 85.331, deliveryTimestamps: [] }),
    // Worst: farthest, highest load.
    idleRider({ _id: 'B', latitude: 23.45, longitude: 85.45, deliveryTimestamps: [now, now, now] }),
    // Middle.
    idleRider({ _id: 'C', latitude: 23.40, longitude: 85.40, deliveryTimestamps: [now] }),
  ];

  const weights = { etar: 0.71, load: 0.29 };
  const result = allocateOrder(order, candidates, weights);

  assert.ok(result);
  assert.equal(result.winner._id, 'A');
  assert.equal(result.candidatesConsidered, 3);
});

test('allocateOrder returns falsy for an empty candidate list (no crash)', () => {
  const order = { restaurantLat: 23.35, restaurantLng: 85.33 };
  const result = allocateOrder(order, [], { etar: 0.71, load: 0.29 });
  assert.ok(!result);
});

test('weights influence ranking — load-only weights elect the least-loaded rider regardless of distance', () => {
  const order = { restaurantLat: 23.35, restaurantLng: 85.33 };
  const now = new Date();
  const candidates = [
    // Close but heavily loaded.
    idleRider({ _id: 'X', latitude: 23.351, longitude: 85.331, deliveryTimestamps: [now, now, now] }),
    // Far but no recent load.
    idleRider({ _id: 'Y', latitude: 23.45, longitude: 85.45, deliveryTimestamps: [] }),
  ];

  // etar=0 → distance must not matter; load dominates.
  const result = allocateOrder(order, candidates, { etar: 0, load: 1 });

  assert.ok(result);
  assert.equal(result.winner._id, 'Y');
});
