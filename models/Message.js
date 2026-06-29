// models/Message.js
// CRIT-02: نموذج مستقل للرسائل بدلًا من تضمينها داخل Conversation
// HIGH-04: استخدام timestamps:true بدلًا من createdAt اليدوي

const mongoose = require('mongoose');
const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    // المحادثة التي تنتمي إليها الرسالة — مفهرسة لتسريع الاستعلام
    conversation: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },

    sender: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    text: {
      type: String,
      trim: true,
      required: true,
      maxlength: 1000,
    },

    // HIGH-04: حُذف createdAt اليدوي — timestamps:true يتكفل به
    read: {
      type: Boolean,
      default: false,
    },
  },
  // HIGH-04: يضيف createdAt + updatedAt تلقائيًا بدون تعارض
  { timestamps: true }
);

// فهرس مركّب لجلب رسائل محادثة مرتَّبة بالتاريخ بكفاءة
messageSchema.index({ conversation: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);