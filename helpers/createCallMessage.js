// helpers/createCallMessage.js
const mongoose = require("mongoose");
const Message = require("../models/message.model");
const Conversation = require("../models/conversation.model");

function callPreviewText(callType, status) {
  if (status === "missed" || status === "timeout") return `Missed ${callType} call`;
  if (status === "declined") return `Declined ${callType} call`;
  if (status === "canceled") return `Canceled ${callType} call`;
  if (status === "completed") return `${callType} call ended`;
  return `${callType} call`;
}

module.exports.createCallMessage = async ({
  sender,
  receiver,
  callType,
  status,
  duration = 0,
  io,
  conversationId = null,
  isGroup = false,
}) => {
  // ✅ EARLY VALIDATION (MOST IMPORTANT)
  if (!sender) {
    throw new Error("createCallMessage: sender is required");
  }

  try {
    let conversation = null;

    /* ---------- GET CONVERSATION ---------- */
    if (conversationId) {
      conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        throw new Error("Conversation not found");
      }
    } else if (!isGroup) {
      if (!receiver) {
        throw new Error("createCallMessage: receiver is required for single call");
      }

      const senderId = new mongoose.Types.ObjectId(String(sender));
      const receiverId = new mongoose.Types.ObjectId(String(receiver));

      conversation = await Conversation.findOne({
        participants: { $all: [senderId, receiverId] },
        isGroup: false,
      });

      if (!conversation) {
        conversation = await Conversation.create({
          participants: [senderId, receiverId],
          isGroup: false,
        });
      }
    } else {
      // group + no conversationId → NOT allowed
      throw new Error("createCallMessage: group call requires conversationId");
    }

    /* ---------- MESSAGE ---------- */
    const callInfo = { callType, status, duration };
    const previewText = callPreviewText(callType, status);

    const receivers = isGroup ? [null] : [receiver];
    const messages = [];

    for (const r of receivers) {
      const msg = await Message.create({
        conversationId: conversation._id,
        sender,
        receiver: r,
        text: previewText,
        messageType: "call",
        callInfo,
        attachments: [],
        seenBy: [sender],
      });

      const populatedMsg = await Message.findById(msg._id)
        .populate("sender", "name username profilePic")
        .populate("receiver", "name username profilePic");

      conversation.lastMessage = {
        _id: populatedMsg._id,
        text: previewText,
        sender: populatedMsg.sender,
        seenBy: [sender],
        updatedAt: new Date(),
        callInfo,
      };

      if (isGroup) {
        io.to(String(conversation._id)).emit("newMessage", populatedMsg);
      } else {
        io.to(String(sender)).emit("newMessage", populatedMsg);
        io.to(String(r)).emit("newMessage", populatedMsg);
      }

      messages.push(populatedMsg);
    }

    await conversation.save();

    io.to(String(conversation._id)).emit("conversationUpdated", {
      _id: conversation._id,
      lastMessage: conversation.lastMessage,
      updatedAt: conversation.lastMessage.updatedAt,
      isGroup: conversation.isGroup,
      name: conversation.name || null,
    });

    return isGroup ? messages[0] : messages;
  } catch (err) {
    console.error("createCallMessage error:", err.message);
    throw err; // 🔥 let caller know
  }
};
