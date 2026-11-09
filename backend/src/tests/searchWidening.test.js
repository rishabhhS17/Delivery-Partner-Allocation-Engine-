import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { latLngToCell } from 'h3-js';
import { riderState, h3Buckets } from '../engine/state.js';
import { _addToH3 } from '../engine/h3Index.js';
import { _chooseAssignment } from '../engine/dispatch.js';
import { H3_RESOLUTION } from '../config/constants.js';

// No database here: saving the search start fails at once instead of waiting for a connection.
mongoose.set('bufferCommands', false);

const MINUTE_MS = 60_000;
const RESTAURANT = { lat: 23.3400, lng: 85.3210 };

function addIdleRiderNextToRestaurant() {
  const rider = {
    _id: { toString: () => 'rider-near' }, name: 'near', status: 'IDLE', availabilityStatus: 'ONLINE',
    lat: RESTAURANT.lat + 0.0018, lng: RESTAURANT.lng, // ~200 m away
    orders: new Set(), stops: [], deliveryTimestamps: [],
  };
  rider.h3Index = latLngToCell(rider.lat, rider.lng, H3_RESOLUTION);
  riderState.set('rider-near', rider);
  _addToH3('rider-near', rider);
}

function orderWithFoodReadyIn(foodReadyInMs, now) {
  return {
    _id: 'order-' + foodReadyInMs, restaurantLat: RESTAURANT.lat, restaurantLng: RESTAURANT.lng,
    customerLat: RESTAURANT.lat + 0.01, customerLng: RESTAURANT.lng,
    prepReadyAt: new Date(now + foodReadyInMs), jitGrace_s: 1, promisedBy: new Date(now + 60 * MINUTE_MS),
  };
}

test('waiting for the food does not widen the search; the clock starts when a rider is sent', () => {
  riderState.clear(); h3Buckets.clear();
  addIdleRiderNextToRestaurant();
  const now = Date.now();
  const order = orderWithFoodReadyIn(10 * MINUTE_MS, now);

  assert.equal(_chooseAssignment('o1', order, now).kind, 'hold');
  const fiveMinutesLater = _chooseAssignment('o1', order, now + 5 * MINUTE_MS);
  assert.equal(fiveMinutesLater.kind, 'hold');
  assert.equal(order.searchRangeKm, 5, 'still the normal 5 km after 5 minutes of waiting for food');
  assert.equal(order.dispatchStartedAt, undefined, 'the widening clock has not started');

  const departure = now + 10 * MINUTE_MS;
  assert.equal(_chooseAssignment('o1', order, departure).kind, 'assign');
  assert.equal(order.dispatchStartedAt.getTime(), departure, 'the clock starts at the first real try');
});

test('when nobody is in range the clock starts at once, so the search can widen', () => {
  riderState.clear(); h3Buckets.clear();
  const now = Date.now();
  const order = orderWithFoodReadyIn(10 * MINUTE_MS, now);

  assert.equal(_chooseAssignment('o2', order, now).kind, 'no_rider');
  assert.equal(order.dispatchStartedAt.getTime(), now);
  _chooseAssignment('o2', order, now + 61_000);
  assert.equal(order.searchRangeKm, 7, 'widened to 7 km after 60 s of finding nobody');
});
