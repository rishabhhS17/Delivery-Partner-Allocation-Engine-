// ─── Dispatch engine: public commands ────────────────────────────────────────
// Everything outside src/engine talks to the engine only through this file. The bots in src/sim
// are held to that by tests/engineSimWall.test.js: they play the part of riders' phones and
// customers' apps, so they may report what happened, never reach into engine state.

import { latLngToCell } from 'h3-js';
import { getH3Config, MAX_PENDING_ORDERS } from '../config/constants.js';
import { createOrder } from '../services/orderGenerator.js';
import { riderState, pendingQueue, runtime } from './state.js';
import { _reindexIfBucketed } from './h3Index.js';
import { _arriveAtStop, _completePickup, _dropOrderFromRider } from './riderLifecycle.js';
import { _chooseAssignment } from './dispatch.js';
import { hydrate } from './hydrate.js';
import {
  runExclusive, startDispatchLoop, startBroadcastLoop, startPendingOrderSync, stopLoops,
} from './dispatchLoop.js';
import { _makeOffer, _acceptOffer, _rejectOffer, _withdrawOffer } from './offers.js';
import { _listKitchenTickets, _updatePrepEstimate } from './prepEstimates.js';
import { _applyRiderAvailability } from './riderLifecycle.js';
import { startLeaderElection, resignLeadership, isThisInstanceLeader } from './leaderLease.js';
import { getEngineHealth } from './health.js';
import { enqueueOrder, scheduleWake, dequeueOrder } from './wakeList.js';

// Only the instance holding the leader lease runs the engine (decision E4).
export { startLeaderElection, resignLeadership };
import {
  saveFinalPositions, appendOrderEvent, clearOffer, saveRiderCancellation, loadOrder, saveRestaurantRejection,
  simulateDatabaseOutage as startSimulatedOutage, getSimulatedOutageUntil,
} from './storage.js';
import { subscribe, buildLiveSnapshot, publish } from './broadcast.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('engine');

/**
 * What a rider bot needs to move one rider for one tick.
 * @typedef {Object} RiderTask
 * @property {string} riderId
 * @property {'IDLE'|'ACCEPTED'|'WAITING'|'PICKED_UP'} status
 * @property {number} lat  Current position as the engine last heard it.
 * @property {number} lng
 * @property {number|null} waitingUntil  Epoch ms the food is ready (WAITING riders only).
 * @property {StopRef|null} nextStop  The stop the rider is heading to or waiting at.
 * @property {{ orderId: string, expiresAtMs: number }|null} offer  An order offered to the rider,
 *           waiting for acceptOffer / rejectOffer (no answer by expiresAtMs counts as ignored).
 * @property {RiderLeg|null} leg  The leg toward the next stop; null when there is nothing to do.
 */

/**
 * Which stop a rider report is about, so a repeated report can be recognised.
 * @typedef {Object} StopRef
 * @property {string} orderId
 * @property {'PICKUP'|'DROP'} type
 */

/**
 * What a stop report did.
 * @typedef {'done'|'already_done'|'ignored'} StopReportResult
 *   done: applied now · already_done: a repeat of a report already applied (no change) ·
 *   ignored: not applied — not this rider's current stop, another report for the rider is still
 *   in flight, or the save failed; report again
 */

/**
 * One leg: from where the rider started toward the next stop. The rider's position is a pure
 * function of this and the clock (see utils/polyline.js positionAlongLeg).
 * @typedef {Object} RiderLeg
 * @property {number} originLat
 * @property {number} originLng
 * @property {number} targetLat
 * @property {number} targetLng
 * @property {number} startedAtMs
 * @property {number[][]} coords  Road route as [lng, lat] points; empty until it is fetched
 *                                (the rider then moves in a straight line).
 */

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/** Load state from the database and start dispatching and broadcasting. */
export async function startEngine() {
  if (runtime.running) return;
  await hydrate();
  runtime.running = true;
  startDispatchLoop();
  startBroadcastLoop();
  startPendingOrderSync();
  publish('simulation:status', { running: true });
  log.info('engine started');
}

/**
 * Stop dispatching and save every rider's final position once (decision B5). Called on
 * shutdown (SIGTERM); waits for a dispatch round in progress to finish first.
 */
export async function stopEngine() {
  if (!runtime.running) return;
  runtime.running = false;
  stopLoops();
  await runExclusive(() => saveFinalPositions([...riderState.entries()]));
  log.info('engine stopped, final rider positions saved', { riders: riderState.size });
}

// ─── Live feed ───────────────────────────────────────────────────────────────

/**
 * Everything a browser needs to draw the current state from scratch: the fleet, queue depth,
 * active route lines and recent assignments. Sent first on every (re)connection.
 */
