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
      required: false, // Updated: changed to false for authenticated files
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
     format:{
      type:String,
      default:null
     },
     resource_type: {
    type: String,
    enum: ["image", "video", "raw", null],
    default: null,                                  // Cloudinary resource_type
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
    seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", messageSchema);
