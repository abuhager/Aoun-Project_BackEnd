import mongoose from 'mongoose';

const safeHubSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: true,
      trim:     true,
      minlength: 3,
      maxlength: 100,
    },
    address: {
      type:     String,
      required: true,
      trim:     true,
      minlength: 3,
      maxlength: 200,
    },
    city: {
      type:     String,
      required: true,
      trim:     true,
      minlength: 2,
      maxlength: 60,
    },
    coordinates: {
      lat: { type: Number, min: -90,  max: 90 },
      lng: { type: Number, min: -180, max: 180 },
    },
    isActive: {
      type:    Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
    },
    workingHours: {
      type:    String,
      trim:    true,
      maxlength: 100,
      default: '9:00 ص — 5:00 م',
    },
  },
  { timestamps: true }
);

// ✅ FIX [HUB-09]: compound index — كل query تفلتر بـ isActive أولاً ثم city
safeHubSchema.index({ isActive: 1, city: 1 });const SafeHub = mongoose.model('SafeHub', safeHubSchema);
export default SafeHub;
