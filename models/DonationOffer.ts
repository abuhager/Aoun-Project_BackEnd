import mongoose from 'mongoose';

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
      default:  null,
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

donationOfferSchema.index(
  { request: 1, donor: 1 },
  { unique: true, name: 'request_donor_unique' }
);
donationOfferSchema.index({ safeHub: 1, status: 1 }, { name: 'safeHub_status' });
donationOfferSchema.index({ donor: 1, status: 1 }, { name: 'donor_status' });

const DonationOffer = mongoose.model('DonationOffer', donationOfferSchema);
export default DonationOffer;
