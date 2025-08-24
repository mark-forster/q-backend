// message.service.js
const Message = require("../models/message.model");
const Conversation = require("../models/conversation.model");
const { getRecipientSocketId, io } = require("../socket/socket");
const cloudinary = require("cloudinary").v2;
const fs = require("fs");

/**
 * Creates a new group chat conversation.
 * @param {object} params - The parameters for creating a group chat.
 * @param {string} params.name - The name of the group.
 * @param {string[]} params.participants - An array of participant IDs.
 * @param {string} params.creatorId - The ID of the user who created the group.
 * @returns {Promise<object|null>} The newly created conversation object or null on failure.
 */
const createGroupChat = async ({ name, participants, creatorId }) => {
  try {
    const conversation = new Conversation({
      isGroup: true,
      name,
      participants: [...new Set([...participants, creatorId])],
    });
    await conversation.save();
    return conversation;
  } catch (error) {
    console.error("Group Chat Creation Error:", error);
    return null;
  }
};

/**
 * Finds a one-on-one conversation between two users.
 * @param {string} userId - The ID of the first user.
 * @param {string} otherUserId - The ID of the second user.
 * @returns {Promise<object|null>} The conversation object or null if not found.
 */
const findConversation = async (userId, otherUserId) => {
  try {
    const conversation = await Conversation.findOne({
      isGroup: false,
      participants: { $all: [userId, otherUserId] },
    }).populate("participants", "username profilePic");

    return conversation;
  } catch (error) {
    console.error("findConversation error:", error);
    return null;
  }
};

/**
 * Sends a message and handles file uploads to Cloudinary.
 *
 * @param {object} params - The parameters for the function.
 * @param {string} params.recipientId - The ID of the recipient.
 * @param {string} params.conversationId - The ID of the conversation.
 * @param {string} params.message - The text of the message.
 * @param {string} params.senderId - The ID of the sender.
 * @param {array} params.files - An array of file objects to be uploaded.
 * @returns {Promise<object|null>} The new message object or null if an error occurred.
 */
const sendMessage =  async ({ recipientId, conversationId, message, senderId, files }) => {
  try {
    // locate or create conversation
    let conversation;
    const isMock = String(conversationId || "").startsWith("mock-");

    if (isMock) {
      conversation = await Conversation.findOne({ participants: { $all: [senderId, recipientId] } });
      if (!conversation) {
        conversation = await Conversation.create({ isGroup: false, participants: [senderId, recipientId] });
      }
    } else if (conversationId) {
      conversation = await Conversation.findById(conversationId);
      if (!conversation) throw new Error("Conversation not found");
    } else {
      conversation = await Conversation.findOne({ participants: { $all: [senderId, recipientId] } });
      if (!conversation) {
        conversation = await Conversation.create({ isGroup: false, participants: [senderId, recipientId] });
      }
    }

    // uploads
    let attachments = [];
    if (files && files.length > 0) {
      const uploadPromises = files.map(async (file) => {
        const mimeType = file.mimetype || "";
        const uploadOptions = { secure: true, type: "upload", resource_type: "auto" };
        let attachmentType;

        if (mimeType.startsWith("image/")) {
          attachmentType = mimeType === "image/gif" ? "gif" : "image";
          uploadOptions.resource_type = "image";
          uploadOptions.type = "upload"; // public ok for images
        } else if (mimeType.startsWith("video/")) {
          attachmentType = "video";
          uploadOptions.resource_type = "video";
          uploadOptions.type = "authenticated";
        } else if (mimeType.startsWith("audio/")) {
          // IMPORTANT: audio stored under resource_type 'video'
          attachmentType = "audio";
          uploadOptions.resource_type = "video";
          uploadOptions.type = "authenticated";
          // optional eager mp3 for broad support:
          // uploadOptions.eager = [{ format: "mp3", audio_codec: "mp3" }];
          // uploadOptions.eager_async = true;
        } else if (mimeType.startsWith("application/")) {
          attachmentType = "file";
          uploadOptions.resource_type = "raw";
          uploadOptions.type = "authenticated";
        } else {
          attachmentType = "file";
          uploadOptions.resource_type = "raw";
          uploadOptions.type = "authenticated";
        }

        const uploaded = await cloudinary.uploader.upload(file.path, uploadOptions);
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

        // public URL for public images only; others will use signed URL on demand
        const isPublicImage = (attachmentType === "image" || attachmentType === "gif") && uploadOptions.type !== "authenticated";

        return {
          type: attachmentType, // image | gif | video | audio | file
          url: isPublicImage ? uploaded.secure_url : null,
          public_id: uploaded.public_id,
          name: file.originalname || null,
          size: file.size || null,
          width: uploaded.width || null,
          height: uploaded.height || null,
          duration: uploaded.duration || null,
          format: uploaded.format || null,            // webm/ogg/wav/mp3/png/mp4...
          resource_type: uploaded.resource_type || null, // 'image' | 'video' | 'raw'
          mimeType,                                       // 'audio/webm' etc.
        };
      });

      attachments = await Promise.all(uploadPromises);
    }

    // create message
    const newMessage = await Message.create({
      conversationId: conversation._id,
      sender: senderId,
      text: message || "",
      attachments,
      seenBy: [senderId],
    });

    // lastMessage preview
    let lastText = message || "";
    if (!lastText && attachments.length > 0) {
      const t = attachments[attachments.length - 1].type;
      lastText =
        t === "image" ? "Image" :
        t === "gif"   ? "GIF"   :
        t === "video" ? "Video" :
        t === "audio" ? "Audio" :
        `File: ${attachments[attachments.length - 1].name || "Attachment"}`;
    }

    conversation.lastMessage = { text: lastText, sender: senderId, seenBy: [senderId] };
    await conversation.save();

    // realtime
    io && io.to(conversation._id.toString()).emit("newMessage", newMessage);
    return newMessage;
  } catch (err) {
    console.error("Send Message Error:", err);
    // cleanup temps
    if (files && files.length > 0) {
      for (const f of files) {
        try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {}
      }
    }
    throw err;
  }
};
/**
 * Retrieves all messages for a given conversation.
 * @param {object} params - The parameters for getting messages.
 * @param {string} params.conversationId - The ID of the conversation.
 * @returns {Promise<object[]>} An array of message objects.
 */
