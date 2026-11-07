export const H3_RESOLUTION          = 7;
export const H3_SERVICE_AREA_K      = 5;
// Rings of H3 res-7 cells (~2 km each) that define a customer's restaurant service
// area — restaurants outside this hexagon disk aren't shown when ordering.
export const RESTAURANT_SERVICE_K   = 2;

export const RIDER_SPEED_KMH        = 40;
export const TICK_INTERVAL_MS       = 1000;
// Max wall-clock time an order may sit PENDING (waiting for a rider) before it is
// dropped and marked CANCELLED. Tunable; kept short so it is observable in a demo.
export const ORDER_TTL_MS           = 180_000; // 180 s
export const RIDER_SEED_COUNT       = 32;
export const AUTO_ORDER_INTERVAL_MS = 600_000;
export const LOAD_WINDOW_MINUTES    = 60;
export const MAX_ALLOCATION_RETRIES = 10;
export const MIN_RIDER_SPEED_MS     = 3;

export const DEFAULT_WEIGHTS = { etar: 0.71, load: 0.29 };

// ── Multi-order clubbing dispatch engine (feature/multi-order-engine) ──────────
// Stage 1 — food-prep + just-in-time hold. Prep is a random duration per order;
// JIT_GRACE is also random per order (drawn once at creation, stored on the order),
// biased small so a rider arrives slightly early (brief WAITING) rather than late.
export const PREP_TIME_MIN_S = 300;
export const PREP_TIME_MAX_S = 900;
export const JIT_GRACE_MIN_S = 1;
export const JIT_GRACE_MAX_S = 20;

// Stage 2 — the authority for "in range". H3 is only candidate generation; a rider
// is a real candidate only if its LIVE haversine distance to the restaurant is within
// maxRangeKm. Runtime-tunable via PUT /config/h3. The H3 search ring is derived from it
// (see searchRingSize in services/allocationEngine.js), so there is no separate ring knob.
export const MAX_ALLOCATION_RANGE_KM = 5;
// Only this many of the nearest in-range riders are scored for an order (decision F1).
export const MAX_SCORED_CANDIDATES = 50;
// An order with no rider in range is looked at again after these delays (then every 10 s).
export const NO_RIDER_RETRY_DELAYS_MS = [1000, 2000, 4000, 10_000];

// Memory bounds, so nothing grows without limit under load (decision E1).
// Past this many waiting orders, new orders are refused with "try again shortly" — a safety
// limit far above Ranchi's normal queue (a few hundred at peak), not an overload policy.
export const MAX_PENDING_ORDERS = 5000;

// Rider offers (decision G3): how long a rider has to answer, and how many unanswered offers
// in a row switch them offline.
export const OFFER_TIMEOUT_MS = 30_000;
export const IGNORED_OFFERS_BEFORE_OFFLINE = 3;

// The search widens while an order goes unassigned (decision G1): the configured max range at
// first, then 7 km after 60 s and 10 km after 120 s of trying (the TTL still cancels it).
export const SEARCH_WIDENING_STEPS = [
  { afterMs: 60_000,  rangeKm: 7 },
  { afterMs: 120_000, rangeKm: 10 },
];

/** How far to look for riders for an order that has been in dispatch for elapsedMs. */
export function searchRangeKm(elapsedMs) {
  let rangeKm = getH3Config().maxRangeKm;
  for (const step of SEARCH_WIDENING_STEPS) {
    if (elapsedMs >= step.afterMs) rangeKm = Math.max(rangeKm, step.rangeKm);
  }
  return rangeKm;
}

// Stage 3 — capped interleaved clubbing (Model A) + anti-starvation.
export const CLUBBING_CAP                   = 2;    // N-general ceiling; nothing hardcoded to 2
export const CLUBBING_RESTAURANT_RADIUS_KM  = 1.5;  // B's restaurant near the rider's path
export const CLUBBING_DROP_RADIUS_KM        = 2;    // B's drop near an existing drop
export const CLUBBING_BEARING_TOLERANCE_DEG = 45;   // drop-to-drop compatible-direction tolerance
export const ORDER_DEADLINE_SLACK_S         = 600;  // slack baked into promisedBy
export const HEAD_FREEZE_S                  = 120;  // within this of next drop → no inserting ahead
export const FIRST_MILE_NOMINAL_S           = 300;  // rider-independent first-mile est for promisedBy
export const AGING_LOCK_S                   = 300;  // onboard order this close to promisedBy is immovable;
                                                    // a PENDING order this close to promisedBy is force-assigned

