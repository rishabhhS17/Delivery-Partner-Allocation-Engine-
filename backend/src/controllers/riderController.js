import { latLngToCell } from 'h3-js';
import { H3_RESOLUTION } from '../config/constants.js';
import Rider from '../models/Rider.js';
import {
  validateRiderCreate,
  validateLocationUpdate,
  validateStatusUpdate,
} from '../validators/riderValidator.js';

// Normalize a rider doc for API responses: the DB schema stores latitude/longitude,
// but all clients (map markers, socket tick) standardize on lat/lng.
const serializeRider = (rider) => {
  const { latitude, longitude, ...rest } = rider.toObject();
  return { ...rest, lat: latitude, lng: longitude };
};

export const createRider = async (req, res, next) => {
  try {
    const err = validateRiderCreate(req.body);
    if (err) { res.status(400); throw new Error(err); }

    const { name, phone, latitude, longitude, rating } = req.body;
    const h3Index = latLngToCell(latitude, longitude, H3_RESOLUTION);

    const rider = await Rider.create({
      name,
      phone,
      latitude,
      longitude,
      h3Index,
      rating: rating ?? 4,
      availabilityStatus: 'OFFLINE',
      status: 'IDLE',
      activeOrders: 0,
      isSimulated: false,
    });

    res.status(201).json({ success: true, data: serializeRider(rider) });
  } catch (err) {
    next(err);
  }
};

export const getAllRiders = async (req, res, next) => {
  try {
    const riders = await Rider.find().sort({ createdAt: -1 });
    res.json({ success: true, data: riders.map(serializeRider) });
  } catch (err) {
    next(err);
  }
};

export const getRiderById = async (req, res, next) => {
  try {
    const rider = await Rider.findById(req.params.id);
    if (!rider) { res.status(404); throw new Error('Rider not found'); }
    res.json({ success: true, data: serializeRider(rider) });
  } catch (err) {
    next(err);
  }
};

export const updateLocation = async (req, res, next) => {
  try {
    const err = validateLocationUpdate(req.body);
    if (err) { res.status(400); throw new Error(err); }

    const { latitude, longitude } = req.body;
    const h3Index = latLngToCell(latitude, longitude, H3_RESOLUTION);

    const rider = await Rider.findByIdAndUpdate(
      req.params.id,
      { latitude, longitude, h3Index },
      { new: true, runValidators: true }
    );
    if (!rider) { res.status(404); throw new Error('Rider not found'); }

    res.json({ success: true, data: serializeRider(rider) });
  } catch (err) {
    next(err);
  }
};

export const updateStatus = async (req, res, next) => {
  try {
    const err = validateStatusUpdate(req.body);
    if (err) { res.status(400); throw new Error(err); }

    const { availabilityStatus } = req.body;
    const rider = await Rider.findByIdAndUpdate(
      req.params.id,
      { availabilityStatus },
      { new: true, runValidators: true }
    );
    if (!rider) { res.status(404); throw new Error('Rider not found'); }

    res.json({ success: true, data: serializeRider(rider) });
  } catch (err) {
    next(err);
  }
};
