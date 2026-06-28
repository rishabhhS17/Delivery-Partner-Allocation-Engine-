/**
 * reseed.js — drops Riders, Restaurants, Customers, Orders, AllocationHistory
 * then inserts the curated demo dataset.  Run with: node reseed.js
 */
import mongoose from 'mongoose';
import { latLngToCell } from 'h3-js';

import { config } from './src/config/env.js';
import { H3_RESOLUTION } from './src/config/constants.js';
import Rider           from './src/models/Rider.js';
import Restaurant      from './src/models/Restaurant.js';
import Customer        from './src/models/Customer.js';
import Order           from './src/models/Order.js';
import AllocationHistory from './src/models/AllocationHistory.js';

function h3(lat, lng) {
  return latLngToCell(lat, lng, H3_RESOLUTION);
}

// ─── Restaurants (10) ────────────────────────────────────────────────────────
// Spread across Ranchi: Kanke Rd, Lalpur, Main Rd, Harmu, Doranda, Argora, etc.
const RESTAURANTS = [
  { name: 'Oona',         phone: '9810001001', latitude: 23.3556, longitude: 85.3098 },
  { name: 'Mocha',        phone: '9810001002', latitude: 23.3413, longitude: 85.3422 },
  { name: 'Kamdenu',      phone: '9810001003', latitude: 23.3265, longitude: 85.3185 },
  { name: 'Kaveri',       phone: '9810001004', latitude: 23.3480, longitude: 85.3295 },
  { name: 'Loop',         phone: '9810001005', latitude: 23.3340, longitude: 85.3510 },
  { name: 'Machaan',      phone: '9810001006', latitude: 23.3590, longitude: 85.3355 },
  { name: 'Rasoi',        phone: '9810001007', latitude: 23.3295, longitude: 85.3455 },
  { name: 'Big Bowl',     phone: '9810001008', latitude: 23.3440, longitude: 85.3178 },
  { name: 'Spice Craft',  phone: '9810001009', latitude: 23.3385, longitude: 85.3038 },
  { name: 'Chaat Co.',    phone: '9810001010', latitude: 23.3520, longitude: 85.3490 },
];

// ─── Riders (9) ──────────────────────────────────────────────────────────────
// Placed at different intersections so H3 allocation radius picks multiple candidates
const RIDERS = [
  { name: 'Krrish',    latitude: 23.3500, longitude: 85.3150 },
  { name: 'Daksh',     latitude: 23.3370, longitude: 85.3320 },
  { name: 'Aviral',    latitude: 23.3445, longitude: 85.3420 },
  { name: 'Ajitesh',   latitude: 23.3295, longitude: 85.3260 },
  { name: 'Rishabh',   latitude: 23.3555, longitude: 85.3400 },
  { name: 'Rishi',     latitude: 23.3310, longitude: 85.3480 },
  { name: 'Manav',     latitude: 23.3490, longitude: 85.3070 },
  { name: 'Sunny',     latitude: 23.3380, longitude: 85.3510 },
  { name: 'Sreyannsh', latitude: 23.3430, longitude: 85.3250 },
];

// ─── Customers (13) ──────────────────────────────────────────────────────────
const CUSTOMERS = [
  { name: 'Samina',  latitude: 23.3410, longitude: 85.3350 },
  { name: 'Om',      latitude: 23.3280, longitude: 85.3140 },
  { name: 'Saikat',  latitude: 23.3520, longitude: 85.3220 },
  { name: 'Debjnai', latitude: 23.3360, longitude: 85.3440 },
  { name: 'Tanwi',   latitude: 23.3460, longitude: 85.3500 },
  { name: 'Aditi',   latitude: 23.3580, longitude: 85.3290 },
  { name: 'Skleja',  latitude: 23.3305, longitude: 85.3380 },
  { name: 'Ashish',  latitude: 23.3445, longitude: 85.3095 },
  { name: 'Ayush',   latitude: 23.3395, longitude: 85.3480 },
  { name: 'Ishaan',  latitude: 23.3270, longitude: 85.3300 },
  { name: 'Prashun', latitude: 23.3535, longitude: 85.3450 },
  { name: 'Sonu',    latitude: 23.3330, longitude: 85.3200 },
  { name: 'Sameer',  latitude: 23.3480, longitude: 85.3380 },
];

// ─── rating helper ────────────────────────────────────────────────────────────
function randRating() {
  return parseFloat((Math.random() * 1.5 + 3.5).toFixed(1));
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(config.mongoUri);
  console.log('Connected.\n');

  console.log('Dropping existing collections…');
  await Promise.all([
    Rider.deleteMany({}),
    Restaurant.deleteMany({}),
    Customer.deleteMany({}),
    Order.deleteMany({}),
    AllocationHistory.deleteMany({}),
  ]);
  console.log('  Done.\n');

  console.log('Seeding restaurants…');
  const restaurantDocs = RESTAURANTS.map(r => ({
    ...r,
    h3Index:  h3(r.latitude, r.longitude),
    isActive: true,
  }));
  await Restaurant.insertMany(restaurantDocs);
  console.log(`  Inserted ${restaurantDocs.length} restaurants.`);

  console.log('Seeding riders…');
  const riderDocs = RIDERS.map(r => ({
    ...r,
    h3Index:            h3(r.latitude, r.longitude),
    rating:             randRating(),
    availabilityStatus: 'ONLINE',
    status:             'IDLE',
    activeOrders:       0,
    isSimulated:        true,
  }));
  await Rider.insertMany(riderDocs);
  console.log(`  Inserted ${riderDocs.length} riders.`);

  console.log('Seeding customers…');
  const customerDocs = CUSTOMERS.map(c => ({
    ...c,
    h3Index:  h3(c.latitude, c.longitude),
    isActive: true,
  }));
  await Customer.insertMany(customerDocs);
  console.log(`  Inserted ${customerDocs.length} customers.`);

  console.log('\nDone. Admin user preserved.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
