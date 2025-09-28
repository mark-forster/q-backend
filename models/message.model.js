// message.model.js
const mongoose = require("mongoose");

// ---- Attachment Subdocument ----
const attachmentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["image", "video", "file", "audio", "gif"],
      required: true,
    },
    url: {
      type: String,
      required: false, // Authenticated files  
    },
    public_id: {
      type: String,
      default: null,
    },
    name: {
      type: String,
      default: null,
    },
    size: {
      type: Number,
      default: null,
    },
    width: {
      type: Number,
      default: null,
    },
    height: {
      type: Number,
      default: null,
    },
    duration: {
      type: Number,
      default: null,
    },
    format: {
      type: String,
      default: null,
    },
    resource_type: {
      type: String,
      enum: ["image", "video", "raw", null],
      default: null, // Cloudinary resource_type
    },
    cloudinary_type: {
      type: String,
      enum: ["upload", "authenticated", null],
      default: null, // Cloudinary type (upload | authenticated)
    },
    mimeType: { type: String, default: null },
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
    text: String,
    attachments: {
      type: [attachmentSchema],
      default: [],
    },
    deletedBy: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        }
    ],
    seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
     isRead: {
            type: Boolean,
            default: false,
        },
    isForwarded: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);
messageSchema.index({ conversationId: 1, _id: -1 });
messageSchema.index({ 'attachments.public_id': 1 });
messageSchema.index({ sender: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);
