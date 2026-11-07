import mongoose from 'mongoose';

// A time-limited lock: only the instance named in `holder` may act while `expiresAt` is in the
// future. Used so that during a Render deploy, when two instances briefly run side by side,
// only one of them dispatches (decision E4).
const LeaseSchema = new mongoose.Schema({
  _id:       { type: String },
  holder:    { type: String, required: true },
  expiresAt: { type: Date, required: true },
});

export default mongoose.model('Lease', LeaseSchema);
