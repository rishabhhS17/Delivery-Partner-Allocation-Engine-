import { latLngToCell } from 'h3-js';
import { getH3Config } from '../config/constants.js';
import Customer from '../models/Customer.js';
import Order from '../models/Order.js';
import { validateCustomerCreate } from '../validators/customerValidator.js';

// Count orders per entity id in one aggregation: `total` (all-time) and `lastHour` (created in
// the past 60 min). `field` is the Order field to group by (customerId / restaurantId). Shared
// by the customer + restaurant list endpoints so each can show live order volume cheaply.
export async function orderCountsByEntity(field, ids) {
  if (!ids.length) return new Map();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await Order.aggregate([
    { $match: { [field]: { $in: ids } } },
    { $group: {
      _id: `$${field}`,
      total: { $sum: 1 },
      lastHour: { $sum: { $cond: [{ $gt: ['$createdAt', oneHourAgo] }, 1, 0] } },
    } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}

export const createCustomer = async (req, res, next) => {
  try {
    const err = validateCustomerCreate(req.body);
    if (err) { res.status(400); throw new Error(err); }

    const { name, phone, address, latitude, longitude } = req.body;
    const h3Index = latLngToCell(latitude, longitude, getH3Config().resolution);

    const customer = await Customer.create({ name, phone, address, latitude, longitude, h3Index });
    res.status(201).json({ success: true, data: customer });
  } catch (err) {
    next(err);
  }
};

export const getAllCustomers = async (req, res, next) => {
  try {
    const customers = await Customer.find({ isActive: true }).sort({ createdAt: -1 });
    const counts = await orderCountsByEntity('customerId', customers.map((c) => c._id));
    const data = customers.map((c) => {
      const n = counts.get(String(c._id));
      return { ...c.toObject(), totalOrders: n?.total ?? 0, ordersLastHour: n?.lastHour ?? 0 };
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

export const deleteCustomer = async (req, res, next) => {
  try {
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!customer) { res.status(404); throw new Error('Customer not found'); }
    res.json({ success: true, data: customer });
  } catch (err) {
    next(err);
  }
};
