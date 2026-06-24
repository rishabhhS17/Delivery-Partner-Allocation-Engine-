export const H3_RESOLUTION          = 7;
export const H3_CANDIDATE_K         = 2;
export const H3_SERVICE_AREA_K      = 5;

export const RIDER_SPEED_KMH        = 40;
export const TICK_INTERVAL_MS       = 1000;
export const RIDER_SEED_COUNT       = 32;
export const AUTO_ORDER_INTERVAL_MS = 600_000;
export const LOAD_WINDOW_MINUTES    = 60;
export const MAX_ALLOCATION_RETRIES = 10;
export const MIN_RIDER_SPEED_MS     = 3;

export const DEFAULT_WEIGHTS = { etar: 0.50, rating: 0.30, load: 0.20 };

export const RANCHI_BOUNDS = {
  minLat: 23.25, maxLat: 23.45,
  minLng: 85.25, maxLng: 85.45,
};

// Mutable runtime weights — updated via PUT /config/weights without a restart
let currentWeights = { ...DEFAULT_WEIGHTS };

export function getWeights() {
  return currentWeights;
}

export function setWeights({ etar, rating, load }) {
  const total = etar + rating + load;
  currentWeights = {
    etar:   etar   / total,
    rating: rating / total,
    load:   load   / total,
  };
}
