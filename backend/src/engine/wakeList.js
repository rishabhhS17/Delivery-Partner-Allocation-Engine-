import { RIDER_SPEED_KMH, AGING_LOCK_S, getH3Config } from '../config/constants.js';
import { pendingQueue } from './state.js';

// ─── Wake-up list ────────────────────────────────────────────────────────────
// Waiting orders sleep in one list sorted by the moment they next need looking at, so a dispatch
// round scores only the orders that are due instead of every order every second (decision F1).
// An order is typically scored 2–3 times: when the earliest in-range rider would need to leave,
// at the chosen rider's own departure moment, and (if needed) once more to commit.

const wakeAtByOrder = new Map();   // orderId → the wake-up time that counts
const timesScoredByOrder = new Map(); // orderId → how many times dispatch has scored it
const wakeEntries   = [];          // { orderId, wakeAt } sorted by wakeAt; stale entries are skipped

/** Put an order in the queue, asleep until it could first need a rider. */
export function enqueueOrder(order, now = Date.now()) {
  const orderId = order._id.toString();
  pendingQueue.set(orderId, order);
  scheduleWake(orderId, firstWakeAt(order, now));
}

/** Take an order out of the queue (assigned, cancelled, or dropped). */
export function dequeueOrder(orderId) {
  pendingQueue.delete(orderId);
  wakeAtByOrder.delete(orderId);
  timesScoredByOrder.delete(orderId);
}

/** Count one more scoring of the order; returns the total so far. */
export function countScoring(orderId) {
  const timesScored = (timesScoredByOrder.get(orderId) ?? 0) + 1;
  timesScoredByOrder.set(orderId, timesScored);
  return timesScored;
}

export function clearWakeList() {
  wakeAtByOrder.clear();
  wakeEntries.length = 0;
  timesScoredByOrder.clear();
}

/** Wake the order at `wakeAt` (replaces any earlier wake-up time). */
export function scheduleWake(orderId, wakeAt) {
  wakeAtByOrder.set(orderId, wakeAt);
  let low = 0;
  let high = wakeEntries.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (wakeEntries[middle].wakeAt <= wakeAt) low = middle + 1; else high = middle;
  }
  wakeEntries.splice(low, 0, { orderId, wakeAt });
}

/** Ids of the queued orders whose wake-up time has come, removed from the list. */
export function takeDueOrderIds(now) {
  const due = [];
  while (wakeEntries.length && wakeEntries[0].wakeAt <= now) {
    const { orderId, wakeAt } = wakeEntries.shift();
    if (wakeAtByOrder.get(orderId) !== wakeAt || !pendingQueue.has(orderId)) continue; // stale
    wakeAtByOrder.delete(orderId);
    due.push(orderId);
  }
  return due;
}

export function sleepingOrderCount() {
  return wakeAtByOrder.size;
}

/** When a near-deadline order stops waiting for the ideal moment and is assigned regardless. */
export function forceAssignAt(order) {
  return order.promisedBy ? new Date(order.promisedBy).getTime() - AGING_LOCK_S * 1000 : Infinity;
}

// The earliest any in-range rider could need to set off: the food's ready time minus the
// longest in-range trip to the restaurant (and the order's small early-arrival grace).
function firstWakeAt(order, now) {
  if (!order.prepReadyAt) return now;
  const longestTrip_s = getH3Config().maxRangeKm / RIDER_SPEED_KMH * 3600;
  const wakeAt = new Date(order.prepReadyAt).getTime() - (longestTrip_s + (order.jitGrace_s ?? 0)) * 1000;
  return Math.max(now, Math.min(wakeAt, forceAssignAt(order)));
}
