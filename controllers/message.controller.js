// controllers/message.controller.js
const Message = require("../models/message.model");
const catchAsync = require("../config/catchAsync");
const ApiError = require("../config/apiError");
const Conversation = require("../models/conversation.model");
const cloudinary = require("cloudinary").v2;
const messageService = require("../services/message.service");
const fs = require("fs");
const GroupReadState = require("../models/groupReadState.model");

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
  const { recipientId, message, conversationId, replyTo } = req.body;
  const files = req.files;
  const senderId = req.user._id;

  const newMessage = await messageService.sendMessage({
    recipientId,
    conversationId,
    message,
    senderId,
    files,
    replyTo,
    
  });

  res
    .status(201)
    .json({ message: "Message sent successfully", data: newMessage });
});

// getMessages controller
const getMessages = catchAsync(async (req, res, next) => {
  const { conversationId } = req.params;
  const userId = req.user._id;
  const { skip = 0, limit = 50 } = req.query;

  const result = await messageService.getMessages({
    conversationId,
    userId,
    skip,
    limit,
  });
  res.send(result);
});

const searchMessages = catchAsync(async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;
  const { text = "" } = req.query;

  const data = await messageService.searchMessages({
    conversationId,
    userId,
    text,
  });

  res.status(200).json({
    message: "Messages search result",
    data,
  });
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
  const { name } = req.body;
  const participants = req.body.members;
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
  const currentUserId = req.user._id;

  const result = await messageService.renameGroup({
    conversationId,
    name,
    currentUserId,
  });
  if (!result) {
    return res.status(400).json({ message: "Failed to rename group" });
  }
  res.status(200).json({ message: "Group renamed successfully", data: result });
});

const addToGroup = catchAsync(async (req, res, next) => {
  const { conversationId, userId } = req.body;
  const currentUserId = req.user._id;

  const result = await messageService.addToGroup({
    conversationId,
    userId,
    currentUserId,
  });
  if (!result) {
    return res.status(400).json({ message: "Failed to add member to group" });
  }
  res.status(200).json({ message: "Member added successfully", data: result });
});

