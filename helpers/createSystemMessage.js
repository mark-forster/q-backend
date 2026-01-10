const mongoose = require("mongoose");
const Message = require("../models/message.model");
const Conversation = require("../models/conversation.model");

module.exports.createSystemMessage = async ({
  conversationId,
  text,
  io,
  senderId = null 
}) => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return;

  const msg = await Message.create({
    conversationId,
    sender: senderId, 
    text,
    messageType: "system", 
    seenBy: senderId ? [senderId] : [],
  });

  const populated = await Message.findById(msg._id);
  io.to(String(conversationId)).emit("newMessage", populated);
  
  // Conversation list update
  conversation.lastMessage = {
    _id: populated._id,
    text: text,
    updatedAt: new Date(),
  };
  await conversation.save();

  return populated;
};