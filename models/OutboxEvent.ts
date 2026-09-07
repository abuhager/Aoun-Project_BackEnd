import mongoose from 'mongoose';

export const OUTBOX_EVENT_TYPES = Object.freeze([
  'verification_email',
  'password_reset_email',
  'critical_notification_email',
] as const);

export const OUTBOX_STATUSES = Object.freeze([
  'pending',
  'processing',
  'completed',
  'dead',
] as const);

const outboxEventSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: OUTBOX_EVENT_TYPES,
    required: true,
  },
  encryptedPayload: {
    type: String,
    required: true,
    select: false,
  },
  idempotencyKey: {
    type: String,
    required: true,
    maxlength: 200,
  },
  status: {
    type: String,
    enum: OUTBOX_STATUSES,
    default: 'pending',
    required: true,
  },
  attempts: { type: Number, default: 0, min: 0 },
  maxAttempts: { type: Number, default: 5, min: 1, max: 20 },
  availableAt: { type: Date, default: Date.now, required: true },
  lockedAt: { type: Date, default: null },
  lockedBy: { type: String, default: null, maxlength: 120 },
  completedAt: { type: Date, default: null },
  lastErrorCode: { type: String, default: null, maxlength: 160 },
}, { timestamps: true });

outboxEventSchema.index(
  { idempotencyKey: 1 },
  { unique: true, name: 'idempotency_key_unique' }
);
outboxEventSchema.index(
  { status: 1, availableAt: 1, createdAt: 1 },
  { name: 'outbox_claim_order' }
);
outboxEventSchema.index(
  { status: 1, lockedAt: 1 },
  { name: 'outbox_stale_locks' }
);
outboxEventSchema.index(
  { completedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60, name: 'completed_outbox_ttl' }
);

const OutboxEvent = mongoose.model('OutboxEvent', outboxEventSchema);

export default OutboxEvent;
