import { TICK_INTERVAL_MS, NO_RIDER_RETRY_DELAYS_MS } from '../config/constants.js';
import { pendingQueue, runtime } from './state.js';
import { publish, buildFleetSnapshot } from './broadcast.js';
import { isDatabaseAvailable, loadPendingOrders } from './storage.js';
import { recordDispatchRoundMs, recordBroadcastMs } from './health.js';
import { enqueueOrder, takeDueOrderIds, scheduleWake, nextNoRiderRetryDelay, resetNoRiderRetries } from './wakeList.js';
import {
  _cancelExpiredOrders, _chooseAssignment, _cancelOrderAfterEngineError,
} from './dispatch.js';
import { _makeOffer, _expireOffers, _withdrawOffer } from './offers.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('engine');

// How often the dispatcher looks for PENDING orders it has not heard about — ones created
// through another instance during a deploy, or by a script.
const PENDING_SYNC_EVERY_MS = 5_000;

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
      const startedAt = performance.now();
      runExclusive(runDispatchRound)
        .then(() => recordDispatchRoundMs(performance.now() - startedAt))
        .then(scheduleNextRound)
        // An error not tied to one order means the engine's own state can't be trusted: rethrow
        // so the process exits and Render restarts it from the database (decision E1).
        .catch(err => setImmediate(() => { throw err; }));
    }, TICK_INTERVAL_MS);
  };
  scheduleNextRound();
}

export function startPendingOrderSync() {
  runtime.pendingSyncTimer = setInterval(() => {
    if (!isDatabaseAvailable()) return;
    runExclusive(async () => {
      for (const order of await loadPendingOrders()) {
        const orderId = order._id.toString();
        // A stale read is harmless: the assignment's conditional save refuses a changed order.
        if (!pendingQueue.has(orderId)) enqueueOrder(order);
      }
    }).catch(err => log.error('pending order sync failed', { error: err.message }));
  }, PENDING_SYNC_EVERY_MS);
}

export function stopLoops() {
  clearTimeout(runtime.dispatchTimer);
  clearInterval(runtime.broadcastTimer);
  clearInterval(runtime.pendingSyncTimer);
  runtime.dispatchTimer = null;
  runtime.broadcastTimer = null;
  runtime.pendingSyncTimer = null;
}

async function runDispatchRound() {
  // No decision is made unless it can be saved: while the database is down, dispatch pauses.
  // Rider movement and the live stream carry on; dispatch resumes on its own (decision E3).
  if (!isDatabaseAvailable()) {
    if (!runtime.isDispatchPaused) {
      runtime.isDispatchPaused = true;
      log.warn('database unavailable, dispatch paused');
      publish('simulation:status', { running: runtime.running, dispatchPaused: true });
    }
    return;
  }
  if (runtime.isDispatchPaused) {
    runtime.isDispatchPaused = false;
    log.info('database back, dispatch resumed');
    publish('simulation:status', { running: runtime.running, dispatchPaused: false });
  }

  // Phase 1 — offers nobody answered in time go back to dispatch; orders that waited too long
  // after becoming dispatchable are cancelled (withdrawing any open offer).
  await _expireOffers(Date.now());
  for (const orderId of await _cancelExpiredOrders(Date.now())) _withdrawOffer(orderId);

  // Phase 2 — score only the orders whose wake-up time has come (marginal-cost clubbing + JIT
  // hold + force-assign); the rest sleep in the wake-up list.
  // Most urgent deadline first, so a crowded round serves the orders closest to being late.
  const dueOrders = takeDueOrderIds(Date.now())
    .map(orderId => pendingQueue.get(orderId))
    .filter(Boolean)
    .sort((a, b) => promisedByMs(a) - promisedByMs(b));
  for (const order of dueOrders) {
    const orderId = order._id.toString();
    if (!pendingQueue.has(orderId)) continue;
    let decision;
    try {
      decision = _chooseAssignment(orderId, order, Date.now());
    } catch (err) {
      await _cancelOrderAfterEngineError(orderId, order, err);
      _withdrawOffer(orderId);
      continue;
    }
    if (decision.kind === 'hold') {
      resetNoRiderRetries(orderId);
      scheduleWake(orderId, decision.wakeAt);
    } else if (decision.kind === 'no_rider') {
      scheduleWake(orderId, Date.now() + nextNoRiderRetryDelay(orderId)); // 1 → 2 → 4 → 10 s
    } else if (!(await _makeOffer(decision)) && pendingQueue.has(orderId)) {
      scheduleWake(orderId, Date.now() + NO_RIDER_RETRY_DELAYS_MS[0]); // save failed: try again shortly
    }
  }
}

// ─── Broadcast loop ──────────────────────────────────────────────────────────
// Sends the whole fleet every second (decision C3), independent of dispatch, so the map keeps
// moving even while a dispatch round is waiting on the database.

export function startBroadcastLoop() {
  runtime.broadcastTimer = setInterval(() => {
    const startedAt = performance.now();
    publish('simulation:tick', { riders: buildFleetSnapshot(), queueDepth: pendingQueue.size });
    recordBroadcastMs(performance.now() - startedAt);
  }, TICK_INTERVAL_MS);
}

function promisedByMs(order) {
  return order.promisedBy ? new Date(order.promisedBy).getTime() : Infinity;
}
