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
  for (const ticket of getKitchenTickets()) {
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
