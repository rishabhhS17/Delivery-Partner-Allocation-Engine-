import { latLngToCell } from 'h3-js';
import {
  getCandidateCells,
  allocateClub,
  pickupStop,
  dropStop,
  bearing,
  bearingDiff,
} from './allocationEngine.js';
import { getRoute } from './routingService.js';
import {
  getWeights,
  RIDER_SPEED_KMH,
  TICK_INTERVAL_MS,
  getH3Config,
  getOrderTtl,
  CLUBBING_CAP,
  CLUBBING_RESTAURANT_RADIUS_KM,
  CLUBBING_DROP_RADIUS_KM,
  CLUBBING_BEARING_TOLERANCE_DEG,
  AGING_LOCK_S,
} from '../config/constants.js';
import { haversine } from '../utils/haversine.js';
import Rider from '../models/Rider.js';
import Order from '../models/Order.js';
import AllocationHistory from '../models/AllocationHistory.js';
import { startAutoOrderJob, stopAutoOrderJob } from './orderGenerator.js';

// ─── In-memory state ─────────────────────────────────────────────────────────

const riderState        = new Map();   // riderId(string) → riderEntry
const h3Buckets         = new Map();   // h3Cell(string)  → Set<riderId(string)>
const pendingQueue      = new Map();   // orderId(string)  → orderDoc
const activeRoutes      = new Map();   // orderId(string)  → { riderId, leg1Coords, leg2Coords }
const recentAssignments = [];          // capped ring-buffer of last 20 order:assigned payloads
const RECENT_CAP        = 20;

let tickTimer = null;
let healTimer = null;
let ioRef     = null;
let running   = false;

const ORPHAN_SWEEP_INTERVAL_MS = 30_000;
const ORPHAN_GRACE_MS          = 20_000;

// ─── Public API ──────────────────────────────────────────────────────────────

export function initSimulation(io) {
  ioRef = io;
  io.on('connection', (socket) => {
    socket.emit('simulation:status', { running });
    for (const [orderId, route] of activeRoutes) {
      socket.emit('order:route', { orderId, ...route });
    }
    if (recentAssignments.length) {
      socket.emit('recent:assignments', recentAssignments);
    }
  });
}

export async function startSimulation() {
  if (running) return;
  await hydrate();
  running   = true;
  tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  healTimer = setInterval(() => {
    _sweepOrphanedOrders().catch(err => console.error('[sim] orphan sweep failed:', err.message));
  }, ORPHAN_SWEEP_INTERVAL_MS);
  startAutoOrderJob(addPendingOrder);
  if (ioRef) ioRef.emit('simulation:status', { running: true });
  console.log('[sim] started');
}

export async function stopSimulation() {
  if (!running) return;
  clearInterval(tickTimer);
  tickTimer = null;
  clearInterval(healTimer);
  healTimer = null;
  running   = false;
  stopAutoOrderJob();

  // Flush current in-memory state to DB so restarts always have a clean baseline.
  const writes = [];
  for (const [riderId, rider] of riderState) {
    writes.push(
      Rider.findByIdAndUpdate(riderId, {
        status:          rider.status,
        currentOrderId:  rider.currentOrderId ?? null,
        onboardOrderIds: _onboardIdsFromStops(rider),
        activeOrders:    rider.orders.size,
        latitude:        rider.lat,
        longitude:       rider.lng,
        h3Index:         rider.h3Index,
        deliveryTimestamps: rider.deliveryTimestamps,
      }).catch(err => console.error('[sim] flush write failed for', rider.name, ':', err.message))
    );
  }
  await Promise.allSettled(writes);
  if (ioRef) ioRef.emit('simulation:status', { running: false });
  console.log(`[sim] stopped + flushed ${riderState.size} riders to DB`);
}

export function getStatus() {
  return { running, riderCount: riderState.size, queueDepth: pendingQueue.size };
}

export function isSimulationRunning() {
  return running;
}

export function addPendingOrder(order) {
  if (!running) return;
  pendingQueue.set(order._id.toString(), order);
}

