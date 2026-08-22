const mongoose = require('mongoose');

const donationOfferSchema = new mongoose.Schema(
  {
    request: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'DonationRequest',
      required: true,
      index:    true,
    },
    donor: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },
    safeHub: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'SafeHub',
      required: true,
    },
    condition: {
      type:     String,
      enum:     ['جديد', 'مستعمل ممتاز', 'مستعمل جيد'],
      required: true,
    },
    description:  { type: String, maxlength: 500, trim: true },
    imageUrl:     { type: String, default: null },
    cloudinaryId: { type: String, default: null },
    status: {
      type:    String,
      enum: [
        'pending',
        'accepted',
        'rejected',
        'withdrawn',
        'cancelled_by_requester',
        'request_expired',
      ],
      default: 'pending',
      index:   true,
    },
  },
  { timestamps: true, autoIndex: false }
);

module.exports = mongoose.model('DonationOffer', donationOfferSchema);
