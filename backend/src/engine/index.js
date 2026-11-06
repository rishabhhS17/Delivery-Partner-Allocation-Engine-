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
import { runExclusive, startDispatchLoop, startBroadcastLoop } from './dispatchLoop.js';

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
 * One leg: from where the rider started toward the next stop.
 * @typedef {Object} RiderLeg
 * @property {number} key  Changes whenever the leg (or its road route) is replaced.
 * @property {number} originLat
 * @property {number} originLng
 * @property {number} targetLat
 * @property {number} targetLng
 * @property {number} startedAtMs
 * @property {number} duration_s  Used for straight-line movement when there is no road route.
 * @property {number[][]} coords  Road route as [lng, lat] points; empty until it is fetched.
 * @property {number} startSegmentIdx  Progress along coords when this leg key began.
 * @property {number} startDistanceOnSegment
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
  if (runtime.io) runtime.io.emit('simulation:status', { running: true });
  console.log('[engine] started');
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
    const hasLeg = head && rider.status !== 'WAITING' && rider.legStartedAt && rider.legDuration_s != null;
    tasks.push({
      riderId,
      status:       rider.status,
      lat:          rider.lat,
      lng:          rider.lng,
      waitingUntil: rider.status === 'WAITING' ? (rider.waitingUntil ?? 0) : null,
      leg: hasLeg ? {
        key:                    rider.legKey,
        originLat:              rider.legOriginLat,
        originLng:              rider.legOriginLng,
        targetLat:              head.lat,
        targetLng:              head.lng,
        startedAtMs:            rider.legStartedAt.getTime(),
        duration_s:             rider.legDuration_s,
        coords:                 rider.legCoords,
        startSegmentIdx:        rider.legStartSegmentIdx ?? 0,
        startDistanceOnSegment: rider.legStartDistanceOnSegment ?? 0,
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
