import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import session from 'express-session';
import passport from './config/passport.js';
import routes from './routes/index.js';
import { config } from './config/env.js';
import { notFound, errorHandler } from './middleware/errorMiddleware.js';

const app = express();

const allowedOrigins = [config.frontendUrl, 'http://localhost:3000', 'http://localhost:5173'];

// CSP enabled with explicit directives for API server protection and Mapbox support
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:', 'blob:', 'https://*.mapbox.com'],
      connectSrc:  ["'self'", 'https://*.mapbox.com', process.env.FRONTEND_URL || 'http://localhost:3000'],
      workerSrc:   ["'self'", 'blob:'],
      fontSrc:     ["'self'", 'data:'],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts, please try again after 15 minutes' },
});

// Session needed for OAuth 2.0 state handshake; not used for API auth (JWT Bearer)
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 10 * 60 * 1000 }, // 10 min — only for OAuth handshake
}));

app.use(passport.initialize());
app.use(passport.session());

app.use('/api/auth/login', loginLimiter);
app.use('/api', apiLimiter, routes);

app.use(notFound);
app.use(errorHandler);

export default app;
