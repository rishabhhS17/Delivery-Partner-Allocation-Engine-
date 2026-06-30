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

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session needed for OAuth 2.0 state handshake; not used for API auth (JWT Bearer)
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 10 * 60 * 1000 }, // 10 min — only for OAuth handshake
}));

app.use(passport.initialize());
app.use(passport.session());

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

export default app;
