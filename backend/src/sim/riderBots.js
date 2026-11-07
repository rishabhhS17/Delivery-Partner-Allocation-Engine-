// ─── Rider bots ──────────────────────────────────────────────────────────────
// Every rider is a bot (decision B3). Once a tick each bot works out where its rider is on the
// leg the engine gave it (decision B2) and reports back, the way a rider's phone would: a new
// position, "I've arrived", "I've collected the food". The engine decides everything else.
//
// The bots keep no state: a position is a pure function of the leg (start time + route) and the
// clock, so after a restart every rider carries on from where they should be (decision B5).
// TODO(real-riders): a real rider's GPS pings and app taps would call the same engine commands.

import { RIDER_SPEED_KMH, TICK_INTERVAL_MS } from '../config/constants.js';
import { positionAlongLeg } from '../utils/polyline.js';
import {
  getRiderTasks,
  reportRiderPosition,
  riderArrived,
  riderCollectedFood,
} from '../engine/index.js';

const RIDER_SPEED_METRES_PER_SECOND = RIDER_SPEED_KMH / 3.6;

let botTimer = null;
let lastTickMs = null;

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
  for (const task of getRiderTasks()) {
    if (task.status === 'WAITING') {
      if (now >= task.waitingUntil) riderCollectedFood(task.riderId);
      continue;
    }
    if (!task.leg) continue; // idle: stays where they are

    const metresTravelled = RIDER_SPEED_METRES_PER_SECOND * (now - task.leg.startedAtMs) / 1000;
    const position = positionAlongLeg(task.leg, metresTravelled);
    reportRiderPosition(task.riderId, position.lat, position.lng, position.segmentIdx);
    if (position.isComplete) riderArrived(task.riderId);
  }
}
