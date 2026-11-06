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

export function saveAssignment(orderId, riderId, score, now) {
  return Order.findByIdAndUpdate(orderId, {
    status: 'ASSIGNED',
    assignedRiderId: riderId,
    assignedAt: new Date(now),
    allocationScore: score,
  });
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

export function saveCancellation(orderId, now) {
  return Order.findByIdAndUpdate(orderId, {
    status: 'CANCELLED', cancelledAt: new Date(now), assignedRiderId: null,
  });
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

/** Rider position and status, shown on the Riders page. On restart the engine recomputes the
 *  status from the orders, so a stale value here does no harm. */
export function saveRiderState(riderId, fields) {
  return Rider.findByIdAndUpdate(riderId, fields);
}
