const mongoose = require("mongoose");

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
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      required: true,
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
  },
  { timestamps: true }
);

conversationSchema.index({ item: 1, owner: 1, requester: 1 }, { unique: true });
conversationSchema.index({ participants: 1, updatedAt: -1 });

module.exports = mongoose.model("Conversation", conversationSchema);
