import mongoose from 'mongoose';

// Append-only record of every change to an order (created, assigned, picked up, …). Never
// updated, only inserted; MongoDB deletes each record 7 days after it was written.
export const ORDER_EVENT_TTL_SECONDS = 7 * 24 * 60 * 60;

const OrderEventSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  type:    { type: String, required: true },
  at:      { type: Date, required: true, default: Date.now },
  riderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Rider', default: null },
  details: { type: mongoose.Schema.Types.Mixed },
});

OrderEventSchema.index({ orderId: 1, at: 1 });
OrderEventSchema.index({ at: 1 }, { expireAfterSeconds: ORDER_EVENT_TTL_SECONDS });

export default mongoose.model('OrderEvent', OrderEventSchema);