const removeFromGroup = catchAsync(async (req, res, next) => {
  const { conversationId, userId } = req.body;
  const currentUserId = req.user._id;

  const result = await messageService.removeFromGroup({
    conversationId,
    userId,
    currentUserId,
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

const leaveGroup = catchAsync(async (req, res) => {
  const { conversationId } = req.body;
  const userId = req.user._id;

  if (!conversationId) {
    return res.status(400).json({
      message: "Conversation ID is required",
    });
  }

  const result = await messageService.leaveGroup({
    conversationId,
    userId,
  });

  res.status(200).json({
    message: "Left group successfully",
    data: result,
  });
});



const deleteMessage = catchAsync(async (req, res, next) => {
  const { messageId } = req.params;
  const { deleteForEveryone } = req.query; 
  const currentUserId = req.user._id;

  const result = await messageService.deleteMessage({
    messageId,
    currentUserId,
    deleteForEveryone: deleteForEveryone === "true",
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

  res.status(200).json({
    message: "Conversation deleted successfully",
    data: { conversationId: result.conversationId },
  });
});

// update Method
const updateMessage = catchAsync(async (req, res) => {
  const { messageId } = req.params;
  const { newText, message } = req.body;
  const currentUserId = req.user._id;

  const textToUpdate =
    typeof newText === "string" && newText.length
      ? newText
      : typeof message === "string"
      ? message
      : "";

  if (!textToUpdate.trim()) {
    return res
      .status(400)
      .json({ message: "Updated text cannot be empty." });
  }

  const result = await messageService.updateMessage({
    messageId,
    newText: textToUpdate,
    currentUserId,
  });

  if (!result) {
    return res
      .status(405)
      .json({ message: "Message not found or unauthorized" });
  }

  res.status(200).json({
    message: "Message Updated Successfully",
    data: result,
  });
});

//forward  Method
const forwardMessage = catchAsync(async (req, res) => {
  const { messageId } = req.params;
  const { recipientIds } = req.body;
  const currentUserId = req.user._id;
  const result = await messageService.forwardMessage({
    currentUserId,
    messageId,
    recipientIds,
  });
  if (result && result.length > 0) {
    return res.status(201).json({ message: "Message Forwarded successfully" });
  }
  return res
    .status(400)
    .json({ message: "Message forwarding failed. Please try again." });
});

const getSignedUrl = catchAsync(async (req, res) => {
  const { publicId } = req.params;
  if (!publicId)
    return res.status(400).json({ error: "Public ID is required" });

  const resourceType = req.query.resourceType || "video";
  const format = req.query.format;
  const forceMp3 = String(req.query.forceMp3 || "").toLowerCase() === "true"; // 15 minute 

  const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;

  if (resourceType === "video") {
    const opts = {
      resource_type: "video",
      type: "authenticated",
      secure: true,
      sign_url: true,
      expires_at: expiresAt,
    };

    if (forceMp3) {
      opts.format = "mp3";
      opts.transformation = [{ audio_codec: "mp3" }];
    } else if (format) {
      opts.format = format;
    }

    const url = cloudinary.url(publicId, opts);
    return res.json({ url });
  }

  if (resourceType === "raw") {
    const url = cloudinary.utils.private_download_url(
      publicId,
      format || "bin",
      {
        resource_type: "raw",
        type: "authenticated",
        secure: true,
        sign_url: true,
        expires_at: expiresAt,
      }
    );
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

  const url = cloudinary.url(publicId, {
    resource_type: "image",
    secure: true,
  });
  return res.json({ url });
});

const deleteMessageForMe = catchAsync(async (req, res, next) => {
  const { messageId } = req.params;
  const currentUserId = req.user._id;

  const result = await messageService.deleteMessageForMe({
    messageId,
    currentUserId,
  });

  if (!result) {
    return res
      .status(404)
      .json({ message: "Message not found or already deleted for you" });
  }

  res.status(200).json({ message: "Message deleted for you successfully" });
});

// message Seen Status
const updateMessagesSeenStatus = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    if (!conversationId) {
      return res.status(400).json({ error: "Conversation ID is required." });
    }

    // Call the updated service function
    await messageService.updateMessagesSeenStatus({ conversationId, userId });
    res
      .status(200)
      .json({ message: "Messages seen status updated successfully." });
  } catch (error) {
    console.error("Update Messages Seen Status Controller Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const getGroupReadState = async (req, res) => {
  const { conversationId } = req.params;

  const rows = await GroupReadState.find({ conversationId })
    .select("userId lastReadAt")
    .lean();

  res.json(rows);
};



//messager React
const reactToMessage = catchAsync(async (req, res) => {
  const { messageId } = req.params;
  const { emoji } = req.body;
  const userId = req.user._id;

  const updated = await messageService.reactToMessage({
    messageId,
    userId,
    emoji,
  });

  res.status(200).json({
    message: "Reaction updated",
    data: updated,
  });
});

const removeReaction = catchAsync(async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user._id;

  const updated = await messageService.reactToMessage({
    messageId,
    userId,
    emoji: "",
  });

  res.status(200).json({
    message: "Reaction removed",
    data: updated,
  });
});


const pinMessage = catchAsync(async (req, res) => {
  const { conversationId, messageId } = req.params;
  const userId = req.user._id;

  const conv = await messageService.pinMessage({
    conversationId,
    messageId,
    userId,
  });

  res.status(200).json({
    message: "Message pinned",
    data: conv,
  });
});

const unpinMessage = catchAsync(async (req, res) => {
  const { conversationId, messageId } = req.params;

  const conv = await messageService.unpinMessage({
    conversationId,
    messageId,
  });

  res.status(200).json({
    message: "Message unpinned",
    data: conv,
  });
});

module.exports = {
  startConversation,
  sendMessage,
  getMessages,
  searchMessages,
  getConversations,
  createGroupChat,
  renameGroup,
  addToGroup,
  removeFromGroup,
  leaveGroup,
  deleteMessage,
  deleteConversation,
  updateMessage,
  forwardMessage,
  getSignedUrl,
  deleteMessageForMe,
  updateMessagesSeenStatus,
  getGroupReadState,
  reactToMessage,
  removeReaction,
  pinMessage,
  unpinMessage,
};
