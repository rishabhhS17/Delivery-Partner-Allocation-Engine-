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
    // Which orders a rider carries is stored only on the Order (assignedRiderId), never here,
    // so the two can never disagree (decision E2).
    // Only the last LOAD_WINDOW_MINUTES are kept (all the load score needs); the lifetime count
    // lives in totalDeliveries so the list stays small.
    deliveryTimestamps: { type: [Date], default: [] },
    totalDeliveries:    { type: Number, default: 0 },
    // The leg the rider is on right now. Position is never saved per tick: it is rebuilt from
    // this leg and the clock (decision B5). null when idle.
    currentLeg: {
      type: {
        startedAt:     Date,
        originLat:     Number,
        originLng:     Number,
        targetOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
        targetType:    { type: String, enum: ['PICKUP', 'DROP'] },
        coords:        { type: [[Number]], default: [] },
      },
      default: null,
    },
    isSimulated:        { type: Boolean, required: true, default: false },
  },
  { timestamps: true }
);

RiderSchema.index({ availabilityStatus: 1, h3Index: 1 });
RiderSchema.index({ availabilityStatus: 1, status: 1 });

export default mongoose.model('Rider', RiderSchema);
