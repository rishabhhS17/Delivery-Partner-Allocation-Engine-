import mongoose from 'mongoose';

const RiderSchema = new mongoose.Schema(
  {
    name:               { type: String, required: true },
    phone:              { type: String },
    latitude:           { type: Number, required: true },
    longitude:          { type: Number, required: true },
    h3Index:            { type: String, required: true },
    availabilityStatus: { type: String, required: true, enum: ['ONLINE', 'OFFLINE'], default: 'OFFLINE' },
    status:             { type: String, required: true, enum: ['IDLE', 'ACCEPTED', 'WAITING', 'PICKED_UP'], default: 'IDLE' },
    activeOrders:       { type: Number, required: true, default: 0 },
    currentOrderId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    nextOrderId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    // Full onboard-order set for N-order clubbing (Stage 3). currentOrderId/nextOrderId are kept
    // for backward compatibility + the manual path; onboardOrderIds is the authoritative list the
    // stop-list is rebuilt from on hydrate. Order matters: it is the current itinerary order.
    onboardOrderIds:    { type: [mongoose.Schema.Types.ObjectId], ref: 'Order', default: [] },
    deliveryTimestamps: { type: [Date], default: [] },
    isSimulated:        { type: Boolean, required: true, default: false },
  },
  { timestamps: true }
);

RiderSchema.index({ availabilityStatus: 1, h3Index: 1 });
RiderSchema.index({ availabilityStatus: 1, status: 1 });

export default mongoose.model('Rider', RiderSchema);
