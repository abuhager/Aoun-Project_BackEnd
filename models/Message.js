const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    clientMessageId: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: 1 });
// Speeds up unread-count queries (conversation + sender + read)
messageSchema.index({ conversation: 1, sender: 1, read: 1 });
// Socket retries with the same client id must not create duplicate messages.
messageSchema.index(
  { conversation: 1, sender: 1, clientMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientMessageId: { $type: "string" } },
  }
);

module.exports = mongoose.model("Message", messageSchema);