// Manual admin path: append a second order to a BUSY rider's itinerary (simple append — the tick
// is the primary, cheapest-insertion clubber; this is a fallback). Only reached if a busy winner
// is ever passed; the manual route currently scores IDLE riders only.
export function queueNextOrder(riderId, order) {
  if (!running) return;
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

// ─── Order / stop helpers ──────────────────────────────────────────────────────

function _meta(order) {
  return {
    _id:           order._id,
    restaurantLat: order.restaurantLat, restaurantLng: order.restaurantLng,
    customerLat:   order.customerLat,   customerLng:   order.customerLng,
    prepReadyAt:   order.prepReadyAt,   promisedBy:    order.promisedBy,
    jitGrace_s:    order.jitGrace_s ?? 0,
    pickedUp:      order.status === 'PICKED_UP',
  };
}

// meta carries {_id, restaurantLat/Lng, customerLat/Lng, prepReadyAt, promisedBy} — exactly what
// pickupStop/dropStop read — so they build stops directly from a meta.
function _stopsForMeta(meta) {
  return meta.pickedUp ? [dropStop(meta)] : [pickupStop(meta), dropStop(meta)];
}

// A rider stays discoverable in the H3 index while it has a free slot (Stage 2).
function _freeSlot(rider) {
  return rider.orders.size < CLUBBING_CAP;
}

// Unique order ids in itinerary order (first appearance in the stop-list) — persisted so hydrate
// can rebuild an N-order stop-list.
function _onboardIdsFromStops(rider) {
  const seen = new Set();
  const ids = [];
  for (const s of rider.stops) {
    const id = s.orderId.toString();
    if (!seen.has(id)) { seen.add(id); ids.push(s.orderId); }
  }
  return ids;
}

// ─── Hydration ───────────────────────────────────────────────────────────────

async function _healOrphanedRiders() {
  const orphaned = await Rider.find({
    availabilityStatus: 'ONLINE',
    status: { $in: ['ACCEPTED', 'WAITING', 'PICKED_UP'] },
    currentOrderId: null,
    onboardOrderIds: { $size: 0 },
  });
  if (!orphaned.length) return;

  const orphanedIds = orphaned.map(r => r._id);
  console.warn(`[sim] healing ${orphaned.length} orphaned rider(s):`, orphaned.map(r => r.name).join(', '));

  await Promise.all([
    Rider.updateMany(
      { _id: { $in: orphanedIds } },
      { status: 'IDLE', currentOrderId: null, activeOrders: 0, onboardOrderIds: [] }
    ),
    Order.updateMany(
      { assignedRiderId: { $in: orphanedIds }, status: 'ASSIGNED' },
      { $set: { status: 'PENDING', assignedRiderId: null, assignedAt: null, queuedAt: new Date() } }
    ),
    Order.updateMany(
      { assignedRiderId: { $in: orphanedIds }, status: 'PICKED_UP' },
      { $set: { status: 'PENDING', assignedRiderId: null, assignedAt: null, queuedAt: new Date() } }
    ),
  ]);
}

// Two classes of orphaned orders the rider-side healer misses (unchanged from the two-leg engine):
// ASSIGNED orders with no live ACCEPTED rider, and stuck PICKED_UP orders — both re-queued PENDING.
async function _healOrphanedOrders() {
  const assignedOrders = await Order.find({ status: 'ASSIGNED' }).lean();
  if (assignedOrders.length) {
    const riderIds     = [...new Set(assignedOrders.map(o => o.assignedRiderId?.toString()).filter(Boolean))];
    const activeRiders = await Rider.find({ _id: { $in: riderIds } })
      .select('_id onboardOrderIds currentOrderId').lean();
    const onboardByRider = new Map(
      activeRiders.map(r => [
        r._id.toString(),
        new Set([...(r.onboardOrderIds ?? []).map(x => x.toString()),
                 ...(r.currentOrderId ? [r.currentOrderId.toString()] : [])]),
      ])
    );

    const toRequeue = assignedOrders.filter(o => {
      const rid = o.assignedRiderId?.toString();
      return !rid || !onboardByRider.get(rid)?.has(o._id.toString());
    });

    if (toRequeue.length) {
      console.warn(`[sim] re-queuing ${toRequeue.length} orphaned ASSIGNED order(s) → PENDING`);
      await Order.updateMany(
        { _id: { $in: toRequeue.map(o => o._id) } },
        { $set: { status: 'PENDING', assignedRiderId: null, assignedAt: null, queuedAt: new Date() } }
      );
    }
  }

  const stuck = await Order.find({ status: 'PICKED_UP' }).lean();
  if (!stuck.length) return;

  const pickupRiderIds = [...new Set(stuck.map(o => o.assignedRiderId?.toString()).filter(Boolean))];
  const active = await Rider.find({ _id: { $in: pickupRiderIds } })
    .select('_id onboardOrderIds currentOrderId').lean();
  const onboardByRider = new Map(
    active.map(r => [
      r._id.toString(),
      new Set([...(r.onboardOrderIds ?? []).map(x => x.toString()),
               ...(r.currentOrderId ? [r.currentOrderId.toString()] : [])]),
    ])
  );

  const stuckOrphans = stuck.filter(o => !onboardByRider.get(o.assignedRiderId?.toString())?.has(o._id.toString()));
  if (!stuckOrphans.length) return;

  console.warn(`[sim] re-queuing ${stuckOrphans.length} stuck PICKED_UP order(s) → PENDING`);
  await Order.updateMany(
    { _id: { $in: stuckOrphans.map(o => o._id) } },
    { $set: { status: 'PENDING', assignedRiderId: null, assignedAt: null, queuedAt: new Date() } }
  );
}

async function _sweepOrphanedOrders() {
  if (!running) return;
  const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS);

  const liveOrderIds = new Set();
  for (const [, r] of riderState) {
    for (const id of r.orders.keys()) liveOrderIds.add(id);
  }

  const active = await Order.find({
    status: { $in: ['ASSIGNED', 'PICKED_UP'] },
    assignedAt: { $lt: cutoff },
  });
  for (const ord of active) {
    const idStr = ord._id.toString();
    if (liveOrderIds.has(idStr) || pendingQueue.has(idStr)) continue;

    const wasStatus     = ord.status;
    ord.status          = 'PENDING';
    ord.assignedRiderId = null;
    ord.queuedAt        = new Date();
    pendingQueue.set(idStr, ord);
    await Order.findByIdAndUpdate(ord._id, {
      status: 'PENDING', assignedRiderId: null, assignedAt: null, queuedAt: ord.queuedAt,
    }).catch(err => console.error('[sim] orphan requeue write failed:', err.message));
    console.warn(`[sim] runtime orphan swept → re-queued ${wasStatus} order`, idStr);
  }
}

