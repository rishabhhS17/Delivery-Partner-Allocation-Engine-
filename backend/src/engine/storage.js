// ─── Engine storage ──────────────────────────────────────────────────────────
// Every database read and write the engine makes goes through this file, so the engine's
// persistence rules live in one place.
//
// Who carries an order is stored only on the Order (assignedRiderId). A rider's order list is
// never saved on the Rider: on restart it is rebuilt from the orders (decision E2), so the two
// can never disagree.

import Rider from '../models/Rider.js';
import Order from '../models/Order.js';
import AllocationHistory from '../models/AllocationHistory.js';
import OrderEvent from '../models/OrderEvent.js';

const ACTIVE_ORDER_STATUSES = ['ASSIGNED', 'PICKED_UP'];

// ─── Startup reads ───────────────────────────────────────────────────────────

/** Orders a rider is carrying right now. */
export function loadActiveOrders() {
  return Order.find({ status: { $in: ACTIVE_ORDER_STATUSES } });
}

/** Orders waiting for a rider. */
export function loadPendingOrders() {
  return Order.find({ status: 'PENDING' });
}

/** Online riders, plus any rider still carrying an order (they finish it even if offline). */
export function loadRidersForStartup(carrierIds) {
  return Rider.find({ $or: [{ availabilityStatus: 'ONLINE' }, { _id: { $in: carrierIds } }] });
}

/** Put orders whose rider no longer exists back in the queue. */
export function requeueOrders(orderIds, now) {
  return Order.updateMany(
    { _id: { $in: orderIds } },
    { $set: { status: 'PENDING', assignedRiderId: null, assignedAt: null, queuedAt: new Date(now) } }
  );
}

// ─── Order writes ────────────────────────────────────────────────────────────

/**
 * The whole assignment is this one conditional update: it only applies while the order is still
 * PENDING. Resolves true when it was saved, false when the order had already changed.
 */
export async function saveAssignment(orderId, riderId, score, now) {
  const { modifiedCount } = await Order.updateOne(
    { _id: orderId, status: 'PENDING' },
    { $set: { status: 'ASSIGNED', assignedRiderId: riderId, assignedAt: new Date(now), allocationScore: score } }
  );
  return modifiedCount === 1;
}

export function saveAllocationRecord(orderId, riderId, result) {
  return AllocationHistory.create({
    orderId,
    riderId,
    allocationScore: result.score,
    breakdown: result.breakdown,
    candidatesConsidered: result.candidatesConsidered,
  });
}

export function savePickup(orderId, now, actualWait_s) {
  return Order.findByIdAndUpdate(orderId, {
    status: 'PICKED_UP', pickedUpAt: new Date(now), actualWait_s,
  });
}

export function saveDelivery(orderId, now) {
  return Order.findByIdAndUpdate(orderId, { status: 'DELIVERED', deliveredAt: new Date(now) });
}

/** Cancels a PENDING order. Resolves true when it was saved, false when it had already changed. */
export async function saveCancellation(orderId, now) {
  const { modifiedCount } = await Order.updateOne(
    { _id: orderId, status: 'PENDING' },
    { $set: { status: 'CANCELLED', cancelledAt: new Date(now), assignedRiderId: null } }
  );
  return modifiedCount === 1;
}

export function saveOrderRoute(orderId, route, hasNextLeg) {
  return Order.findByIdAndUpdate(orderId, {
    leg1Coords:     route.leg1Coords,
    leg2Coords:     hasNextLeg ? route.leg2Coords : [],
    leg1Duration_s: route.leg1Duration_s,
    leg2Duration_s: route.leg2Duration_s,
  });
}

// ─── Rider writes ────────────────────────────────────────────────────────────

/** Rider position, status and current leg. On restart the engine recomputes the status from the
 *  orders and the position from the leg, so a stale value here does no harm. */
export function saveRiderState(riderId, fields) {
  return Rider.findByIdAndUpdate(riderId, fields);
}

/** The road route for the rider's current leg arrived. */
export function saveRiderLegRoute(riderId, coords) {
  return Rider.updateOne({ _id: riderId, currentLeg: { $ne: null } }, { $set: { 'currentLeg.coords': coords } });
}

/** One write of every rider's position at shutdown. */
export function saveFinalPositions(riderEntries) {
  if (!riderEntries.length) return Promise.resolve();
  return Rider.bulkWrite(riderEntries.map(([riderId, rider]) => ({
    updateOne: {
      filter: { _id: riderId },
      update: { $set: { latitude: rider.lat, longitude: rider.lng, h3Index: rider.h3Index } },
    },
  })));
}

// ─── Order event log ─────────────────────────────────────────────────────────

/**
 * Append one entry to the order's event log (kept 7 days). Best effort: a failed log write is
 * reported but never blocks the change it describes.
 * @param {string} type  e.g. 'created', 'assigned', 'picked_up', 'delivered', 'cancelled'
 */
export function appendOrderEvent(orderId, type, { riderId = null, details } = {}) {
  return OrderEvent.create({ orderId, type, riderId, details, at: new Date() })
    .catch(err => console.error(`[engine] order event '${type}' write failed:`, err.message));
}