export function getLiveSnapshot() {
  return buildLiveSnapshot();
}

/**
 * Receive every live event (the fleet each second, order events as they happen) until the
 * returned function is called. `send` gets the event name and its payload as a JSON string.
 * @param {(event: string, json: string) => void} send
 * @returns {() => void} unsubscribe
 */
export function subscribeToLiveFeed(send) {
  return subscribe(send);
}

/** Health numbers for GET /api/health: event-loop delay, tick times, queues, DB latency. */
export async function getHealth() {
  return { isLeader: isThisInstanceLeader(), ...(await getEngineHealth()) };
}

/** @returns {{ running: boolean, isLeader: boolean, riderCount: number, queueDepth: number }} */
export function getStatus() {
  return {
    running: runtime.running, isLeader: isThisInstanceLeader(),
    riderCount: riderState.size, queueDepth: pendingQueue.size,
  };
}

// ─── Orders ──────────────────────────────────────────────────────────────────

/**
 * Queue an order the engine should dispatch. Always queues: an order that arrives while the
 * engine is still hydrating is either loaded from the DB by hydrate or queued here afterwards.
 */
export function addPendingOrder(order) {
  enqueueOrder(order);
  appendOrderEvent(order._id, 'created', {
    details: { restaurantName: order.restaurantName, customerName: order.customerName, prepReadyAt: order.prepReadyAt },
  });
}

/** False once MAX_PENDING_ORDERS orders are waiting: new orders are refused until it drains. */
export function canAcceptOrders(count = 1) {
  return pendingQueue.size + count <= MAX_PENDING_ORDERS;
}

/**
 * Create an order (random customer + restaurant pair unless both ids are given) and queue it.
 * Throws an error with statusCode 503 when the queue is full (see canAcceptOrders).
 * @param {{ customerId?: string, restaurantId?: string }} [request]
 */
export async function placeOrder(request = {}) {
  if (!canAcceptOrders()) {
    const err = new Error('Too many orders are waiting for a rider — try again shortly');
    err.statusCode = 503;
    throw err;
  }
  const order = await createOrder(request);
  addPendingOrder(order);
  return order;
}

/**
 * Dispatch one queued order right now, skipping the just-in-time wait (manual dispatch).
 * Waits its turn behind any dispatch round in progress.
 * The chosen rider is offered it and may refuse, like any other order.
 * @returns {Promise<{ status: 'not_pending' } | { status: 'no_rider', orderId: string }
 *          | { status: 'offered', orderId: string, riderId: string, riderName: string }>}
 */
export function dispatchNow(orderId) {
  return runExclusive(async () => {
    const id = orderId.toString();
    const order = pendingQueue.get(id);
    if (!order) return { status: 'not_pending' };
    const openOfferRider = riderOfOpenOffer(id);
    if (openOfferRider) return { status: 'offered', orderId: id, ...openOfferRider };
    const decision = _chooseAssignment(id, order, Date.now(), { skipJitHold: true });
    if (decision.kind !== 'assign') return { status: 'no_rider', orderId: id };
    if (await _makeOffer(decision)) {
      return { status: 'offered', orderId: id, riderId: decision.winnerId, riderName: riderState.get(decision.winnerId)?.name };
    }
    // The save may have found the order already changed and dropped it from the queue.
    return pendingQueue.has(id) ? { status: 'no_rider', orderId: id } : { status: 'not_pending' };
  });
}

// ─── Kitchen (what a restaurant's tablet would send) ─────────────────────────

/**
 * Orders the kitchens are still preparing (not yet picked up).
 * @returns {{ orderId: string, placedAt: Date, foodReadyAt: Date, riderId: string|null }[]}
 */
export function getKitchenTickets() {
  return _listKitchenTickets();
}

/**
 * The kitchen's new estimate of when the food is ready; dispatch re-plans (decision H1).
 * @returns {Promise<'updated'|'not_found'|'failed'>}
 */
export function updatePrepEstimate(orderId, foodReadyAt) {
  return runExclusive(() => _updatePrepEstimate(String(orderId), foodReadyAt));
}

/**
 * The restaurant turns the order down (decision H3). Allowed until pickup: the order is
 * cancelled with reason 'restaurant_rejected', and a rider already heading there moves on.
 * @returns {Promise<'cancelled'|'not_found'|'failed'>}
 */
