// conversation.model.js
const mongoose = require("mongoose");

const lastMessageSchema = new mongoose.Schema({
  text: String,
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
}, { _id: false , timestamps: true});

const conversationSchema = new mongoose.Schema({
  isGroup: { type: Boolean, default: false },
  name: { 
    type: String,
    required: function () { return this.isGroup; }
  },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
  lastMessage: lastMessageSchema
}, { timestamps: true });

module.exports = mongoose.model("Conversation", conversationSchema);
