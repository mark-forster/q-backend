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
      required: true, // CDN/Object storage URL
    },
    public_id: {
      type: String,
      default: null, // Cloudinary/S3 key
    },
    name: {
      type: String,
      default: null, // original file name
    },
    size: {
      type: Number,
      default: null, // bytes
    },
    width: {
      type: Number,
      default: null, // for images/videos
    },
    height: {
      type: Number,
      default: null,
    },
    duration: {
      type: Number,
      default: null, // for audio/video (sec)
    },
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
      type: [attachmentSchema], // multiple files al
      default: [],
    },
    seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", messageSchema);
