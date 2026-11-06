import express from 'express';
import AllocationHistory from '../models/AllocationHistory.js';
import { dispatchNow } from '../engine/index.js';

const router = express.Router();

// POST /api/allocation/allocate
// Manually dispatch one PENDING order now, through the engine's normal scoring (idle and busy
// riders, clubbing), skipping only the just-in-time wait.
router.post('/allocate', (req, res, next) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ message: 'orderId required' });

    const outcome = dispatchNow(orderId);
    if (outcome.status === 'not_pending') {
      return res.status(404).json({ message: 'Order not found or not PENDING' });
    }
    if (outcome.status === 'no_rider') {
      return res.json({ assigned: false, message: 'No eligible riders in range — order stays PENDING', orderId });
    }

    const { riderId, riderName, score, breakdown, candidatesConsidered } = outcome;
    return res.json({ assigned: true, orderId, riderId, riderName, score, breakdown, candidatesConsidered });
  } catch (err) {
    next(err);
  }
});

// GET /api/allocation/history?page=1&limit=20
router.get('/history', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);

    const [records, total] = await Promise.all([
      AllocationHistory.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('orderId',  'restaurantName customerName status')
        .populate('riderId',  'name'),
      AllocationHistory.countDocuments(),
    ]);

    res.json({ total, page, limit, records });
  } catch (err) {
    next(err);
  }
});

export default router;
