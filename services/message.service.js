const Message = require("../models/message.model");
const Conversation = require("../models/conversation.model");
const { io } = require("../socket/socket");
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
// 💡 UPDATED: Added a helper function to get the recipient's socket ID (if needed, although we are now using rooms)
const getRecipientSocketId = (recipientId) => {
  const { userSocketMap } = require("../socket/socket");
  return userSocketMap.get(String(recipientId));
};

const sendMessage = async ({ recipientId, conversationId, message, senderId, files }) => {
    try {
        let conversation = await Conversation.findOne({ participants: { $all: [senderId, recipientId] } }).populate({
            path: "participants",
            select: "username profilePic name updatedAt",
        });
        if (conversation) {
      if (conversation.deletedBy && conversation.deletedBy.includes(senderId)) {
       
        conversation.deletedBy = conversation.deletedBy.filter(
          (id) => id.toString() !== senderId.toString()
        );
        await conversation.save();
      }
    }

        const isNewConversation = !conversation;

        if (isNewConversation) {
            conversation = await Conversation.create({
                isGroup: false,
                participants: [senderId, recipientId],
            });
            conversation = await conversation.populate({
                path: "participants",
                select: "username profilePic name updatedAt",
            });
        }

        let attachments = [];
        if (files && files.length > 0) {
            const uploadPromises = files.map(async (file) => {
                const mimeType = file.mimetype || "";
                const uploadOptions = { secure: true, type: "upload", resource_type: "auto" };
                let attachmentType;

                if (mimeType.startsWith("image/")) {
                    attachmentType = mimeType === "image/gif" ? "gif" : "image";
                    uploadOptions.resource_type = "image";
                    uploadOptions.type = "upload";
                } else if (mimeType.startsWith("video/")) {
                    attachmentType = "video";
                    uploadOptions.resource_type = "video";
                    uploadOptions.type = "authenticated";
                } else if (mimeType.startsWith("audio/")) {
                    attachmentType = "audio";
                    uploadOptions.resource_type = "video";
                    uploadOptions.type = "authenticated";
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

                const isPublicImage =
                    (attachmentType === "image" || attachmentType === "gif") &&
                    uploadOptions.type !== "authenticated";

                return {
                    type: attachmentType,
                    url: isPublicImage ? uploaded.secure_url : null,
                    public_id: uploaded.public_id,
                    name: file.originalname || null,
                    size: file.size || null,
                    width: uploaded.width || null,
                    height: uploaded.height || null,
                    duration: uploaded.duration || null,
                    format: uploaded.format || null,
                    resource_type: uploaded.resource_type || null,
                    cloudinary_type: uploadOptions.type || null,
                    mimeType,
                };
            });

            attachments = await Promise.all(uploadPromises);
        }

        const newMessage = await Message.create({
            conversationId: conversation._id,
            sender: senderId,
            text: message || "",
            attachments,
            seenBy: [senderId],
        });

        let lastText = message || "";
        if (!lastText && attachments.length > 0) {
           const t = attachments[attachments.length - 1].type;
            if (t === "image") {
                lastText = "Image";
            } else if (t === "gif") {
                lastText = "GIF";
            } else if (t === "video") {
                lastText = "Video";
            } else if (t === "audio") {
                lastText = "Audio";
            } else {
                // Corrected to show only "File" as requested
                lastText = "File";
            }
        }

        conversation.lastMessage = {
            text: lastText,
            sender: senderId,
            seenBy: [senderId],
            updatedAt: new Date(),
        };
        await conversation.save();

        if (io) {
            // FIX: Emit only to the recipient, not the whole conversation room.
            const recipientSocketId = getRecipientSocketId(recipientId);
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("newMessage", newMessage);
            }

            if (isNewConversation) {
                const recipient = conversation.participants.find(
                    (p) => p._id.toString() !== senderId.toString()
                );
                if (recipient) {
                    const recipientSocketIdForConv = getRecipientSocketId(recipient._id.toString());
                    if (recipientSocketIdForConv) {
                         io.to(recipientSocketIdForConv).emit("conversationCreated", conversation);
                    }
                }
            }
        }

        return newMessage;
    } catch (err) {
        console.error("Send Message Error:", err);
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
 * @param {string} params.userId - The ID of the current user.
 * @returns {Promise<object[]>} An array of message objects.
 */
const getMessages = async ({ conversationId, userId }) => {
  try {
    const messages = await Message.find({
      conversationId,
      deletedBy: { $ne: userId }
    }).sort({
      createdAt: 1,
    });
    return messages;
  } catch (error) {
    console.error("Get Messages Error:", error);
    throw error;
  }
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
      deletedBy: { $ne: userId }
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
 * 💡 UPDATED: This method now specifically handles 'delete for everyone'.
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
    
    // Check and delete attachments from Cloudinary if no other messages reference them.
    if (message.attachments && message.attachments.length > 0) {
      const promises = message.attachments.map(async (attachment) => {
        const otherMessagesWithAttachment = await Message.countDocuments({
          "attachments.public_id": attachment.public_id,
          _id: { $ne: messageId },
        });

        if (otherMessagesWithAttachment === 0) {
          try {
            await cloudinary.uploader.destroy(attachment.public_id, {
              resource_type: attachment.resource_type,
              type: attachment.cloudinary_type,
            });
            console.log(`Successfully deleted Cloudinary resource: ${attachment.public_id}`);
          } catch (error) {
            console.error(`Error deleting Cloudinary resource ${attachment.public_id}:`, error);
          }
        } else {
          console.log(`Resource ${attachment.public_id} is still referenced by ${otherMessagesWithAttachment} other messages. Skipping deletion.`);
        }
      });
      await Promise.all(promises);
    }
    
    const conversationId = message.conversationId;
    const deletedMessageId = message._id;
    await Message.findByIdAndDelete(messageId);
    const conversation = await Conversation.findById(conversationId);

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
    }

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
    throw error;
  }
};

