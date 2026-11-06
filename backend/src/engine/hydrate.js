import { latLngToCell } from 'h3-js';
import { pickupStop, dropStop } from '../services/allocationEngine.js';
import { RIDER_SPEED_KMH, getH3Config } from '../config/constants.js';
import { riderState, h3Buckets, pendingQueue, activeRoutes, recentAssignments } from './state.js';
import { _meta } from './itinerary.js';
import { _freeSlot, _addToH3 } from './h3Index.js';
import { _preAdvancePolyline, _positionFromPolyline } from '../utils/polyline.js';
import { loadActiveOrders, loadPendingOrders, loadRidersForStartup, requeueOrders } from './storage.js';

// ─── Hydration ───────────────────────────────────────────────────────────────
// Rebuilds the engine's memory from the database. The orders are the source of truth for who
// carries what (decision E2), so there is nothing to heal: every rider's order list is simply
// rebuilt from the orders that name them.

export async function hydrate() {
  riderState.clear();
  h3Buckets.clear();
  pendingQueue.clear();
  activeRoutes.clear();
  recentAssignments.length = 0;

  const now = Date.now();
  const activeOrders = await loadActiveOrders();
  const ordersByRider = new Map();
  for (const order of activeOrders) {
    const riderId = order.assignedRiderId?.toString();
    if (!riderId) continue;
    if (!ordersByRider.has(riderId)) ordersByRider.set(riderId, []);
    ordersByRider.get(riderId).push(order);
  }

  const riders = await loadRidersForStartup([...ordersByRider.keys()]);
  for (const rider of riders) {
    const id    = rider._id.toString();
    const entry = _buildEntry(rider);
    const carried = ordersByRider.get(id) ?? [];
    ordersByRider.delete(id);

    if (carried.length) {
      // Picked-up orders first (their food is on board), then the rest in the order they were
      // assigned — a valid, if not always optimal, restart ordering of the stops.
      const ordered = carried.sort((a, b) =>
        (a.status === 'PICKED_UP' ? 0 : 1) - (b.status === 'PICKED_UP' ? 0 : 1) ||
        (a.assignedAt?.getTime?.() ?? 0) - (b.assignedAt?.getTime?.() ?? 0));
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
      if (_freeSlot(entry)) _addToH3(id, entry);
    }

    riderState.set(id, entry);
  }

  // Orders whose rider record is gone go back in the queue.
  const ownerlessOrderIds = [...ordersByRider.values()].flat().map(o => o._id);
  if (ownerlessOrderIds.length) {
    await requeueOrders(ownerlessOrderIds, now);
    console.warn(`[engine] re-queued ${ownerlessOrderIds.length} order(s) whose rider no longer exists`);
  }

  for (const ord of await loadPendingOrders()) pendingQueue.set(ord._id.toString(), ord);

  console.log(`[engine] hydrated — ${riderState.size} riders, ${pendingQueue.size} pending orders`);
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
