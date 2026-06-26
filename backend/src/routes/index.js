import express from 'express';
import riderRoutes      from './riders.js';
import restaurantRoutes from './restaurants.js';
import customerRoutes   from './customers.js';
import orderRoutes      from './orders.js';
import allocationRoutes from './allocation.js';
import configRoutes     from './config.js';

const router = express.Router();

router.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

router.use('/riders',      riderRoutes);
router.use('/restaurants', restaurantRoutes);
router.use('/customers',   customerRoutes);
router.use('/orders',      orderRoutes);
router.use('/allocation',  allocationRoutes);
router.use('/config',      configRoutes);

export default router;
