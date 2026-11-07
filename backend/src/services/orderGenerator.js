import { latLngToCell, gridDisk } from 'h3-js';
import { getH3Config, H3_SERVICE_AREA_K } from '../config/constants.js';
import Restaurant from '../models/Restaurant.js';
import Customer from '../models/Customer.js';
import Order from '../models/Order.js';
import { buildOrderTimingFields } from '../utils/orderTiming.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('orders');

async function pickPair() {
  const restaurants = await Restaurant.find({ isActive: true });
  if (!restaurants.length) throw new Error('No active restaurants available');

  const shuffled = restaurants.sort(() => Math.random() - 0.5);

  for (const restaurant of shuffled.slice(0, 10)) {
    const restaurantHex = latLngToCell(restaurant.latitude, restaurant.longitude, getH3Config().resolution);
    const serviceArea = gridDisk(restaurantHex, H3_SERVICE_AREA_K);
    const customers = await Customer.find({ h3Index: { $in: serviceArea }, isActive: true });
    if (!customers.length) continue;
    const customer = customers[Math.floor(Math.random() * customers.length)];
    return { restaurant, customer };
  }

  throw new Error('No customer found within service area of any restaurant after 10 attempts');
}

// customerId/restaurantId let a caller request a specific pair (e.g. a dispatcher placing an
// order for a chosen customer at a chosen restaurant) instead of the default random pairing.
// Omitting both (the existing behavior — bulkCreateOrders and the auto-order timer both call
// this with no arguments) falls through to pickPair() unchanged.
export async function createOrder({ customerId, restaurantId, externalOrderId } = {}) {
  let restaurant, customer;

  if (customerId && restaurantId) {
    [restaurant, customer] = await Promise.all([
      Restaurant.findOne({ _id: restaurantId, isActive: true }),
      Customer.findOne({ _id: customerId, isActive: true }),
    ]);
    if (!restaurant) throw new Error('Restaurant not found or inactive');
    if (!customer) throw new Error('Customer not found or inactive');
  } else {
    ({ restaurant, customer } = await pickPair());
  }

  const now = new Date();
  const timing = buildOrderTimingFields({
    restaurantLat: restaurant.latitude,
    restaurantLng: restaurant.longitude,
    customerLat:   customer.latitude,
    customerLng:   customer.longitude,
    now,
  });

  return Order.create({
    externalOrderId,
    restaurantId:   restaurant._id,
    restaurantName: restaurant.name,
    restaurantLat:  restaurant.latitude,
    restaurantLng:  restaurant.longitude,
    customerId:     customer._id,
    customerName:   customer.name,
    customerLat:    customer.latitude,
    customerLng:    customer.longitude,
    status:         'PENDING',
    queuedAt:       now,
    ...timing,   // prepTime_s, jitGrace_s, prepReadyAt, promisedBy (Stage 1 + 3)
  });
}

export async function bulkCreateOrders(count) {
  const created = [];
  for (let i = 0; i < count; i++) {
    try {
      const order = await createOrder();
      created.push(order);
    } catch (err) {
      // skip — no eligible customer found for this attempt
      log.error('bulk order creation failed', { attempt: i, error: err.message });
    }
  }
  return created;
}
