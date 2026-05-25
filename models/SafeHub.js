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

module.exports = mongoose.model('SafeHub', safeHubSchema);