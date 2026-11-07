// ─── In-memory state ─────────────────────────────────────────────────────────

export const riderState        = new Map();   // riderId(string) → riderEntry
export const h3Buckets         = new Map();   // h3Cell(string)  → Set<riderId(string)>
export const pendingQueue      = new Map();   // orderId(string)  → orderDoc
export const activeRoutes      = new Map();   // orderId(string)  → { riderId, leg1Coords, leg2Coords }
export const recentAssignments = [];          // capped ring-buffer of last 20 order:assigned payloads
export const RECENT_CAP        = 20;

// Values that get reassigned live on one object, because a module cannot reassign another
// module's exported variables.
export const runtime = {
  dispatchTimer:  null,
  broadcastTimer: null,
  running:   false,
  isDispatchPaused: false,
};
