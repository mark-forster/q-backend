const mongoose = require("mongoose");

const lastCallInfoSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: [
        "outgoing",
        "incoming",
        "missed",
        "declined",
        "completed",
        "timeout",
        "canceled",
      ],
    },
    callType: {
      type: String,
      enum: ["audio", "video"],
      default: "audio",
    },
    duration: { type: Number, default: 0 },
  },
  { _id: false }
);

const lastMessageSchema = new mongoose.Schema(
  {
    text: String,
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // message id of last message
    _id: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },

    callInfo: {
      type: lastCallInfoSchema,
      default: null,
    },
  },
  {
    _id: false,
    timestamps: true, 
  }
);

const pinnedMessageSchema = new mongoose.Schema(
  {
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      required: true,
    },
    pinnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    pinnedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    isGroup: { type: Boolean, default: false },
    name: {
      type: String,
      required: function () {
        return this.isGroup;
      },
    },

    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ],
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // Last message preview
    lastMessage: lastMessageSchema,

    // Soft delete: who deleted this conversation
    deletedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // Pinned messages
    pinnedMessages: {
      type: [pinnedMessageSchema],
      default: [],
    },
    hasActiveCall: {
      type: Boolean,
      default: false,
    },

    activeCallType: {
      type: String,
      enum: ["audio", "video"],
      default: null,
    },
  },
  { timestamps: true }
);

// Indexes for faster queries
conversationSchema.index({ participants: 1 });
conversationSchema.index({ "lastMessage.updatedAt": -1 });

module.exports = mongoose.model("Conversation", conversationSchema);
