import express from 'express';
import {
  createSingleOrder,
  createBulkOrders,
  getAllOrders,
  getOrderById,
} from '../controllers/orderController.js';

const router = express.Router();

router.post('/bulk', createBulkOrders);
router.post('/',     createSingleOrder);
router.get('/',      getAllOrders);
router.get('/:id',   getOrderById);

export default router;
