import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    email:        { type: String, required: true, unique: true },
    passwordHash: { type: String, default: '' },
    googleId:     { type: String, unique: true, sparse: true },
    role:         { type: String, required: true, enum: ['admin', 'partner'] },
    riderId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Rider', default: null },
    avatarUrl:    { type: String, default: null },

    // Email/password registration is gated behind OTP verification; Google OAuth users are
    // verified immediately since Google itself proves ownership of the email.
    isVerified:   { type: Boolean, default: false },

    // Hashed one-time password for registration/reset flows. Never store the raw OTP.
    otpHash:      { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },
    otpPurpose:   { type: String, enum: ['register', 'reset', null], default: null },
  },
  { timestamps: true }
);

export default mongoose.model('User', UserSchema);
