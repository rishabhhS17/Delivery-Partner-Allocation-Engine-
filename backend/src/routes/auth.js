import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import passport from '../config/passport.js';
import User from '../models/User.js';
import { config } from '../config/env.js';
import {
  register,
  verifyRegisterOtp,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
} from '../controllers/authController.js';

const router = express.Router();

// A 6-digit OTP's real defense is attempt limiting, not length — applied to every OTP
// request/verify route below, matching app.js's existing loginLimiter shape.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again later' },
});

// POST /api/auth/login — email/password
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const user = await User.findOne({ email });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: { _id: user._id, email: user.email, role: user.role, avatarUrl: user.avatarUrl ?? null },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token' });
    }

    const token = header.slice(7);
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(decoded.userId).select('-passwordHash -otpHash');
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });

    res.json({ success: true, user });
  } catch {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
});

// POST /api/auth/register — { email, password } -> emails a registration OTP
router.post('/register', otpLimiter, register);

// POST /api/auth/register/verify-otp — { email, otp } -> verifies + issues a session token
router.post('/register/verify-otp', otpLimiter, verifyRegisterOtp);

// POST /api/auth/forgot-password — { email } -> emails a reset OTP if the account exists
router.post('/forgot-password', otpLimiter, forgotPassword);

// POST /api/auth/forgot-password/verify-otp — { email, otp } -> issues a short-lived reset token
router.post('/forgot-password/verify-otp', otpLimiter, verifyResetOtp);

// POST /api/auth/reset-password — { resetToken, newPassword }
router.post('/reset-password', resetPassword);

// GET /api/auth/google — initiate Google OAuth
router.get('/google', (req, res, next) => {
  if (!config.googleClientId) {
    return res.status(503).json({ success: false, message: 'Google OAuth not configured' });
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

// GET /api/auth/google/callback — Google redirects here after consent
router.get(
  '/google/callback',
  (req, res, next) => {
    passport.authenticate('google', {
      session: false,
      failureRedirect: `${config.frontendUrl}/login?error=oauth`,
    })(req, res, next);
  },
  (req, res) => {
    const token = jwt.sign(
      { userId: req.user._id, email: req.user.email, role: req.user.role },
      config.jwtSecret,
      { expiresIn: '7d' }
    );
    res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
  },
);

export default router;
