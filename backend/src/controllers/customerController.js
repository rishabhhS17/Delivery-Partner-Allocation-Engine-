import { latLngToCell } from 'h3-js';
import { H3_RESOLUTION } from '../config/constants.js';
import Customer from '../models/Customer.js';
import { validateCustomerCreate } from '../validators/customerValidator.js';

export const createCustomer = async (req, res, next) => {
  try {
    const err = validateCustomerCreate(req.body);
    if (err) { res.status(400); throw new Error(err); }

    const { name, phone, address, latitude, longitude } = req.body;
    const h3Index = latLngToCell(latitude, longitude, H3_RESOLUTION);

    const customer = await Customer.create({ name, phone, address, latitude, longitude, h3Index });
    res.status(201).json({ success: true, data: customer });
  } catch (err) {
    next(err);
  }
};

export const getAllCustomers = async (req, res, next) => {
  try {
    const customers = await Customer.find({ isActive: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: customers });
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
