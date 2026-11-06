import { latLngToCell } from 'h3-js';
import { getRoute } from '../services/routingService.js';
import { getH3Config } from '../config/constants.js';
import { riderState, activeRoutes, runtime } from './state.js';
import { _syncIndex } from './h3Index.js';
import {
  savePickup, saveDelivery, saveOrderRoute, saveRiderState, saveRiderLegRoute,
} from './storage.js';

// ─── Stop arrival / transitions ────────────────────────────────────────────────
// A rider's position is never stored per tick. It follows from their current leg (where it
// started, when, and the road route) — see utils/polyline.js. The leg is saved on the Rider, so
// after a restart the same position is rebuilt from the clock (decision B5).

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

// Set up the leg from the rider's current position toward stops[0]; with no stops left the
// rider goes IDLE where they are.
export function _beginLegToHead(rider, now, riderId) {
  if (!rider.stops.length) { _goIdle(rider, now, riderId); return; }

  const head = rider.stops[0];
  rider.legOriginLat = rider.lat;
  rider.legOriginLng = rider.lng;
  rider.legStartedAt = new Date(now);
  // Reuse the route prefetched for this leg, if any; otherwise the bot moves in a straight line
  // until the road route arrives.
  rider.legCoords = rider.nextLegCoords?.length >= 2 ? rider.nextLegCoords : [];
  rider.nextLegCoords = [];
  rider.currentSegmentIdx = 0;
  rider.currentOrderId = head.orderId;
  rider.status = head.type === 'PICKUP' ? 'ACCEPTED' : 'PICKED_UP';
  rider.waitingUntil = null;
  rider.pickupArrivalAt = null;

  saveRiderState(riderId, {
    status:     rider.status,
    latitude:   rider.lat,
    longitude:  rider.lng,
    h3Index:    rider.h3Index,
    currentLeg: {
      startedAt:     rider.legStartedAt,
      originLat:     rider.legOriginLat,
      originLng:     rider.legOriginLng,
      targetOrderId: head.orderId,
      targetType:    head.type,
      coords:        rider.legCoords,
    },
  }).catch(err => console.error('[engine] leg write failed:', err.message));
  _fetchHeadRoute(rider, riderId);
}

// An idle rider stays where they finished (decision B4).
function _goIdle(rider, now, riderId) {
  rider.status         = 'IDLE';
  rider.currentOrderId = null;
  rider.stops          = [];
  rider.orders.clear();
  rider.h3Index = latLngToCell(rider.lat, rider.lng, getH3Config().resolution);
  rider.legStartedAt = null;
  rider.legOriginLat = null; rider.legOriginLng = null;
  rider.legCoords = []; rider.nextLegCoords = [];
  rider.currentSegmentIdx = 0;
  rider.waitingUntil = null; rider.pickupArrivalAt = null;

  _syncIndex(riderId, rider); // free slot → (re)index where they are

  saveRiderState(riderId, {
    status:          'IDLE',
    latitude:        rider.lat,
    longitude:       rider.lng,
    h3Index:         rider.h3Index,
    deliveryTimestamps: rider.deliveryTimestamps,
    currentLeg:      null,
  }).catch(err => console.error('[engine] idle write failed:', err.message));
}

// Fetch the road-snapped route for the current head leg (leg origin → stops[0]) and prefetch the
// following leg (stops[0] → stops[1]). Fire-and-forget; the straight-line fallback covers the gap.
export function _fetchHeadRoute(rider, riderId) {
  const head = rider.stops[0];
  if (!head) return;
  const next       = rider.stops[1];
  const dest2      = next ?? head;
  const orderIdStr = head.orderId.toString();
  const legStartedAt = rider.legStartedAt;

  getRoute(
    { lat: rider.legOriginLat, lng: rider.legOriginLng },
    { lat: head.lat,           lng: head.lng           },
    { lat: dest2.lat,          lng: dest2.lng          }
  ).then(route => {
    const r = riderState.get(riderId.toString());
    if (!r || r.legStartedAt !== legStartedAt) return; // the rider started another leg meanwhile
    r.legCoords     = route.leg1Coords;
    r.nextLegCoords = next ? route.leg2Coords : [];

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
    saveRiderLegRoute(riderId, route.leg1Coords).catch(() => {});
  }).catch(err => console.warn('[engine] head route fetch failed, using straight-line fallback:', err.message));
}
