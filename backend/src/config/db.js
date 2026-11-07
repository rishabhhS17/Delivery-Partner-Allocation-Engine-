import mongoose from 'mongoose';
import { config } from './env.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('db');

// Without buffering, a query made while the database is unreachable fails at once instead of
// waiting up to 10 s, so the engine can notice the outage and pause (decision E3).
mongoose.set('bufferCommands', false);

const connectDB = async () => {
  try {
    if (!config.mongoUri) {
      log.warn('MongoDB URI is not defined, skipping DB connection');
      return;
    }
    const conn = await mongoose.connect(config.mongoUri);
    log.info('MongoDB connected', { host: conn.connection.host });
  } catch (error) {
    log.error('MongoDB connection failed', { error: error.message });
    process.exit(1);
  }
};

export default connectDB;
