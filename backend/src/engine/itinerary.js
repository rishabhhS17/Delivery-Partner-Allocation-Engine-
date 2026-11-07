import { pickupStop, dropStop } from '../services/allocationEngine.js';

// ─── Order / stop helpers ──────────────────────────────────────────────────────

export function _meta(order) {
  return {
    _id:           order._id,
    restaurantLat: order.restaurantLat, restaurantLng: order.restaurantLng,
    customerLat:   order.customerLat,   customerLng:   order.customerLng,
    prepReadyAt:   order.prepReadyAt,   promisedBy:    order.promisedBy,
    jitGrace_s:    order.jitGrace_s ?? 0,
    riderArrivedAt: order.riderArrivedAt ?? null,
    createdAt:     order.createdAt,
    pickedUp:      order.status === 'PICKED_UP',
  };
}

// meta carries {_id, restaurantLat/Lng, customerLat/Lng, prepReadyAt, promisedBy} — exactly what
// pickupStop/dropStop read — so they build stops directly from a meta.
export function _stopsForMeta(meta) {
  return meta.pickedUp ? [dropStop(meta)] : [pickupStop(meta), dropStop(meta)];
}
