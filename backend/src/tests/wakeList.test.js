import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueOrder, dequeueOrder, scheduleWake, takeDueOrderIds, clearWakeList, sleepingOrderCount,
  nextNoRiderRetryDelay, resetNoRiderRetries,
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

test('an order with no rider backs off 1 → 2 → 4 → 10 s, then stays at 10 s', () => {
  clearWakeList();
  enqueueOrder(order('lonely'), 5_000_000);
  const delays = [1, 2, 3, 4, 5, 6].map(() => nextNoRiderRetryDelay('lonely'));
  assert.deepEqual(delays, [1000, 2000, 4000, 10_000, 10_000, 10_000]);
  resetNoRiderRetries('lonely');
  assert.equal(nextNoRiderRetryDelay('lonely'), 1000, 'starts over once a rider was found');
});
