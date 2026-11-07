import { riderState, pendingQueue } from './state.js';
import { savePrepEstimate, appendOrderEvent } from './storage.js';
import { publish } from './broadcast.js';
import { scheduleWake, isOrderAsleep } from './wakeList.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('engine');

// ─── Food-ready estimates ────────────────────────────────────────────────────
// The kitchen sets an estimate when the order is placed and may change it (food delayed, or
// ready early). Dispatch re-plans each time (decision H1): a waiting order is woken so the
// wake-up list re-sorts and the just-in-time departure is recomputed; an assigned order's pickup
// stop gets the new time, and a rider already waiting at the counter waits until then.

/** Orders a kitchen is still preparing (not yet picked up). */
export function _listKitchenTickets() {
  const tickets = [];
  for (const [orderId, order] of pendingQueue) {
    tickets.push({ orderId, placedAt: order.createdAt, foodReadyAt: order.prepReadyAt, riderId: null });
  }
  for (const [riderId, rider] of riderState) {
    for (const [orderId, meta] of rider.orders) {
      if (!meta.pickedUp) tickets.push({ orderId, placedAt: meta.createdAt, foodReadyAt: meta.prepReadyAt, riderId });
    }
  }
  return tickets;
}

/** @returns {Promise<'updated'|'not_found'|'failed'>} not_found: picked up, finished or unknown */
export async function _updatePrepEstimate(orderId, foodReadyAt) {
  const now = Date.now();
  const readyAt = new Date(foodReadyAt);
  const pendingOrder = pendingQueue.get(orderId);
  const carrier = pendingOrder ? null : findCarrier(orderId);
  if (!pendingOrder && !carrier) return 'not_found';
  const previousReadyAt = pendingOrder?.prepReadyAt ?? carrier.meta.prepReadyAt;

  let isSaved;
  try {
    isSaved = await savePrepEstimate(pendingOrder?._id ?? carrier.meta._id, readyAt);
  } catch (err) {
    log.error('prep estimate write failed', { orderId, error: err.message });
    return 'failed';
  }
  if (!isSaved) return 'not_found';

  if (pendingOrder) {
    pendingOrder.prepReadyAt = readyAt;
    if (isOrderAsleep(orderId)) scheduleWake(orderId, now); // re-plan now (not while offered)
  } else {
    const { rider, meta } = carrier;
    meta.prepReadyAt = readyAt;
    for (const stop of rider.stops) {
      if (String(stop.orderId) === orderId && stop.type === 'PICKUP') stop.prepReadyAt = readyAt;
    }
    if (rider.status === 'WAITING' && String(rider.stops[0]?.orderId) === orderId) rider.waitingUntil = readyAt.getTime();
  }

  appendOrderEvent(pendingOrder?._id ?? carrier.meta._id, 'prep_updated', {
    details: { foodReadyAt: readyAt, previousFoodReadyAt: previousReadyAt },
  });
  publish('order:prep_updated', { orderId, foodReadyAt: readyAt.getTime() });
  return 'updated';
}

function findCarrier(orderId) {
  for (const rider of riderState.values()) {
    const meta = rider.orders.get(orderId);
    if (meta && !meta.pickedUp) return { rider, meta };
  }
  return null;
}
