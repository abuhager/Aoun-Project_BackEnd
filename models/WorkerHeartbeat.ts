import mongoose from 'mongoose';

const workerHeartbeatSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  state: {
    type: String,
    enum: ['starting', 'running', 'stopped', 'error'],
    required: true,
  },
  workerId: { type: String, required: true, maxlength: 120 },
  heartbeatAt: { type: Date, required: true },
  lastProcessedAt: { type: Date, default: null },
  lastErrorCode: { type: String, default: null, maxlength: 160 },
}, { timestamps: true });

const WorkerHeartbeat = mongoose.model('WorkerHeartbeat', workerHeartbeatSchema);

export default WorkerHeartbeat;
