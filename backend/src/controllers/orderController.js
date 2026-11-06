import Order from '../models/Order.js';
import { createOrder, bulkCreateOrders } from '../services/orderGenerator.js';
import { addPendingOrder, isSimulationRunning } from '../services/simulation/index.js';

// In-memory idempotency cache — prevents duplicate orders from slow-network retries.
// Keys expire after 60 s; the Map is pruned on each write (bounded by request rate).
const _seen = new Map();
const KEY_TTL_MS = 60_000;

function _isDuplicate(key) {
  if (!key) return false;
  const now = Date.now();
  for (const [k, t] of _seen) if (now - t > KEY_TTL_MS) _seen.delete(k);
  if (_seen.has(key)) return true;
  _seen.set(key, now);
  return false;
}

export const createSingleOrder = async (req, res, next) => {
  try {
    if (_isDuplicate(req.headers['x-idempotency-key'])) {
      return res.status(409).json({ success: false, message: 'Duplicate request — order already being created' });
    }
    if (!isSimulationRunning()) {
      return res.status(409).json({
        success: false,
        message: 'Simulation is currently stopped. Start simulation before creating live orders.',
      });
    }

    const { customerId, restaurantId } = req.body ?? {};
    if ((customerId && !restaurantId) || (!customerId && restaurantId)) {
      res.status(400);
      throw new Error('Both customerId and restaurantId are required together, or omit both to auto-pick a pair');
    }

    const order = await createOrder({ customerId, restaurantId });
    addPendingOrder(order);
    res.status(201).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

export const createBulkOrders = async (req, res, next) => {
  try {
    if (_isDuplicate(req.headers['x-idempotency-key'])) {
      return res.status(409).json({ success: false, message: 'Duplicate request — bulk orders already being created' });
    }
    const count = parseInt(req.body.count, 10);
    if (!count || count < 1 || count > 100) {
      res.status(400);
      throw new Error('count must be a number between 1 and 100');
    }
    const orders = await bulkCreateOrders(count);
    orders.forEach(addPendingOrder);
    res.status(201).json({ success: true, created: orders.length, requested: count });
  } catch (err) {
    next(err);
  }
};

export const getAllOrders = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    // Cap results. Orders accumulate indefinitely in the simulation (DELIVERED /
    // CANCELLED are never deleted), so an unbounded find() made both the DB sort
    // and the JSON payload grow without limit — the main cause of the Orders page
    // being slow, especially over the deployed network hop. The table only ever
    // shows recent activity, so return the most recent N.
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('-polyline -leg1Coords -leg2Coords')  // table doesn't use them; map gets them live over the socket
      .populate('assignedRiderId', 'name')
      .lean();
    res.json({ success: true, data: orders });
  } catch (err) {
    next(err);
  }
};

export const getOrderById = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) { res.status(404); throw new Error('Order not found'); }
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};
