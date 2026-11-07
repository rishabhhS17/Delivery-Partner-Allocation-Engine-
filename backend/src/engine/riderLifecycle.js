import { latLngToCell } from 'h3-js';
import { getRoute } from '../services/routingService.js';
import { getH3Config } from '../config/constants.js';
import { riderState, activeRoutes } from './state.js';
import { _syncIndex } from './h3Index.js';
import { publish } from './broadcast.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('engine');
import {
  savePickup, saveDelivery, saveOrderRoute, saveRiderState, saveRiderLegRoute, appendOrderEvent,
  saveRiderArrivedAtRestaurant,
} from './storage.js';

// ─── Stop arrival / transitions ────────────────────────────────────────────────
// A rider's position is never stored per tick. It follows from their current leg (where it
// started, when, and the road route) — see utils/polyline.js. The leg is saved on the Rider, so
// after a restart the same position is rebuilt from the clock (decision B5).

// Stop reports run one at a time with dispatch (see index.js), and each pickup / delivery is
// saved before it is applied: if the save fails the rider simply stays at the stop and the bot
// reports again next tick.
export async function _arriveAtStop(riderId, rider, now) {
  const head = rider.stops[0];
  if (!head) { _goIdle(rider, now, riderId); return; }

  if (head.type === 'PICKUP') {
    const meta    = rider.orders.get(head.orderId.toString());
    const readyMs = meta?.prepReadyAt ? new Date(meta.prepReadyAt).getTime() : 0;
    if (now < readyMs) {
      // Food not ready — park and WAIT.
      rider.status          = 'WAITING';
      rider.waitingUntil    = readyMs;
      // After a restart the rider "arrives" again; the saved first arrival keeps the wait right.
      rider.pickupArrivalAt = meta?.riderArrivedAt ? new Date(meta.riderArrivedAt).getTime() : now;
      if (meta && !meta.riderArrivedAt) meta.riderArrivedAt = new Date(now);
      saveRiderState(riderId, { status: 'WAITING' }).catch(() => {});
      saveRiderArrivedAtRestaurant(head.orderId, now)
        .catch(err => log.error('arrival time write failed', { orderId: head.orderId, riderId, error: err.message }));
      appendOrderEvent(head.orderId, 'rider_waiting', { riderId: rider._id, details: { foodReadyAt: new Date(readyMs) } });
    } else {
      await _completePickup(riderId, rider, now);
    }
  } else {
    await _completeDrop(riderId, rider, now);
  }
}

export async function _completePickup(riderId, rider, now) {
  const head = rider.stops[0];
  const oid  = head.orderId.toString();
  const meta = rider.orders.get(oid);
  // Measured from the first arrival, which is saved — so it stays right across a restart.
  const savedArrivalMs = meta?.riderArrivedAt ? new Date(meta.riderArrivedAt).getTime() : null;
  const arrivedAtMs = rider.pickupArrivalAt ?? savedArrivalMs;
  const actualWait_s = arrivedAtMs ? Math.round((now - arrivedAtMs) / 1000) : 0;
  try {
    await savePickup(head.orderId, now, actualWait_s);
  } catch (err) {
    log.error('pickup write failed, rider will report again', { orderId: oid, riderId, error: err.message });
    return;
  }

  rider.stops.splice(rider.stops.indexOf(head), 1); // remove this PICKUP
  if (meta) meta.pickedUp = true;
  rider.waitingUntil    = null;
  rider.pickupArrivalAt = null;

  appendOrderEvent(head.orderId, 'picked_up', { riderId: rider._id, details: { actualWait_s } });
  publish('order:status', { orderId: oid, status: 'PICKED_UP', riderId: riderId.toString() });

  _beginLegToHead(rider, now, riderId);
}

async function _completeDrop(riderId, rider, now) {
  const head = rider.stops[0];
  const oid  = head.orderId.toString();
  try {
    await saveDelivery(head.orderId, now);
  } catch (err) {
    log.error('delivery write failed, rider will report again', { orderId: oid, riderId, error: err.message });
    return;
  }

  rider.stops.splice(rider.stops.indexOf(head), 1); // remove this DROP
  rider.orders.delete(oid);
  activeRoutes.delete(oid);
  rider.deliveryTimestamps = [...rider.deliveryTimestamps, new Date(now)];

  appendOrderEvent(head.orderId, 'delivered', { riderId: rider._id });
  publish('order:delivered', { orderId: oid, riderId: riderId.toString() });

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
  }).catch(err => log.error('leg write failed', { riderId, error: err.message }));
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
  // A rider switched offline while busy leaves the live fleet once their last order is done.
  if (rider.availabilityStatus !== 'ONLINE') riderState.delete(riderId.toString());

  saveRiderState(riderId, {
    status:          'IDLE',
    latitude:        rider.lat,
    longitude:       rider.lng,
    h3Index:         rider.h3Index,
    deliveryTimestamps: rider.deliveryTimestamps,
    currentLeg:      null,
  }).catch(err => log.error('idle write failed', { riderId, error: err.message }));
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
    publish('order:route', {
      orderId: orderIdStr,
      riderId: riderId.toString(),
      leg1Coords: route.leg1Coords,
      leg2Coords: next ? route.leg2Coords : [],
    });
    saveOrderRoute(head.orderId, route, Boolean(next)).catch(() => {});
    saveRiderLegRoute(riderId, route.leg1Coords).catch(() => {});
  }).catch(err => log.warn('route fetch failed, using straight-line fallback', { orderId: orderIdStr, riderId, error: err.message }));
}
