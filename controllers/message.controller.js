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
  const files = req.files;
  const senderId = req.user._id;
  const newMessage = await messageService.sendMessage({
    recipientId,
    message,
    senderId,
    files,
  });
  res
    .status(201)
    .json({ message: "Message sent successfully", data: newMessage });
});

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

  // Socket event participants
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

// update Method
const updateMessage = catchAsync(async (req, res) => {
  const { messageId } = req.params;
  const { newText } = req.body;
  const currentUserId = req.user._id;
  const result = await messageService.updateMessage({
    messageId,
    newText,
    currentUserId,
  });
  if (!result) {
    return res
      .status(405)
      .json({ message: "Message not found or unauthorized" });
  }
  res.status(200).json({
    message: "Message Updated Successfully",
    data: { messageId: result.messageId },
  });
});

//forward Message Method
const forwardMessage = catchAsync(async (req, res) => {
  const { messageId } = req.params;
  const { recipientIds } = req.body;
  const currentUserId = req.user._id;
  const result = await messageService.forwardMessage({
    currentUserId,
    messageId,
    recipientIds,
  });
  if (!result) {
    console.log(result);
    return res
      .status(405)
      .json({ message: "Something went wrong this may be serverError" });
  }
  res.status(201).json({ message: "Message Forwarded successfully" });
});

// controller
const getSignedUrl = catchAsync(async (req, res) => {
  const { publicId } = req.params;
  if (!publicId) return res.status(400).json({ error: "Public ID is required" });

  const resourceType = req.query.resourceType || "video";
  const format = req.query.format;
  const forceMp3 = String(req.query.forceMp3 || "").toLowerCase() === "true";

  // 15 minute expiry
  const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;

  if (resourceType === "video") {
    const opts = {
      resource_type: "video", // Cloudinary handles audio under 'video'
      type: "authenticated",
      secure: true,
      sign_url: true,
      expires_at: expiresAt,
    };

    // audio: optionally transcode to mp3 for widest support
    if (forceMp3) {
      opts.format = "mp3";
      opts.transformation = [{ audio_codec: "mp3" }];
    } else if (format) {
      opts.format = format; // serve requested/original format
    }

    const url = cloudinary.url(publicId, opts);
    return res.json({ url });
  }

  if (resourceType === "raw") {
    const url = cloudinary.utils.private_download_url(publicId, format || "bin", {
      resource_type: "raw",
      type: "authenticated",
      secure: true,
      sign_url: true,
      expires_at: expiresAt,
      // don't set attachment:true so browsers can try inline view
    });
    return res.json({ url });
  }

  if (resourceType === "image") {
    const url = cloudinary.url(publicId, {
      resource_type: "image",
      type: "authenticated",
      secure: true,
      sign_url: true,
      expires_at: expiresAt,
      format: format || undefined,
    });
    return res.json({ url });
  }

  const url = cloudinary.url(publicId, { resource_type: "image", secure: true });
  return res.json({ url });
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
  updateMessage,
  forwardMessage,
  getSignedUrl,
};