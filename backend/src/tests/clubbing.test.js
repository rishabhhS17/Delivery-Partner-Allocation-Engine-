import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeTime,
  simulateRoute,
  deadlineOk,
  cheapestInsertion,
  allocateClub,
  pickupStop,
  dropStop,
  bearing,
  bearingDiff,
} from '../services/allocationEngine.js';

const now = Date.now();
const FAR_FUTURE = new Date(now + 3600e3);

// Order A: restaurant → customer, prep already ready, roomy deadline.
const orderA = {
  _id: 'A',
  restaurantLat: 23.350, restaurantLng: 85.320,
  customerLat: 23.360, customerLng: 85.330,
  prepReadyAt: new Date(now), promisedBy: FAR_FUTURE,
};
// Order B: restaurant + drop clustered near A's.
const orderB = {
  _id: 'B',
  restaurantLat: 23.351, restaurantLng: 85.321,
  customerLat: 23.362, customerLng: 85.332,
  prepReadyAt: new Date(now), promisedBy: FAR_FUTURE,
};

test('routeTime charges prep wait as max(arrival, prepReadyAt)', () => {
  const start = { lat: 23.350, lng: 85.320 };            // sitting on the restaurant
  const readySoon = { ...orderA, prepReadyAt: new Date(now + 100_000) }; // ready in 100 s
  const stops = [pickupStop(readySoon), dropStop(readySoon)];
  const t = routeTime(stops, start, now);
  // Arrival at pickup is ~instant (already there) but food isn't ready for 100 s, so total
  // traversal must be at least that wait.
  assert.ok(t >= 100, `expected wait ≥100s to be charged, got ${t}`);
});

test('cheapestInsertion keeps pickup before drop and returns a 4-stop ordering', () => {
  const start = { lat: 23.352, lng: 85.322 };
  const baseStops = [dropStop(orderA)];                   // carrying A, already picked up
  const ins = cheapestInsertion(baseStops, pickupStop(orderB), dropStop(orderB), start, now);
  assert.ok(ins, 'expected a feasible insertion');
  assert.equal(ins.ordering.length, 3);                  // dropA + pickupB + dropB
  const idxPickupB = ins.ordering.findIndex(s => s.type === 'PICKUP' && s.orderId === 'B');
  const idxDropB   = ins.ordering.findIndex(s => s.type === 'DROP'   && s.orderId === 'B');
  assert.ok(idxPickupB < idxDropB, 'pickup must come before drop');
  assert.ok(ins.marginalCost > 0);
});

test('cheapestInsertion returns null when B cannot meet its deadline', () => {
  const start = { lat: 23.30, lng: 85.28 };
  const tightB = { ...orderB, promisedBy: new Date(now - 1000) }; // already past due
  const ins = cheapestInsertion([], pickupStop(tightB), dropStop(tightB), start, now);
  assert.equal(ins, null);
});

test('deadlineOk fails when a drop lands after its promisedBy', () => {
  const start = { lat: 23.30, lng: 85.28 };
  const tightA = { ...orderA, promisedBy: new Date(now + 1000) };
  const stops = [pickupStop(tightA), dropStop(tightA)];
  assert.equal(deadlineOk(stops, start, now), false);
  assert.equal(deadlineOk([pickupStop(orderA), dropStop(orderA)], start, now), true);
});

test('allocateClub: a busy rider with a nearby drop beats a farther idle rider on marginal cost', () => {
  const idle = { rider: { _id: 'idle' }, startPos: { lat: 23.320, lng: 85.290 }, stops: [], deliveryTimestamps: [] };
  const busy = { rider: { _id: 'busy' }, startPos: { lat: 23.352, lng: 85.322 }, stops: [dropStop(orderA)], deliveryTimestamps: [] };
  const res = allocateClub(orderB, [idle, busy], { etar: 1, load: 0 }, now);
  assert.ok(res);
  assert.equal(res.winner.rider._id, 'busy');
  assert.equal(res.candidatesConsidered, 2);
});

test('bearing / bearingDiff behave sanely', () => {
  const north = bearing({ lat: 23.35, lng: 85.32 }, { lat: 23.36, lng: 85.32 });
  assert.ok(north < 5 || north > 355, `due-north bearing should be ~0°, got ${north}`);
  assert.equal(bearingDiff(350, 10), 20);
});

test('simulateRoute reports a drop completion time for every order', () => {
  const start = { lat: 23.340, lng: 85.310 };
  const { dropTimes } = simulateRoute([pickupStop(orderA), dropStop(orderA)], start, now);
  assert.ok(dropTimes['A'] > now);
});
