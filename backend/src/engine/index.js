// ─── Dispatch engine: public commands ────────────────────────────────────────
// Everything outside src/engine talks to the engine only through this file. The bots in src/sim
// are held to that by tests/engineSimWall.test.js: they play the part of riders' phones and
// customers' apps, so they may report what happened, never reach into engine state.

import { latLngToCell } from 'h3-js';
import { TICK_INTERVAL_MS, getH3Config } from '../config/constants.js';
import { createOrder } from '../services/orderGenerator.js';
import { riderState, pendingQueue, activeRoutes, recentAssignments, runtime } from './state.js';
import { _meta, _stopsForMeta } from './itinerary.js';
import { _syncIndex, _reindexIfBucketed } from './h3Index.js';
import { _beginLegToHead, _arriveAtStop, _completePickup } from './riderLifecycle.js';
import { hydrate, _sweepOrphanedOrders } from './hydrate.js';
import { tick } from './dispatchTick.js';

const ORPHAN_SWEEP_INTERVAL_MS = 30_000;

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

/** Load state from the database and start the dispatch tick. */
export async function startEngine() {
  if (runtime.running) return;
  await hydrate();
  runtime.running   = true;
  runtime.tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  runtime.healTimer = setInterval(() => {
    _sweepOrphanedOrders().catch(err => console.error('[engine] orphan sweep failed:', err.message));
  }, ORPHAN_SWEEP_INTERVAL_MS);
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

// Manual admin path: append a second order to a BUSY rider's itinerary (simple append — the tick
// is the primary, cheapest-insertion clubber; this is a fallback). Only reached if a busy winner
// is ever passed; the manual route currently scores IDLE riders only.
export function queueNextOrder(riderId, order) {
  if (!runtime.running) return;
  const id = riderId.toString();
  const rider = riderState.get(id);
  if (!rider || !order?.restaurantLat) return;
  const oid = order._id.toString();
  rider.orders.set(oid, _meta(order));
  rider.stops = [...rider.stops, ..._stopsForMeta(rider.orders.get(oid))];
  rider.nextLegCoords = [];
  rider.currentOrderId = rider.stops[0]?.orderId ?? rider.currentOrderId;
  pendingQueue.delete(oid);
  _syncIndex(id, rider);
}

// Sync in-memory state after a manual IDLE allocation so the next tick doesn't double-assign.
// Receives the full order doc so the stop-list can be built.
export function syncManualAllocation(riderId, order) {
  const id = riderId.toString();
  const rider = riderState.get(id);
  if (!rider || !order?.restaurantLat) return; // sim not running, or only an id was passed
  const oid = order._id.toString();
  rider.orders.set(oid, _meta(order));
  rider.stops = _stopsForMeta(rider.orders.get(oid));
  rider.currentOrderId = order._id;
  rider.nextLegCoords = [];
  pendingQueue.delete(oid);
  _syncIndex(id, rider);
  _beginLegToHead(rider, Date.now(), id);
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
