import mongoose from 'mongoose';

const RiderSchema = new mongoose.Schema(
  {
    name:               { type: String, required: true },
    phone:              { type: String },
    latitude:           { type: Number, required: true },
    longitude:          { type: Number, required: true },
    h3Index:            { type: String, required: true },
    rating:             { type: Number, required: true, default: 4, min: 1, max: 5 },
    availabilityStatus: { type: String, required: true, enum: ['ONLINE', 'OFFLINE'], default: 'OFFLINE' },
    status:             { type: String, required: true, enum: ['IDLE', 'ACCEPTED', 'PICKED_UP'], default: 'IDLE' },
    activeOrders:       { type: Number, required: true, default: 0 },
    currentOrderId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    nextOrderId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    deliveryTimestamps: { type: [Date], default: [] },
    isSimulated:        { type: Boolean, required: true, default: false },
  },
  { timestamps: true }
);

RiderSchema.index({ availabilityStatus: 1, h3Index: 1 });
RiderSchema.index({ availabilityStatus: 1, status: 1 });

export default mongoose.model('Rider', RiderSchema);
