import { monitorEventLoopDelay } from 'node:perf_hooks';
import { riderState, pendingQueue, runtime } from './state.js';
import { isDatabaseAvailable, pingDatabase } from './storage.js';

// ─── Engine health ───────────────────────────────────────────────────────────
// The numbers behind GET /api/health and the dashboard's "Engine health" card (decision E6):
// is the single Node thread keeping up, how long the engine's own work takes, and how the
// database is doing.

const NANOSECONDS_PER_MS = 1e6;
const EVENT_LOOP_WINDOW_MS = 30_000;
const RECENT_ASSIGNMENTS_TRACKED = 50;

// Event-loop delay: how late timers fire because the thread was busy. Reported per 30 s window.
// Node samples with a 20 ms timer and records the whole interval, so the sampling interval is
// subtracted to leave only the lag (on Windows a few ms of timer rounding remain).
const SAMPLING_INTERVAL_MS = 20;
const eventLoopDelay = monitorEventLoopDelay({ resolution: SAMPLING_INTERVAL_MS });
eventLoopDelay.enable();
const lagMs = (nanoseconds) => Math.max(0, Math.round(nanoseconds / NANOSECONDS_PER_MS - SAMPLING_INTERVAL_MS));
let lastEventLoopWindow = null;
setInterval(() => {
  lastEventLoopWindow = summariseEventLoopDelay();
  eventLoopDelay.reset();
}, EVENT_LOOP_WINDOW_MS).unref();

function summariseEventLoopDelay() {
  if (!eventLoopDelay.count) return null;
  return {
    p50: lagMs(eventLoopDelay.percentile(50)),
    p99: lagMs(eventLoopDelay.percentile(99)),
    max: lagMs(eventLoopDelay.max),
  };
}

const lastDurationsMs = { dispatchRound: null, broadcast: null };
const recentTimeToAssignMs = [];

export function recordDispatchRoundMs(ms) { lastDurationsMs.dispatchRound = Math.round(ms); }
export function recordBroadcastMs(ms)     { lastDurationsMs.broadcast = Math.round(ms * 10) / 10; }

/** Time from an order being placed to a rider being assigned (includes the deliberate JIT wait). */
export function recordTimeToAssignMs(ms) {
  recentTimeToAssignMs.push(ms);
  if (recentTimeToAssignMs.length > RECENT_ASSIGNMENTS_TRACKED) recentTimeToAssignMs.shift();
}

function summariseTimeToAssign() {
  if (!recentTimeToAssignMs.length) return null;
  const sorted = [...recentTimeToAssignMs].sort((a, b) => a - b);
  const averageMs = sorted.reduce((sum, ms) => sum + ms, 0) / sorted.length;
  return {
    average_s: Math.round(averageMs / 1000),
    p90_s:     Math.round(sorted[Math.floor(sorted.length * 0.9)] / 1000),
    sampleSize: sorted.length,
  };
}

export async function getEngineHealth() {
  let ordersInDelivery = 0;
  for (const rider of riderState.values()) ordersInDelivery += rider.orders.size;

  return {
    running:          runtime.running,
    isDispatchPaused: runtime.isDispatchPaused,
    eventLoopDelayMs: lastEventLoopWindow ?? summariseEventLoopDelay(),
    lastDispatchRoundMs: lastDurationsMs.dispatchRound,
    lastBroadcastMs:     lastDurationsMs.broadcast,
    queues: {
      pendingOrders: pendingQueue.size,
      ordersInDelivery,
      liveRiders:    riderState.size,
    },
    timeToAssign: summariseTimeToAssign(),
    database: {
      isConnected: isDatabaseAvailable(),
      pingMs:      isDatabaseAvailable() ? await pingDatabase() : null,
    },
  };
}
