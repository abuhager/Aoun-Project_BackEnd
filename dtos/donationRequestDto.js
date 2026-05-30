const mongoose = require('mongoose');

const donationRequestSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  category: { type: String, required: true, trim: true, maxlength: 50 },
  description: { type: String, maxlength: 500, trim: true },
  location: { type: String, required: true, trim: true, maxlength: 100 },
  urgency: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  },
  status: {
    type: String,
    enum: ['active', 'fulfilled', 'expired', 'cancelled'],
    default: 'active',
  },
  month: { type: String, index: true },
  expiresAt: { type: Date, index: true },
}, { timestamps: true });

donationRequestSchema.index({ requester: 1, month: 1, status: 1 });
donationRequestSchema.index({ status: 1, expiresAt: 1 });
donationRequestSchema.index({ category: 1, status: 1 });

donationRequestSchema.pre(/^find/, function(next) {
  this.where({});
  next();
});

module.exports = mongoose.model('DonationRequest', donationRequestSchema);