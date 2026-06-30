// models/Conversation.js
// fixes: CRIT-01 (compound unique index), CRIT-02 (removed embedded messages),
//        HIGH-03 (participants validator), MED-05 (auto lastActivity), MED-06 (sort participants)

const mongoose = require('mongoose');
const { Schema } = mongoose;

const conversationSchema = new Schema(
  {
    item: {
      type: Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
    },

    // HIGH-03: validator يمنع مستخدمًا يتحدث مع نفسه أو محادثة بمشارك واحد
    participants: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      validate: [
        {
          validator: (v) => v.length === 2,
          message: 'المحادثة يجب أن تكون بين مستخدمَين بالضبط',
        },
        {
          validator: (v) => new Set(v.map(String)).size === v.length,
          message: 'لا يمكن تكرار المشارك نفسه في المحادثة',
        },
      ],
    },

    // CRIT-02: بدلًا من تضمين الرسائل — مرجع لآخر رسالة فقط
    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },

    // unreadCount مخزَّن مباشرة لتجنب aggregate عند كل طلب
    unreadCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastActivity: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// CRIT-01: الفهرس الفريد المركّب الصحيح
conversationSchema.index({ item: 1, participants: 1 }, { unique: true });
// فهرس لجلب محادثات مستخدم مرتَّبة بالأحدث
conversationSchema.index({ participants: 1, lastActivity: -1 });

// MED-05: تحديث lastActivity تلقائيًا عند كل save
// MED-06: ترتيب participants تلقائيًا لضمان عمل الفهرس الفريد
conversationSchema.pre('save', async function () {
  if (this.isModified('participants')) {
    this.participants = this.participants
      .map(String)
      .sort()
      .map((id) => new mongoose.Types.ObjectId(id));
  }
  this.lastActivity = new Date();
});

module.exports = mongoose.model('Conversation', conversationSchema);