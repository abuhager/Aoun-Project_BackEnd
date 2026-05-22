const mongoose = require('mongoose');

const safeHubSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  location: { type: String, required: true, trim: true },
  address:  { type: String, required: true },
  coords: {
    lat: { type: Number },
    lng: { type: Number },
  },
  managedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isActive:    { type: Boolean, default: true },
  workingHours:{ type: String, default: '9:00 - 17:00' },
}, { timestamps: true });

module.exports = mongoose.model('SafeHub', safeHubSchema);