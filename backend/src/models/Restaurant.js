import mongoose from 'mongoose';

const RestaurantSchema = new mongoose.Schema(
  {
    name:      { type: String, required: true },
    phone:     { type: String },
    latitude:  { type: Number, required: true },
    longitude: { type: Number, required: true },
    h3Index:   { type: String, required: true },
    isActive:  { type: Boolean, required: true, default: true },
  },
  { timestamps: true }
);

RestaurantSchema.index({ h3Index: 1, isActive: 1 });

export default mongoose.model('Restaurant', RestaurantSchema);
