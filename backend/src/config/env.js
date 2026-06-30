import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

if (!process.env.MONGODB_URI) throw new Error('[env] Missing MONGODB_URI — server cannot start');
if (!process.env.JWT_SECRET)  throw new Error('[env] Missing JWT_SECRET — server cannot start');

export const config = {
  port:              process.env.PORT || 5000,
  mongoUri:          process.env.MONGODB_URI,
  jwtSecret:         process.env.JWT_SECRET,
  mapboxToken:       process.env.MAPBOX_TOKEN,
  sessionSecret:     process.env.SESSION_SECRET     || 'dpae-session-secret',
  frontendUrl:       process.env.FRONTEND_URL        || 'http://localhost:3000',
  googleClientId:    process.env.GOOGLE_CLIENT_ID    || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback',
};
