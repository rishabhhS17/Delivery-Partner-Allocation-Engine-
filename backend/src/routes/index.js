import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import authRoutes        from './auth.js';
import analyticsRoutes   from './analytics.js';
import riderRoutes       from './riders.js';
import restaurantRoutes  from './restaurants.js';
import customerRoutes    from './customers.js';
import orderRoutes       from './orders.js';
import allocationRoutes  from './allocation.js';
import configRoutes      from './config.js';
import simulationRoutes  from './simulation.js';

const router = express.Router();

router.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

router.use('/auth',        authRoutes);
router.use('/analytics',   analyticsRoutes);
router.use('/riders',      protect, riderRoutes);
router.use('/restaurants', protect, restaurantRoutes);
router.use('/customers',   protect, customerRoutes);
router.use('/orders',      protect, orderRoutes);
router.use('/allocation',  protect, allocationRoutes);
router.use('/config',      protect, configRoutes);
router.use('/simulation',  protect, simulationRoutes);

export default router;
