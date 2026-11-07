import { OFFER_TIMEOUT_MS, IGNORED_OFFERS_BEFORE_OFFLINE } from '../config/constants.js';
import { riderState, pendingQueue } from './state.js';
import { saveOffer, clearOffer, saveRiderAvailability, appendOrderEvent } from './storage.js';
import { publish } from './broadcast.js';
import { scheduleWake, unscheduleWake } from './wakeList.js';
import { _commitAssignment, _decisionForRider } from './dispatch.js';
import { _applyRiderAvailability } from './riderLifecycle.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('engine');

// ─── Offers ──────────────────────────────────────────────────────────────────
// A rider is offered an order rather than handed it (decision G3) — a second order for a busy
// rider (clubbing) too: they keep riding while the offer is open (decision K5). The offer is saved on the
// order with its expiry time, so it survives a restart. The rider accepts (the assignment is
// then saved as usual), rejects (they are never offered that order again), or lets 30 s pass —
// an ignore. Three ignores in a row and the rider is switched offline. A rider holds at most
// one offer at a time, and an offered order stays PENDING, out of the wake-up list.
// Everything here runs inside the dispatch line (runExclusive), never alongside a decision.

// orderId → { order, riderId, expiresAtMs, decision } — decision is the scoring that chose the
// rider; it is not saved, so after a restart the order is scored again for that rider on accept.
const openOffers = new Map();

export function clearOffers() {
  openOffers.clear();
}

/** Offer the chosen rider the order. Returns false when the offer could not be saved. */
export async function _makeOffer(decision) {
  const { orderId, order, winnerId } = decision;
  const rider = riderState.get(winnerId);
  const expiresAtMs = Date.now() + OFFER_TIMEOUT_MS;
  let isSaved;
  try {
    isSaved = await saveOffer(order._id, rider._id, expiresAtMs);
  } catch (err) {
    log.error('offer write failed, order stays queued', { orderId, riderId: winnerId, error: err.message });
    return false;
  }
  if (!isSaved) return false;
  trackOffer(order, rider, expiresAtMs, decision);
  appendOrderEvent(order._id, 'offered', { riderId: rider._id, details: { expiresAt: new Date(expiresAtMs) } });
  publish('order:offered', { orderId, riderId: winnerId, riderName: rider.name, expiresAt: expiresAtMs });
  return true;
}

function trackOffer(order, rider, expiresAtMs, decision = null) {
  const orderId = order._id.toString();
  unscheduleWake(orderId);
  openOffers.set(orderId, { order, riderId: rider._id.toString(), expiresAtMs, decision });
  rider.openOffer = { orderId, expiresAtMs };
}

/** After a restart: an offer saved on a PENDING order is open again until it expires. */
export function _restoreOffer(order) {
  const rider = riderState.get(String(order.offer.riderId));
  if (!rider) return false;
  trackOffer(order, rider, new Date(order.offer.expiresAt).getTime());
  return true;
}

/** @returns {Promise<'assigned'|'not_offered'|'failed'>} */
export async function _acceptOffer(riderId, orderId) {
  const offer = openOffers.get(orderId);
  if (!offer || offer.riderId !== riderId) return 'not_offered';
  const rider = riderState.get(riderId);
  // The rider kept riding while the offer was open, so check the order still fits their stops
  // now. The original scoring is kept for the record when there is one (not after a restart).
  const fitsNow = rider && _decisionForRider(orderId, offer.order, rider, Date.now());
  const decision = fitsNow && (offer.decision ?? fitsNow);
  if (!decision) {
    // The rider can no longer fit this order in (their stops changed since the offer): hand it
    // back to dispatch. Not a reject — they may be offered it again later.
    try { await clearOffer(offer.order._id, {}); } catch { return 'failed'; }
    closeOffer(orderId);
    scheduleWake(orderId, Date.now());
    return 'not_offered';
  }
  const assignment = await _commitAssignment(decision);
  if (!assignment && pendingQueue.has(orderId)) return 'failed'; // the save failed: the rider may accept again
  closeOffer(orderId);
  if (rider) rider.ignoredOffersInARow = 0;
  return assignment ? 'assigned' : 'not_offered';
}

/** @returns {Promise<'rejected'|'not_offered'|'failed'>} */
export async function _rejectOffer(riderId, orderId) {
  const offer = openOffers.get(orderId);
  if (!offer || offer.riderId !== riderId) return 'not_offered';
  try {
    await clearOffer(offer.order._id, { rejectedRiderId: riderId });
  } catch (err) {
    log.error('offer reject write failed, rider may reject again', { orderId, riderId, error: err.message });
    return 'failed';
  }
  const order = offer.order;
  order.rejectedRiderIds = [...(order.rejectedRiderIds ?? []), riderId];
  closeOffer(orderId);
  const rider = riderState.get(riderId);
  if (rider) rider.ignoredOffersInARow = 0;
  appendOrderEvent(order._id, 'offer_rejected', { riderId });
  publish('order:offer_rejected', { orderId, riderId });
  scheduleWake(orderId, Date.now()); // back to dispatch at once, without this rider
  return 'rejected';
}

/** Offers nobody answered in time count as ignored; the order goes back to dispatch. */
export async function _expireOffers(now) {
  for (const [orderId, offer] of [...openOffers]) {
    if (offer.expiresAtMs > now) continue;
    try {
      await clearOffer(offer.order._id, {});
    } catch (err) {
      log.error('offer expiry write failed, will retry', { orderId, error: err.message });
      continue;
    }
    closeOffer(orderId);
    appendOrderEvent(offer.order._id, 'offer_ignored', { riderId: offer.riderId });
    publish('order:offer_ignored', { orderId, riderId: offer.riderId });
    if (pendingQueue.has(orderId)) scheduleWake(orderId, now);
    await countIgnoredOffer(offer.riderId);
  }
}

// Three ignored offers in a row switch the rider offline (decision G3).
async function countIgnoredOffer(riderId) {
  const rider = riderState.get(riderId);
  if (!rider) return;
  rider.ignoredOffersInARow = (rider.ignoredOffersInARow ?? 0) + 1;
  if (rider.ignoredOffersInARow < IGNORED_OFFERS_BEFORE_OFFLINE) return;
  try {
    await saveRiderAvailability(riderId, 'OFFLINE');
  } catch (err) {
    log.error('auto-offline write failed', { riderId, error: err.message });
    return;
  }
  log.warn('rider ignored offers in a row, switched offline', { riderId, ignored: rider.ignoredOffersInARow });
  publish('rider:auto_offline', { riderId, riderName: rider.name });
  await _applyRiderAvailability(riderId, 'OFFLINE');
}

/** The order left dispatch some other way (cancelled): withdraw its offer, if any. */
export function _withdrawOffer(orderId) {
  if (openOffers.has(orderId)) closeOffer(orderId);
}

function closeOffer(orderId) {
  const offer = openOffers.get(orderId);
  openOffers.delete(orderId);
  const rider = offer && riderState.get(offer.riderId);
  if (rider?.openOffer?.orderId === orderId) rider.openOffer = null;
}
