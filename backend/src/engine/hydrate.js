import { latLngToCell } from 'h3-js';
import { pickupStop, dropStop } from '../services/allocationEngine.js';
import { RIDER_SPEED_KMH, getH3Config } from '../config/constants.js';
import { riderState, h3Buckets, pendingQueue, activeRoutes, recentAssignments } from './state.js';
import { _meta } from './itinerary.js';
import { _freeSlot, _addToH3 } from './h3Index.js';
import { positionAlongLeg } from '../utils/polyline.js';
import { enqueueOrder, clearWakeList } from './wakeList.js';
import { clearOffers, _restoreOffer } from './offers.js';
import { _beginLegToHead, _fetchHeadRoute } from './riderLifecycle.js';
import {
  loadActiveOrders, loadPendingOrders, loadRidersForStartup, requeueOrders, appendOrderEvent, clearOffer,
} from './storage.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('engine');

// ─── Hydration ───────────────────────────────────────────────────────────────
// Rebuilds the engine's memory from the database. The orders are the source of truth for who
// carries what (decision E2), so there is nothing to heal: every rider's order list is simply
// rebuilt from the orders that name them.

export async function hydrate() {
  riderState.clear();
  h3Buckets.clear();
  pendingQueue.clear();
  clearWakeList();
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
  const ridersNeedingNewLeg = [];
  const ridersNeedingRoute  = [];
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
      // Keep heading where the rider was heading: moving that stop to the front is always valid
      // (a pickup may go anywhere before its drop; a drop's food is already on board).
      const savedTargetIdx = entry.stops.findIndex(stop =>
        String(stop.orderId) === String(rider.currentLeg?.targetOrderId) && stop.type === rider.currentLeg?.targetType);
      if (savedTargetIdx > 0) entry.stops.unshift(...entry.stops.splice(savedTargetIdx, 1));
      entry.currentOrderId = entry.stops[0].orderId;
      entry.status = entry.stops[0].type === 'PICKUP' ? 'ACCEPTED' : 'PICKED_UP';

      // Carry on along the saved leg if it still leads to the first stop; otherwise start a new
      // leg from where the rider was last saved.
      if (!_restoreLeg(entry, rider.currentLeg, now)) ridersNeedingNewLeg.push([id, entry]);
      else if (!entry.legCoords.length) ridersNeedingRoute.push([id, entry]);
      entry.h3Index = latLngToCell(entry.lat, entry.lng, getH3Config().resolution);

      if (_freeSlot(entry)) _addToH3(id, entry);
    } else {
      entry.status = 'IDLE';
      if (_freeSlot(entry)) _addToH3(id, entry);
    }

    riderState.set(id, entry);
  }

  // Needs riderState filled first: both look the rider up again when the route arrives.
  for (const [id, entry] of ridersNeedingNewLeg) _beginLegToHead(entry, now, id);
  for (const [id, entry] of ridersNeedingRoute) _fetchHeadRoute(entry, id);

  // Orders whose rider record is gone go back in the queue.
  const ownerlessOrderIds = [...ordersByRider.values()].flat().map(o => o._id);
  if (ownerlessOrderIds.length) {
    await requeueOrders(ownerlessOrderIds, now);
    for (const orderId of ownerlessOrderIds) appendOrderEvent(orderId, 'requeued', { details: { reason: 'rider_missing' } });
    log.warn('re-queued orders whose rider no longer exists', { orderIds: ownerlessOrderIds });
  }

  clearOffers();
  for (const ord of await loadPendingOrders()) {
    enqueueOrder(ord, now);
    // An offer saved before the restart is open again (its expiry is a saved timestamp); one for a
    // rider who is no longer live is closed so the order can be offered to someone else.
    if (ord.offer?.riderId && !_restoreOffer(ord)) await clearOffer(ord._id, {});
  }

  log.info('hydrated from the database', { riders: riderState.size, pendingOrders: pendingQueue.size });
}

// Restore the rider's saved leg if it still leads to their first stop, and place them where the
// clock says they are along it (decision B5). Returns false when there is no usable saved leg.
function _restoreLeg(entry, savedLeg, now) {
  const head = entry.stops[0];
  if (!savedLeg?.startedAt || !head) return false;
  if (String(savedLeg.targetOrderId) !== String(head.orderId) || savedLeg.targetType !== head.type) return false;

  entry.legOriginLat = savedLeg.originLat;
  entry.legOriginLng = savedLeg.originLng;
  entry.legStartedAt = new Date(savedLeg.startedAt);
  entry.legCoords    = savedLeg.coords?.length >= 2 ? savedLeg.coords.map(([lng, lat]) => [lng, lat]) : [];

  const metresTravelled = (RIDER_SPEED_KMH / 3.6) * (now - entry.legStartedAt.getTime()) / 1000;
  const position = positionAlongLeg({
    originLat: entry.legOriginLat, originLng: entry.legOriginLng,
    targetLat: head.lat, targetLng: head.lng, coords: entry.legCoords,
  }, metresTravelled);
  entry.lat = position.lat;
  entry.lng = position.lng;
  entry.currentSegmentIdx = position.segmentIdx;
  return true;
}

export function _buildEntry(rider) {
  return {
    _id:     rider._id,
    name:    rider.name,
    lat:     rider.latitude,
    lng:     rider.longitude,
    h3Index: rider.h3Index ?? latLngToCell(rider.latitude, rider.longitude, getH3Config().resolution),
    status:  rider.status,
    availabilityStatus: rider.availabilityStatus,
    deliveryTimestamps: rider.deliveryTimestamps ?? [],
    // Older records only have the list, which used to hold every delivery.
    totalDeliveries: rider.totalDeliveries || (rider.deliveryTimestamps?.length ?? 0),

    // Multi-order itinerary
    stops:   [],                 // [{ type, orderId, lat, lng, prepReadyAt?, promisedBy? }, …]
    orders:  new Map(),          // orderId(str) → meta
    currentOrderId: null,        // = stops[0]?.orderId (telemetry / back-compat)
    bucketCell: null,            // the H3 cell this rider is currently indexed under (Stage 2)

    // Current leg (position → stops[0]); the position itself follows from these and the clock
    legOriginLat: null, legOriginLng: null,
    legStartedAt: null,
    legCoords: [],               // road route for the current leg
    nextLegCoords: [],           // prefetched road route for the following leg
    currentSegmentIdx: 0,        // how far along legCoords (the maps trim the drawn route by it)

    // WAITING (parked at a not-yet-ready pickup)
    waitingUntil: null,
    pickupArrivalAt: null,
  };
}
