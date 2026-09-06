import mongoose from 'mongoose';

const donationRequestSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:     { type: String, required: true, trim: true, maxlength: 100 },
  category:  { type: String, required: true, trim: true, maxlength: 50 },
  urgency:   { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  description: { type: String, maxlength: 500 },
  location:  { type: String, required: true, trim: true, maxlength: 100 },
  status: {
    type:    String,
    // processing حالة داخلية لا تظهر إلا داخل transaction قبول العرض.
    enum:    ['active', 'processing', 'fulfilled', 'expired', 'cancelled'],
    default: 'active',
  },
  fulfilledByItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    default: null,
  },
  month:     { type: String },
  expiresAt: { type: Date, required: true },
}, {
  timestamps: true,
  autoIndex: false,
});

donationRequestSchema.index({ requester: 1, month: 1 });
donationRequestSchema.index({ status: 1, expiresAt: 1 });
donationRequestSchema.index({ category: 1, status: 1, createdAt: -1 });const DonationRequest = mongoose.model('DonationRequest', donationRequestSchema);
export default DonationRequest;
