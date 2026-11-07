import { riderState, pendingQueue, activeRoutes, recentAssignments, runtime } from './state.js';

// ─── Live feed ───────────────────────────────────────────────────────────────
// Everything the engine announces goes through publish(): the fleet every second and each order
// event as it happens. Subscribers (the Server-Sent Events stream, one per open browser) get
// every event; a new or reconnecting subscriber starts from a fresh snapshot instead of a replay
// of what it missed (decision K6).

const subscribers = new Set();

/** @param {(event: string, json: string) => void} send  Called with each event, already JSON. */
export function subscribe(send) {
  subscribers.add(send);
  return () => subscribers.delete(send);
}

export function publish(event, payload) {
  if (!subscribers.size) return;
  const json = JSON.stringify(payload); // serialised once, however many browsers are watching
  for (const send of subscribers) send(event, json);
}

/** Everything a browser needs to draw the current state from scratch. */
export function buildLiveSnapshot() {
  return {
    running:           runtime.running,
    riders:            buildFleetSnapshot(),
    queueDepth:        pendingQueue.size,
    dispatchPaused:    runtime.isDispatchPaused,
    routes:            [...activeRoutes].map(([orderId, route]) => ({ orderId, ...route })),
    recentAssignments: [...recentAssignments],
  };
}

export function buildFleetSnapshot() {
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
      hasOffer:           Boolean(rider.openOffer),
      legStepIndex:       rider.currentSegmentIdx ?? 0,
      leg:                rider.status === 'ACCEPTED' ? 'leg1'
                        : rider.status === 'PICKED_UP' ? 'leg2'
                        : null,
    });
  }
  return fleet;
}
