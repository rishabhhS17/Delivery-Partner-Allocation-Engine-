import { latLngToCell } from 'h3-js';
import { getRoute } from '../services/routingService.js';
import { RIDER_SPEED_KMH, getH3Config } from '../config/constants.js';
import { haversine } from '../utils/haversine.js';
import { riderState, activeRoutes, runtime } from './state.js';
import { _syncIndex } from './h3Index.js';
import { savePickup, saveDelivery, saveOrderRoute, saveRiderState } from './storage.js';

// ─── Stop arrival / transitions ────────────────────────────────────────────────

export function _arriveAtStop(riderId, rider, now) {
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
      saveRiderState(riderId, { status: 'WAITING' }).catch(() => {});
    } else {
      _completePickup(riderId, rider, now);
    }
  } else {
    _completeDrop(riderId, rider, now);
  }
}

export function _completePickup(riderId, rider, now) {
  const head = rider.stops.shift();               // remove the PICKUP
  const oid  = head.orderId.toString();
  const meta = rider.orders.get(oid);
  if (meta) meta.pickedUp = true;

  const actualWait_s = rider.pickupArrivalAt ? Math.round((now - rider.pickupArrivalAt) / 1000) : 0;
  rider.waitingUntil    = null;
  rider.pickupArrivalAt = null;

  savePickup(head.orderId, now, actualWait_s)
    .catch(err => console.error('[engine] pickup write failed:', err.message));
  if (runtime.io) runtime.io.emit('order:status', { orderId: oid, status: 'PICKED_UP', riderId: riderId.toString() });

  _beginLegToHead(rider, now, riderId);
}

function _completeDrop(riderId, rider, now) {
  const head = rider.stops.shift();               // remove the DROP
  const oid  = head.orderId.toString();
  rider.orders.delete(oid);
  activeRoutes.delete(oid);
  rider.deliveryTimestamps = [...rider.deliveryTimestamps, new Date(now)];

  saveDelivery(head.orderId, now)
    .catch(err => console.error('[engine] delivered write failed:', err.message));
  if (runtime.io) runtime.io.emit('order:delivered', { orderId: oid, riderId: riderId.toString() });

  _syncIndex(riderId, rider);   // a slot just freed → ensure indexed
  _beginLegToHead(rider, now, riderId);
}

// Set up the leg toward stops[0]; if the itinerary is empty, go IDLE and return home.
export function _beginLegToHead(rider, now, riderId) {
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
  rider.legKey = (rider.legKey ?? 0) + 1;
  rider.legStartSegmentIdx = 0;
  rider.legStartDistanceOnSegment = 0;
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
  rider.legKey = (rider.legKey ?? 0) + 1;
  rider.waitingUntil = null; rider.pickupArrivalAt = null;

  _syncIndex(riderId, rider); // free slot → (re)index at home

  saveRiderState(riderId, {
    status:          'IDLE',
    latitude:        rider.homeLat,
    longitude:       rider.homeLng,
    h3Index:         rider.h3Index,
    deliveryTimestamps: rider.deliveryTimestamps,
  }).catch(err => console.error('[engine] idle write failed:', err.message));
}

function _persistRider(riderId, rider, now) {
  saveRiderState(riderId, {
    status:          rider.status,
    latitude:        rider.lat,
    longitude:       rider.lng,
    h3Index:         rider.h3Index,
  }).catch(err => console.error('[engine] persist write failed:', err.message));
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
    r.legKey                 = (r.legKey ?? 0) + 1;   // tells the rider bot to follow the road route
    r.legStartSegmentIdx     = 0;
    r.legStartDistanceOnSegment = 0;

    activeRoutes.set(orderIdStr, {
      riderId: riderId.toString(),
      leg1Coords: route.leg1Coords,
      leg2Coords: next ? route.leg2Coords : [],
    });
    if (runtime.io) {
      runtime.io.emit('order:route', {
        orderId: orderIdStr,
        riderId: riderId.toString(),
        leg1Coords: route.leg1Coords,
        leg2Coords: next ? route.leg2Coords : [],
      });
    }
    saveOrderRoute(head.orderId, route, Boolean(next)).catch(() => {});
  }).catch(err => console.warn('[engine] head route fetch failed, using lerp fallback:', err.message));
}