async function hydrate() {
  await _healOrphanedRiders();
  await _healOrphanedOrders();

  riderState.clear();
  h3Buckets.clear();
  pendingQueue.clear();
  activeRoutes.clear();
  recentAssignments.length = 0;

  const riders = await Rider.find({ availabilityStatus: 'ONLINE' });
  const now = Date.now();

  for (const rider of riders) {
    const id    = rider._id.toString();
    const entry = _buildEntry(rider);

    // Rebuild the onboard set: prefer onboardOrderIds; fall back to currentOrderId/nextOrderId.
    let ids = (rider.onboardOrderIds && rider.onboardOrderIds.length)
      ? rider.onboardOrderIds
      : [rider.currentOrderId, rider.nextOrderId].filter(Boolean);

    let ordered = [];
    if (ids.length) {
      const docs = await Order.find({ _id: { $in: ids }, status: { $in: ['ASSIGNED', 'PICKED_UP'] } });
      const byId = new Map(docs.map(o => [o._id.toString(), o]));
      ordered = ids.map(i => byId.get(i.toString())).filter(Boolean);
    }

    if (ordered.length) {
      // Build the stop-list (sequential per order — a safe restart approximation of interleaving).
      entry.stops = [];
      for (const o of ordered) {
        entry.orders.set(o._id.toString(), _meta(o));
        if (o.status === 'ASSIGNED') entry.stops.push(pickupStop(o));
        entry.stops.push(dropStop(o));
      }
      entry.currentOrderId = entry.stops[0].orderId;
      entry.status = entry.stops[0].type === 'PICKUP' ? 'ACCEPTED' : 'PICKED_UP';

      // Reconstruct the head leg mid-flight (mirrors the two-leg engine's hydrate).
      _reconstructHeadLeg(entry, ordered[0], now);
      entry.h3Index = latLngToCell(entry.lat, entry.lng, getH3Config().resolution);

      if (_freeSlot(entry)) _addToH3(id, entry);
    } else {
      entry.status = 'IDLE';
      _addToH3(id, entry);
    }

    riderState.set(id, entry);
  }

  const pending = await Order.find({ status: 'PENDING' });
  for (const ord of pending) {
    // skip any order already onboard a live rider
    let onboard = false;
    for (const [, r] of riderState) if (r.orders.has(ord._id.toString())) { onboard = true; break; }
    if (!onboard) pendingQueue.set(ord._id.toString(), ord);
  }

  console.log(`[sim] hydrated — ${riderState.size} riders, ${pendingQueue.size} pending orders`);
}

