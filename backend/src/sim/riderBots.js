// ─── Rider bots ──────────────────────────────────────────────────────────────
// Every rider is a bot (decision B3). Once a tick each bot moves its rider along the leg the
// engine gave it and reports back, the way a rider's phone would: a new position, "I've
// arrived", "I've collected the food". The engine decides everything else.
// TODO(real-riders): a real rider's GPS pings and app taps would call the same engine commands.

import { TICK_INTERVAL_MS } from '../config/constants.js';
import { _advanceAlongPolyline } from '../utils/polyline.js';
import {
  getRiderTasks,
  reportRiderPosition,
  riderArrived,
  riderCollectedFood,
} from '../engine/index.js';

// riderId → the bot's own progress along its current leg.
const movementByRider = new Map();
let botTimer = null;

export function startRiderBots() {
  if (botTimer) return;
  botTimer = setInterval(moveAllRiders, TICK_INTERVAL_MS);
}

function moveAllRiders() {
  const now = Date.now();
  for (const task of getRiderTasks()) {
    if (task.status === 'WAITING') {
      if (now >= task.waitingUntil) riderCollectedFood(task.riderId);
      continue;
    }
    if (!task.leg) {
      movementByRider.delete(task.riderId);
      continue;
    }
    moveRiderAlongLeg(task, now);
  }
}

function moveRiderAlongLeg(task, now) {
  const { leg } = task;
  let movement = movementByRider.get(task.riderId);
  if (!movement || movement.legKey !== leg.key) {
    movement = {
      legKey:                   leg.key,
      legCoords:                leg.coords,
      currentSegmentIdx:        leg.startSegmentIdx,
      distanceCoveredOnSegment: leg.startDistanceOnSegment,
      lat:                      task.lat,
      lng:                      task.lng,
    };
    movementByRider.set(task.riderId, movement);
  }

  let isLegComplete;
  if (movement.legCoords.length >= 2) {
    isLegComplete = _advanceAlongPolyline(movement);
  } else {
    // No road route yet: straight line, paced by the leg's estimated duration.
    const t = Math.min(1, (now - leg.startedAtMs) / (leg.duration_s * 1000));
    movement.lat = leg.originLat + t * (leg.targetLat - leg.originLat);
    movement.lng = leg.originLng + t * (leg.targetLng - leg.originLng);
    isLegComplete = t >= 1;
  }

  reportRiderPosition(task.riderId, movement.lat, movement.lng, movement.currentSegmentIdx);
  if (isLegComplete) {
    movementByRider.delete(task.riderId);
    riderArrived(task.riderId);
  }
}
