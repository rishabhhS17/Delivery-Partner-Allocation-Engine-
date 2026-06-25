import { latLngToCell } from 'h3-js';
import { H3_RESOLUTION } from '../config/constants.js';
import Restaurant from '../models/Restaurant.js';
import { validateRestaurantCreate } from '../validators/restaurantValidator.js';

export const createRestaurant = async (req, res, next) => {
  try {
    const err = validateRestaurantCreate(req.body);
    if (err) { res.status(400); throw new Error(err); }

    const { name, phone, latitude, longitude } = req.body;
    const h3Index = latLngToCell(latitude, longitude, H3_RESOLUTION);

    const restaurant = await Restaurant.create({ name, phone, latitude, longitude, h3Index });
    res.status(201).json({ success: true, data: restaurant });
  } catch (err) {
    next(err);
  }
};

export const getAllRestaurants = async (req, res, next) => {
  try {
    const restaurants = await Restaurant.find({ isActive: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: restaurants });
  } catch (err) {
    next(err);
  }
};

export const deleteRestaurant = async (req, res, next) => {
  try {
    const restaurant = await Restaurant.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!restaurant) { res.status(404); throw new Error('Restaurant not found'); }
    res.json({ success: true, data: restaurant });
  } catch (err) {
    next(err);
  }
};