/**
 * Deletes a conversation from a user's view, or permanently if all participants have deleted it.
 * @param {object} params - The parameters for deleting a conversation.
 * @param {string} params.conversationId - The ID of the conversation to delete.
 * @param {string} params.currentUserId - The ID of the user performing the deletion.
 * @returns {Promise<object|null>} The result object or null on failure.
 */
const deleteConversation = async ({ conversationId, currentUserId }) => {
  try {
    // Step 1: Add the current user to the conversation's deletedBy array.
    const conversation = await Conversation.findByIdAndUpdate(
      conversationId,
      { $addToSet: { deletedBy: currentUserId } },
      { new: true }
    );
    if (!conversation) {
      throw new Error("Conversation not found.");
    }
      await Message.updateMany(
            { conversationId },
            { $addToSet: { deletedBy: currentUserId } }
        ); 


    // Step 2: Check if ALL participants have deleted the conversation.
    const totalParticipants = conversation.participants.length;
    const deletedByCount = conversation.deletedBy.length;
    
    if (totalParticipants > 0 && totalParticipants === deletedByCount) {
      console.log(`Conversation ${conversationId} deleted for all participants. Permanently deleting messages and files.`);
      
      // Permanently delete all messages associated with the conversation.
      const messages = await Message.find({ conversationId });
      if (messages.length > 0) {
        // Find and delete associated files from Cloudinary
        for (const message of messages) {
          if (message.attachments && message.attachments.length > 0) {
            for (const attachment of message.attachments) {
              // Check if the file is used in ANY other conversation
              const isReferencedByOtherConversations = await Message.exists({
                "attachments.public_id": attachment.public_id,
                conversationId: { $ne: conversationId }
              });

              if (!isReferencedByOtherConversations) {
                try {
                  await cloudinary.uploader.destroy(attachment.public_id, {
                    resource_type: attachment.resource_type,
                    type: attachment.cloudinary_type,
                  });
                  console.log(`Successfully deleted Cloudinary resource: ${attachment.public_id}`);
                } catch (error) {
                  console.error(`Error deleting Cloudinary resource ${attachment.public_id}:`, error);
                }
              } else {
                console.log(`Resource ${attachment.public_id} is still referenced in other conversations. Skipping deletion.`);
              }
            }
          }
        }
      }

      // Finally, permanently delete the messages and the conversation from the database.
      await Message.deleteMany({ conversationId });
      await Conversation.findByIdAndDelete(conversationId);
      
      // Emit socket event to notify all clients that the conversation is permanently gone.
      io.to(conversationId.toString()).emit("conversationPermanentlyDeleted", {
        conversationId: conversationId.toString(),
      });

      return { permanentlyDeleted: true, conversationId: conversationId.toString() };
      
    } else {
      console.log(`Conversation ${conversationId} deleted for user ${currentUserId}. Not yet permanently deleted.`);
      
      // Emit a socket event to the current user only (optional)
      // or simply rely on the frontend's local state update.
      
      return { permanentlyDeleted: false, conversationId: conversationId.toString() };
    }
  } catch (error) {
    console.error("Delete Conversation Error:", error);
    throw error;
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
 * * @param {string} params.messageId - The ID of the message to update.
 * @param {string} params.currentUserId - The new text for the message.
 * @param {string} params.participantIds - The ID of the user performing the update.
 *
 *
 */
const forwardMessage = async ({ currentUserId, messageId, recipientIds }) => {
    try {
        const originalMessage = await Message.findById(messageId);
        if (!originalMessage) {
            throw new Error("Original message not found");
        }

        const forwardedMessages = [];

        for (const recipientId of recipientIds) {
            let conversation = await Conversation.findOne({
                participants: { $all: [currentUserId, recipientId] },
            }).populate({
                path: "participants",
                select: "username profilePic name",
            });

            const isNewConversation = !conversation;

            if (isNewConversation) {
                conversation = await Conversation.create({
                    isGroup: false,
                    participants: [currentUserId, recipientId],
                });
                // Conversation အသစ်ကို populate လုပ်ထားမှသာ client မှာ လိုအပ်တဲ့ data တွေရမယ်
                conversation = await conversation.populate("participants", "username name profilePic");
            }

            const newMessage = await Message.create({
                sender: currentUserId,
                conversationId: conversation._id,
                text: originalMessage.text,
                attachments: originalMessage.attachments || [],
                seenBy: [currentUserId],
                isForwarded: true,
            });

            // Conversation ရဲ့ lastMessage ကို update လုပ်ပါ
            let lastText = originalMessage.text || "";
            if (!lastText && originalMessage.attachments && originalMessage.attachments.length > 0) {
                const t = originalMessage.attachments[0].type;
                lastText = t === "image" ? "Image" : "File";
            }
            conversation.lastMessage = {
                text: lastText,
                sender: currentUserId,
                seenBy: [currentUserId]
            };
            await conversation.save();

            // newMessage ကို populate လုပ်ပြီးမှ event ထဲမှာ ထည့်ပြီး ပြန်ပို့ဖို့
            const populatedNewMessage = await newMessage.populate("sender", "username profilePic");
            forwardedMessages.push(populatedNewMessage);

            // Socket.IO Logic
            const senderSocketId = getRecipientSocketId(currentUserId);
            const recipientSocketId = getRecipientSocketId(recipientId);

            // လက်ခံသူဆီကို event ပို့မယ်
            if (recipientSocketId) {
                // conversation အသစ်ဆိုရင် conversationCreated event ကို ပို့မယ်
                if (isNewConversation) {
                    io.to(recipientSocketId).emit("conversationCreated", conversation);
                }
                // ရှိပြီးသားဖြစ်ဖြစ်၊ အသစ်ဖြစ်ဖြစ် newMessage event ပို့မယ်
                io.to(recipientSocketId).emit("newMessage", populatedNewMessage);
            }

            // sender (လက်ရှိ user) ဆီကို event ပို့မယ်
            if (senderSocketId) {
                if (isNewConversation) {
                    // Conversation အသစ်ဆိုရင် sender ဆီကိုလည်း conversationCreated event ပို့မယ်
                    io.to(senderSocketId).emit("conversationCreated", conversation);
                }
                // newMessage event ကိုလည်း ပို့မယ် (မလိုရင် ဖယ်နိုင်သည်၊ ဒါပေမဲ့ ရှိပြီးသား conversation မှာ message update အတွက် အသုံးဝင်)
                io.to(senderSocketId).emit("newMessage", populatedNewMessage);
            }
        }
        return forwardedMessages;
    } catch (error) {
        console.error("Error forwarding message:", error);
        throw error;
    }
};

// 💡 This is the new, separate function to handle 'delete for me' logic.
const deleteMessageForMe = async ({ messageId, currentUserId }) => {
  try {
    // Step 1: Add the user ID to the message's deletedBy array.
    const message = await Message.findByIdAndUpdate(
      messageId,
      { $addToSet: { deletedBy: currentUserId } },
      { new: true }
    );

    if (!message) {
      throw new Error("Message not found or update failed.");
    }

    // Step 2: Get the conversation to find the total number of participants.
    const conversation = await Conversation.findById(message.conversationId);
    if (!conversation) {
      return { messageId, permanentlyDeleted: false };
    }

    const totalParticipants = conversation.participants.length;
    const deletedByCount = message.deletedBy.length;

    // Step 3: Check if all participants have deleted the message.
    if (totalParticipants > 0 && totalParticipants === deletedByCount) {
      console.log(`Message ${messageId} deleted for all participants. Permanently deleting from DB.`);
      
      // Permanently delete the message and its attachments if not referenced elsewhere.
      await Message.findByIdAndDelete(messageId);

      if (message.attachments && message.attachments.length > 0) {
        for (const attachment of message.attachments) {
          const isReferencedByOtherMessages = await Message.exists({
            "attachments.public_id": attachment.public_id,
            // Note: We don't need to exclude the current message here because it's already deleted.
          });

          if (!isReferencedByOtherMessages) {
            try {
              await cloudinary.uploader.destroy(attachment.public_id, {
                resource_type: attachment.resource_type,
                type: attachment.cloudinary_type,
              });
              console.log(`Successfully deleted Cloudinary resource: ${attachment.public_id}`);
            } catch (error) {
              console.error(`Error deleting Cloudinary resource ${attachment.public_id}:`, error);
            }
          } else {
            console.log(`Resource ${attachment.public_id} is still referenced by other messages. Skipping deletion.`);
          }
        }
      }
      return { messageId, permanentlyDeleted: true };
    }

    return { messageId, permanentlyDeleted: false };
  } catch (error) {
    console.error("Error in deleteMessageForMe service:", error);
    throw error;
  }
};

const updateMessagesSeenStatus = async ({ conversationId, userId }) => {
  try {
    const updatedMessages = await Message.updateMany(
      {
        conversationId,
        "seenBy": { "$ne": userId }
      },
      {
        "$addToSet": { "seenBy": userId }
      }
    );
    await Conversation.findByIdAndUpdate(
      conversationId,
      { "$addToSet": { "lastMessage.seenBy": userId } },
      { new: true }
    );

    if (io) {
      io.to(conversationId).emit("messagesSeen", {
        conversationId,
        userId,
      });
      console.log(`User ${userId} seen messages in conversation ${conversationId}`);
    }

    return updatedMessages;
  } catch (error) {
    console.error("Update Messages Seen Status Error:", error);
    throw error;
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
  deleteMessageForMe,
  updateMessagesSeenStatus
};