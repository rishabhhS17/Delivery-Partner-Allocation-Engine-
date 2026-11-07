import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { tryAcquireLease, releaseLease } from './storage.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('lease');

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
      log.warn('lease check failed', { instanceId, error: err.message });
      isHeld = isLeader;
    }
    try {
      if (isHeld && !isLeader) {
        isLeader = true;
        log.info('this instance is now the dispatcher', { instanceId });
        try {
          await onElected();
        } catch (err) {
          // Could not start (e.g. the database dropped mid-startup): give the lease back and
          // try again on the next check.
          log.error('starting as dispatcher failed', { instanceId, error: err.message });
          isLeader = false;
          await releaseLease(DISPATCHER_LEASE, instanceId).catch(() => {});
        }
      } else if (!isHeld && isLeader) {
        isLeader = false;
        log.warn('lost the dispatcher lease', { instanceId });
        await onDeposed();
      } else if (!isHeld && leaseTimer === null) {
        log.info('waiting, another instance is dispatching', { instanceId });
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
  log.info('released the dispatcher lease', { instanceId });
}
