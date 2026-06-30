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
    rating: 4,
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
    // Best: closest, highest rating, lowest load.
    idleRider({ _id: 'A', latitude: 23.351, longitude: 85.331, rating: 5, deliveryTimestamps: [] }),
    // Worst: farthest, lowest rating, highest load.
    idleRider({ _id: 'B', latitude: 23.45, longitude: 85.45, rating: 3, deliveryTimestamps: [now, now, now] }),
    // Middle.
    idleRider({ _id: 'C', latitude: 23.40, longitude: 85.40, rating: 4, deliveryTimestamps: [now] }),
  ];

  const weights = { etar: 0.5, rating: 0.3, load: 0.2 };
  const result = allocateOrder(order, candidates, weights);

  assert.ok(result);
  assert.equal(result.winner._id, 'A');
  assert.equal(result.candidatesConsidered, 3);
});

test('allocateOrder returns falsy for an empty candidate list (no crash)', () => {
  const order = { restaurantLat: 23.35, restaurantLng: 85.33 };
  const result = allocateOrder(order, [], { etar: 0.5, rating: 0.3, load: 0.2 });
  assert.ok(!result);
});

test('weights influence ranking — rating-only weights elect the highest-rated rider regardless of distance', () => {
  const order = { restaurantLat: 23.35, restaurantLng: 85.33 };
  const candidates = [
    // Close but low rating.
    idleRider({ _id: 'X', latitude: 23.351, longitude: 85.331, rating: 2 }),
    // Far but highest rating.
    idleRider({ _id: 'Y', latitude: 23.45, longitude: 85.45, rating: 5 }),
  ];

  // etar=0 → distance must not matter; rating dominates.
  const result = allocateOrder(order, candidates, { etar: 0, rating: 1, load: 0 });

  assert.ok(result);
  assert.equal(result.winner._id, 'Y');
});
