import { latLngToCell } from 'h3-js';
import { H3_RESOLUTION } from '../config/constants.js';
import Rider from '../models/Rider.js';
import {
  validateRiderCreate,
  validateLocationUpdate,
  validateStatusUpdate,
} from '../validators/riderValidator.js';

// Normalize a rider doc for API responses: the DB schema stores latitude/longitude,
// but all clients (map markers, socket tick) standardize on lat/lng. When `currentOrderId`
// has been `.populate()`d with restaurant/customer names, also attach a flattened
// `currentOrderSummary` so clients can render "Restaurant → Customer" without a second lookup;
// `currentOrderId` itself always stays the raw id.
const serializeRider = (rider) => {
  const { latitude, longitude, currentOrderId, ...rest } = rider.toObject();

  const isPopulatedOrder = currentOrderId && typeof currentOrderId === 'object' && 'restaurantName' in currentOrderId;
  const currentOrderSummary = isPopulatedOrder
    ? { restaurantName: currentOrderId.restaurantName, customerName: currentOrderId.customerName }
    : null;

  const deliveryTimestamps = rest.deliveryTimestamps ?? [];
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  return {
    ...rest,
    lat: latitude,
    lng: longitude,
    currentOrderId: isPopulatedOrder ? currentOrderId._id : currentOrderId,
    currentOrderSummary,
    totalOrders: deliveryTimestamps.length,
    ordersLastHour: deliveryTimestamps.filter((t) => new Date(t).getTime() > oneHourAgo).length,
  };
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

const CURRENT_ORDER_POPULATE = { path: 'currentOrderId', select: 'restaurantName customerName' };

export const getAllRiders = async (req, res, next) => {
  try {
    const riders = await Rider.find().sort({ createdAt: -1 }).populate(CURRENT_ORDER_POPULATE);
    res.json({ success: true, data: riders.map(serializeRider) });
  } catch (err) {
    next(err);
  }
};

export const getRiderById = async (req, res, next) => {
  try {
    const rider = await Rider.findById(req.params.id).populate(CURRENT_ORDER_POPULATE);
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
