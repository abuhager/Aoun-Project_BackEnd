import mongoose from "mongoose";

/**
 * NOTE on unreadCount:
 * We deliberately do NOT store a single `unreadCount` number on the
 * conversation. A 2-participant conversation needs a PER-USER unread
 * count ("unread for me" vs "unread for them") — a single shared field
 * can never represent that correctly and was a source of bugs in the
 * old schema. Unread counts are computed on read (see
 * conversationRepository.countUnreadForUser) from the Message.read flag.
 */
const conversationSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['booking', 'admin', 'support'], default: 'booking' },
    threadKey: { type: String },
    subject: { type: String, trim: true, maxlength: 150 },
    supportStatus: { type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open' },
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      required: false,
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    lastMessage: {
      type: String,
      default: "",
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
    archivedAt: { type: Date, default: null, index: true },
    archiveReason: { type: String, trim: true, maxlength: 100, default: null },
  },
  { timestamps: true }
);

conversationSchema.index({ item: 1, owner: 1, requester: 1 }, { unique: true, partialFilterExpression: { item: { $type: 'objectId' } } });
conversationSchema.index({ threadKey: 1 }, { unique: true, partialFilterExpression: { threadKey: { $type: 'string' } } });
conversationSchema.index({ participants: 1, updatedAt: -1 });
conversationSchema.index({ kind: 1, updatedAt: -1, _id: -1 }, { name: 'support_inbox_order' });
conversationSchema.index({ kind: 1, requester: 1, updatedAt: -1, _id: -1 }, { name: 'support_requester_order' });
const Conversation = mongoose.model("Conversation", conversationSchema);
export default Conversation;
