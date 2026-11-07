import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';
import Order from '../models/Order.js';
import { placeOrder } from '../engine/index.js';

const router = express.Router();
const MAX_EXTERNAL_ID_LENGTH = 100;

// The upstream order service authenticates with its own key, not a user login (decision H2).
function requireServiceKey(req, res, next) {
  if (!config.orderServiceKey) {
    return res.status(503).json({ success: false, message: 'Order intake is not configured' });
  }
  const sent = Buffer.from(String(req.headers['x-service-key'] ?? ''));
  const expected = Buffer.from(config.orderServiceKey);
  if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
    return res.status(401).json({ success: false, message: 'Invalid service key' });
  }
  next();
}

// POST /api/intake/orders  body: { externalOrderId, customerId?, restaurantId? }
// The same externalOrderId always yields the same order: a retry returns the existing one (200)
// instead of creating a duplicate, even across restarts, because the id is unique in the DB.
router.post('/orders', requireServiceKey, async (req, res, next) => {
  try {
    const { externalOrderId, customerId, restaurantId } = req.body ?? {};
    if (typeof externalOrderId !== 'string' || !externalOrderId.trim() || externalOrderId.length > MAX_EXTERNAL_ID_LENGTH) {
      return res.status(400).json({ success: false, message: `externalOrderId must be a non-empty string up to ${MAX_EXTERNAL_ID_LENGTH} characters` });
    }
    if (Boolean(customerId) !== Boolean(restaurantId)) {
      return res.status(400).json({ success: false, message: 'Give both customerId and restaurantId, or neither to auto-pick a pair' });
    }

    const existing = await Order.findOne({ externalOrderId }).lean();
    if (existing) return res.json({ success: true, isDuplicate: true, data: existing });

    try {
      const order = await placeOrder({ customerId, restaurantId, externalOrderId });
      return res.status(201).json({ success: true, isDuplicate: false, data: order });
    } catch (err) {
      // Two identical retries arrived together: the unique index let only one through.
      if (err.code === 11000) {
        return res.json({ success: true, isDuplicate: true, data: await Order.findOne({ externalOrderId }).lean() });
      }
      if (err.statusCode) res.status(err.statusCode);
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

export default router;
