import { latLngToCell } from 'h3-js';
import { getH3Config } from '../config/constants.js';
import Rider from '../models/Rider.js';
import Order from '../models/Order.js';
import { setRiderAvailability } from '../engine/index.js';
import {
  validateRiderCreate,
  validateLocationUpdate,
  validateStatusUpdate,
} from '../validators/riderValidator.js';

// Normalize a rider doc for API responses: the DB schema stores latitude/longitude,
// but all clients (map markers, live stream) standardize on lat/lng. `currentOrder` is the
// rider's earliest-assigned active order (looked up from the orders, which are the only record
// of who carries what), flattened so clients can render "Restaurant → Customer".
const serializeRider = (rider, currentOrder = null) => {
  const { latitude, longitude, ...rest } = rider.toObject();

  const currentOrderSummary = currentOrder
    ? { restaurantName: currentOrder.restaurantName, customerName: currentOrder.customerName }
    : null;

  const deliveryTimestamps = rest.deliveryTimestamps ?? [];
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  return {
    ...rest,
    lat: latitude,
    lng: longitude,
    currentOrderId: currentOrder?._id ?? null,
    currentOrderSummary,
    totalOrders: deliveryTimestamps.length,
    ordersLastHour: deliveryTimestamps.filter((t) => new Date(t).getTime() > oneHourAgo).length,
  };
};

export const createRider = async (req, res, next) => {
  try {
    const err = validateRiderCreate(req.body);
    if (err) { res.status(400); throw new Error(err); }

    const { name, phone, latitude, longitude } = req.body;
    const h3Index = latLngToCell(latitude, longitude, getH3Config().resolution);

    const rider = await Rider.create({
      name,
      phone,
      latitude,
      longitude,
      h3Index,
      availabilityStatus: 'OFFLINE',
      status: 'IDLE',
      isSimulated: false,
    });

    res.status(201).json({ success: true, data: serializeRider(rider) });
  } catch (err) {
    next(err);
  }
};

// riderId → that rider's earliest-assigned active order.
async function findCurrentOrdersByRider(riderFilter = {}) {
  const activeOrders = await Order.find({ status: { $in: ['ASSIGNED', 'PICKED_UP'] }, ...riderFilter })
    .sort({ assignedAt: 1 })
    .select('_id assignedRiderId restaurantName customerName')
    .lean();
  const byRider = new Map();
  for (const order of activeOrders) {
    const riderId = order.assignedRiderId?.toString();
    if (riderId && !byRider.has(riderId)) byRider.set(riderId, order);
  }
  return byRider;
}

export const getAllRiders = async (req, res, next) => {
  try {
    const [riders, currentOrders] = await Promise.all([
      Rider.find().sort({ createdAt: -1 }),
      findCurrentOrdersByRider(),
    ]);
    res.json({ success: true, data: riders.map((r) => serializeRider(r, currentOrders.get(r._id.toString()))) });
  } catch (err) {
    next(err);
  }
};

export const getRiderById = async (req, res, next) => {
  try {
    const rider = await Rider.findById(req.params.id);
    if (!rider) { res.status(404); throw new Error('Rider not found'); }
    const currentOrders = await findCurrentOrdersByRider({ assignedRiderId: rider._id });
    res.json({ success: true, data: serializeRider(rider, currentOrders.get(rider._id.toString())) });
  } catch (err) {
    next(err);
  }
};

export const updateLocation = async (req, res, next) => {
  try {
    const err = validateLocationUpdate(req.body);
    if (err) { res.status(400); throw new Error(err); }

    const { latitude, longitude } = req.body;
    const h3Index = latLngToCell(latitude, longitude, getH3Config().resolution);

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
    await setRiderAvailability(rider._id, availabilityStatus); // reaches the live engine at once

    res.json({ success: true, data: serializeRider(rider) });
  } catch (err) {
    next(err);
  }
};
