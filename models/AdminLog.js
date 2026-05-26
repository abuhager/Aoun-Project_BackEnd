// models/AdminLog.js
// يُسجّل كل عملية أدمن — يُستخدم في Phase 6 Admin Dashboard
const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
  adminId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action:     { type: String, enum: ['PROMOTE', 'DEMOTE', 'BAN', 'UNBAN'], required: true },
  reason:     { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('AdminLog', adminLogSchema);