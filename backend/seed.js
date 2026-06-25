import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { latLngToCell } from 'h3-js';

import { config } from './src/config/env.js';
import { H3_RESOLUTION, RANCHI_BOUNDS, RIDER_SEED_COUNT } from './src/config/constants.js';
import Rider from './src/models/Rider.js';
import Restaurant from './src/models/Restaurant.js';
import Customer from './src/models/Customer.js';
import User from './src/models/User.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function randLat() {
  return parseFloat(
    (Math.random() * (RANCHI_BOUNDS.maxLat - RANCHI_BOUNDS.minLat) + RANCHI_BOUNDS.minLat).toFixed(6)
  );
}

function randLng() {
  return parseFloat(
    (Math.random() * (RANCHI_BOUNDS.maxLng - RANCHI_BOUNDS.minLng) + RANCHI_BOUNDS.minLng).toFixed(6)
  );
}

function randRating() {
  return parseFloat((Math.random() * 1.5 + 3.5).toFixed(1));
}

function h3(lat, lng) {
  return latLngToCell(lat, lng, H3_RESOLUTION);
}

// ─── seed data ──────────────────────────────────────────────────────────────

const RESTAURANTS = [
  { name: 'Saffron Garden',       phone: '9801001001', latitude: 23.3441, longitude: 85.3096 },
  { name: 'Hotel Kwality',        phone: '9801001002', latitude: 23.3560, longitude: 85.3318 },
  { name: 'Punjab Dhaba',         phone: '9801001003', latitude: 23.3285, longitude: 85.3176 },
  { name: 'Biryani Blues',        phone: '9801001004', latitude: 23.3412, longitude: 85.3245 },
  { name: 'Ranchi Foodie House',  phone: '9801001005', latitude: 23.3350, longitude: 85.3380 },
  { name: 'Spice Route',          phone: '9801001006', latitude: 23.3490, longitude: 85.3120 },
  { name: 'The Grand Buffet',     phone: '9801001007', latitude: 23.3380, longitude: 85.3450 },
  { name: 'Flavours of India',    phone: '9801001008', latitude: 23.3310, longitude: 85.3290 },
];

const CUSTOMER_NAMES = [
  'Aarav Sharma',   'Priya Singh',    'Rohit Kumar',    'Sneha Gupta',
  'Vikram Yadav',   'Neha Verma',     'Amit Tiwari',    'Pooja Mishra',
  'Rahul Jha',      'Anjali Das',     'Suresh Patel',   'Kavita Rao',
  'Deepak Nair',    'Riya Mehta',     'Arjun Sinha',    'Swati Pandey',
  'Nikhil Ghosh',   'Meera Bose',     'Tarun Saxena',   'Divya Kapoor',
  'Karan Malhotra', 'Sana Khan',      'Rajan Dubey',    'Tanya Agarwal',
  'Varun Chouhan',
];

const RIDER_NAMES = [
  'Rajesh Kumar',    'Sanjay Singh',    'Manoj Prasad',   'Dinesh Yadav',
  'Anil Sharma',     'Sunil Verma',     'Rakesh Tiwari',  'Vijay Mishra',
  'Ramesh Gupta',    'Pankaj Jha',      'Deepak Mehta',   'Ashok Nair',
  'Santosh Rao',     'Hemant Das',      'Naveen Patel',   'Girish Sahu',
  'Mukesh Singh',    'Praveen Kumar',   'Dilip Yadav',    'Ravi Sharma',
  'Sachin Tiwari',   'Vishal Mishra',   'Ajay Gupta',     'Nitin Verma',
  'Amit Pandey',     'Saurabh Jha',     'Kartik Nair',    'Alok Mehta',
  'Tarun Sinha',     'Rohit Dubey',     'Sumit Saxena',   'Ankur Kapoor',
];

// ─── seed functions ──────────────────────────────────────────────────────────

async function seedRestaurants() {
  const count = await Restaurant.countDocuments();
  if (count > 0) {
    console.log(`  Restaurants: skipped (${count} already exist)`);
    return;
  }

  const docs = RESTAURANTS.map(r => ({
    ...r,
    h3Index:  h3(r.latitude, r.longitude),
    isActive: true,
  }));

  await Restaurant.insertMany(docs);
  console.log(`  Restaurants: seeded ${docs.length}`);
}

async function seedCustomers() {
  const count = await Customer.countDocuments();
  if (count > 0) {
    console.log(`  Customers: skipped (${count} already exist)`);
    return;
  }

  const docs = CUSTOMER_NAMES.map(name => {
    const latitude  = randLat();
    const longitude = randLng();
    return {
      name,
      latitude,
      longitude,
      h3Index:  h3(latitude, longitude),
      isActive: true,
    };
  });

  await Customer.insertMany(docs);
  console.log(`  Customers: seeded ${docs.length}`);
}

async function seedRiders() {
  const count = await Rider.countDocuments();
  if (count > 0) {
    console.log(`  Riders: skipped (${count} already exist)`);
    return;
  }

  const docs = RIDER_NAMES.slice(0, RIDER_SEED_COUNT).map(name => {
    const latitude  = randLat();
    const longitude = randLng();
    return {
      name,
      latitude,
      longitude,
      h3Index:            h3(latitude, longitude),
      rating:             randRating(),
      availabilityStatus: 'ONLINE',
      status:             'IDLE',
      activeOrders:       0,
      isSimulated:        true,
    };
  });

  await Rider.insertMany(docs);
  console.log(`  Riders: seeded ${docs.length}`);
}

async function seedAdminUser() {
  const existing = await User.findOne({ email: 'admin@demo.com' });
  if (existing) {
    console.log('  Admin user: skipped (already exists)');
    return;
  }

  const passwordHash = await bcrypt.hash(config.adminPassword, 10);
  await User.create({
    email: 'admin@demo.com',
    passwordHash,
    role:    'admin',
    riderId: null,
  });
  console.log('  Admin user: seeded (admin@demo.com)');
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(config.mongoUri);
  console.log('Connected.\n');

  console.log('Seeding:');
  await seedRestaurants();
  await seedCustomers();
  await seedRiders();
  await seedAdminUser();

  console.log('\nDone.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
