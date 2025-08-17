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
  img,
}) => {
  try {
    let conversation;
    let imageInfo = null;

    if (conversationId && conversationId.startsWith("mock-")) {
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
    } // Upload image if provided

    if (img) {
      const uploadedResponse = await cloudinary.uploader.upload(img.path, {
        resource_type: "auto",
      });
      fs.unlinkSync(img.path); // Delete the local file after upload
      imageInfo = {
        public_id: uploadedResponse.public_id,
        url: uploadedResponse.secure_url,
      };
    } // Create new message

    const newMessage = await Message.create({
      conversationId: conversation._id,
      sender: senderId,
      text: message || "",
      img: imageInfo || null,
      seenBy: [senderId],
    }); // Update conversation's last message

    conversation.lastMessage = {
      text: message || (imageInfo ? imageInfo.url : ""),
      sender: senderId,
      seenBy: [senderId],
    };
    await conversation.save(); // Emit socket event to all participants in the conversation room

    io.to(conversation._id.toString()).emit("newMessage", newMessage);

    return newMessage;
  } catch (err) {
    console.error("Send Message Error:", err.message || err);
    if (img) fs.unlink(img.path, () => {});
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
};