export function restaurantRejectedOrder(orderId) {
  return runExclusive(async () => {
    const oid = String(orderId);
    const pendingOrder = pendingQueue.get(oid);
    let carrierId = null;
    for (const [riderId, rider] of riderState) {
      const meta = rider.orders.get(oid);
      if (meta && !meta.pickedUp) carrierId = riderId;
    }
    if (!pendingOrder && !carrierId) return 'not_found';
    const now = Date.now();
    let isSaved;
    try {
      isSaved = await saveRestaurantRejection(pendingOrder?._id ?? riderState.get(carrierId).orders.get(oid)._id, now);
    } catch (err) {
      log.error('restaurant rejection write failed', { orderId: oid, error: err.message });
      return 'failed';
    }
    if (!isSaved) return 'not_found';

    if (pendingOrder) {
      dequeueOrder(oid);
      _withdrawOffer(oid);
    } else {
      _dropOrderFromRider(carrierId, riderState.get(carrierId), oid, now);
    }
    appendOrderEvent(oid, 'cancelled', { riderId: carrierId, details: { reason: 'restaurant_rejected' } });
    publish('order:cancelled', { orderId: oid, reason: 'restaurant_rejected' });
    log.warn('restaurant rejected the order, cancelled', { orderId: oid, riderId: carrierId });
    return 'cancelled';
  });
}

// ─── Presenter test hook ─────────────────────────────────────────────────────

/**
 * Make every engine database call fail for durationMs, as in a real outage: dispatch pauses,
 * riders keep moving, and it all resumes on its own (decision I3).
 * @returns {number} epoch ms the simulated outage ends
 */
export function simulateDatabaseOutage(durationMs) {
  log.warn('simulated database outage started', { durationMs });
  return startSimulatedOutage(durationMs);
}

/** @returns {number|null} epoch ms the simulated outage ends, or null when there is none */
export function getDatabaseOutageEnd() {
  return getSimulatedOutageUntil();
}

// ─── Rider availability ──────────────────────────────────────────────────────

/**
 * A rider went online or offline (already saved to the database). Online: they join the live
 * fleet and can be offered orders at once. Offline: they get no new orders; an idle rider leaves
 * the fleet at once, a busy one finishes what they carry first.
 * @param {string} riderId
 * @param {'ONLINE'|'OFFLINE'} availabilityStatus
 */
export function setRiderAvailability(riderId, availabilityStatus) {
  if (!runtime.running) return Promise.resolve(); // not the dispatcher: it loads riders at startup
  const id = riderId.toString();
  return runExclusive(async () => {
    // An offline rider can't answer: their open offer goes straight back to dispatch.
    const openOfferOrderId = riderState.get(id)?.openOffer?.orderId;
    if (availabilityStatus === 'OFFLINE' && openOfferOrderId) {
      await clearOffer(pendingQueue.get(openOfferOrderId)?._id ?? openOfferOrderId, {});
      _withdrawOffer(openOfferOrderId);
      if (pendingQueue.has(openOfferOrderId)) scheduleWake(openOfferOrderId, Date.now());
    }
    await _applyRiderAvailability(id, availabilityStatus);
  });
}

// ─── Offers (what a rider's phone would send) ────────────────────────────────

/**
 * The rider accepts the order they were offered; it is then assigned to them.
 * @returns {Promise<'assigned'|'not_offered'|'failed'>}  failed: the save failed, accept again
 */
export function acceptOffer(riderId, orderId) {
  return runExclusive(() => _acceptOffer(String(riderId), String(orderId)));
}

/**
 * The rider turns the order down; they will never be offered that order again.
 * @returns {Promise<'rejected'|'not_offered'|'failed'>}
 */
export function rejectOffer(riderId, orderId) {
  return runExclusive(() => _rejectOffer(String(riderId), String(orderId)));
}

/**
 * The rider cancels an order they accepted — allowed only before pickup (decision G2). The order
 * goes straight back to dispatch, and this rider is not offered it again.
 * @returns {Promise<'cancelled'|'not_allowed'|'failed'>}
 *   not_allowed: already picked up, or not this rider's order · failed: the save failed, try again
 */
export function riderCancelledOrder(riderId, orderId) {
  return runExclusive(async () => {
    const id = String(riderId);
    const oid = String(orderId);
    const rider = riderState.get(id);
    const meta = rider?.orders.get(oid);
    if (!meta || meta.pickedUp) return 'not_allowed';
    const now = Date.now();
    let isSaved;
    try {
      isSaved = await saveRiderCancellation(meta._id, rider._id, now);
    } catch (err) {
      log.error('rider cancellation write failed', { orderId: oid, riderId: id, error: err.message });
      return 'failed';
    }
    if (!isSaved) return 'not_allowed';

    _dropOrderFromRider(id, rider, oid, now);
    appendOrderEvent(meta._id, 'rider_cancelled', { riderId: rider._id });
    publish('order:rider_cancelled', { orderId: oid, riderId: id, riderName: rider.name });
    log.info('rider cancelled before pickup, order back in dispatch', { orderId: oid, riderId: id });
    const order = await loadOrder(meta._id).catch(() => null);
    if (order) {
      enqueueOrder(order, now);
      scheduleWake(oid, now); // look for another rider at once
    } // else the PENDING order is picked up by the pending-order sync within seconds
    return 'cancelled';
  });
}

