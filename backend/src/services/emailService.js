import nodemailer from 'nodemailer';
import { config } from '../config/env.js';

let _transporter = null;

function _isConfigured() {
  return Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
}

function _getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: Number(config.smtpPort) || 587,
      secure: Number(config.smtpPort) === 465,
      auth: { user: config.smtpUser, pass: config.smtpPass },
    });
  }
  return _transporter;
}

const SUBJECT_BY_PURPOSE = {
  register: 'Verify your email',
  reset:    'Reset your password',
};

// Sends a one-time password by email. When SMTP isn't configured (no host/user/pass set), logs
// the OTP to the server console instead of throwing — this keeps registration/reset flows fully
// testable in dev without real mail credentials, mirroring how Google OAuth already degrades
// gracefully (503) when unconfigured rather than crashing the request.
export async function sendOtpEmail(toEmail, otp, purpose) {
  if (!_isConfigured()) {
    console.log(`[email] SMTP not configured — OTP for ${toEmail} (${purpose}): ${otp}`);
    return;
  }

  const subject = SUBJECT_BY_PURPOSE[purpose] || 'Your one-time password';
  await _getTransporter().sendMail({
    from: config.smtpFrom || config.smtpUser,
    to: toEmail,
    subject,
    text: `Your verification code is ${otp}. It expires in 10 minutes.`,
    html: `<p>Your verification code is <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
  });
}
