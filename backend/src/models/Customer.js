import mongoose from 'mongoose';

const CustomerSchema = new mongoose.Schema(
  {
    name:      { type: String, required: true },
    phone:     { type: String },
    address:   { type: String },
    latitude:  { type: Number, required: true },
    longitude: { type: Number, required: true },
    h3Index:   { type: String, required: true },
    isActive:  { type: Boolean, required: true, default: true },
  },
  { timestamps: true }
);

CustomerSchema.index({ h3Index: 1, isActive: 1 });

export default mongoose.model('Customer', CustomerSchema);