function riderOfOpenOffer(orderId) {
  for (const [riderId, rider] of riderState) {
    if (rider.openOffer?.orderId === orderId) return { riderId, riderName: rider.name };
  }
  return null;
}

// ─── Rider reports (what a rider's phone would send) ────────────────────────

/** @returns {RiderTask[]} One entry per live rider. */
export function getRiderTasks() {
  const tasks = [];
  for (const [riderId, rider] of riderState) {
    const head = rider.stops[0];
    const hasLeg = head && rider.status !== 'WAITING' && rider.legStartedAt;
    tasks.push({
      riderId,
      status:       rider.status,
      lat:          rider.lat,
      lng:          rider.lng,
      waitingUntil: rider.status === 'WAITING' ? (rider.waitingUntil ?? 0) : null,
      nextStop:     head ? { orderId: head.orderId.toString(), type: head.type } : null,
      offer:        rider.openOffer ?? null,
      leg: hasLeg ? {
        originLat:   rider.legOriginLat,
        originLng:   rider.legOriginLng,
        targetLat:   head.lat,
        targetLng:   head.lng,
        startedAtMs: rider.legStartedAt.getTime(),
        coords:      rider.legCoords,
      } : null,
    });
  }
  return tasks;
}

/**
 * A rider moved. `segmentIdx` is how far along the road route they are (used by the maps to
 * trim the drawn route).
 */
export function reportRiderPosition(riderId, lat, lng, segmentIdx = 0) {
  const rider = riderState.get(riderId);
  if (!rider) return;
  rider.lat = lat;
  rider.lng = lng;
  rider.currentSegmentIdx = segmentIdx;
  rider.h3Index = latLngToCell(lat, lng, getH3Config().resolution);
  _reindexIfBucketed(riderId, rider);
}

// Has this stop already been completed? A pickup is done once the food is on board (or the
// order is gone from the rider because it was delivered); a drop once the order is gone.
function isStopAlreadyDone(rider, stop) {
  const meta = rider.orders.get(stop.orderId);
  return stop.type === 'PICKUP' ? !meta || meta.pickedUp : !meta;
}

// A stop report changes the rider's itinerary, so it waits its turn behind dispatch (an
// assignment never interleaves with a pickup or delivery). Reports name their stop: a repeat of
// one already applied (a phone retrying a request) is a no-op success (decision E1). Only one
// report per rider is in flight; a bot reporting again meanwhile is ignored and simply reports
// again next tick.
function reportStop(riderId, stop, isExpectedState, handle) {
  const rider = riderState.get(riderId);
  if (!rider) return Promise.resolve('ignored');
  if (isStopAlreadyDone(rider, stop)) return Promise.resolve('already_done');
  if (rider.isReportingStop) return Promise.resolve('ignored');
  rider.isReportingStop = true;
  return runExclusive(async () => {
    if (isStopAlreadyDone(rider, stop)) return 'already_done';
    const head = rider.stops[0];
    const isHeadStop = head && String(head.orderId) === stop.orderId && head.type === stop.type;
    if (!isHeadStop || !isExpectedState(rider)) return 'ignored';
    rider.lat = head.lat;
    rider.lng = head.lng;
    await handle(rider);
    return isStopAlreadyDone(rider, stop) || rider.status === 'WAITING' ? 'done' : 'ignored';
  }).finally(() => { rider.isReportingStop = false; });
}

/**
 * A rider reached a stop (restaurant or customer).
 * @param {string} riderId
 * @param {StopRef} stop
 * @returns {Promise<StopReportResult>}
 */
export function riderArrived(riderId, stop) {
  return reportStop(riderId, stop, rider => rider.status !== 'WAITING',
    rider => _arriveAtStop(riderId, rider, Date.now()));
}

/**
 * A rider waiting at the restaurant collected the food for an order.
 * @param {string} riderId
 * @param {string} orderId
 * @returns {Promise<StopReportResult>}
 */
export function riderCollectedFood(riderId, orderId) {
  return reportStop(riderId, { orderId: String(orderId), type: 'PICKUP' }, rider => rider.status === 'WAITING',
    rider => _completePickup(riderId, rider, Date.now()));
}
