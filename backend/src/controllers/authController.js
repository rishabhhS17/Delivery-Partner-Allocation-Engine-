import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { config } from '../config/env.js';
import { sendOtpEmail } from '../services/emailService.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL = '10m';
const SESSION_TOKEN_TTL = '7d';

function _generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function _signSessionToken(user) {
  return jwt.sign(
    { userId: user._id, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: SESSION_TOKEN_TTL }
  );
}

function _publicUser(user) {
  return { _id: user._id, email: user.email, role: user.role, avatarUrl: user.avatarUrl ?? null };
}

// POST /api/auth/register — { email, password }
// Creates an unverified account and emails a 6-digit OTP. If a previous, never-verified signup
// exists for this email, its password/OTP fields are overwritten in place rather than failing
// on the unique-email index — an abandoned registration must not permanently block that address.
export const register = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const existing = await User.findOne({ email });
    if (existing && existing.isVerified) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otp = _generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

    if (existing) {
      existing.passwordHash = passwordHash;
      existing.otpHash = otpHash;
      existing.otpExpiresAt = otpExpiresAt;
      existing.otpPurpose = 'register';
      await existing.save();
    } else {
      await User.create({
        email,
        passwordHash,
        role: 'partner',
        isVerified: false,
        otpHash,
        otpExpiresAt,
        otpPurpose: 'register',
      });
    }

    await sendOtpEmail(email, otp, 'register');
    res.status(200).json({ success: true, message: 'Verification code sent to your email' });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/register/verify-otp — { email, otp }
export const verifyRegisterOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and code are required' });
    }

    const user = await User.findOne({ email });
    if (!user || !user.otpHash || user.otpPurpose !== 'register') {
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }
    if (user.otpExpiresAt < new Date()) {
      return res.status(400).json({ success: false, message: 'Code has expired — please register again' });
    }
    if (!(await bcrypt.compare(otp, user.otpHash))) {
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }

    user.isVerified = true;
    user.otpHash = null;
    user.otpExpiresAt = null;
    user.otpPurpose = null;
    await user.save();

    const token = _signSessionToken(user);
    res.json({ success: true, token, user: _publicUser(user) });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/forgot-password — { email }
// Always returns the same generic response whether or not the email is registered, to avoid
// leaking which emails have accounts.
export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const genericResponse = {
      success: true,
      message: 'If an account exists for that email, a code has been sent',
    };

    const user = await User.findOne({ email, isVerified: true });
    if (!user) return res.json(genericResponse);

    const otp = _generateOtp();
    user.otpHash = await bcrypt.hash(otp, 10);
    user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    user.otpPurpose = 'reset';
    await user.save();

    await sendOtpEmail(email, otp, 'reset');
    res.json(genericResponse);
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/forgot-password/verify-otp — { email, otp }
// Issues a short-lived reset token rather than allowing the password to be changed directly
// from this request, closing the gap between "OTP verified" and "password actually changed."
export const verifyResetOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and code are required' });
    }

    const user = await User.findOne({ email });
    if (!user || !user.otpHash || user.otpPurpose !== 'reset') {
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }
    if (user.otpExpiresAt < new Date()) {
      return res.status(400).json({ success: false, message: 'Code has expired — please request a new one' });
    }
    if (!(await bcrypt.compare(otp, user.otpHash))) {
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }

    user.otpHash = null;
    user.otpExpiresAt = null;
    user.otpPurpose = null;
    await user.save();

    const resetToken = jwt.sign(
      { userId: user._id, purpose: 'reset' },
      config.jwtSecret,
      { expiresIn: RESET_TOKEN_TTL }
    );
    res.json({ success: true, resetToken });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/reset-password — { resetToken, newPassword }
export const resetPassword = async (req, res, next) => {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) {
      return res.status(400).json({ success: false, message: 'Reset token and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, config.jwtSecret);
    } catch {
      return res.status(401).json({ success: false, message: 'Reset link has expired — please request a new one' });
    }
    if (decoded.purpose !== 'reset') {
      return res.status(401).json({ success: false, message: 'Invalid reset token' });
    }

    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ success: false, message: 'Account not found' });

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ success: true, message: 'Password updated — you can now log in' });
  } catch (err) {
    next(err);
  }
};
