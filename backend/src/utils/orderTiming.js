import { haversine } from './haversine.js';
import {
  PREP_TIME_MIN_S,
  PREP_TIME_MAX_S,
  JIT_GRACE_MIN_S,
  JIT_GRACE_MAX_S,
  FIRST_MILE_NOMINAL_S,
  ORDER_DEADLINE_SLACK_S,
  RIDER_SPEED_KMH,
} from '../config/constants.js';

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

// Single source of truth for the timing fields every order gets at creation, no matter which
// path creates it (single / bulk / auto). Keeps prep, JIT grace and the absolute deadline
// consistent across the codebase.
//
//   prepReadyAt = now + prepTime_s                      (food ready)
//   jitGrace_s  = random [1,20] s, drawn ONCE here       (stable per order)
//   promisedBy  = now + FIRST_MILE_NOMINAL_S + prepTime_s + lastMile_s + ORDER_DEADLINE_SLACK_S
//                 (rider-independent — no rider exists yet, so first-mile is a nominal constant)
export function buildOrderTimingFields({
  restaurantLat,
  restaurantLng,
  customerLat,
  customerLng,
  now = new Date(),
}) {
  const prepTime_s  = randInt(PREP_TIME_MIN_S, PREP_TIME_MAX_S);
  const jitGrace_s  = randInt(JIT_GRACE_MIN_S, JIT_GRACE_MAX_S);
  const prepReadyAt = new Date(now.getTime() + prepTime_s * 1000);

  const lastMile_s =
    haversine(
      { lat: restaurantLat, lng: restaurantLng },
      { lat: customerLat, lng: customerLng }
    ) / RIDER_SPEED_KMH * 3600;

  const promisedBy = new Date(
    now.getTime() +
      (FIRST_MILE_NOMINAL_S + prepTime_s + lastMile_s + ORDER_DEADLINE_SLACK_S) * 1000
  );

  return { prepTime_s, jitGrace_s, prepReadyAt, promisedBy };
}
