import { TICK_INTERVAL_MS } from '../config/constants.js';
import { pendingQueue, runtime } from './state.js';
import { publish, buildFleetSnapshot } from './broadcast.js';
import { isDatabaseAvailable } from './storage.js';
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
  // No decision is made unless it can be saved: while the database is down, dispatch pauses.
  // Rider movement and the live stream carry on; dispatch resumes on its own (decision E3).
  if (!isDatabaseAvailable()) {
    if (!runtime.isDispatchPaused) {
      runtime.isDispatchPaused = true;
      console.warn('[engine] database unavailable — dispatch paused');
      publish('simulation:status', { running: runtime.running, dispatchPaused: true });
    }
    return;
  }
  if (runtime.isDispatchPaused) {
    runtime.isDispatchPaused = false;
    console.log('[engine] database back — dispatch resumed');
    publish('simulation:status', { running: runtime.running, dispatchPaused: false });
  }

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
// Sends the whole fleet every second (decision C3), independent of dispatch, so the map keeps
// moving even while a dispatch round is waiting on the database.

export function startBroadcastLoop() {
  runtime.broadcastTimer = setInterval(() => {
    publish('simulation:tick', { riders: buildFleetSnapshot(), queueDepth: pendingQueue.size });
  }, TICK_INTERVAL_MS);
}