// Reconstruct the rider's current-leg position from the head order's persisted leg data, so a
// restart resumes a rider mid-leg instead of teleporting them. ASSIGNED → leg1 (→restaurant),
// PICKED_UP → leg2 (→customer).
function _reconstructHeadLeg(entry, head, now) {
  const assigned = head.status === 'ASSIGNED';
  const originLat  = assigned ? (head.leg1OriginLat ?? entry.lat) : head.restaurantLat;
  const originLng  = assigned ? (head.leg1OriginLng ?? entry.lng) : head.restaurantLng;
  const destLat    = assigned ? head.restaurantLat : head.customerLat;
  const destLng    = assigned ? head.restaurantLng : head.customerLng;
  const startedAt  = assigned
    ? (head.legStartedAt ? new Date(head.legStartedAt) : new Date(now))
    : (head.pickedUpAt   ? new Date(head.pickedUpAt)   : new Date(now));
  const duration_s = (assigned ? head.leg1Duration_s : head.leg2Duration_s) ?? (assigned ? 60 : 120);
  const legCoords  = (assigned ? head.leg1Coords : head.leg2Coords);
  const coords     = legCoords?.length >= 2 ? legCoords : [];

  Object.assign(entry, {
    legOriginLat: originLat, legOriginLng: originLng,
    legStartedAt: startedAt, legDuration_s: duration_s,
    legCoords: coords, nextLegCoords: [],
    currentSegmentIdx: 0, distanceCoveredOnSegment: 0,
  });

  if (coords.length >= 2) {
    const elapsed_s = (now - startedAt.getTime()) / 1000;
    _preAdvancePolyline(entry, (RIDER_SPEED_KMH / 3.6) * elapsed_s);
    _positionFromPolyline(entry);
  } else {
    const t = Math.min(1, (now - startedAt.getTime()) / (duration_s * 1000));
    entry.lat = originLat + t * (destLat - originLat);
    entry.lng = originLng + t * (destLng - originLng);
  }
}

function _buildEntry(rider) {
  return {
    _id:     rider._id,
    name:    rider.name,
    lat:     rider.latitude,
    lng:     rider.longitude,
    homeLat: rider.latitude,
    homeLng: rider.longitude,
    h3Index: rider.h3Index ?? latLngToCell(rider.latitude, rider.longitude, getH3Config().resolution),
    status:  rider.status,
    availabilityStatus: rider.availabilityStatus,
    deliveryTimestamps: rider.deliveryTimestamps ?? [],

    // Multi-order itinerary
    stops:   [],                 // [{ type, orderId, lat, lng, prepReadyAt?, promisedBy? }, …]
    orders:  new Map(),          // orderId(str) → meta
    currentOrderId: null,        // = stops[0]?.orderId (telemetry / back-compat)
    bucketCell: null,            // the H3 cell this rider is currently indexed under (Stage 2)

    // Current leg (position → stops[0])
    legOriginLat: null, legOriginLng: null,
    legStartedAt: null, legDuration_s: null,
    legCoords: [],               // polyline for the current leg
    nextLegCoords: [],           // prefetched polyline for the following leg (swapped in on arrival)
    currentSegmentIdx: 0,
    distanceCoveredOnSegment: 0,

    // WAITING (parked at a not-yet-ready pickup)
    waitingUntil: null,
    pickupArrivalAt: null,
  };
}

// ─── Tick ─────────────────────────────────────────────────────────────────────

