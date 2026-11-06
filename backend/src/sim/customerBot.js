// ─── Customer bot ────────────────────────────────────────────────────────────
// Stands in for customers: places a random order at a fixed interval. Customers only place
// orders; they never cancel or go missing (decision H3).

import { AUTO_ORDER_INTERVAL_MS } from '../config/constants.js';
import { placeOrder } from '../engine/index.js';

let orderTimer = null;

export function startCustomerBot() {
  if (orderTimer) return;
  orderTimer = setInterval(async () => {
    try {
      await placeOrder();
    } catch (err) {
      console.error('[customerBot] auto order creation failed:', { error: err.message });
    }
  }, AUTO_ORDER_INTERVAL_MS);
}
