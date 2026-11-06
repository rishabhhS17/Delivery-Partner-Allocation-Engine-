import { TICK_INTERVAL_MS } from '../config/constants.js';
import { riderState, pendingQueue, runtime } from './state.js';
import { _cancelExpiredOrders, _chooseAssignment, _commitAssignment } from './dispatch.js';

// ─── Dispatch loop ───────────────────────────────────────────────────────────
// One dispatch round about every second. A round awaits its database writes (an assignment is
// only announced once saved), so rounds never overlap: the next one is scheduled when the
// previous finishes, and manual dispatch joins the same line through runExclusive.
// Rider movement is not done here: the rider bots (src/sim) move riders and report back.

let dispatchLine = Promise.resolve();

/** Run fn after any dispatch work already in progress, so two decisions never interleave. */
export function runExclusive(fn) {
  const run = dispatchLine.then(fn);
  dispatchLine = run.catch(() => {});
  return run;
}

export function startDispatchLoop() {
  const scheduleNextRound = () => {
    if (!runtime.running) return;
    runtime.dispatchTimer = setTimeout(() => {
      runExclusive(runDispatchRound)
        .catch(err => console.error('[engine] dispatch round failed:', err))
        .finally(scheduleNextRound);
    }, TICK_INTERVAL_MS);
  };
  scheduleNextRound();
}

export function stopLoops() {
  clearTimeout(runtime.dispatchTimer);
  clearInterval(runtime.broadcastTimer);
  runtime.dispatchTimer = null;
  runtime.broadcastTimer = null;
}

async function runDispatchRound() {
  // Phase 1 — drop orders that waited too long after becoming dispatchable.
  await _cancelExpiredOrders(Date.now());

  // Phase 2 — allocate pending orders (marginal-cost clubbing + JIT hold + force-assign)
  for (const [orderId, order] of [...pendingQueue]) {
    if (!pendingQueue.has(orderId)) continue;
    const decision = _chooseAssignment(orderId, order, Date.now());
    if (decision) await _commitAssignment(decision);
  }
}

// ─── Broadcast loop ──────────────────────────────────────────────────────────
// Sends the fleet every second, independent of dispatch, so the map keeps moving even while a
// dispatch round is waiting on the database.

export function startBroadcastLoop() {
  runtime.broadcastTimer = setInterval(() => {
    if (!runtime.io) return;
    runtime.io.emit('simulation:tick', {
      riders:     buildFleetSnapshot(),
      queueDepth: pendingQueue.size,
    });
  }, TICK_INTERVAL_MS);
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
