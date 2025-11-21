// services/message.service.js
const Message = require("../models/message.model");
const Conversation = require("../models/conversation.model");
const { io, getRecipientSocketIds } = require("../socket/socket");
const cloudinary = require("cloudinary").v2;
const fs = require("fs");

// -----------------------------
// Group Chat Helpers
// -----------------------------
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

// -----------------------------
// Helper: Upload Attachments
// -----------------------------
async function uploadAttachments(files = []) {
  if (!files.length) return [];

  const uploads = files.map(async (file) => {
    const mimeType = file.mimetype || "";
    const uploadOptions = {
      secure: true,
      resource_type: "auto",
      type: "upload",
    };

    let attachmentType = "file";

    if (mimeType.startsWith("image/")) {
      attachmentType = mimeType === "image/gif" ? "gif" : "image";
      uploadOptions.resource_type = "image";
      uploadOptions.type = "upload"; // public
    } else if (mimeType.startsWith("video/")) {
      attachmentType = "video";
      uploadOptions.resource_type = "video";
      uploadOptions.type = "authenticated";
    } else if (mimeType.startsWith("audio/")) {
      attachmentType = "audio";
      uploadOptions.resource_type = "video"; // Cloudinary uses video for audio too
      uploadOptions.type = "authenticated";
    } else {
      attachmentType = "file";
      uploadOptions.resource_type = "raw";
      uploadOptions.type = "authenticated";
    }

    const uploaded = await cloudinary.uploader.upload(file.path, uploadOptions);
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

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

  return Promise.all(uploads);
}

// Helper: build lastMessage text
function resolveLastMessageText(messageText, attachments = []) {
  if (messageText && messageText.trim()) return messageText.trim();
  if (!attachments.length) return "";

  const t = attachments.at(-1)?.type;
  if (t === "image") return "Image";
  if (t === "gif") return "GIF";
  if (t === "video") return "Video";
  if (t === "audio") return "Audio";
  return "File";
}

// Helper: emit to all socketIds of a user
function emitToUser(userId, event, payload) {
  const sockets = getRecipientSocketIds(userId);
  if (!sockets || !sockets.length) return;
  sockets.forEach((sid) => {
    io.to(sid).emit(event, payload);
  });
}

// -----------------------------
// SEND MESSAGE
// -----------------------------
const sendMessage = async ({
  recipientId,
  conversationId,
  message,
  senderId,
  files,
}) => {
  try {
    let conversation = null;
    const sender = String(senderId);
    const receiver = String(recipientId);

    // 1) Try to use provided conversationId (if any)
    if (conversationId) {
      conversation = await Conversation.findById(conversationId).populate(
        "participants",
        "username profilePic name updatedAt"
      );
    }

    // 2) Fallback: find by participants
    if (!conversation) {
      conversation = await Conversation.findOne({
        isGroup: false,
        participants: { $all: [sender, receiver] },
      }).populate("participants", "username profilePic name updatedAt");
    }

    // 3) If conversation previously deleted by sender → remove from deletedBy
    if (conversation && conversation.deletedBy?.includes(sender)) {
      conversation.deletedBy = conversation.deletedBy.filter(
        (id) => id.toString() !== sender
      );
      await conversation.save();
    }

    const isNewConversation = !conversation;

    // 4) Create new conversation if needed
    if (!conversation) {
      conversation = await Conversation.create({
        isGroup: false,
        participants: [sender, receiver],
      });
      conversation = await conversation.populate(
        "participants",
        "username profilePic name updatedAt"
      );
    }

    // 5) Upload attachments to Cloudinary
    const attachments = await uploadAttachments(files);

    // 6) Create message
    const newMessage = await Message.create({
      conversationId: conversation._id,
      sender: sender,
      text: message || "",
      attachments,
      seenBy: [sender],
    });

    // 7) Update conversation.lastMessage
    const lastText = resolveLastMessageText(message, attachments);

    conversation.lastMessage = {
      text: lastText,
      sender: sender,
      seenBy: [sender],
      updatedAt: new Date(),
    };
    await conversation.save();

    // 8) Emit socket events
    // - emit ONLY to receiver for "newMessage"
    emitToUser(receiver, "newMessage", newMessage);

    // - if this is a brand new conversation, notify both sides
    if (isNewConversation) {
      const convPayload = conversation.toObject();

      emitToUser(receiver, "conversationCreated", convPayload);
      emitToUser(sender, "conversationCreated", convPayload);
    }

    return newMessage;
  } catch (err) {
    console.error("Send Message Error:", err);
    if (files?.length) {
      for (const f of files) {
        try {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        } catch {}
      }
    }
    throw err;
  }
};

// -----------------------------
// GET MESSAGES
// -----------------------------
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

// -----------------------------
// GET CONVERSATIONS (with unreadCount)
// -----------------------------
const getConversations = async (userId) => {
  try {
    const conversations = await Conversation.find({
      participants: userId,
      deletedBy: { $ne: userId },
    }).populate(
      "participants",
      "username profilePic name updatedAt"
    );

    const withUnread = await Promise.all(
      conversations.map(async (conv) => {
        const unreadCount = await Message.countDocuments({
          conversationId: conv._id,
          deletedBy: { $ne: userId },
          seenBy: { $ne: userId },
        });

        const doc = conv.toObject();
        doc.unreadCount = unreadCount;

        // direct chat ဖြစ်ရင် – UI အတွက် opposite user တစ်ယောက်ထဲ ပြန်ပေးမယ်
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
    console.error("GetConversations Error:", err);
    throw err;
  }
};

// -----------------------------
// Group ops
// -----------------------------
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

    conversation.participants = conversation.participants.filter(
      (id) => id.toString() !== String(userId)
    );
    await conversation.save();
    return conversation;
  } catch (error) {
    console.error("Remove from Group Error:", error);
    return null;
  }
};

// -----------------------------
// DELETE MESSAGE (for everyone)
// -----------------------------
const deleteMessage = async ({ messageId, currentUserId }) => {
  try {
    const message = await Message.findById(messageId);
    if (!message) return null;

    if (message.sender.toString() !== String(currentUserId)) {
      throw new Error("You are not authorized to delete this message.");
    }

    // cloudinary cleanup
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
              console.error(
                "Cloudinary delete failed:",
                attachment.public_id,
                e?.message
              );
            }
          }
        })
      );
    }

    const conversationId = message.conversationId;
    const deletedMessageId = message._id;

    await Message.findByIdAndDelete(messageId);

    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
      // re-compute lastMessage
      const lastMessage = await Message.findOne({
        conversationId,
        deletedBy: { $ne: currentUserId },
      }).sort({ createdAt: -1 });

      if (lastMessage) {
        conversation.lastMessage = {
          text: resolveLastMessageText(
            lastMessage.text,
            lastMessage.attachments || []
          ),
          sender: lastMessage.sender,
          seenBy: lastMessage.seenBy,
          updatedAt: lastMessage.updatedAt,
        };
      } else {
        conversation.lastMessage = undefined;
      }
      await conversation.save();

      // notify all participants in this conversation room
      io.to(String(conversationId)).emit("messageDeleted", {
        conversationId: String(conversationId),
        messageId: String(deletedMessageId),
      });
    }

    return {
      deletedMessageId,
      conversationId,
      participants: conversation?.participants,
    };
  } catch (error) {
    console.error("Delete Message Error:", error);
    throw error;
  }
};