function tick() {
  const now = Date.now();
  const tickRiders = [];

  // Phase 1 — advance positions, resolve WAITING, detect stop completions
  for (const [riderId, rider] of riderState) {
    if (rider.status === 'WAITING') {
      if (now >= (rider.waitingUntil ?? 0)) {
        const head = rider.stops[0];
        if (head) { rider.lat = head.lat; rider.lng = head.lng; }
        _completePickup(riderId, rider, now);
      }
    } else if (rider.stops.length && rider.legStartedAt && rider.legDuration_s != null) {
      const head = rider.stops[0];
      let legComplete;

      if (rider.legCoords.length >= 2) {
        legComplete = _advanceAlongPolyline(rider);
      } else {
        const t = Math.min(1, (now - rider.legStartedAt.getTime()) / (rider.legDuration_s * 1000));
        rider.lat = rider.legOriginLat + t * (head.lat - rider.legOriginLat);
        rider.lng = rider.legOriginLng + t * (head.lng - rider.legOriginLng);
        legComplete = t >= 1;
      }

      rider.h3Index = latLngToCell(rider.lat, rider.lng, getH3Config().resolution);
      _reindexIfBucketed(riderId, rider);

      if (legComplete) {
        rider.lat = head.lat;
        rider.lng = head.lng;
        _arriveAtStop(riderId, rider, now);
      }
    }

    tickRiders.push({
      _id:                riderId,
      name:               rider.name,
      lat:                rider.lat,
      lng:                rider.lng,
      status:             rider.status,
      availabilityStatus: rider.availabilityStatus ?? 'ONLINE',
      orderId:            rider.currentOrderId ? rider.currentOrderId.toString() : null,
      carrying:           rider.orders.size,
      onboardOrderIds:    [...rider.orders.keys()],
      legStepIndex:       rider.currentSegmentIdx ?? 0,
      leg:                rider.status === 'ACCEPTED' ? 'leg1'
                        : rider.status === 'PICKED_UP' ? 'leg2'
                        : null,
    });
  }

  // Phase 1.5 — drop orders that waited too long AFTER becoming dispatchable (TTL fix).
  // Measured from prepReadyAt so a JIT-held order is never cancelled for sitting through prep.
  const ttlCutoff = now - getOrderTtl();
  for (const [orderId, order] of pendingQueue) {
    const dispatchableMs = order.prepReadyAt
      ? new Date(order.prepReadyAt).getTime()
      : ((order.queuedAt ?? order.createdAt)?.getTime?.() ?? now);
    if (dispatchableMs > ttlCutoff) continue;

    pendingQueue.delete(orderId);
    Order.findByIdAndUpdate(order._id, {
      status: 'CANCELLED', cancelledAt: new Date(now), assignedRiderId: null,
    }).catch(err => console.error('[sim] TTL cancel write failed:', err.message));
    if (ioRef) ioRef.emit('order:cancelled', { orderId, reason: 'no_rider' });
    console.warn('[sim] order TTL expired → CANCELLED', orderId);
  }

  // Phase 2 — allocate pending orders (marginal-cost clubbing + JIT hold + force-assign)
  for (const [orderId, order] of pendingQueue) {
    _tryAllocate(orderId, order, now);
  }

  // Phase 3 — broadcast tick
  if (ioRef) {
    ioRef.emit('simulation:tick', {
      riders:     tickRiders,
      queueDepth: pendingQueue.size,
    });
  }
}

// Busy-rider clubbing gate: B's restaurant near the rider's path, and B's drop near an existing
// drop in a compatible direction (drop-to-drop bearing within tolerance).
function _clubbable(rider, order) {
  const restB = { lat: order.restaurantLat, lng: order.restaurantLng };
  const dropB = { lat: order.customerLat,   lng: order.customerLng };

  let nearRest = haversine({ lat: rider.lat, lng: rider.lng }, restB) <= CLUBBING_RESTAURANT_RADIUS_KM;
  if (!nearRest) {
    for (const s of rider.stops) {
      if (haversine({ lat: s.lat, lng: s.lng }, restB) <= CLUBBING_RESTAURANT_RADIUS_KM) { nearRest = true; break; }
    }
  }
  if (!nearRest) return false;

  const origin  = { lat: rider.lat, lng: rider.lng };
  const bearToB = bearing(origin, dropB);
  for (const s of rider.stops) {
    if (s.type !== 'DROP') continue;
    if (haversine({ lat: s.lat, lng: s.lng }, dropB) <= CLUBBING_DROP_RADIUS_KM &&
        bearingDiff(bearing(origin, { lat: s.lat, lng: s.lng }), bearToB) <= CLUBBING_BEARING_TOLERANCE_DEG) {
      return true;
    }
  }
  return false;
}

function _tryAllocate(orderId, order, now) {
  const promisedByMs = order.promisedBy ? new Date(order.promisedBy).getTime() : Infinity;
  const force = (promisedByMs - now) / 1000 <= AGING_LOCK_S; // PENDING anti-starvation backstop

  const cells = getCandidateCells(order.restaurantLat, order.restaurantLng);
  const { maxRangeKm } = getH3Config();
  const restaurant = { lat: order.restaurantLat, lng: order.restaurantLng };

  const seen = new Set();
  const candidates = [];
  for (const cell of cells) {
    const bucket = h3Buckets.get(cell);
    if (!bucket) continue;
    for (const rid of bucket) {
      if (seen.has(rid)) continue;
      seen.add(rid);
      const r = riderState.get(rid);
      if (!r || r.status === 'WAITING') continue;   // don't disturb a parked pickup
      if (!_freeSlot(r)) continue;                   // no capacity
      if (haversine({ lat: r.lat, lng: r.lng }, restaurant) > maxRangeKm) continue; // range gate (authority)
      const isIdle = r.orders.size === 0;
      if (!isIdle && !_clubbable(r, order)) continue; // busy → clubbing gate
      candidates.push({
        rider: r,
        startPos: { lat: r.lat, lng: r.lng },
        stops: r.stops,
        deliveryTimestamps: r.deliveryTimestamps,
      });
    }
  }
  if (!candidates.length) return;

  const result = allocateClub(order, candidates, getWeights(), now);
  if (!result) return;

  const winner   = result.winner.rider;
  const winnerId = winner._id.toString();

  // JIT hold — commit only once now ≥ departBy (unless force-assigning near the deadline).
  if (!force) {
    const travel_s = haversine({ lat: winner.lat, lng: winner.lng }, restaurant) / RIDER_SPEED_KMH * 3600;
    const grace_s  = order.jitGrace_s ?? 0;
    const prepReadyMs = order.prepReadyAt ? new Date(order.prepReadyAt).getTime() : now;
    const departBy = prepReadyMs - (travel_s + grace_s) * 1000;
    if (now < departBy) return; // hold this tick
  }

  _commitAssignment(order, orderId, winner, winnerId, result, now);
}

