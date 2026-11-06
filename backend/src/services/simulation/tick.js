import { latLngToCell } from 'h3-js';
import { getH3Config } from '../../config/constants.js';
import { riderState, pendingQueue, runtime } from './state.js';
import { _reindexIfBucketed } from './h3Index.js';
import { _advanceAlongPolyline } from './polyline.js';
import { _arriveAtStop, _completePickup } from './riderTrip.js';
import { _cancelExpiredOrders, _tryAllocate } from './dispatch.js';

// ─── Tick ─────────────────────────────────────────────────────────────────────

export function tick() {
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

  // Phase 1.5 — drop orders that waited too long after becoming dispatchable.
  _cancelExpiredOrders(now);

  // Phase 2 — allocate pending orders (marginal-cost clubbing + JIT hold + force-assign)
  for (const [orderId, order] of pendingQueue) {
    _tryAllocate(orderId, order, now);
  }

  // Phase 3 — broadcast tick
  if (runtime.io) {
    runtime.io.emit('simulation:tick', {
      riders:     tickRiders,
      queueDepth: pendingQueue.size,
    });
  }
}