const getMessages = async ({ conversationId }) => {
  const messages = await Message.find({ conversationId }).sort({
    createdAt: 1,
  });
  return messages;
};

/**
 * Retrieves all conversations for a given user.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<object[]>} An array of conversation objects.
 */
const getConversations = async (userId) => {
  try {
    const conversations = await Conversation.find({
      participants: userId,
    }).populate({
      path: "participants",
      select: "username profilePic name updatedAt",
    });

    conversations.forEach((conv) => {
      if (!conv.isGroup) {
        conv.participants = conv.participants.filter(
          (p) => p._id.toString() !== userId.toString()
        );
      }
    });

    return conversations;
  } catch (err) {
    return err.message;
  }
};

/**
 * Renames a group conversation.
 * @param {object} params - The parameters for renaming a group.
 * @param {string} params.conversationId - The ID of the conversation.
 * @param {string} params.name - The new name for the group.
 * @returns {Promise<object|null>} The updated conversation object or null on failure.
 */
const renameGroup = async ({ conversationId, name }) => {
  try {
    const updated = await Conversation.findByIdAndUpdate(
      conversationId,
      { name },
      { new: true }
    );
    return updated;
  } catch (error) {
    console.error("Rename Group Error:", error);
    return null;
  }
};

/**
 * Adds a new member to a group conversation.
 * @param {object} params - The parameters for adding a member.
 * @param {string} params.conversationId - The ID of the conversation.
 * @param {string} params.userId - The ID of the user to add.
 * @returns {Promise<object|null>} The updated conversation object or null on failure.
 */
const addToGroup = async ({ conversationId, userId }) => {
  try {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.isGroup) return null;

    if (!conversation.participants.includes(userId)) {
      conversation.participants.push(userId);
      await conversation.save();
    }
    return conversation;
  } catch (error) {
    console.error("Add to Group Error:", error);
    return null;
  }
};

/**
 * Removes a member from a group conversation.
 * @param {object} params - The parameters for removing a member.
 * @param {string} params.conversationId - The ID of the conversation.
 * @param {string} params.userId - The ID of the user to remove.
 * @returns {Promise<object|null>} The updated conversation object or null on failure.
 */
const removeFromGroup = async ({ conversationId, userId }) => {
  try {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.isGroup) return null;

    conversation.participants = conversation.participants.filter(
      (id) => id.toString() !== userId
    );
    await conversation.save();

    return conversation;
  } catch (error) {
    console.error("Remove from Group Error:", error);
    return null;
  }
};

/**
 * Deletes a specific message and updates the last message of the conversation if necessary.
 * @param {object} params - The parameters for deleting a message.
 * @param {string} params.messageId - The ID of the message to delete.
 * @param {string} params.currentUserId - The ID of the user performing the deletion.
 * @returns {Promise<object|null>} The result object with deleted message ID and conversation ID, or null on failure.
 */
