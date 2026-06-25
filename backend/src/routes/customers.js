import express from 'express';
import {
  createCustomer,
  getAllCustomers,
  deleteCustomer,
} from '../controllers/customerController.js';

const router = express.Router();

router.post('/',      createCustomer);
router.get('/',       getAllCustomers);
router.delete('/:id', deleteCustomer);

export default router;
