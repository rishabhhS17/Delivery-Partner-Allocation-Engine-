import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueOrder, dequeueOrder, scheduleWake, takeDueOrderIds, clearWakeList, sleepingOrderCount,
} from '../engine/wakeList.js';

const order = (id, extra = {}) => ({ _id: id, ...extra });

test('due orders come out in wake-up order and only once', () => {
  clearWakeList();
  const now = 1_000_000;
  enqueueOrder(order('late'), now);
  enqueueOrder(order('early'), now);
  scheduleWake('late', now + 500);
  scheduleWake('early', now + 100);
  assert.deepEqual(takeDueOrderIds(now + 50), []);
  assert.deepEqual(takeDueOrderIds(now + 600), ['early', 'late']);
  assert.deepEqual(takeDueOrderIds(now + 700), []);
  assert.equal(sleepingOrderCount(), 0);
});

test('rescheduling replaces the earlier wake-up time', () => {
  clearWakeList();
  const now = 2_000_000;
  enqueueOrder(order('A'), now);
  scheduleWake('A', now + 100);
  scheduleWake('A', now + 1000);  // e.g. the JIT hold pushed it later
  assert.deepEqual(takeDueOrderIds(now + 200), []);
  assert.deepEqual(takeDueOrderIds(now + 1000), ['A']);
});

test('a dequeued order never wakes', () => {
  clearWakeList();
  const now = 3_000_000;
  enqueueOrder(order('gone'), now);
  dequeueOrder('gone');
  assert.deepEqual(takeDueOrderIds(now + 10_000), []);
});

test('an order whose food is ready far ahead sleeps until a rider could need to leave', () => {
  clearWakeList();
  const now = 4_000_000;
  enqueueOrder(order('prep', { prepReadyAt: new Date(now + 20 * 60_000), promisedBy: new Date(now + 3600e3) }), now);
  assert.deepEqual(takeDueOrderIds(now + 60_000), [], 'not due a minute later');
  assert.deepEqual(takeDueOrderIds(now + 20 * 60_000), ['prep'], 'due by the time the food is ready');
});
