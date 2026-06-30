import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    email:        { type: String, required: true, unique: true },
    passwordHash: { type: String, default: '' },
    googleId:     { type: String, unique: true, sparse: true },
    role:         { type: String, required: true, enum: ['admin', 'partner'] },
    riderId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Rider', default: null },
  },
  { timestamps: true }
);

export default mongoose.model('User', UserSchema);
