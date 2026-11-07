import mongoose from 'mongoose';

const AllocationHistorySchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    riderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Rider', required: true },
    allocationScore: { type: Number, required: true },
    breakdown: { type: mongoose.Schema.Types.Mixed },
    candidatesConsidered: { type: Number },
  },
  { timestamps: true }
);

AllocationHistorySchema.index({ orderId: 1 });
// Score breakdowns are kept 7 days, then MongoDB deletes them (decision K3).
export const ALLOCATION_HISTORY_TTL_SECONDS = 7 * 24 * 60 * 60;
AllocationHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: ALLOCATION_HISTORY_TTL_SECONDS });

export default mongoose.model('AllocationHistory', AllocationHistorySchema);
