export const H3_RESOLUTION          = 7;
export const H3_CANDIDATE_K         = 20;
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

export const RANCHI_BOUNDS = {
  minLat: 23.25, maxLat: 23.45,
  minLng: 85.25, maxLng: 85.45,
};

// ── Mutable runtime config ───────────────────────────────────────────────────
// Tunable at runtime via /config without a restart. TTL and the two K radii are read at
// query time, so changes apply immediately. H3 `resolution` is read wherever a cell is
// computed, but riders are indexed into h3Buckets at hydration time — so a resolution change
// only fully takes effect after the simulation is restarted (stop → start re-buckets the fleet).

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
  candidateK:         H3_CANDIDATE_K,
  restaurantServiceK: RESTAURANT_SERVICE_K,
};

export function getH3Config() {
  return currentH3;
}

export function setH3Config({ resolution, candidateK, restaurantServiceK } = {}) {
  const next = { ...currentH3 };
  if (resolution !== undefined) {
    if (!Number.isInteger(resolution) || resolution < 0 || resolution > 15)
      throw new Error('resolution must be an integer between 0 and 15');
    next.resolution = resolution;
  }
  if (candidateK !== undefined) {
    if (!Number.isInteger(candidateK) || candidateK < 0)
      throw new Error('candidateK must be a non-negative integer');
    next.candidateK = candidateK;
  }
  if (restaurantServiceK !== undefined) {
    if (!Number.isInteger(restaurantServiceK) || restaurantServiceK < 0)
      throw new Error('restaurantServiceK must be a non-negative integer');
    next.restaurantServiceK = restaurantServiceK;
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
