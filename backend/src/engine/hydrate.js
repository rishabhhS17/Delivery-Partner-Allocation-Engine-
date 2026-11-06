import { latLngToCell } from 'h3-js';
import { pickupStop, dropStop } from '../services/allocationEngine.js';
import { RIDER_SPEED_KMH, getH3Config } from '../config/constants.js';
import Rider from '../models/Rider.js';
import Order from '../models/Order.js';
import { riderState, h3Buckets, pendingQueue, activeRoutes, recentAssignments, runtime } from './state.js';
import { _meta } from './itinerary.js';
import { _freeSlot, _addToH3 } from './h3Index.js';
import { _preAdvancePolyline, _positionFromPolyline } from '../utils/polyline.js';

const ORPHAN_GRACE_MS = 20_000;

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

export async function _sweepOrphanedOrders() {
  if (!runtime.running) return;
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

export async function hydrate() {
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
    // The rider bot resumes from here instead of the start of the route.
    entry.legStartSegmentIdx        = entry.currentSegmentIdx;
    entry.legStartDistanceOnSegment = entry.distanceCoveredOnSegment;
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
    legKey: 1,                   // changes whenever the leg or its road route is replaced
    legStartSegmentIdx: 0,       // route progress when the current leg key began
    legStartDistanceOnSegment: 0,

    // WAITING (parked at a not-yet-ready pickup)
    waitingUntil: null,
    pickupArrivalAt: null,
  };
}
