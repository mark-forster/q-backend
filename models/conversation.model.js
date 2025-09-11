const mongoose = require("mongoose");

const lastMessageSchema = new mongoose.Schema({
  text: String,
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  // 💡 Note: Add _id to lastMessageSchema for proper indexing and tracking
  _id: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
}, { _id: false, timestamps: true });

const conversationSchema = new mongoose.Schema({
  isGroup: { type: Boolean, default: false },
  name: {
    type: String,
    required: function () { return this.isGroup; }
  },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
  lastMessage: lastMessageSchema,
  // This array will track which users have deleted the conversation.
  deletedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
}, { timestamps: true });


conversationSchema.index({ participants: 1 });
conversationSchema.index({ 'lastMessage.updatedAt': -1 });


module.exports = mongoose.model("Conversation", conversationSchema);