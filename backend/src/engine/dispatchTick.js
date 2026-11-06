import { riderState, pendingQueue, runtime } from './state.js';
import { _cancelExpiredOrders, _tryAllocate } from './dispatch.js';

// ─── Dispatch tick ────────────────────────────────────────────────────────────
// Rider movement is no longer done here: the rider bots (src/sim) move riders and report
// positions and arrivals through the engine's public commands.

export function tick() {
  const now = Date.now();

  // Phase 1 — drop orders that waited too long after becoming dispatchable.
  _cancelExpiredOrders(now);

  // Phase 2 — allocate pending orders (marginal-cost clubbing + JIT hold + force-assign)
  for (const [orderId, order] of pendingQueue) {
    _tryAllocate(orderId, order, now);
  }

  // Phase 3 — broadcast the fleet
  if (runtime.io) {
    runtime.io.emit('simulation:tick', {
      riders:     buildFleetSnapshot(),
      queueDepth: pendingQueue.size,
    });
  }
}

function buildFleetSnapshot() {
  const fleet = [];
  for (const [riderId, rider] of riderState) {
    fleet.push({
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
  return fleet;
}
