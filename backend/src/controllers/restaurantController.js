import { latLngToCell, gridDisk } from 'h3-js';
import { H3_RESOLUTION, RESTAURANT_SERVICE_K } from '../config/constants.js';
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
    // Optional geo filter: when a customer's lat/lng is supplied, only return
    // restaurants inside that customer's H3 service area (their cell + surrounding
    // rings). The $in on h3Index uses the { h3Index: 1, isActive: 1 } index — no
    // collection scan. Missing/invalid coords fall through to the full list, which
    // keeps the Restaurants admin page working unchanged.
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const filter = { isActive: true };

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const cell  = latLngToCell(lat, lng, H3_RESOLUTION);
      const cells = gridDisk(cell, RESTAURANT_SERVICE_K);
      filter.h3Index = { $in: cells };
    }

    const restaurants = await Restaurant.find(filter).sort({ createdAt: -1 });
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
