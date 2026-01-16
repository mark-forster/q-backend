const mongoose = require("mongoose");

const groupReadStateSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    lastReadMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    lastReadAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// one row per (conversation,user)
groupReadStateSchema.index({ conversationId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("GroupReadState", groupReadStateSchema);
