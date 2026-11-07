// ─── Rider bots ──────────────────────────────────────────────────────────────
// Every rider is a bot (decision B3). Once a tick each bot works out where its rider is on the
// leg the engine gave it (decision B2) and reports back, the way a rider's phone would: a new
// position, "I've arrived", "I've collected the food". The engine decides everything else.
//
// Movement keeps no state: a position is a pure function of the leg (start time + route) and the
// clock, so after a restart every rider carries on from where they should be (decision B5).
// The only bot memory is each rider's pending decisions (how to answer an offer, whether to
// cancel before pickup), drawn at the rates set in Settings (decision G4).
// TODO(real-riders): a real rider's GPS pings and app taps would call the same engine commands.

import { RIDER_SPEED_KMH, TICK_INTERVAL_MS, getRiderBotBehaviour } from '../config/constants.js';
import { positionAlongLeg } from '../utils/polyline.js';
import {
  getRiderTasks,
  reportRiderPosition,
  riderArrived,
  riderCollectedFood,
  acceptOffer,
  rejectOffer,
  riderCancelledOrder,
} from '../engine/index.js';

const RIDER_SPEED_METRES_PER_SECOND = RIDER_SPEED_KMH / 3.6;

let botTimer = null;
let lastTickMs = null;
// What each bot decided, so it decides once per offer / per order (the rates in Settings).
const offerReplies = new Map();      // `${riderId}:${orderId}` → { answer, answerAt, isSent }
const pickupPlans  = new Map();      // `${riderId}:${orderId}` → { cancelAt: ms | null, isSent }

// Presenter buttons (decision I3): the next offer any bot sees is rejected / ignored, or the next
// rider found heading to a pickup cancels it — at once, so the audience sees it happen.
const forcedRiderActions = [];       // 'reject' | 'ignore' | 'cancel', oldest first

export function forceNextRiderAction(action) {
  forcedRiderActions.push(action);
}

export function getForcedRiderActions() {
  return [...forcedRiderActions];
}

function takeForcedAction(kinds) {
  const index = forcedRiderActions.findIndex(action => kinds.includes(action));
  return index === -1 ? null : forcedRiderActions.splice(index, 1)[0];
}

/** How long the last rider-bot tick took, in ms (shown on /api/health). */
export function getRiderBotTickMs() {
  return lastTickMs;
}

export function startRiderBots() {
  if (botTimer) return;
  botTimer = setInterval(moveAllRiders, TICK_INTERVAL_MS);
}

export function stopRiderBots() {
  clearInterval(botTimer);
  botTimer = null;
}

function moveAllRiders() {
  const startedAt = performance.now();
  moveEachRider();
  lastTickMs = Math.round((performance.now() - startedAt) * 10) / 10;
}

function moveEachRider() {
  const now = Date.now();
  const liveKeys = new Set();
  for (const task of getRiderTasks()) {
    if (task.offer) liveKeys.add(answerOffer(task.riderId, task.offer.orderId, now));
    if (task.nextStop?.type === 'PICKUP') liveKeys.add(maybeCancelBeforePickup(task.riderId, task.nextStop.orderId, now));
    if (task.status === 'WAITING') {
      if (now >= task.waitingUntil) riderCollectedFood(task.riderId, task.nextStop.orderId);
      continue;
    }
    if (!task.leg) continue; // idle: stays where they are

    const metresTravelled = RIDER_SPEED_METRES_PER_SECOND * (now - task.leg.startedAtMs) / 1000;
    const position = positionAlongLeg(task.leg, metresTravelled);
    reportRiderPosition(task.riderId, position.lat, position.lng, position.segmentIdx);
    if (position.isComplete) riderArrived(task.riderId, task.nextStop);
  }
  forgetFinishedPlans(liveKeys);
}

// Decide once how to answer an offer — reject, ignore or accept, at the configured rates — and
// answer after a human-like pause. Returns the plan's key so finished plans can be forgotten.
function answerOffer(riderId, orderId, now) {
  const key = `${riderId}:${orderId}`;
  let reply = offerReplies.get(key);
  if (!reply) {
    const behaviour = getRiderBotBehaviour();
    const roll = Math.random() * 100;
    const forced = takeForcedAction(['reject', 'ignore']);
    const answer = forced ?? (roll < behaviour.rejectPercent ? 'reject'
      : roll < behaviour.rejectPercent + behaviour.ignorePercent ? 'ignore'
      : 'accept');
    const replyAfterS = forced ? 1 : behaviour.replyMinS + Math.random() * (behaviour.replyMaxS - behaviour.replyMinS);
    reply = { answer, answerAt: now + replyAfterS * 1000, isSent: false };
    offerReplies.set(key, reply);
  }
  if (!reply.isSent && reply.answer !== 'ignore' && now >= reply.answerAt) {
    reply.isSent = true;
    const send = reply.answer === 'reject' ? rejectOffer : acceptOffer;
    send(riderId, orderId).then((result) => { if (result === 'failed') reply.isSent = false; });
  }
  return key;
}

// Decide once per accepted order whether this rider will cancel it before pickup, and if so
// when (a few seconds into the ride to the restaurant).
function maybeCancelBeforePickup(riderId, orderId, now) {
  const key = `${riderId}:${orderId}`;
  let plan = pickupPlans.get(key);
  if (!plan) {
    const willCancel = Math.random() * 100 < getRiderBotBehaviour().cancelBeforePickupPercent;
    plan = { cancelAt: willCancel ? now + (3 + Math.random() * 15) * 1000 : null, isSent: false };
    pickupPlans.set(key, plan);
  }
  if (!plan.cancelAt && !plan.isSent && takeForcedAction(['cancel'])) plan.cancelAt = now;
  if (plan.cancelAt && !plan.isSent && now >= plan.cancelAt) {
    plan.isSent = true;
    riderCancelledOrder(riderId, orderId).then((result) => { if (result === 'failed') plan.isSent = false; });
  }
  return key;
}

function forgetFinishedPlans(liveKeys) {
  for (const key of offerReplies.keys()) if (!liveKeys.has(key)) offerReplies.delete(key);
  for (const key of pickupPlans.keys()) if (!liveKeys.has(key)) pickupPlans.delete(key);
}
