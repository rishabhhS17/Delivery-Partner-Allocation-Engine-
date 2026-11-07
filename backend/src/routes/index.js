import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { getHealth } from '../engine/index.js';
import { getRiderBotTickMs } from '../sim/index.js';
import authRoutes        from './auth.js';
import analyticsRoutes   from './analytics.js';
import riderRoutes       from './riders.js';
import restaurantRoutes  from './restaurants.js';
import customerRoutes    from './customers.js';
import orderRoutes       from './orders.js';
import allocationRoutes  from './allocation.js';
import configRoutes      from './config.js';
import simulationRoutes  from './simulation.js';
import streamRoutes      from './stream.js';

const router = express.Router();

// Open (no login) so the platform's health check can use it. Engine numbers are null on an
// instance that is not the dispatcher (see the leader lease).
router.get('/health', async (req, res, next) => {
  try {
    res.json({ status: 'ok', engine: await getHealth(), lastRiderBotTickMs: getRiderBotTickMs() });
  } catch (err) {
    next(err);
  }
});

router.use('/auth',        authRoutes);
router.use('/analytics',   protect, analyticsRoutes);
router.use('/riders',      protect, riderRoutes);
router.use('/restaurants', protect, restaurantRoutes);
router.use('/customers',   protect, customerRoutes);
router.use('/orders',      protect, orderRoutes);
router.use('/allocation',  protect, allocationRoutes);
router.use('/config',      protect, configRoutes);
router.use('/simulation',  protect, simulationRoutes);
router.use('/stream',      protect, streamRoutes);

export default router;
