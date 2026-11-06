import { pickupStop, dropStop } from '../allocationEngine.js';

// ─── Order / stop helpers ──────────────────────────────────────────────────────

export function _meta(order) {
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
export function _stopsForMeta(meta) {
  return meta.pickedUp ? [dropStop(meta)] : [pickupStop(meta), dropStop(meta)];
}

// Unique order ids in itinerary order (first appearance in the stop-list) — persisted so hydrate
// can rebuild an N-order stop-list.
export function _onboardIdsFromStops(rider) {
  const seen = new Set();
  const ids = [];
  for (const s of rider.stops) {
    const id = s.orderId.toString();
    if (!seen.has(id)) { seen.add(id); ids.push(s.orderId); }
  }
  return ids;
}