// -----------------------------
// DELETE CONVERSATION
// -----------------------------
const deleteConversation = async ({ conversationId, currentUserId }) => {
  try {
    const conversation = await Conversation.findByIdAndUpdate(
      conversationId,
      { $addToSet: { deletedBy: currentUserId } },
      { new: true }
    );

    if (!conversation) throw new Error("Conversation not found.");

    await Message.updateMany(
      { conversationId },
      { $addToSet: { deletedBy: currentUserId } }
    );

    const totalParticipants = conversation.participants.length;
    const deletedByCount = conversation.deletedBy.length;

    if (totalParticipants > 0 && totalParticipants === deletedByCount) {
      // all participants deleted → purge completely
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
                console.error(
                  "Cloudinary delete failed:",
                  e?.message
                );
              }
            }
          }
        }
      }

      await Message.deleteMany({ conversationId });
      await Conversation.findByIdAndDelete(conversationId);

      io.to(String(conversationId)).emit(
        "conversationPermanentlyDeleted",
        { conversationId: String(conversationId) }
      );

      return {
        permanentlyDeleted: true,
        conversationId: String(conversationId),
      };
    }

    return {
      permanentlyDeleted: false,
      conversationId: String(conversationId),
    };
  } catch (error) {
    console.error("Delete Conversation Error:", error);
    throw error;
  }
};