const deleteMessage = async ({ messageId, currentUserId }) => {
  try {
    const message = await Message.findById(messageId);
    if (!message) return null;

    if (message.sender.toString() !== currentUserId.toString()) {
      throw new Error("You are not authorized to delete this message.");
    }

    const conversationId = message.conversationId;
    const deletedMessageId = message._id;
    await Message.findByIdAndDelete(messageId);
    const conversation = await Conversation.findById(conversationId); // Check if the deleted message was the last one in the conversation

    if (
      conversation &&
      conversation.lastMessage &&
      conversation.lastMessage.sender &&
      conversation.lastMessage.sender.toString() ===
        message.sender.toString() &&
      conversation.lastMessage.text === message.text
    ) {
      const lastMessage = await Message.findOne({ conversationId }).sort({
        createdAt: -1,
      });
      conversation.lastMessage = lastMessage
        ? {
            text: lastMessage.text,
            sender: lastMessage.sender,
            seenBy: lastMessage.seenBy,
          }
        : {};
      await conversation.save();
    } // Emit socket event to all participants

    if (conversation) {
      io.to(conversation._id.toString()).emit("messageDeleted", {
        conversationId: conversationId.toString(),
        messageId: deletedMessageId.toString(),
      });
      console.log("Emit messageDeleted", conversationId, deletedMessageId);
    }

    return {
      deletedMessageId,
      conversationId,
      participants: conversation.participants,
    };
  } catch (error) {
    console.error("Delete Message Error:", error);
    return null;
  }
};

/**
 * Deletes an entire conversation and all its messages.
 * @param {object} params - The parameters for deleting a conversation.
 * @param {string} params.conversationId - The ID of the conversation to delete.
 * @param {string} params.currentUserId - The ID of the user performing the deletion.
 * @returns {Promise<object|null>} The result object with deleted conversation ID and participants, or null on failure.
 */
const deleteConversation = async ({ conversationId, currentUserId }) => {
  try {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return null; // Check permissions to delete conversation

    if (
      !conversation.participants.some(
        (p) => p.toString() === currentUserId.toString()
      )
    ) {
      throw new Error("You are not authorized to delete this conversation.");
    }

    const participants = conversation.participants;
    const deletedConversationId = conversation._id; // Delete all messages in the conversation

    await Message.deleteMany({ conversationId }); // Delete the conversation itself

    await Conversation.findByIdAndDelete(conversationId); // Emit socket event to all participants

    io.to(deletedConversationId.toString()).emit("conversationDeleted", {
      conversationId: deletedConversationId.toString(),
    });

    return { deletedConversationId, participants };
  } catch (error) {
    console.error("Delete Conversation Error:", error);
    return null;
  }
};

/**
 * Updates an existing message.
 * @param {object} params - The parameters for updating a message.
 * @param {string} params.messageId - The ID of the message to update.
 * @param {string} params.newText - The new text for the message.
 * @param {string} params.currentUserId - The ID of the user performing the update.
 * @returns {Promise<object|null>} The updated message object or null on failure.
 */
const updateMessage = async ({ messageId, newText, currentUserId }) => {
  try {
    const message = await Message.findById(messageId);
    if (!message) {
      throw new Error("Message not found.");
    }
    // Authorization check: ensure the current user is the sender of the message.
    if (message.sender.toString() !== currentUserId.toString()) {
      throw new Error("You are not authorized to update this message.");
    }
    // Update the message text.
    message.text = newText;
    await message.save();
    // Update the conversation's last message if this was the last message.
    const conversation = await Conversation.findById(message.conversationId);
    if (conversation && conversation.lastMessage.text === message.text) {
      conversation.lastMessage.text = newText;
      await conversation.save();
    }
    // Emit a socket event to inform all participants about the update.
    io.to(message.conversationId.toString()).emit("messageUpdated", {
      conversationId: message.conversationId.toString(),
      messageId: message._id.toString(),
      newText,
    });
    console.log(" Emit messageUpdated", messageId, newText);
    return message;
  } catch (error) {
    console.error("Update Message Error:", error);
    return null;
  }
};

/**
 * @param {object} params
 *  * @param {string} params.messageId - The ID of the message to update.
 * @param {string} params.currentUserId - The new text for the message.
 * @param {string} params.participantIds - The ID of the user performing the update.
 *
 *
 */
const forwardMessage = async ({ currentUserId, messageId, recipientIds }) => {
  try {
    const originalMessage = await Message.findById(messageId);
    // console.log(originalMessage);
    if (!originalMessage) {
      return res.status(404).json({ error: "Original message not found" });
    }
    // forward message array
    const forwardedMessages = [];

    // create Message for each recipient(recive users)
    for (const recipientId of recipientIds) {
      // check conversation already exists
      let conversation = await Conversation.findOne({
        participants: { $all: [currentUserId, recipientId] },
      });

      // conversation create if not already exist
      if (!conversation) {
        conversation = new Conversation({
          participants: [currentUserId, recipientId],
        });
        await conversation.save();
      }

      // create new Message
      const newMessage = new Message({
        sender: currentUserId,
        receiver: recipientId,
        conversationId: conversation._id,
        text: originalMessage.text,
        img: originalMessage.img
          ? {
              public_id: originalMessage.img.public_id || null,
              url: originalMessage.img.url || null,
            }
          : null,
      });

      await newMessage.save();

      // Conversation lastMessage message  update
      conversation.lastMessage = {
        text: originalMessage.text,
        sender: originalMessage.sender,
      };
      await conversation.save();

      forwardedMessages.push(newMessage);
    }
    return forwardedMessages;
  } catch (error) {
    console.error("Error forwarding message:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  sendMessage,
  findConversation,
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
};
