const Message = require("../models/message.model");
const catchAsync = require("../config/catchAsync");
const ApiError = require("../config/apiError");
const Conversation = require("../models/conversation.model");
const cloudinary = require("cloudinary").v2;
const messageService = require("../services/message.service");
const fs = require("fs");
const startConversation = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { otherUserId } = req.body;

  if (!otherUserId) {
    return res.status(400).json({ message: "Other user ID is required" });
  }

  const conversation = await messageService.findConversation(
    userId,
    otherUserId
  );

  if (!conversation) {
    return res.status(200).json({ data: null });
  }

  res.status(200).json({ message: "Conversation ready", data: conversation });
});

const sendMessage = catchAsync(async (req, res, next) => {
  const { recipientId, message } = req.body;
  let  img  = req.file;
  const senderId = req.user._id;
  const newMessage = await messageService.sendMessage({
    recipientId,
    message,
    senderId,
    img,
  });
  res
    .status(201)
    .json({ message: "Message sent successfully", data: newMessage });
 }
 
);

const getMessages = catchAsync(async (req, res, next) => {
  const { conversationId } = req.params;
  const result = await messageService.getMessages({ conversationId });
  res.send(result);
});

const getConversations = catchAsync(async (req, res, next) => {
  const userId = req.user._id;
  const result = await messageService.getConversations(userId);

  res.status(200).json({
    message: "Conversations fetched successfully",
    conversations: result,
  });
});

const createGroupChat = catchAsync(async (req, res, next) => {
  const { name, participants } = req.body;
  const creatorId = req.user._id;

  const group = await messageService.createGroupChat({
    name,
    participants,
    creatorId,
  });

  if (!group) {
    return res.status(400).json({ message: "Group creation failed" });
  }

  res.status(201).json({ message: "Group created successfully", data: group });
});

const renameGroup = catchAsync(async (req, res, next) => {
  const { conversationId, name } = req.body;

  const result = await messageService.renameGroup({ conversationId, name });
  if (!result) {
    return res.status(400).json({ message: "Failed to rename group" });
  }
  res.status(200).json({ message: "Group renamed successfully", data: result });
});

const addToGroup = catchAsync(async (req, res, next) => {
  const { conversationId, userId } = req.body;

  const result = await messageService.addToGroup({ conversationId, userId });
  if (!result) {
    return res.status(400).json({ message: "Failed to add member to group" });
  }
  res.status(200).json({ message: "Member added successfully", data: result });
});

const removeFromGroup = catchAsync(async (req, res, next) => {
  const { conversationId, userId } = req.body;

  const result = await messageService.removeFromGroup({
    conversationId,
    userId,
  });
  if (!result) {
    return res
      .status(400)
      .json({ message: "Failed to remove member from group" });
  }
  res
    .status(200)
    .json({ message: "Member removed successfully", data: result });
});

const deleteMessage = catchAsync(async (req, res, next) => {
  const { messageId } = req.params;
  const currentUserId = req.user._id;

  const result = await messageService.deleteMessage({
    messageId,
    currentUserId,
  });

  if (!result) {
    return res
      .status(404)
      .json({ message: "Message not found or unauthorized" });
  }

  // Socket event  participants
  if (req.io) {
    result.participants.forEach((participantId) => {
      req.io.to(participantId.toString()).emit("messageDeleted", {
        conversationId: result.conversationId.toString(),
        messageId: result.deletedMessageId.toString(),
      });
    });
  }

  res.status(200).json({
    message: "Message deleted successfully",
    data: { messageId: result.deletedMessageId },
  });
});

const deleteConversation = catchAsync(async (req, res, next) => {
  const { conversationId } = req.params;
  const currentUserId = req.user._id;

  const result = await messageService.deleteConversation({
    conversationId,
    currentUserId,
  });

  if (!result) {
    return res
      .status(404)
      .json({ message: "Conversation not found or unauthorized" });
  }

  // Socket event  participants
  if (req.io) {
    result.participants.forEach((participantId) => {
      req.io.to(participantId.toString()).emit("conversationDeleted", {
        conversationId: result.deletedConversationId.toString(),
      });
    });
  }

  res.status(200).json({
    message: "Conversation deleted successfully",
    data: { conversationId: result.deletedConversationId },
  });
});

module.exports = {
  startConversation,
  sendMessage,
  getMessages,
  getConversations,
  createGroupChat,
  renameGroup,
  addToGroup,
  removeFromGroup,
  deleteMessage,
  deleteConversation,
};
