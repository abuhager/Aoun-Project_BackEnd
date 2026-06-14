// models/SafeHub.js
// ✅ FIX [HUB-09]: إضافة compound index على city + isActive
//    يُسرّع الـ query الأكثر استخداماً: findAllActive() + findByCity()

const mongoose = require('mongoose');

const safeHubSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: true,
      trim:     true,
    },
    address: {
      type:     String,
      required: true,
      trim:     true,
    },
    city: {
      type:     String,
      required: true,
      trim:     true,
    },
    coordinates: {
      lat: { type: Number },
      lng: { type: Number },
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
      default: '9:00 ص — 5:00 م',
    },
  },
  { timestamps: true }
);

// ✅ FIX [HUB-09]: compound index — كل query تفلتر بـ isActive أولاً ثم city
safeHubSchema.index({ isActive: 1, city: 1 });

module.exports = mongoose.model('SafeHub', safeHubSchema);