// models/Conversation.js
// CRIT-01/02 + HIGH-03 ► Index + Validator

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    sender:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text:      { type: String, trim: true, required: true, maxlength: 1000 },
    createdAt: { type: Date, default: Date.now },
    read:      { type: Boolean, default: false },
  },
  { _id: true }
);

const conversationSchema = new mongoose.Schema(
  {
    item:         { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    messages: {
      type: [messageSchema],
      validate: {
        validator(v) { return v.length <= 2000; },
        message: 'تجاوزت المحادثة الحد الأقصى (2000 رسالة)',
      },
    },
    lastActivity: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

conversationSchema.index({ item: 1, participants: 1 }, { unique: true });
conversationSchema.index({ participants: 1, lastActivity: -1 });
conversationSchema.index({ lastActivity: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
