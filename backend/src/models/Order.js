import mongoose from 'mongoose';

const OrderSchema = new mongoose.Schema(
  {
    // The upstream order service's own id for this order. Unique, so a retried request can never
    // create a second order — even after a restart (decision H2). Absent for internal orders.
    externalOrderId: { type: String },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    restaurantName: { type: String, required: true },
    restaurantLat: { type: Number, required: true },
    restaurantLng: { type: Number, required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    customerLat: { type: Number, required: true },
    customerLng: { type: Number, required: true },
    assignedRiderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Rider', default: null },
    status: { type: String, required: true, enum: ['PENDING', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'CANCELLED'], default: 'PENDING' },

    // ── Multi-order engine (Stage 1 + 3) ──────────────────────────────────────
    // Prep starts when the order is placed → prepReadyAt = createdAt + prepTime_s.
    // jitGrace_s is drawn once at creation (random [1,20] s) and reused every tick so
    // departBy = prepReadyAt − travelTime − jitGrace_s counts down stably. actualWait_s
    // records how long the rider actually waited at the restaurant (WAITING telemetry).
    // promisedBy is the absolute per-order deadline, fixed for life:
    //   createdAt + FIRST_MILE_NOMINAL_S + prepTime_s + lastMile_s + ORDER_DEADLINE_SLACK_S.
    prepTime_s:   { type: Number },
    prepReadyAt:  { type: Date },
    jitGrace_s:   { type: Number },
    actualWait_s: { type: Number },
    // When the rider reached the restaurant. Saved (not just kept in memory) so the measured wait
    // stays right across a restart — every engine timer is a saved timestamp (decision E1).
    riderArrivedAt: { type: Date },
    // The open offer, if any: the rider asked and when the offer lapses (a saved timestamp, so
    // it survives a restart). Riders who rejected the order are never offered it again (G3).
    offer: {
      type: {
        riderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Rider' },
        expiresAt: Date,
      },
      default: null,
    },
    rejectedRiderIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Rider', default: [] },
    // When dispatch first looked for a rider — the clock the search widening runs on (G1).
    dispatchStartedAt: { type: Date },
    promisedBy:   { type: Date },

    polyline: { type: [{ lat: Number, lng: Number }], default: [] },
    leg1Duration_s: { type: Number },
    leg2Duration_s: { type: Number },
    leg1OriginLat: { type: Number },
    leg1OriginLng: { type: Number },
    leg1Coords: { type: [[Number]], default: [] },
    leg2Coords: { type: [[Number]], default: [] },
    legStartedAt: { type: Date },
    progress: { type: Number, default: 0 },
    queuedAt: { type: Date },
    allocationScore: { type: Number },
    assignedAt:      { type: Date },
    pickedUpAt:      { type: Date },
    deliveredAt:     { type: Date },
    cancelledAt:     { type: Date },
    // Why a CANCELLED order was cancelled: no rider before its time limit, or the engine hit an
    // error on this order (it is cancelled so one bad order cannot take the city down).
    cancelReason:    { type: String, enum: ['no_rider', 'engine_error', null], default: null },
  },
  { timestamps: true }
);

OrderSchema.index({ status: 1, createdAt: 1 });
OrderSchema.index({ assignedRiderId: 1, deliveredAt: 1 });
// Default Orders view sorts by createdAt desc with no status filter; this index
// lets Mongo serve the "most recent N" query as a cheap index scan instead of an
// in-memory sort of the whole collection.
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ externalOrderId: 1 }, { unique: true, sparse: true });

export default mongoose.model('Order', OrderSchema);