function _commitAssignment(order, orderId, winner, winnerId, result, now) {
  pendingQueue.delete(orderId);

  winner.orders.set(order._id.toString(), _meta(order));
  winner.stops = result.ordering;
  winner.currentOrderId = winner.stops[0].orderId;
  winner.nextLegCoords = [];        // stale after re-planning → refetch
  _syncIndex(winnerId, winner);     // may remove from index if now at capacity
  _beginLegToHead(winner, now, winnerId);

  Promise.all([
    Order.findByIdAndUpdate(order._id, {
      status: 'ASSIGNED',
      assignedRiderId: winner._id,
      assignedAt: new Date(now),
      allocationScore: result.score,
    }),
    Rider.findByIdAndUpdate(winner._id, {
      status:          winner.status,
      currentOrderId:  winner.currentOrderId,
      onboardOrderIds: _onboardIdsFromStops(winner),
      activeOrders:    winner.orders.size,
    }),
    AllocationHistory.create({
      orderId: order._id,
      riderId: winner._id,
      allocationScore: result.score,
      breakdown: result.breakdown,
      candidatesConsidered: result.candidatesConsidered,
    }),
  ]).catch(err => console.error('[sim] assign write failed:', err.message));

  if (ioRef) {
    const payload = {
      orderId:        order._id.toString(),
      riderId:        winnerId,
      riderName:      winner.name,
      restaurantName: order.restaurantName,
      customerName:   order.customerName,
      score:          result.score,
      carrying:       winner.orders.size,
      ts:             now,
    };
    ioRef.emit('order:assigned', payload);
    recentAssignments.push(payload);
    if (recentAssignments.length > RECENT_CAP) recentAssignments.shift();
  }
}

// ─── Stop arrival / transitions ────────────────────────────────────────────────

function _arriveAtStop(riderId, rider, now) {
  const head = rider.stops[0];
  if (!head) { _goIdle(rider, now, riderId); return; }

  if (head.type === 'PICKUP') {
    const meta    = rider.orders.get(head.orderId.toString());
    const readyMs = meta?.prepReadyAt ? new Date(meta.prepReadyAt).getTime() : 0;
    if (now < readyMs) {
      // Food not ready — park and WAIT.
      rider.status          = 'WAITING';
      rider.waitingUntil    = readyMs;
      rider.pickupArrivalAt = now;
      Rider.findByIdAndUpdate(riderId, { status: 'WAITING' }).catch(() => {});
    } else {
      _completePickup(riderId, rider, now);
    }
  } else {
    _completeDrop(riderId, rider, now);
  }
}

function _completePickup(riderId, rider, now) {
  const head = rider.stops.shift();               // remove the PICKUP
  const oid  = head.orderId.toString();
  const meta = rider.orders.get(oid);
  if (meta) meta.pickedUp = true;

  const actualWait_s = rider.pickupArrivalAt ? Math.round((now - rider.pickupArrivalAt) / 1000) : 0;
  rider.waitingUntil    = null;
  rider.pickupArrivalAt = null;

  Order.findByIdAndUpdate(head.orderId, {
    status: 'PICKED_UP', pickedUpAt: new Date(now), actualWait_s,
  }).catch(err => console.error('[sim] pickup write failed:', err.message));
  if (ioRef) ioRef.emit('order:status', { orderId: oid, status: 'PICKED_UP', riderId: riderId.toString() });

  _beginLegToHead(rider, now, riderId);
}

