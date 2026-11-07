import mongoose from 'mongoose';
import { config } from './env.js';

// Without buffering, a query made while the database is unreachable fails at once instead of
// waiting up to 10 s, so the engine can notice the outage and pause (decision E3).
mongoose.set('bufferCommands', false);

const connectDB = async () => {
  try {
    if (!config.mongoUri) {
      console.warn('MongoDB URI is not defined. Skipping DB connection.');
      return;
    }
    const conn = await mongoose.connect(config.mongoUri);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
