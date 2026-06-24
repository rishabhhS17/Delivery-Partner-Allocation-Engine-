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

export default mongoose.model('AllocationHistory', AllocationHistorySchema);