export const RANCHI_BOUNDS = {
  minLat: 23.25, maxLat: 23.45,
  minLng: 85.25, maxLng: 85.45,
};

// ── Mutable runtime config ───────────────────────────────────────────────────
// Tunable at runtime via /config without a restart. TTL and the two K radii are read at
// query time, so changes apply immediately. H3 `resolution` is read wherever a cell is
// computed, but riders are indexed into h3Buckets at hydration time — so a resolution change
// only fully takes effect after a server restart (hydrate re-buckets the fleet).

let currentOrderTtlMs = ORDER_TTL_MS;

export function getOrderTtl() {
  return currentOrderTtlMs;
}

export function setOrderTtl(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) throw new Error('TTL must be a positive number of milliseconds');
  currentOrderTtlMs = Math.round(n);
}

let currentH3 = {
  resolution:         H3_RESOLUTION,
  restaurantServiceK: RESTAURANT_SERVICE_K,
  maxRangeKm:         MAX_ALLOCATION_RANGE_KM,
};

export function getH3Config() {
  return currentH3;
}

export function setH3Config({ resolution, restaurantServiceK, maxRangeKm } = {}) {
  const next = { ...currentH3 };
  if (resolution !== undefined) {
    if (!Number.isInteger(resolution) || resolution < 0 || resolution > 15)
      throw new Error('resolution must be an integer between 0 and 15');
    next.resolution = resolution;
  }
  if (restaurantServiceK !== undefined) {
    if (!Number.isInteger(restaurantServiceK) || restaurantServiceK < 0)
      throw new Error('restaurantServiceK must be a non-negative integer');
    next.restaurantServiceK = restaurantServiceK;
  }
  if (maxRangeKm !== undefined) {
    if (typeof maxRangeKm !== 'number' || !Number.isFinite(maxRangeKm) || maxRangeKm <= 0)
      throw new Error('maxRangeKm must be a positive number');
    next.maxRangeKm = maxRangeKm;
  }
  currentH3 = next;
}

// Mutable runtime weights — updated via PUT /config/weights without a restart
let currentWeights = { ...DEFAULT_WEIGHTS };

export function getWeights() {
  return currentWeights;
}

export function setWeights({ etar, load }) {
  const total = etar + load;
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Weights must sum to a positive number — got ' + total);
  }
  currentWeights = {
    etar: etar / total,
    load: load / total,
  };
}

// ── Bot behaviour (decision G4) ──────────────────────────────────────────────
// How the simulated riders behave, adjustable live from Settings. All rates 0 = a perfect bot.
export const DEFAULT_RIDER_BOT_BEHAVIOUR = {
  replyMinS:                 2,   // seconds before a rider answers an offer…
  replyMaxS:                 8,   // …picked at random between these
  rejectPercent:             15,  // share of offers turned down
  ignorePercent:             5,   // share of offers left unanswered (they lapse after 30 s)
  cancelBeforePickupPercent: 2,   // share of accepted orders cancelled on the way to the restaurant
};

let currentRiderBotBehaviour = { ...DEFAULT_RIDER_BOT_BEHAVIOUR };

export function getRiderBotBehaviour() {
  return currentRiderBotBehaviour;
}

/** Validates and applies a partial update; throws with a readable message on bad input. */
export function setRiderBotBehaviour(update = {}) {
  const next = { ...currentRiderBotBehaviour };
  for (const key of Object.keys(DEFAULT_RIDER_BOT_BEHAVIOUR)) {
    if (update[key] === undefined) continue;
    const value = Number(update[key]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be a number of 0 or more`);
    if (key.endsWith('Percent') && value > 100) throw new Error(`${key} must be between 0 and 100`);
    next[key] = value;
  }
  if (next.replyMinS > next.replyMaxS) throw new Error('replyMinS must not be more than replyMaxS');
  if (next.rejectPercent + next.ignorePercent > 100) throw new Error('rejectPercent + ignorePercent must not exceed 100');
  currentRiderBotBehaviour = next;
}
