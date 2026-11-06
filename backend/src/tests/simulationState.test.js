import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getStatus,
  addPendingOrder,
  dispatchNow,
} from '../engine/index.js';

// These tests only touch the in-memory exported helpers. No DB connection is opened
// (connectDB lives in server.js).

test('addPendingOrder queues the order even before the engine has started', () => {
  const before = getStatus().queueDepth;
  addPendingOrder({ _id: 'order-before-start' });
  assert.equal(getStatus().queueDepth, before + 1);
});

test('dispatchNow reports an order that is not in the queue as not pending', async () => {
  assert.deepEqual(await dispatchNow('order-that-was-never-queued'), { status: 'not_pending' });
});
