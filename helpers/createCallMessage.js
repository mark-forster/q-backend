// helpers/createCallMessage.js
const mongoose = require("mongoose");
const Message = require("../models/message.model");
const Conversation = require("../models/conversation.model");

module.exports.createCallMessage = async ({
  sender,    // caller id (string or ObjectId)
  receiver,  // other user id
  callType,  // "audio" | "video"
  status,    // "completed" | "missed" | "declined" | "canceled"
  duration = 0,
  io,
}) => {
  try {
    const senderId = new mongoose.Types.ObjectId(String(sender));
    const receiverId = new mongoose.Types.ObjectId(String(receiver));

    let conversation = await Conversation.findOne({
      participants: { $all: [senderId, receiverId] },
      isGroup: false,
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [senderId, receiverId],
        isGroup: false,
      });
    }

    const callInfo = {
      callType,      // "audio" | "video"
      status,        // "completed" | "missed" | "declined" | "canceled"
      duration,      // seconds
    };

    const msg = await Message.create({
      conversationId: conversation._id,
      sender: senderId,   
      receiver: receiverId,
      text: "",
      messageType: "call",
      callInfo,
      attachments: [],
      seenBy: [senderId],
    });

    conversation.lastMessage = {
      _id: msg._id,
      text: "",
      sender: senderId,
      seenBy: [senderId],
      updatedAt: new Date(),
    };
    await conversation.save();

    io.to(String(senderId)).emit("newMessage", msg);
    io.to(String(receiverId)).emit("newMessage", msg);

    return msg;
  } catch (err) {
    console.error("createCallMessage error:", err);
  }
};
