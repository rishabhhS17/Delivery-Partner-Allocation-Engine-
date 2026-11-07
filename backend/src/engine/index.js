// ─── Dispatch engine: public commands ────────────────────────────────────────
// Everything outside src/engine talks to the engine only through this file. The bots in src/sim
// are held to that by tests/engineSimWall.test.js: they play the part of riders' phones and
// customers' apps, so they may report what happened, never reach into engine state.

import { latLngToCell } from 'h3-js';
import { getH3Config } from '../config/constants.js';
import { createOrder } from '../services/orderGenerator.js';
import { riderState, pendingQueue, runtime } from './state.js';
import { _reindexIfBucketed, _syncIndex } from './h3Index.js';
import { _arriveAtStop, _completePickup } from './riderLifecycle.js';
import { _chooseAssignment, _commitAssignment } from './dispatch.js';
import { hydrate, _buildEntry } from './hydrate.js';
import {
  runExclusive, startDispatchLoop, startBroadcastLoop, startPendingOrderSync, stopLoops,
} from './dispatchLoop.js';
import { startLeaderElection, resignLeadership, isThisInstanceLeader } from './leaderLease.js';
import { getEngineHealth } from './health.js';
import { enqueueOrder } from './wakeList.js';

// Only the instance holding the leader lease runs the engine (decision E4).
export { startLeaderElection, resignLeadership };
import { saveFinalPositions, appendOrderEvent, loadRider } from './storage.js';
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

/**
 * Create an order (random customer + restaurant pair unless both ids are given) and queue it.
 * @param {{ customerId?: string, restaurantId?: string }} [request]
 */
export async function placeOrder(request = {}) {
  const order = await createOrder(request);
  addPendingOrder(order);
  return order;
}

/**
 * Dispatch one queued order right now, skipping the just-in-time wait (manual dispatch).
 * Waits its turn behind any dispatch round in progress.
 * @returns {Promise<{ status: 'not_pending' } | { status: 'no_rider', orderId: string }
 *          | { status: 'assigned', orderId: string, riderId: string, riderName: string,
 *              score: number, breakdown: object, candidatesConsidered: number }>}
 */
export function dispatchNow(orderId) {
  return runExclusive(async () => {
    const id = orderId.toString();
    const order = pendingQueue.get(id);
    if (!order) return { status: 'not_pending' };
    const decision = _chooseAssignment(id, order, Date.now(), { skipJitHold: true });
    const assignment = decision.kind === 'assign' ? await _commitAssignment(decision) : null;
    if (assignment) return { status: 'assigned', orderId: id, ...assignment };
    // The save may have found the order already changed and dropped it from the queue.
    return pendingQueue.has(id) ? { status: 'no_rider', orderId: id } : { status: 'not_pending' };
  });
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
    let rider = riderState.get(id);
    if (availabilityStatus === 'ONLINE' && !rider) {
      const riderDoc = await loadRider(id);
      if (!riderDoc) return;
      rider = _buildEntry(riderDoc);
      rider.status = 'IDLE';
      riderState.set(id, rider);
    }
    if (!rider) return;
    rider.availabilityStatus = availabilityStatus;
    _syncIndex(id, rider); // offline → out of the search index, online → in it
    if (availabilityStatus === 'OFFLINE' && rider.orders.size === 0) riderState.delete(id);
  });
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