function _completeDrop(riderId, rider, now) {
  const head = rider.stops.shift();               // remove the DROP
  const oid  = head.orderId.toString();
  rider.orders.delete(oid);
  activeRoutes.delete(oid);
  rider.deliveryTimestamps = [...rider.deliveryTimestamps, new Date(now)];

  Order.findByIdAndUpdate(head.orderId, {
    status: 'DELIVERED', deliveredAt: new Date(now),
  }).catch(err => console.error('[sim] delivered write failed:', err.message));
  if (ioRef) ioRef.emit('order:delivered', { orderId: oid, riderId: riderId.toString() });

  _syncIndex(riderId, rider);   // a slot just freed → ensure indexed
  _beginLegToHead(rider, now, riderId);
}

// Set up the leg toward stops[0]; if the itinerary is empty, go IDLE and return home.
function _beginLegToHead(rider, now, riderId) {
  if (!rider.stops.length) { _goIdle(rider, now, riderId); return; }

  const head = rider.stops[0];
  rider.legOriginLat = rider.lat;
  rider.legOriginLng = rider.lng;
  rider.legStartedAt = new Date(now);
  rider.legDuration_s = haversine({ lat: rider.lat, lng: rider.lng }, { lat: head.lat, lng: head.lng })
    / RIDER_SPEED_KMH * 3600;
  rider.legCoords = rider.nextLegCoords?.length >= 2 ? rider.nextLegCoords : [];
  rider.nextLegCoords = [];
  rider.currentSegmentIdx = 0;
  rider.distanceCoveredOnSegment = 0;
  rider.currentOrderId = head.orderId;
  rider.status = head.type === 'PICKUP' ? 'ACCEPTED' : 'PICKED_UP';
  rider.waitingUntil = null;
  rider.pickupArrivalAt = null;

  _persistRider(riderId, rider, now);
  _fetchHeadRoute(rider, riderId, now);
}

function _goIdle(rider, now, riderId) {
  rider.status         = 'IDLE';
  rider.currentOrderId = null;
  rider.stops          = [];
  rider.orders.clear();
  rider.lat     = rider.homeLat;
  rider.lng     = rider.homeLng;
  rider.h3Index = latLngToCell(rider.homeLat, rider.homeLng, getH3Config().resolution);
  rider.legStartedAt = null; rider.legDuration_s = null;
  rider.legOriginLat = null; rider.legOriginLng = null;
  rider.legCoords = []; rider.nextLegCoords = [];
  rider.currentSegmentIdx = 0; rider.distanceCoveredOnSegment = 0;
  rider.waitingUntil = null; rider.pickupArrivalAt = null;

  _syncIndex(riderId, rider); // free slot → (re)index at home

  Rider.findByIdAndUpdate(riderId, {
    status:          'IDLE',
    currentOrderId:  null,
    onboardOrderIds: [],
    activeOrders:    0,
    latitude:        rider.homeLat,
    longitude:       rider.homeLng,
    h3Index:         rider.h3Index,
    deliveryTimestamps: rider.deliveryTimestamps,
  }).catch(err => console.error('[sim] idle write failed:', err.message));
}

function _persistRider(riderId, rider, now) {
  Rider.findByIdAndUpdate(riderId, {
    status:          rider.status,
    currentOrderId:  rider.currentOrderId ?? null,
    onboardOrderIds: _onboardIdsFromStops(rider),
    activeOrders:    rider.orders.size,
    latitude:        rider.lat,
    longitude:       rider.lng,
    h3Index:         rider.h3Index,
  }).catch(err => console.error('[sim] persist write failed:', err.message));
}

// Fetch the road-snapped route for the current head leg (pos → stops[0]) and prefetch the
// following leg (stops[0] → stops[1]). Fire-and-forget; the lerp fallback covers the gap.
function _fetchHeadRoute(rider, riderId, now) {
  const head = rider.stops[0];
  if (!head) return;
  const next    = rider.stops[1];
  const dest2   = next ?? head;
  const orderIdStr = head.orderId.toString();
  const headType = head.type;

  getRoute(
    { lat: rider.legOriginLat, lng: rider.legOriginLng },
    { lat: head.lat,           lng: head.lng           },
    { lat: dest2.lat,          lng: dest2.lng          }
  ).then(route => {
    const r = riderState.get(riderId.toString());
    if (!r || !r.stops.length) return;
    const h = r.stops[0];
    if (h.orderId.toString() !== orderIdStr || h.type !== headType) return; // rider moved on
    r.legCoords              = route.leg1Coords;
    r.nextLegCoords          = next ? route.leg2Coords : [];
    r.currentSegmentIdx      = 0;
    r.distanceCoveredOnSegment = 0;
    r.legDuration_s          = route.leg1Duration_s;

    activeRoutes.set(orderIdStr, {
      riderId: riderId.toString(),
      leg1Coords: route.leg1Coords,
      leg2Coords: next ? route.leg2Coords : [],
    });
    if (ioRef) {
      ioRef.emit('order:route', {
        orderId: orderIdStr,
        riderId: riderId.toString(),
        leg1Coords: route.leg1Coords,
        leg2Coords: next ? route.leg2Coords : [],
      });
    }
    Order.findByIdAndUpdate(head.orderId, {
      leg1Coords:     route.leg1Coords,
      leg2Coords:     next ? route.leg2Coords : [],
      leg1Duration_s: route.leg1Duration_s,
      leg2Duration_s: route.leg2Duration_s,
    }).catch(() => {});
  }).catch(err => console.warn('[sim] head route fetch failed, using lerp fallback:', err.message));
}

