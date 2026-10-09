import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  lastRun: Date,
  lastFinishedAt: Date,
  lastSuccessAt: Date,
  nextRunAt: Date,
  lastStatus: { type: String, required: true },
  consecutiveFailures: { type: Number, default: 0 },
  lastDurationMs: Number,
}, { timestamps: true });
export default mongoose.model('BackgroundJobState', schema);
