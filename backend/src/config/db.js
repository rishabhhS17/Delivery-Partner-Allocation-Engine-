import mongoose from 'mongoose';
import { config } from './env.js';

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