// -----------------------------
// UPDATE MESSAGE (edit)
// -----------------------------
const updateMessage = async ({ messageId, newText, currentUserId }) => {
  try {
    const message = await Message.findById(messageId);
    if (!message) throw new Error("Message not found.");

    if (message.sender.toString() !== String(currentUserId)) {
      throw new Error("You are not authorized to update this message.");
    }

    message.text = newText;
    await message.save();

    // update conversation.lastMessage if this is latest message
    const conversationId = message.conversationId;
    const latest = await Message.findOne({ conversationId }).sort({
      createdAt: -1,
    });

    if (latest && String(latest._id) === String(messageId)) {
      await Conversation.findByIdAndUpdate(conversationId, {
        $set: {
          "lastMessage.text": resolveLastMessageText(
            newText,
            message.attachments || []
          ),
          "lastMessage.sender": message.sender,
          "lastMessage.updatedAt": new Date(),
        },
      });
    }

    // send socket event for that conversation room
    io.to(String(conversationId)).emit("messageUpdated", {
      conversationId: String(conversationId),
      messageId: String(messageId),
      newText,
    });

    return message;
  } catch (error) {
    console.error("Update Message Error:", error);
    return null;
  }
};

// -----------------------------
// FORWARD MESSAGE
// -----------------------------
const forwardMessage = async ({
  currentUserId,
  messageId,
  recipientIds,
}) => {
  try {
    const originalMessage = await Message.findById(messageId);
    if (!originalMessage) throw new Error("Original message not found");

    const forwarded = [];

    for (const rid of recipientIds) {
      const recipientId = String(rid);
      const senderId = String(currentUserId);

      let conversation = await Conversation.findOne({
        isGroup: false,
        participants: { $all: [senderId, recipientId] },
      }).populate("participants", "username profilePic name");

      const isNew = !conversation;

      if (!conversation) {
        conversation = await Conversation.create({
          isGroup: false,
          participants: [senderId, recipientId],
        });
        conversation = await conversation.populate(
          "participants",
          "username name profilePic"
        );
      }

      const newMsg = await Message.create({
        sender: senderId,
        conversationId: conversation._id,
        text: originalMessage.text,
        attachments: originalMessage.attachments || [],
        seenBy: [senderId],
        isForwarded: true,
      });

      const lastText = resolveLastMessageText(
        originalMessage.text,
        originalMessage.attachments || []
      );
      conversation.lastMessage = {
        text: lastText,
        sender: senderId,
        seenBy: [senderId],
        updatedAt: new Date(),
      };
      await conversation.save();

      forwarded.push(newMsg);

      // notify participants
      if (isNew) {
        const convObj = conversation.toObject();
        emitToUser(recipientId, "conversationCreated", convObj);
        emitToUser(senderId, "conversationCreated", convObj);
      }

      emitToUser(recipientId, "newMessage", newMsg);
      // sender UI ကို HTTP response နဲ့ handle လုပ်နေပြီ ဆိုရင်
      // 여기서 emitToUser(senderId, "newMessage", newMsg) မလိုပါ
    }

    return forwarded;
  } catch (error) {
    console.error("Error forwarding message:", error);
    throw error;
  }
};

// -----------------------------
// DELETE MESSAGE FOR ME
// -----------------------------
const deleteMessageForMe = async ({ messageId, currentUserId }) => {
  try {
    const message = await Message.findByIdAndUpdate(
      messageId,
      { $addToSet: { deletedBy: currentUserId } },
      { new: true }
    );
    if (!message) throw new Error("Message not found or update failed.");

    const conversation = await Conversation.findById(
      message.conversationId
    );
    if (!conversation) {
      return { messageId, permanentlyDeleted: false };
    }

    const totalParticipants = conversation.participants.length;
    const deletedByCount = message.deletedBy.length;

    if (totalParticipants > 0 && totalParticipants === deletedByCount) {
      await Message.findByIdAndDelete(messageId);

      if (message.attachments?.length) {
        for (const attachment of message.attachments) {
          const stillExists = await Message.exists({
            "attachments.public_id": attachment.public_id,
          });
          if (!stillExists) {
            try {
              await cloudinary.uploader.destroy(attachment.public_id, {
                resource_type: attachment.resource_type,
                type: attachment.cloudinary_type,
              });
            } catch (e) {
              console.error(
                "Cloudinary delete failed:",
                e?.message
              );
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

// -----------------------------
// UPDATE MESSAGES SEEN STATUS
// -----------------------------
const updateMessagesSeenStatus = async ({ conversationId, userId }) => {
  try {
    const cid = String(conversationId);
    const uid = String(userId);

    await Message.updateMany(
      { conversationId: cid, seenBy: { $ne: uid } },
      { $addToSet: { seenBy: uid } }
    );

    const conv = await Conversation.findById(cid).select("lastMessage");
    if (conv && conv.lastMessage) {
      await Conversation.findByIdAndUpdate(
        cid,
        {
          $addToSet: { "lastMessage.seenBy": uid },
          $set: { "lastMessage.updatedAt": new Date() },
        },
        { new: true }
      );
    }

    io.to(cid).emit("messagesSeen", {
      conversationId: cid,
      userId: uid,
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
