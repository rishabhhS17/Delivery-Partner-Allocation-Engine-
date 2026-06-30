import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRiderCreate,
  validateLocationUpdate,
  validateStatusUpdate,
} from '../validators/riderValidator.js';

// NOTE: there is no order-creation validator in this codebase — orders are
// generated server-side from existing restaurant/customer records, so there is
// no user-supplied order payload to validate. Rider validators are covered below.

test('validateRiderCreate returns null for valid input', () => {
  const err = validateRiderCreate({ name: 'Asha', latitude: 23.35, longitude: 85.33, rating: 4 });
  assert.equal(err, null);
});

test('validateRiderCreate returns an error when required fields are missing', () => {
  assert.ok(validateRiderCreate({ latitude: 23.35, longitude: 85.33 }));        // no name
  assert.ok(validateRiderCreate({ name: 'Asha', longitude: 85.33 }));           // no latitude
  assert.ok(validateRiderCreate({ name: 'Asha', latitude: 23.35 }));            // no longitude
});

test('validateLocationUpdate accepts valid coords and rejects out-of-range ones', () => {
  assert.equal(validateLocationUpdate({ latitude: 23.35, longitude: 85.33 }), null);
  assert.ok(validateLocationUpdate({ latitude: 200, longitude: 85.33 }));
});

test('validateStatusUpdate returns null for a valid status', () => {
  assert.equal(validateStatusUpdate({ availabilityStatus: 'ONLINE' }), null);
  assert.equal(validateStatusUpdate({ availabilityStatus: 'OFFLINE' }), null);
});

test('validateStatusUpdate returns an error for an invalid status string', () => {
  assert.ok(validateStatusUpdate({ availabilityStatus: 'BUSY' }));
  assert.ok(validateStatusUpdate({}));
});
