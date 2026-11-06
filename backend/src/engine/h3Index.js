import { CLUBBING_CAP } from '../config/constants.js';
import { h3Buckets } from './state.js';

// A rider stays discoverable in the H3 index while it is online and has a free slot (Stage 2).
// An offline rider may still be finishing orders; they are never offered new ones.
export function _freeSlot(rider) {
  return rider.availabilityStatus === 'ONLINE' && rider.orders.size < CLUBBING_CAP;
}

// ─── H3 bucket helpers (Stage 2 — take the rider entry, maintain bucketCell) ────

export function _addToH3(riderId, rider) {
  const cell = rider.h3Index;
  if (!h3Buckets.has(cell)) h3Buckets.set(cell, new Set());
  h3Buckets.get(cell).add(riderId);
  rider.bucketCell = cell;
}

function _removeFromH3(riderId, rider) {
  if (rider.bucketCell) h3Buckets.get(rider.bucketCell)?.delete(riderId);
  rider.bucketCell = null;
}

// Relocate a bucketed rider when its live cell changes (called every tick after h3Index recompute).
export function _reindexIfBucketed(riderId, rider) {
  if (rider.bucketCell && rider.bucketCell !== rider.h3Index) {
    _removeFromH3(riderId, rider);
    _addToH3(riderId, rider);
  }
}

// Keep the index invariant: a rider is bucketed iff it has a free slot.
export function _syncIndex(riderId, rider) {
  const shouldIndex = _freeSlot(rider);
  if (shouldIndex && !rider.bucketCell)      _addToH3(riderId, rider);
  else if (!shouldIndex && rider.bucketCell) _removeFromH3(riderId, rider);
  else if (shouldIndex)                       _reindexIfBucketed(riderId, rider);
}
