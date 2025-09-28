// services/message.service.js
const Message = require("../models/message.model");
const Conversation = require("../models/conversation.model");
const { io, getRecipientSocketId } = require("../socket/socket");
const cloudinary = require("cloudinary").v2;
const fs = require("fs");

// ---- groups ----
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

const findConversation = async (userId, otherUserId) => {
  try {
    const conversation = await Conversation.findOne({
      isGroup: false,
      participants: { $all: [userId, otherUserId] },
    }).populate("participants", "username profilePic name updatedAt");
    return conversation;
  } catch (error) {
    console.error("findConversation error:", error);
    return null;
  }
};

// ---- send message + attachments ----
const sendMessage = async ({ recipientId, conversationId, message, senderId, files }) => {
  try {
    let conversation = await Conversation.findOne({
      participants: { $all: [senderId, recipientId] },
    }).populate({ path: "participants", select: "username profilePic name updatedAt" });

    if (conversation && conversation.deletedBy?.includes(senderId)) {
      conversation.deletedBy = conversation.deletedBy.filter(
        (id) => id.toString() !== senderId.toString()
      );
      await conversation.save();
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

    // upload attachments (Cloudinary)
    let attachments = [];
    if (files?.length) {
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

    // compute lastMessage text
    let lastText = message || "";
    if (!lastText && attachments.length > 0) {
      const t = attachments.at(-1).type;
      lastText = t === "image" ? "Image" : t === "gif" ? "GIF" : t === "video" ? "Video" : t === "audio" ? "Audio" : "File";
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
    if (files?.length) {
      for (const f of files) {
        try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {}
      }
    }
    throw err;
  }
};

// ---- get messages ----
const getMessages = async ({ conversationId, userId }) => {
  try {
    const messages = await Message.find({
      conversationId,
      deletedBy: { $ne: userId },
    }).sort({ createdAt: 1 });
  return messages;
  } catch (error) {
    console.error("Get Messages Error:", error);
    throw error;
  }
};

// ---- get conversations (with unreadCount) ----
const getConversations = async (userId) => {
  try {
    const conversations = await Conversation.find({
      participants: userId,
      deletedBy: { $ne: userId },
    }).populate({ path: "participants", select: "username profilePic name updatedAt" });

    // attach unreadCount without changing schema
    const withUnread = await Promise.all(
      conversations.map(async (conv) => {
        const unreadCount = await Message.countDocuments({
          conversationId: conv._id,
          deletedBy: { $ne: userId },
          seenBy: { $ne: userId },
        });
        const doc = conv.toObject();
        doc.unreadCount = unreadCount;
        // keep non-group participants list filtered for UX consistency
        if (!doc.isGroup) {
          doc.participants = doc.participants.filter(
            (p) => p._id.toString() !== userId.toString()
          );
        }
        return doc;
      })
    );

    return withUnread;
  } catch (err) {
    return err.message;
  }
};

// ---- rename / group ops ----
const renameGroup = async ({ conversationId, name }) => {
  try {
    const updated = await Conversation.findByIdAndUpdate(conversationId, { name }, { new: true });
    return updated;
  } catch (error) {
    console.error("Rename Group Error:", error);
    return null;
  }
};

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

const removeFromGroup = async ({ conversationId, userId }) => {
  try {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.isGroup) return null;
    conversation.participants = conversation.participants.filter((id) => id.toString() !== userId);
    await conversation.save();
    return conversation;
  } catch (error) {
    console.error("Remove from Group Error:", error);
    return null;
  }
};

// ---- delete message / conversation, update message, forward, delete-for-me, seen ----
const deleteMessage = async ({ messageId, currentUserId }) => {
  try {
    const message = await Message.findById(messageId);
    if (!message) return null;
    if (message.sender.toString() !== currentUserId.toString()) {
      throw new Error("You are not authorized to delete this message.");
    }

    if (message.attachments?.length) {
      await Promise.all(
        message.attachments.map(async (attachment) => {
          const otherCount = await Message.countDocuments({
            "attachments.public_id": attachment.public_id,
            _id: { $ne: messageId },
          });
          if (otherCount === 0) {
            try {
              await cloudinary.uploader.destroy(attachment.public_id, {
                resource_type: attachment.resource_type,
                type: attachment.cloudinary_type,
              });
            } catch (e) {
              console.error("Cloudinary delete failed:", attachment.public_id, e?.message);
            }
          }
        })
      );
    }

    const conversationId = message.conversationId;
    const deletedMessageId = message._id;
    await Message.findByIdAndDelete(messageId);

    const conversation = await Conversation.findById(conversationId);
    if (
      conversation &&
      conversation.lastMessage?.sender?.toString() === message.sender.toString() &&
      conversation.lastMessage?.text === message.text
    ) {
      const lastMessage = await Message.findOne({ conversationId }).sort({ createdAt: -1 });
      conversation.lastMessage = lastMessage
        ? { text: lastMessage.text, sender: lastMessage.sender, seenBy: lastMessage.seenBy, updatedAt: lastMessage.updatedAt }
        : {};
      await conversation.save();
    }

    if (conversation) {
      io.to(conversation._id.toString()).emit("messageDeleted", {
        conversationId: conversationId.toString(),
        messageId: deletedMessageId.toString(),
      });
    }

    return { deletedMessageId, conversationId, participants: conversation?.participants };
  } catch (error) {
    console.error("Delete Message Error:", error);
    throw error;
  }
};

const deleteConversation = async ({ conversationId, currentUserId }) => {
  try {
    const conversation = await Conversation.findByIdAndUpdate(
      conversationId,
      { $addToSet: { deletedBy: currentUserId } },
      { new: true }
    );
    if (!conversation) throw new Error("Conversation not found.");

    await Message.updateMany({ conversationId }, { $addToSet: { deletedBy: currentUserId } });

    const totalParticipants = conversation.participants.length;
    const deletedByCount = conversation.deletedBy.length;

    if (totalParticipants > 0 && totalParticipants === deletedByCount) {
      // purge all
      const messages = await Message.find({ conversationId });
      for (const message of messages) {
        if (message.attachments?.length) {
          for (const attachment of message.attachments) {
            const referencedElsewhere = await Message.exists({
              "attachments.public_id": attachment.public_id,
              conversationId: { $ne: conversationId },
            });
            if (!referencedElsewhere) {
              try {
                await cloudinary.uploader.destroy(attachment.public_id, {
                  resource_type: attachment.resource_type,
                  type: attachment.cloudinary_type,
                });
              } catch (e) {
                console.error("Cloudinary delete failed:", e?.message);
              }
            }
          }
        }
      }
      await Message.deleteMany({ conversationId });
      await Conversation.findByIdAndDelete(conversationId);
      io.to(conversationId.toString()).emit("conversationPermanentlyDeleted", { conversationId: conversationId.toString() });
      return { permanentlyDeleted: true, conversationId: conversationId.toString() };
    }

    return { permanentlyDeleted: false, conversationId: conversationId.toString() };
  } catch (error) {
    console.error("Delete Conversation Error:", error);
    throw error;
  }
};

const updateMessage = async ({ messageId, newText, currentUserId }) => {
  try {
    const message = await Message.findById(messageId);
    if (!message) throw new Error("Message not found.");
    if (message.sender.toString() !== currentUserId.toString())
      throw new Error("You are not authorized to update this message.");

    message.text = newText;
    await message.save();

    const conversation = await Conversation.findById(message.conversationId);
    if (conversation && conversation.lastMessage?.text === message.text) {
      conversation.lastMessage.text = newText;
      await conversation.save();
    }

    io.to(message.conversationId.toString()).emit("messageUpdated", {
      conversationId: message.conversationId.toString(),
      messageId: message._id.toString(),
      newText,
    });

    return message;
  } catch (error) {
    console.error("Update Message Error:", error);
    return null;
  }
};

const forwardMessage = async ({ currentUserId, messageId, recipientIds }) => {
  try {
    const originalMessage = await Message.findById(messageId);
    if (!originalMessage) throw new Error("Original message not found");

    const forwarded = [];

    for (const recipientId of recipientIds) {
      let conversation = await Conversation.findOne({
        participants: { $all: [currentUserId, recipientId] },
      }).populate({ path: "participants", select: "username profilePic name" });

      const isNew = !conversation;
      if (isNew) {
        conversation = await Conversation.create({
          isGroup: false,
          participants: [currentUserId, recipientId],
        });
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

      let lastText = originalMessage.text || "";
      if (!lastText && originalMessage.attachments?.length) {
        const t = originalMessage.attachments[0].type;
        lastText = t === "image" ? "Image" : "File";
      }
      conversation.lastMessage = { text: lastText, sender: currentUserId, seenBy: [currentUserId], updatedAt: new Date() };
      await conversation.save();

      const populated = await newMessage.populate("sender", "username profilePic");
      forwarded.push(populated);

      const senderSocketId = getRecipientSocketId(currentUserId);
      const recipientSocketId = getRecipientSocketId(recipientId);

      if (recipientSocketId) {
        if (isNew) io.to(recipientSocketId).emit("conversationCreated", conversation);
        io.to(recipientSocketId).emit("newMessage", populated);
      }
      if (senderSocketId) {
        if (isNew) io.to(senderSocketId).emit("conversationCreated", conversation);
        io.to(senderSocketId).emit("newMessage", populated);
      }
    }

    return forwarded;
  } catch (error) {
    console.error("Error forwarding message:", error);
    throw error;
  }
};

const deleteMessageForMe = async ({ messageId, currentUserId }) => {
  try {
    const message = await Message.findByIdAndUpdate(
      messageId,
      { $addToSet: { deletedBy: currentUserId } },
      { new: true }
    );
    if (!message) throw new Error("Message not found or update failed.");

    const conversation = await Conversation.findById(message.conversationId);
    if (!conversation) return { messageId, permanentlyDeleted: false };

    const totalParticipants = conversation.participants.length;
    const deletedByCount = message.deletedBy.length;

    if (totalParticipants > 0 && totalParticipants === deletedByCount) {
      await Message.findByIdAndDelete(messageId);

      if (message.attachments?.length) {
        for (const attachment of message.attachments) {
          const stillExists = await Message.exists({ "attachments.public_id": attachment.public_id });
          if (!stillExists) {
            try {
              await cloudinary.uploader.destroy(attachment.public_id, {
                resource_type: attachment.resource_type,
                type: attachment.cloudinary_type,
              });
            } catch (e) {
              console.error("Cloudinary delete failed:", e?.message);
            }
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
    // 1) mark all msgs in the room as seen by this user
    await Message.updateMany(
      { conversationId, seenBy: { $ne: userId } },
      { $addToSet: { seenBy: userId } }
    );

    // 2) update conversation.lastMessage metadata
    const conv = await Conversation.findById(conversationId).select("lastMessage");
    if (conv && conv.lastMessage) {
      await Conversation.findByIdAndUpdate(
        conversationId,
        {
          $addToSet: { "lastMessage.seenBy": userId },   // array -> OK
          $set: { "lastMessage.updatedAt": new Date() }, // date -> use $set
        },
        { new: true }
      );
    }

    // 3) notify clients
    io.to(String(conversationId)).emit("messagesSeen", {
      conversationId: String(conversationId),
      userId: String(userId),
    });

    return { ok: true };
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
  updateMessagesSeenStatus,
};
