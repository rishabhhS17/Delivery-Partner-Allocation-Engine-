// ─── Dispatch engine: public commands ────────────────────────────────────────
// Everything outside src/engine talks to the engine only through this file. The bots in src/sim
// are held to that by tests/engineSimWall.test.js: they play the part of riders' phones and
// customers' apps, so they may report what happened, never reach into engine state.

import { latLngToCell } from 'h3-js';
import { getH3Config } from '../config/constants.js';
import { createOrder } from '../services/orderGenerator.js';
import { riderState, pendingQueue, activeRoutes, recentAssignments, runtime } from './state.js';
import { _reindexIfBucketed } from './h3Index.js';
import { _arriveAtStop, _completePickup } from './riderLifecycle.js';
import { _chooseAssignment, _commitAssignment } from './dispatch.js';
import { hydrate } from './hydrate.js';
import { runExclusive, startDispatchLoop, startBroadcastLoop, stopLoops } from './dispatchLoop.js';
import { saveFinalPositions, appendOrderEvent } from './storage.js';
import { subscribe, buildLiveSnapshot, publish } from './broadcast.js';

/**
 * What a rider bot needs to move one rider for one tick.
 * @typedef {Object} RiderTask
 * @property {string} riderId
 * @property {'IDLE'|'ACCEPTED'|'WAITING'|'PICKED_UP'} status
 * @property {number} lat  Current position as the engine last heard it.
 * @property {number} lng
 * @property {number|null} waitingUntil  Epoch ms the food is ready (WAITING riders only).
 * @property {RiderLeg|null} leg  The leg toward the next stop; null when there is nothing to do.
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

/** Attach the Socket.IO server the engine broadcasts on. */
export function initEngine(io) {
  runtime.io = io;
  io.on('connection', (socket) => {
    socket.emit('simulation:status', { running: runtime.running });
    for (const [orderId, route] of activeRoutes) {
      socket.emit('order:route', { orderId, ...route });
    }
    if (recentAssignments.length) {
      socket.emit('recent:assignments', recentAssignments);
    }
  });
}

/** Load state from the database and start dispatching and broadcasting. */
export async function startEngine() {
  if (runtime.running) return;
  await hydrate();
  runtime.running = true;
  startDispatchLoop();
  startBroadcastLoop();
  publish('simulation:status', { running: true });
  console.log('[engine] started');
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
  console.log(`[engine] stopped — saved ${riderState.size} rider positions`);
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

/** @returns {{ running: boolean, riderCount: number, queueDepth: number }} */
export function getStatus() {
  return { running: runtime.running, riderCount: riderState.size, queueDepth: pendingQueue.size };
}

// ─── Orders ──────────────────────────────────────────────────────────────────

/**
 * Queue an order the engine should dispatch. Always queues: an order that arrives while the
 * engine is still hydrating is either loaded from the DB by hydrate or queued here afterwards.
 */
export function addPendingOrder(order) {
  pendingQueue.set(order._id.toString(), order);
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
    const assignment = decision ? await _commitAssignment(decision) : null;
    if (assignment) return { status: 'assigned', orderId: id, ...assignment };
    // The save may have found the order already changed and dropped it from the queue.
    return pendingQueue.has(id) ? { status: 'no_rider', orderId: id } : { status: 'not_pending' };
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

/** A rider reached their next stop (restaurant or customer). */
export function riderArrived(riderId) {
  const rider = riderState.get(riderId);
  const head = rider?.stops[0];
  if (!head || rider.status === 'WAITING') return;
  rider.lat = head.lat;
  rider.lng = head.lng;
  _arriveAtStop(riderId, rider, Date.now());
}

/** A rider waiting at the restaurant collected the food. */
export function riderCollectedFood(riderId) {
  const rider = riderState.get(riderId);
  const head = rider?.stops[0];
  if (!head || rider.status !== 'WAITING') return;
  rider.lat = head.lat;
  rider.lng = head.lng;
  _completePickup(riderId, rider, Date.now());
}
