const mongoose = require("mongoose");
const participantSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: {
      type: String,
      enum: ["owner", "admin", "member"],
      default: "member",
    },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);
const conversationSchema = new mongoose.Schema(
  {
    isGroup: { type: Boolean, default: false },
    name: { type: String, trim: true },
    groupPhoto: { type: String },
    participants: [participantSchema],
    groupSettings: {
      canMemberInvite: { type: Boolean, default: true },
      canMemberSendMsg: { type: Boolean, default: true },
      canMemberEditInfo: { type: Boolean, default: false },
    },
    lastMessage: {
      _id: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
      text: String,
      sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      messageType: {
        type: String,
        enum: ["text", "call", "system", "sticker"],
      },
      createdAt: Date,
    },
    pinnedMessages: [
      {
        messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
        pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        pinnedAt: { type: Date, default: Date.now },
      },
    ],
    mutedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    hasActiveCall: { type: Boolean, default: false },
    activeCallType: {
      type: String,
      enum: ["audio", "video", null],
      default: null,
    },
  },
  { timestamps: true }
);
conversationSchema.index({ "participants.user": 1 });
conversationSchema.index({ updatedAt: -1 });
module.exports = mongoose.model("Conversation", conversationSchema);
const mongoose = require("mongoose");
 // Attachment
const attachmentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["image", "video", "file", "audio", "gif"],
      required: true,
    },
    url: String,
    name: String,
    size: Number,
    width: Number,
    height: Number,
    duration: Number,
    mimeType: String,
  },
  { _id: false }
); // Call Info
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
    callType: { type: String, enum: ["audio", "video"] },
    duration: { type: Number, default: 0 },
  },
  { _id: false }
); // Reaction
const reactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    emoji: String,
  },
  { _id: false }
);
const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: { type: String, trim: true },
    attachments: [attachmentSchema],
    messageType: {
      type: String,
      enum: ["text", "call", "system", "sticker"],
      default: "text",
    },
    systemDetail: {
      action: String,
      targetUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    callInfo: callInfoSchema,
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    reactions: [reactionSchema],
    isEdited: { type: Boolean, default: false },
    isForwarded: { type: Boolean, default: false },
    forwardedFrom: {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      name: String,
      fromGroup: Boolean,
    },
    deletedForAll: { type: Boolean, default: false },
  },
  { timestamps: true }
);
messageSchema.index({ conversationId: 1, createdAt: -1 });
module.exports = mongoose.model("Message", messageSchema);
const userConversationStateSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    lastReadMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    unreadCount: { type: Number, default: 0 },
    muted: { type: Boolean, default: false },
  },
  { timestamps: true }
);
userConversationStateSchema.index(
  { userId: 1, conversationId: 1 },
  { unique: true }
);
module.exports = mongoose.model(
  "UserConversationState",
  userConversationStateSchema
);
