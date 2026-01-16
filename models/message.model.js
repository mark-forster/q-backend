const mongoose = require("mongoose");

// ---- Attachment  ----
const attachmentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["image", "video", "file", "audio", "gif"],
      required: true,
    },
    url: { type: String },
    public_id: { type: String, default: null },
    name: { type: String, default: null },
    size: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    duration: { type: Number, default: null },
    format: { type: String, default: null },
    resource_type: {
      type: String,
      enum: ["image", "video", "raw", null],
      default: null,
    },
    cloudinary_type: {
      type: String,
      enum: ["upload", "authenticated", null],
      default: null,
    },
    mimeType: { type: String, default: null },
    signedUrl: { type: String, default: null },
  },
  { _id: false }
);

//  CallInfo Schema
const callInfoSchema = new mongoose.Schema(
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

// Reaction schema
const reactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    emoji: { type: String, required: true },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },

    text: { type: String },

    attachments: {
      type: [attachmentSchema],
      default: [],
    },

    messageType: {
      type: String,
      enum: ["text", "call", "system"],
      default: "text",
    },

    callInfo: {
      type: callInfoSchema,
      default: null,
    },

    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },

    reactions: {
      type: [reactionSchema],
      default: [],
    },

    deletedForAll: {
      type: Boolean,
      default: false,
    },

    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
    },
    deliveredAt: Date,
    readAt: Date,

    isForwarded: { type: Boolean, default: false },
    forwardedFrom: {
      kind: {
        type: String,
        enum: ["user"],
        default: "user",
      },
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      name: String,
      username: String,
    },
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, _id: -1 });
messageSchema.index({ "attachments.public_id": 1 });
messageSchema.index({ sender: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);