// ─── H3 bucket helpers (Stage 2 — take the rider entry, maintain bucketCell) ────

function _addToH3(riderId, rider) {
  const cell = rider.h3Index;
  if (!h3Buckets.has(cell)) h3Buckets.set(cell, new Set());
  h3Buckets.get(cell).add(riderId);
  rider.bucketCell = cell;
}

function _removeFromH3(riderId, rider) {
  if (rider.bucketCell) h3Buckets.get(rider.bucketCell)?.delete(riderId);
  rider.bucketCell = null;
}

// Relocate a bucketed rider when its live cell changes (called every tick after h3Index recompute).
function _reindexIfBucketed(riderId, rider) {
  if (rider.bucketCell && rider.bucketCell !== rider.h3Index) {
    _removeFromH3(riderId, rider);
    _addToH3(riderId, rider);
  }
}

// Keep the index invariant: a rider is bucketed iff it has a free slot.
function _syncIndex(riderId, rider) {
  const shouldIndex = _freeSlot(rider);
  if (shouldIndex && !rider.bucketCell)      _addToH3(riderId, rider);
  else if (!shouldIndex && rider.bucketCell) _removeFromH3(riderId, rider);
  else if (shouldIndex)                       _reindexIfBucketed(riderId, rider);
}

// ─── Polyline traversal (unchanged) ─────────────────────────────────────────────

function _advanceAlongPolyline(rider) {
  const metersPerTick = (RIDER_SPEED_KMH / 3.6) * (TICK_INTERVAL_MS / 1000);
  _preAdvancePolyline(rider, metersPerTick);

  const coords = rider.legCoords;
  const segIdx = rider.currentSegmentIdx;

  if (segIdx >= coords.length - 1) {
    const last = coords[coords.length - 1];
    rider.lat  = last[1];
    rider.lng  = last[0];
    return true;
  }

  const from   = coords[segIdx];
  const to     = coords[segIdx + 1];
  const segLen = haversine({ lat: from[1], lng: from[0] }, { lat: to[1], lng: to[0] }) * 1000;
  const t      = segLen > 0 ? Math.min(1, rider.distanceCoveredOnSegment / segLen) : 0;
  rider.lat    = from[1] + t * (to[1] - from[1]);
  rider.lng    = from[0] + t * (to[0] - from[0]);
  return false;
}

function _preAdvancePolyline(rider, meters) {
  let remaining = meters;
  const coords  = rider.legCoords;
  let segIdx    = rider.currentSegmentIdx;
  let distOnSeg = rider.distanceCoveredOnSegment;

  while (remaining > 0 && segIdx < coords.length - 1) {
    const from   = coords[segIdx];
    const to     = coords[segIdx + 1];
    const segLen = haversine({ lat: from[1], lng: from[0] }, { lat: to[1], lng: to[0] }) * 1000;
    const left   = segLen - distOnSeg;

    if (remaining >= left) {
      remaining -= left;
      segIdx++;
      distOnSeg = 0;
    } else {
      distOnSeg += remaining;
      remaining  = 0;
    }
  }

  rider.currentSegmentIdx        = segIdx;
  rider.distanceCoveredOnSegment = distOnSeg;
}

function _positionFromPolyline(rider) {
  const coords = rider.legCoords;
  const segIdx = rider.currentSegmentIdx;

  if (segIdx >= coords.length - 1) {
    const last = coords[coords.length - 1];
    rider.lat  = last[1];
    rider.lng  = last[0];
    return;
  }

  const from   = coords[segIdx];
  const to     = coords[segIdx + 1];
  const segLen = haversine({ lat: from[1], lng: from[0] }, { lat: to[1], lng: to[0] }) * 1000;
  const t      = segLen > 0 ? Math.min(1, rider.distanceCoveredOnSegment / segLen) : 0;
  rider.lat    = from[1] + t * (to[1] - from[1]);
  rider.lng    = from[0] + t * (to[0] - from[0]);
}
