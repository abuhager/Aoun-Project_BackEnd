// models/AdminLog.js
// يُسجّل كل عملية أدمن — يُستخدم في Phase 6 Admin Dashboard
const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
  adminId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // ✅ targetId اختياري — بعض الـ actions تستهدف Item أو Report مش User
  targetId: { type: mongoose.Schema.Types.ObjectId, refPath: 'targetModel', default: null },
  targetModel: {
    type:    String,
    enum:    ['User', 'Item', 'Report', null],
    default: null,
  },

  action: {
    type: String,
    enum: [
      // ── Phase 1 ──────────────────
      'PROMOTE',        // رفع trustLevel
      'DEMOTE',         // خفض trustLevel
      // ── Phase 6 ──────────────────
      'BAN',            // حظر مستخدم
      'UNBAN',          // رفع الحظر
      'REPORT_ACTION',  // البت في بلاغ (قبول/رفض)
      'ITEM_HIDE',      // إخفاء غرض مخالف
      'HUB_MANAGE',     // إدارة Safe Hub
    ],
    required: true,
  },

  reason: { type: String, default: null },

}, { timestamps: true });

module.exports = mongoose.model('AdminLog', adminLogSchema);