// ─── Kitchen bot ─────────────────────────────────────────────────────────────
// Stands in for the restaurants (decision H3). For each new order it decides once, at the rates
// set in Settings, whether the restaurant rejects it, the food runs late, the food is early, or
// all goes to plan — and acts like a real kitchen would: a reject comes within seconds, a delay
// or early finish is announced halfway through the original estimate.
// It only plans orders placed after it started, so a restart never re-rolls an order's fate.

import { TICK_INTERVAL_MS, getKitchenBotBehaviour } from '../config/constants.js';
import { getKitchenTickets, updatePrepEstimate, restaurantRejectedOrder } from '../engine/index.js';

const MINUTE_MS = 60_000;

const plansByOrder = new Map(); // orderId → { action, actAt, foodReadyAt, isDone }

// Presenter buttons (decision I3): the newest order still being prepared is rejected, delayed or
// finished early — at once, rather than halfway through its estimate.
const forcedKitchenActions = [];  // 'reject' | 'delay' | 'early', oldest first

export function forceNextKitchenAction(action) {
  forcedKitchenActions.push(action);
}

export function getForcedKitchenActions() {
  return [...forcedKitchenActions];
}

let kitchenTimer = null;
let startedAt = null;

export function startKitchenBot() {
  if (kitchenTimer) return;
  startedAt = Date.now();
  kitchenTimer = setInterval(runKitchens, TICK_INTERVAL_MS);
}

export function stopKitchenBot() {
  clearInterval(kitchenTimer);
  kitchenTimer = null;
}

function runKitchens() {
  const now = Date.now();
  const liveOrderIds = new Set();
  const tickets = getKitchenTickets();
  applyForcedAction(tickets, now);
  for (const ticket of tickets) {
    liveOrderIds.add(ticket.orderId);
    let plan = plansByOrder.get(ticket.orderId);
    if (!plan) {
      if (!ticket.placedAt || new Date(ticket.placedAt).getTime() < startedAt) continue;
      plan = planOrder(ticket);
      plansByOrder.set(ticket.orderId, plan);
    }
    if (plan.isDone || now < plan.actAt) continue;
    plan.isDone = true;
    const act = plan.action === 'reject'
      ? restaurantRejectedOrder(ticket.orderId)
      : updatePrepEstimate(ticket.orderId, new Date(Math.max(plan.foodReadyAt, now)));
    act.then((result) => { if (result === 'failed') plan.isDone = false; });
  }
  for (const orderId of plansByOrder.keys()) if (!liveOrderIds.has(orderId)) plansByOrder.delete(orderId);
}

function applyForcedAction(tickets, now) {
  if (!forcedKitchenActions.length) return;
  const newestOpen = tickets
    .filter(ticket => !plansByOrder.get(ticket.orderId)?.isDone || plansByOrder.get(ticket.orderId)?.action === 'on_time')
    .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt))[0];
  if (!newestOpen) return; // wait for an order
  const action = forcedKitchenActions.shift();
  const behaviour = getKitchenBotBehaviour();
  const readyAtMs = new Date(newestOpen.foodReadyAt).getTime();
  const between = (min, max) => min + Math.random() * (max - min);
  const foodReadyAt = action === 'delay'
    ? readyAtMs + between(behaviour.delayMinMinutes, behaviour.delayMaxMinutes) * MINUTE_MS
    : readyAtMs - between(behaviour.earlyMinMinutes, behaviour.earlyMaxMinutes) * MINUTE_MS;
  plansByOrder.set(newestOpen.orderId, { action, actAt: now, foodReadyAt, isDone: false });
}

function planOrder(ticket) {
  const behaviour = getKitchenBotBehaviour();
  const placedAtMs = new Date(ticket.placedAt).getTime();
  const readyAtMs = new Date(ticket.foodReadyAt).getTime();
  const halfwayMs = placedAtMs + (readyAtMs - placedAtMs) / 2;
  const between = (min, max) => min + Math.random() * (max - min);

  const roll = Math.random() * 100;
  if (roll < behaviour.rejectPercent) {
    return { action: 'reject', actAt: placedAtMs + between(5, 20) * 1000, isDone: false };
  }
  if (roll < behaviour.rejectPercent + behaviour.delayPercent) {
    const delayMs = between(behaviour.delayMinMinutes, behaviour.delayMaxMinutes) * MINUTE_MS;
    return { action: 'delay', actAt: halfwayMs, foodReadyAt: readyAtMs + delayMs, isDone: false };
  }
  if (roll < behaviour.rejectPercent + behaviour.delayPercent + behaviour.earlyPercent) {
    const earlyMs = between(behaviour.earlyMinMinutes, behaviour.earlyMaxMinutes) * MINUTE_MS;
    return { action: 'early', actAt: halfwayMs, foodReadyAt: readyAtMs - earlyMs, isDone: false };
  }
  return { action: 'on_time', actAt: Infinity, isDone: true };
}
