// models/message.model.js
const mongoose = require("mongoose");

// ---- Attachment Subdocument ----
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
    // ✅ for private audio/video/raw signed URL
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

    // ✅ for direct messages / call messages
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

    // ✅ to distinguish text / call / system
    messageType: {
      type: String,
      enum: ["text", "call", "system"],
      default: "text",
    },

    // Call message support
    callInfo: {
      type: callInfoSchema,
      default: null,
    },

    // ✅ Reply / Quote
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },

    // ✅ Reactions (👍❤️😂…)
    reactions: {
      type: [reactionSchema],
      default: [],
    },

    deletedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    isRead: { type: Boolean, default: false },

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
