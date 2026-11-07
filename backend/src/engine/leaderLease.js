import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { tryAcquireLease, releaseLease } from './storage.js';

// ─── Leader lease ────────────────────────────────────────────────────────────
// During a deploy Render briefly runs the old and new instance side by side. Only the instance
// holding this lease runs the engine and the bots; the other just serves the API. The leader
// renews the lease every few seconds and releases it at shutdown, so the new instance takes over
// within one check. If the leader crashes instead, the lease expires and is taken over then.

const DISPATCHER_LEASE = 'dispatcher';
const LEASE_DURATION_MS = 15_000;
const LEASE_CHECK_EVERY_MS = 5_000;

const instanceId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
let leaseTimer = null;
let isLeader = false;

export function isThisInstanceLeader() {
  return isLeader;
}

/**
 * Keep trying to hold the lease. onElected runs when this instance becomes leader, onDeposed if
 * it loses the lease (it could not renew in time and another instance took over).
 */
export function startLeaderElection({ onElected, onDeposed }) {
  const checkLease = async () => {
    let isHeld = false;
    try {
      isHeld = await tryAcquireLease(DISPATCHER_LEASE, instanceId, LEASE_DURATION_MS);
    } catch (err) {
      // Database unreachable: a leader keeps leading until its lease could have expired, which
      // the engine already handles by pausing dispatch (decision E3).
      console.warn('[lease] check failed:', err.message);
      isHeld = isLeader;
    }
    try {
      if (isHeld && !isLeader) {
        isLeader = true;
        console.log(`[lease] ${instanceId} is now the dispatcher`);
        try {
          await onElected();
        } catch (err) {
          // Could not start (e.g. the database dropped mid-startup): give the lease back and
          // try again on the next check.
          console.error('[lease] starting as dispatcher failed:', err.message);
          isLeader = false;
          await releaseLease(DISPATCHER_LEASE, instanceId).catch(() => {});
        }
      } else if (!isHeld && isLeader) {
        isLeader = false;
        console.warn(`[lease] ${instanceId} lost the dispatcher lease`);
        await onDeposed();
      } else if (!isHeld && leaseTimer === null) {
        console.log(`[lease] ${instanceId} waiting — another instance is dispatching`);
      }
    } finally {
      leaseTimer = setTimeout(checkLease, LEASE_CHECK_EVERY_MS);
    }
  };
  checkLease();
}

/** Stop checking and hand the lease back so a waiting instance can take over at once. */
export async function resignLeadership() {
  clearTimeout(leaseTimer);
  leaseTimer = undefined;
  if (!isLeader) return;
  isLeader = false;
  await releaseLease(DISPATCHER_LEASE, instanceId);
  console.log(`[lease] ${instanceId} released the dispatcher lease`);
}
