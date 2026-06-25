import express from 'express';
import {
  createRestaurant,
  getAllRestaurants,
  deleteRestaurant,
} from '../controllers/restaurantController.js';

const router = express.Router();

router.post('/',      createRestaurant);
router.get('/',       getAllRestaurants);
router.delete('/:id', deleteRestaurant);

export default router;
