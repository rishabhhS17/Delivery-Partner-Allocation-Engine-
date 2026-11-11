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

test('a new order that will be late still gets a rider: the least-late one', () => {
  const lateB = { ...orderB, promisedBy: new Date(now - 1000) }; // already past due
  const ins = cheapestInsertion([], pickupStop(lateB), dropStop(lateB), { lat: 23.30, lng: 85.28 }, now);
  assert.ok(ins, 'a late order is not blocked by its own promise');
  const near = { rider: { _id: 'near' }, startPos: { lat: 23.345, lng: 85.321 }, stops: [], deliveryTimestamps: [] };
  const far  = { rider: { _id: 'far' },  startPos: { lat: 23.300, lng: 85.321 }, stops: [], deliveryTimestamps: [] };
  assert.equal(allocateClub(lateB, [near, far], { etar: 1, load: 0 }, now).winner.rider._id, 'near');
});

test('a second order is never fitted in a way that makes an order already on board late', () => {
  const start = { lat: 23.350, lng: 85.320 };
  // A is on board, its drop ~12 km north (~18 min) and promised just 20 s after the direct ride:
  // too far off for the aging lock or head freeze, so only the deadline check protects it.
  const onBoard = { ...orderA, customerLat: 23.458, customerLng: 85.320 };
  const directDropMs = simulateRoute([dropStop(onBoard)], start, now).dropTimes['A'];
  onBoard.promisedBy = new Date(directDropMs + 20_000);
  // B's restaurant is ~600 m to the side: picking it up first would cost A about 100 s.
  const sideB = { ...orderB, restaurantLat: 23.350, restaurantLng: 85.326, customerLat: 23.456, customerLng: 85.320 };
  const ins = cheapestInsertion([dropStop(onBoard)], pickupStop(sideB), dropStop(sideB), start, now);
  assert.ok(ins);
  assert.equal(ins.ordering[0].orderId, 'A', 'A is dropped first');
  assert.ok(simulateRoute(ins.ordering, start, now).dropTimes['A'] <= onBoard.promisedBy.getTime(), 'A keeps its promise');
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
