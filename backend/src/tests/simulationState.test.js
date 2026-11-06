import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getStatus,
  addPendingOrder,
  syncManualAllocation,
} from '../engine/index.js';

// These tests only touch the in-memory exported helpers. No DB connection is opened
// (connectDB lives in server.js).

test('addPendingOrder queues the order even before the engine has started', () => {
  const before = getStatus().queueDepth;
  addPendingOrder({ _id: 'order-before-start' });
  assert.equal(getStatus().queueDepth, before + 1);
});

test('syncManualAllocation is a safe no-op for an unknown rider', () => {
  assert.doesNotThrow(() => syncManualAllocation('nonexistent-rider', 'some-order-id'));
});
