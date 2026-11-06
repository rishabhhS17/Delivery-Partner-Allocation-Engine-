import { TICK_INTERVAL_MS } from '../../config/constants.js';
import { startAutoOrderJob } from '../orderGenerator.js';
import { riderState, pendingQueue, activeRoutes, recentAssignments, runtime } from './state.js';
import { _meta, _stopsForMeta } from './itinerary.js';
import { _syncIndex } from './h3Index.js';
import { _beginLegToHead } from './riderTrip.js';
import { hydrate, _sweepOrphanedOrders } from './hydrate.js';
import { tick } from './tick.js';

const ORPHAN_SWEEP_INTERVAL_MS = 30_000;

// ─── Public API ──────────────────────────────────────────────────────────────

export function initSimulation(io) {
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

export async function startSimulation() {
  if (runtime.running) return;
  await hydrate();
  runtime.running   = true;
  runtime.tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  runtime.healTimer = setInterval(() => {
    _sweepOrphanedOrders().catch(err => console.error('[sim] orphan sweep failed:', err.message));
  }, ORPHAN_SWEEP_INTERVAL_MS);
  startAutoOrderJob(addPendingOrder);
  if (runtime.io) runtime.io.emit('simulation:status', { running: true });
  console.log('[sim] started');
}

export function getStatus() {
  return { running: runtime.running, riderCount: riderState.size, queueDepth: pendingQueue.size };
}

// Always queue: the simulation runs whenever the server runs. An order that arrives while the
// engine is still hydrating is either loaded from the DB by hydrate or queued here afterwards.
export function addPendingOrder(order) {
  pendingQueue.set(order._id.toString(), order);
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
