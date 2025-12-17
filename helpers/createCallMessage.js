// helpers/createCallMessage.js
const mongoose = require("mongoose");
const Message = require("../models/message.model");
const Conversation = require("../models/conversation.model");

module.exports.createCallMessage = async ({
  sender,
  receiver,
  callType,
  status,
  duration = 0,
  io,
  conversationId = null,   // ⭐ NEW
  isGroup = false,         // ⭐ NEW
}) => {
  try {
    let conversation;

    if (isGroup && conversationId) {
      // ⭐ Group call → group conversation ကိုပဲသုံးမယ်
      conversation = await Conversation.findById(conversationId);
    } else {
      // ⭐ Single call → အရင်လို sender/receiver နဲ့ DM လုပ်မယ်
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
    }

    if (!conversation) return;

    const callInfo = { callType, status, duration };

    const msg = await Message.create({
      conversationId: conversation._id,
      sender,
      receiver: isGroup ? null : receiver,
      text: "",
      messageType: "call",
      callInfo,
      attachments: [],
      seenBy: [sender],
    });

    conversation.lastMessage = {
      _id: msg._id,
      text: "",
      sender,
      seenBy: [sender],
      updatedAt: new Date(),
      callInfo,
    };
    await conversation.save();

    // ⭐ Emit
    if (isGroup) {
      // Group call → Group conversation room
      io.to(String(conversation._id)).emit("newMessage", msg);
    } else {
      // Single call → A & B only
      io.to(String(sender)).emit("newMessage", msg);
      io.to(String(receiver)).emit("newMessage", msg);
    }

    return msg;
  } catch (err) {
    console.error("createCallMessage error:", err);
  }
};

