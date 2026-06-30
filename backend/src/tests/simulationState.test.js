import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSimulationRunning,
  addPendingOrder,
  syncManualAllocation,
} from '../services/simulationEngine.js';

// These tests only touch the pure/stateless exported helpers. The simulation is
// never started and no DB connection is opened (connectDB lives in server.js).

test('isSimulationRunning returns a boolean', () => {
  assert.equal(typeof isSimulationRunning(), 'boolean');
});

test('addPendingOrder is a no-op when the simulation is not running', () => {
  assert.equal(isSimulationRunning(), false);
  // Must not throw even though the order never enters the (empty) queue.
  assert.doesNotThrow(() => addPendingOrder({ _id: 'order-not-running' }));
});

test('syncManualAllocation is a safe no-op for an unknown rider', () => {
  assert.doesNotThrow(() => syncManualAllocation('nonexistent-rider', 'some-order-id'));
});
