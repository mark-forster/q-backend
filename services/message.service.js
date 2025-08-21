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
 * Sends a new message in a conversation.
 * @param {object} params - The message parameters.
 * @param {string} params.recipientId - The ID of the message recipient (used for direct messages).
 * @param {string} params.conversationId - The ID of the conversation.
 * @param {string} params.message - The message text.
 * @param {string} params.senderId - The ID of the message sender.
 * @param {object} params.img - The uploaded image file object.
 * @returns {Promise<object|null>} The newly created message object or null on failure.
 */
const sendMessage = async ({
  recipientId,
  conversationId,
  message,
  senderId,
  files,
}) => {
  try {
    let conversation;
    let attachments = [];

    // Corrected check to ensure conversationId is a string before using .startsWith()
    // This prevents the "Cannot read properties of undefined" error.
        const isMock = String(conversationId || "").startsWith("mock-");
    if (
      isMock
    ) {
      conversation = await Conversation.findOne({
        participants: { $all: [senderId, recipientId] },
      });
      if (!conversation) {
        conversation = await Conversation.create({
          isGroup: false,
          participants: [senderId, recipientId],
        });
      }
    } else if (conversationId) {
      conversation = await Conversation.findById(conversationId);
      if (!conversation) throw new Error("Conversation not found");
    } else {
      conversation = await Conversation.findOne({
        participants: { $all: [senderId, recipientId] },
      });
      if (!conversation) {
        conversation = await Conversation.create({
          isGroup: false,
          participants: [senderId, recipientId],
        });
      }
    } // Upload image if provided //Upload files and create attchment objects
    if (files && files.length > 0) {
      const uploadPromises = files.map(async (file) => {
          let attachmentType;
        const mimeType = file.mimetype;
        const uploadedResponse = await cloudinary.uploader.upload(file.path, {
          resource_type: "auto",
        });
        fs.unlinkSync(file.path); // Delete the local file after upload
      
        if (mimeType.startsWith("image/")) {
          attachmentType = "image";
        } else if (mimeType.startsWith("video/")) {
          attachmentType = "video";
        } else if (mimeType.startsWith("audio/")) {
          attachmentType = "audio";
        } else if (mimeType.includes("gif")) {
          attachmentType = "gif";
        } else {
          attachmentType = "file";
        }

        return {
          type: attachmentType,
          url: uploadedResponse.secure_url,
          public_id: uploadedResponse.public_id,
          name: file.originalname,
          size: file.size,
          width: uploadedResponse.width || null,
          height: uploadedResponse.height || null,
          duration: uploadedResponse.duration || null,
        };
      });
      attachments = await Promise.all(uploadPromises);
    } // Create new message

    const newMessage = await Message.create({
      conversationId: conversation._id,
      sender: senderId,
      text: message || "",
      attachments: attachments || null,
      seenBy: [senderId],
    }); // Update conversation's last message
    let lastText = "";
if (attachments && attachments.length > 0) {
  // final attachment
  const lastAttachment = attachments[attachments.length - 1];
  lastText = lastAttachment.url;
} else {
  // if not attachment add  text 
  lastText = message || "";
}
    conversation.lastMessage = {
      text: lastText,
      sender: senderId,
      seenBy: [senderId],
    };
    await conversation.save(); // Emit socket event to all participants in the conversation room

    io.to(conversation._id.toString()).emit("newMessage", newMessage);

    return newMessage;
  } catch (err) {
    console.error("Send Message Error:", err.message || err); // ** Unlink  multiple files in case of an error ** // Make sure to clean up any files that were partially processed.

    if (files && files.length > 0) {
      files.forEach((file) => {
        try {
          // Check if the file still exists before trying to unlink
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch (unlinkErr) {
          console.error("Failed to unlink temporary file:", unlinkErr);
        }
      });
    }
    return null;
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
