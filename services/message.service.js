// services/message.service.js
const Message = require("../models/message.model");
const Conversation = require("../models/conversation.model");
const { emitToUser, emitToRoom } = require("../socket/socketEmitter");
const cloudinary = require("cloudinary").v2;
const fs = require("fs");
const { getOnlineUserIds } = require("../socket/socketState");
const { isUserReadingConversation } = require("../socket/socketState");
const GroupReadState = require("../models/groupReadState.model");

// Helper Fuctions

function buildConversationPreview(conversation) {
  return {
    _id: conversation._id,
    isGroup: conversation.isGroup,
    name: conversation.name || null,
    lastMessage: conversation.lastMessage,
    updatedAt: conversation.lastMessage?.updatedAt || new Date(),
  };
}

// -----------------------------
// Group Chat
// -----------------------------
const createGroupChat = async ({ name, participants, creatorId }) => {
  try {
    const uniqueParticipants = [
      ...new Set([...participants.map(String), String(creatorId)]),
    ];
    const conversation = new Conversation({
      isGroup: true,
      name,
      participants: uniqueParticipants,
      admins: [creatorId], // creator is admin
    });
    conversation.deletedBy = [];
    await conversation.save();
    // REAL-TIME EVENT EMIT
    const convObj = (
      await conversation.populate("participants", "username name profilePic")
    ).toObject();

    uniqueParticipants.forEach((uid) => {
      emitToUser(uid, "conversationCreated", convObj);
    });

    return convObj;
  } catch (error) {
    console.error("Group Chat Creation Error:", error);
    return null;
  }
};

const findConversation = async (userId, otherUserId) => {
  try {
    const conversation = await Conversation.findOne({
      isGroup: false,
      participants: { $all: [userId, otherUserId], $size: 2 },
    }).populate("participants", "username profilePic name updatedAt");
    return conversation;
  } catch (error) {
    console.error("findConversation error:", error);
    return null;
  }
};

// -----------------------------
// Upload Attachments
// -----------------------------
async function uploadAttachments(files = []) {
  if (!files || !files.length) return [];

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
      signedUrl: null,
    };
  });

  return Promise.all(uploads);
}
//----------------------------
// Helper for Group Action
//------------------------
async function buildFullConversation(conversationId) {
  const conv = await Conversation.findById(conversationId)
    .populate("participants", "username name profilePic updatedAt")
    .populate("admins", "username name profilePic");
  return conv ? conv.toObject() : null;
}

//  build lastMessage text
function resolveLastMessageText(
  messageText,
  attachments = [],
  messageType = "text",
  callInfo = null
) {
  if (messageType === "call") {
    if (!callInfo) return "Call";
    if (callInfo.status === "missed") return `Missed ${callInfo.callType} call`;
    if (callInfo.status === "declined")
      return `Declined ${callInfo.callType} call`;
    if (callInfo.status === "completed") return "Call ended";
    if (callInfo.status === "timeout") return "Call timeout";
    return `${callInfo.callType} call`;
  }

  if (messageText && messageText.trim()) return messageText.trim();
  if (!attachments.length) return "";

  const t = attachments.at(-1)?.type;
  if (t === "image") return "Image";
  if (t === "gif") return "GIF";
  if (t === "video") return "Video";
  if (t === "audio") return "Audio";
  return "File";
}

async function updateGroupReadPointer({ conversationId, userId }) {
  const conv = await Conversation.findById(conversationId).select("isGroup");
  if (!conv || !conv.isGroup) return null;

  // find latest message not deleted
  const lastMsg = await Message.findOne({
    conversationId,
    deletedForAll: { $ne: true },
    deletedFor: { $ne: userId },
  })
    .sort({ createdAt: -1 })
    .select("_id createdAt")
    .lean();

  if (!lastMsg) return null;

  await GroupReadState.updateOne(
    { conversationId, userId },
    {
      $set: {
        lastReadMessageId: lastMsg._id,
        lastReadAt: new Date(),
      },
    },
    { upsert: true }
  );

  return { lastReadMessageId: lastMsg._id };
}




// ======================================================
//        SEND MESSAGE
// ======================================================
const sendMessage = async ({
  recipientId,
  conversationId,
  message,
  senderId,
  files,
  replyTo,
}) => {
  try {
    const sender = String(senderId);
    let receiver = recipientId ? String(recipientId) : null;
    let conversation = null;
    let isNewConversation = false;

    // --------------------------------------------------
    // Find conversation
    // --------------------------------------------------
    if (conversationId) {
      conversation = await Conversation.findById(conversationId).populate(
        "participants",
        "username profilePic name updatedAt"
      );
    }

    if (!conversation) {
      if (!receiver) throw new Error("recipientId required");

      conversation = await Conversation.findOne({
        isGroup: false,
        participants: { $all: [sender, receiver], $size: 2 },
      }).populate("participants", "username profilePic name updatedAt");

      if (!conversation) {
        conversation = await Conversation.create({
          isGroup: false,
          participants: [sender, receiver],
        });
        conversation = await conversation.populate(
          "participants",
          "username profilePic name updatedAt"
        );
        isNewConversation = true;
      }
    }

    const isGroup = !!conversation.isGroup;

    // --------------------------------------------------
    //  Fix receiver
    // --------------------------------------------------
    if (!isGroup) {
      const friend = conversation.participants.find(
        (p) => p._id.toString() !== sender
      );
      receiver = friend?._id?.toString();
    }

    // --------------------------------------------------
    //   RESTORE
    // --------------------------------------------------
    if (!isGroup && receiver && conversation.deletedBy?.includes(receiver)) {
      conversation.deletedBy = conversation.deletedBy.filter(
        (id) => id.toString() !== receiver
      );
      await conversation.save();
      emitToUser(receiver, "conversationRestored", conversation.toObject());
    }

    if (conversation.deletedBy?.includes(sender)) {
      conversation.deletedBy = conversation.deletedBy.filter(
        (id) => id.toString() !== sender
      );
      await conversation.save();
    }

    // --------------------------------------------------
    //  Upload attachments
    // --------------------------------------------------
    const attachments = await uploadAttachments(files);

    // --------------------------------------------------
    //  Create message
    // --------------------------------------------------


const receiverIsReading =
  !isGroup &&
  receiver &&
  isUserReadingConversation(conversation._id, receiver);

let status = isGroup ? undefined : "sent";
let readAt = null;

if (receiverIsReading) {
  status = "read";
  readAt = new Date();
}
    const newMessage = await Message.create({
      conversationId: conversation._id,
      sender,
      receiver,
      text: message || "",
      attachments,
      messageType: "text",
      replyTo: replyTo || null,
      status:status,
      readAt
    });
    await newMessage.populate([
      { path: "sender", select: "name username profilePic" },
      {
        path: "replyTo",
        populate: {
          path: "sender",
          select: "name username profilePic",
        },
      },
    ]);

    // --------------------------------------------------
    //  Update conversation.lastMessage
    // --------------------------------------------------
    const lastText = resolveLastMessageText(message, attachments, "text", null);

    conversation.lastMessage = {
      _id: newMessage._id,
      text: lastText,
      sender,
updatedAt: newMessage.createdAt,
        status: isGroup ? undefined : status,
      callInfo: null,
    };

    await conversation.save();

// --------------------------------------------------
// conversationUpdated 
// --------------------------------------------------
const payload = conversation.isGroup
  ? await buildFullConversation(conversation._id)
  : buildConversationPreview(conversation);

conversation.participants.forEach((uid) => {
  const id = uid._id?.toString?.() || uid.toString();
  emitToUser(id, "conversationUpdated", payload);
});


    // --------------------------------------------------
    // Emit newMessage
    // --------------------------------------------------
    if (!isGroup && receiverIsReading) {
  emitToRoom(conversation._id.toString(), "messagesSeen", {
    conversationId: conversation._id,
    userId: receiver,
  });
}

    if (isGroup) {
      conversation.participants.forEach((uid) => {
        const id = uid._id?.toString?.() || uid.toString();
        if (id !== String(sender)) {
          emitToUser(id, "newMessage", newMessage);
        }
      });
    } else {
      emitToUser(receiver, "newMessage", newMessage);

      if (isNewConversation) {
        const obj = conversation.toObject();
        emitToUser(receiver, "conversationCreated", obj);
        emitToUser(sender, "conversationCreated", obj);
      }
    }

    return newMessage;
  } catch (err) {
    console.error("Send Message Error:", err);

    // cleanup temp files
    files?.forEach((f) => {
      try {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      } catch {}
    });

    throw err;
  }
};

// -----------------------------
// GET MESSAGES (with pagination + signed URLs)
// -----------------------------
const getMessages = async ({
  conversationId,
  userId,
  skip = 0,
  limit = 50,
}) => {
  try {
    const numericSkip = Number(skip) || 0;
    const numericLimit = Number(limit) || 50;
    const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
      const conv = await Conversation.findById(conversationId).select("isGroup");
   if (!conv?.isGroup) {
    await updateMessagesSeenStatus({ conversationId, userId });
  }
 if (conv?.isGroup) {
    const lastMsg = await updateGroupReadPointer({
      conversationId,
      userId,
    });

    if (lastMsg) {
      emitToRoom(String(conversationId), "groupReadUpdated", {
        conversationId: String(conversationId),
        userId: String(userId),
        lastReadAt: new Date(),
      });
    }
  }
    const messages = await Message.find({
      conversationId,
  deletedFor: { $ne: userId },  deletedForAll: { $ne: true },

    })
      .sort({ createdAt: -1 })
      .skip(numericSkip)
      .limit(numericLimit)
      .populate("sender", "name username profilePic")
      .populate("replyTo");
    // Attach signed URLs for private attachments
    for (const msg of messages) {
      if (!msg.attachments || !msg.attachments.length) continue;

      msg.attachments.forEach((att) => {
        if (
          att &&
          att.public_id &&
          att.cloudinary_type === "authenticated" &&
          !att.signedUrl
        ) {
          try {
            if (att.resource_type === "raw") {
              att.signedUrl = cloudinary.utils.private_download_url(
                att.public_id,
                att.format || "bin",
                {
                  resource_type: "raw",
                  type: "authenticated",
                  secure: true,
                  sign_url: true,
                  expires_at: expiresAt,
                }
              );
            } else {
              att.signedUrl = cloudinary.url(att.public_id, {
                resource_type: att.resource_type || "video",
                type: "authenticated",
                secure: true,
                sign_url: true,
                expires_at: expiresAt,
                format: att.format || undefined,
              });
            }
          } catch (e) {
            console.error("Signed URL build failed:", e?.message);
          }
        }
      });
    }

    return messages;
  } catch (error) {
    console.error("Get Messages Error:", error);
    throw error;
  }
};

// -----------------------------
// Search messages in a conversation
// -----------------------------
const searchMessages = async ({ conversationId, userId, text }) => {
  try {
    if (!text || !text.trim()) return [];

    const messages = await Message.find({
      conversationId,
       deletedForAll: { $ne: true },
  deletedFor: { $ne: userId },
      text: { $regex: text, $options: "i" },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("replyTo");

    return messages;
  } catch (error) {
    console.error("Search Messages Error:", error);
    throw error;
  }
};

// -----------------------------
// GET CONVERSATIONS
// -----------------------------
const getConversations = async (userId) => {
  try {
    const conversations = await Conversation.find({
      participants: userId,
      deletedBy: { $ne: userId },
    }).populate("participants", "username profilePic name updatedAt");

    const onlineSet = new Set(getOnlineUserIds().map(String));

    const withUnread = await Promise.all(
      conversations.map(async (conv) => {
       const unreadCount = await Message.countDocuments({
  conversationId: conv._id,
  deletedForAll: { $ne: true },
  deletedFor: { $ne: userId },
  sender: { $ne: userId },
  status: { $ne: "read" }, 
});


        const doc = conv.toObject();

        // decorate participants with online flag
        let participants = (doc.participants || []).map((p) => ({
          ...p,
          online: onlineSet.has(String(p._id)),
        }));

        if (!doc.isGroup) {
          participants = participants.filter(
            (p) => String(p._id) !== String(userId)
          );
        }
        doc.participants = participants;
        doc.unreadCount = unreadCount;
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
// Group  (with admin checks)
// -----------------------------
const renameGroup = async ({ conversationId, name, currentUserId }) => {
  try {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.isGroup) return null;
    // Admin Check 
    if (
      conversation.admins.length &&
      !conversation.admins
        .map((id) => id.toString())
        .includes(String(currentUserId))
    ) {
      throw new Error("Not allowed to rename group");
    }

    conversation.name = name;
    await conversation.save();
    const full = await buildFullConversation(conversationId);
    conversation.participants.forEach((uid) => {
      emitToUser(uid.toString(), "conversationUpdated", full);
    });

    return full;
  } catch (error) {
    console.error("Rename Group Error:", error);
    return null;
  }
};

const addToGroup = async ({ conversationId, userId, currentUserId }) => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation || !conversation.isGroup) return null;

  // admin check...
  // if (
  //   conversation.admins.length &&
  //   !conversation.admins.map(String).includes(String(currentUserId))
  // ) {
  //   throw new Error("Not allowed to add member");
  // }

  const uid = String(userId);

  if (!conversation.participants.map(String).includes(uid)) {
    conversation.participants.push(uid);
    await conversation.save();
  }

  const full = await buildFullConversation(conversationId);

  // existing members update
  conversation.participants.forEach((pid) => {
    emitToUser(pid.toString(), "conversationUpdated", full);
  });

  // new member should see it as new conversation 
  emitToUser(uid, "conversationCreated", full);

  return full;
};


const removeFromGroup = async ({ conversationId, userId, currentUserId }) => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation || !conversation.isGroup) return null;

  // admin check...
  if (
    conversation.admins.length &&
    !conversation.admins.map(String).includes(String(currentUserId))
  ) {
    throw new Error("Not allowed to remove member");
  }

  const removedId = String(userId);

  conversation.participants = conversation.participants.filter(
    (id) => String(id) !== removedId
  );
  await conversation.save();

  const full = await buildFullConversation(conversationId);

  emitToUser(removedId, "removedFromGroup", {
    conversationId: String(conversationId),
  });

  // remaining members update
  conversation.participants.forEach((pid) => {
    emitToUser(pid.toString(), "conversationUpdated", full);
  });

  return full;
};


const leaveGroup = async ({ conversationId, userId }) => {
  try {
    const uid = String(userId);

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.isGroup) {
      throw new Error("Group not found");
    }
    if (!conversation.participants.map(String).includes(uid)) {
      throw new Error("You are not a participant of this group");
    }

    // remove from participants
    conversation.participants = conversation.participants.filter(
      (id) => id.toString() !== uid
    );

    //  remove from admins if admin
    if (conversation.admins?.length) {
      conversation.admins = conversation.admins.filter(
        (id) => id.toString() !== uid
      );
    }

    if (
      conversation.admins.length === 0 &&
      conversation.participants.length > 0
    ) {
      conversation.admins = [conversation.participants[0]];
    }

    await conversation.save();

    const convObj = conversation.toObject();

  const full = await buildFullConversation(conversationId);

conversation.participants.forEach((pid) => {
  emitToUser(pid.toString(), "conversationUpdated", full);
});

emitToUser(uid, "leftGroup", {
  conversationId: String(conversationId),
});
    return convObj;
  } catch (error) {
    console.error("Leave Group Error:", error);
    throw error;
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

await Message.findByIdAndUpdate(messageId, {
  deletedForAll: true,
});
    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
      // re-compute lastMessage
      const lastMessage = await Message.findOne({
       conversationId,
  deletedForAll: { $ne: true },
  deletedFor: { $ne: currentUserId },
      })
        .sort({ createdAt: -1 })
        .lean();

      if (lastMessage) {
        conversation.lastMessage = {
          _id: lastMessage._id,
          text: resolveLastMessageText(
            lastMessage.text,
            lastMessage.attachments || [],
            lastMessage.messageType,
            lastMessage.callInfo
          ),
          sender: lastMessage.sender,
              status: conversation.isGroup ? undefined : lastMessage.status,
          updatedAt: lastMessage.updatedAt,
          callInfo: lastMessage.callInfo || null,
        };
      } else {
        conversation.lastMessage = undefined;
      }
      await conversation.save();
      const preview = buildConversationPreview(conversation);
      conversation.participants.forEach((uid) => {
        emitToUser(uid.toString(), "conversationUpdated", preview);
      });
      // notify all participants in this conversation room
      emitToRoom(conversationId, "messageDeleted", {
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
      { $addToSet: { deletedFor: currentUserId } }
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
                console.error("Cloudinary delete failed:", e?.message);
              }
            }
          }
        }
      }

      await Message.deleteMany({ conversationId });
      await Conversation.findByIdAndDelete(conversationId);

      emitToRoom(conversationId, "conversationPermanentlyDeleted", {
        conversationId: String(conversationId),
      });

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
    const message = await Message.findById(messageId).populate(
      "sender",
      "name username profilePic"
    );

    if (!message) throw new Error("Message not found.");

    const senderId =
      typeof message.sender === "object"
        ? String(message.sender._id)
        : String(message.sender);

    if (senderId !== String(currentUserId)) {
      throw new Error("You are not authorized to update this message.");
    }

    const text = (newText ?? "").toString();

    message.text = text;
    await message.save();

    // update conversation.lastMessage if this is latest message
    const conversationId = message.conversationId;
    const latest = await Message.findOne({ conversationId }).sort({
      createdAt: -1,
    });

    if (latest && String(latest._id) === String(messageId)) {
      await Conversation.findByIdAndUpdate(conversationId, {
        $set: {
          lastMessage: {
            _id: latest._id,
            text: resolveLastMessageText(
              latest.text,
              latest.attachments || [],
              latest.messageType,
              latest.callInfo
            ),
            sender: latest.sender,
            updatedAt: new Date(),
            callInfo: latest.callInfo || null,
          },
        },
      });
    }

    // send socket event for that conversation room
    emitToRoom(conversationId, "messageUpdated", {
      conversationId: String(conversationId),
      messageId: String(messageId),
      newText: message.text,
      sender: message.sender,
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
const forwardMessage = async ({ currentUserId, messageId, recipientIds }) => {
  try {
    const originalMessage = await Message.findById(messageId).populate(
      "sender",
      "name username"
    );

    if (!originalMessage) throw new Error("Original message not found");

    const senderId = String(currentUserId);
    const forwarded = [];

    for (const rid of recipientIds) {
      const targetId = String(rid);

      // =========================
      // CHECK GROUP
      // =========================
      const group = await Conversation.findById(targetId);

      if (group && group.isGroup) {
        // ---------- GROUP FORWARD ----------
        // auto restore group if deleted
        if (group.deletedBy?.includes(senderId)) {
          group.deletedBy = group.deletedBy.filter(
            (id) => id.toString() !== senderId
          );
          await group.save();
          emitToUser(senderId, "conversationRestored", group.toObject());
        }

        const newMsg = await Message.create({
          sender: senderId,
          conversationId: group._id,
          text: originalMessage.text,
          attachments: originalMessage.attachments || [],

          isForwarded: true,
          forwardedFrom: {
            user: originalMessage.sender?._id,
            name: originalMessage.sender?.name,
            username: originalMessage.sender?.username,
            fromGroup: true,
          },

          messageType: originalMessage.messageType,
          callInfo: originalMessage.callInfo,
          replyTo: originalMessage.replyTo || null,
         status:  undefined 

        });

        await newMsg.populate([
          { path: "sender", select: "name username profilePic" },
          {
            path: "replyTo",
            populate: {
              path: "sender",
              select: "name username profilePic",
            },
          },
        ]);

        group.lastMessage = {
          _id: newMsg._id,
          text: resolveLastMessageText(
            newMsg.text,
            newMsg.attachments,
            newMsg.messageType,
            newMsg.callInfo
          ),
          sender: senderId,
          updatedAt: new Date(),
          callInfo: newMsg.callInfo || null,
        };

        await group.save();

        // notify all group members
        group.participants.forEach((uid) => {
          emitToUser(uid.toString(), "newMessage", newMsg);
          emitToUser(
            uid.toString(),
            "conversationUpdated",
            buildConversationPreview(group)
          );
        });

        forwarded.push(newMsg);
        continue;
      }

      // =========================
      // FORWARD
      // =========================
      const recipientId = targetId;

      let conversation = await Conversation.findOne({
        isGroup: false,
        participants: { $all: [senderId, recipientId], $size: 2 },
      });

      const isNew = !conversation;

      if (!conversation) {
        conversation = await Conversation.create({
          isGroup: false,
          participants: [senderId, recipientId],
        });
      }

      // auto restore DM
      if (conversation.deletedBy?.includes(recipientId)) {
        conversation.deletedBy = conversation.deletedBy.filter(
          (id) => id.toString() !== recipientId
        );
        await conversation.save();
        emitToUser(
          recipientId,
          "conversationRestored",
          conversation.toObject()
        );
      }

      const newMsg = await Message.create({
        sender: senderId,
        receiver: recipientId,
        conversationId: conversation._id,
        text: originalMessage.text,
        attachments: originalMessage.attachments || [],

        isForwarded: true,
        forwardedFrom: {
          user: originalMessage.sender?._id,
          name: originalMessage.sender?.name,
          username: originalMessage.sender?.username,
          fromGroup: false,
        },

        messageType: originalMessage.messageType,
        callInfo: originalMessage.callInfo,
        replyTo: originalMessage.replyTo || null,
        status: "sent",
      });

      await newMsg.populate([
        { path: "sender", select: "name username profilePic" },
        {
          path: "replyTo",
          populate: {
            path: "sender",
            select: "name username profilePic",
          },
        },
      ]);

      conversation.lastMessage = {
        _id: newMsg._id,
        text: resolveLastMessageText(
          newMsg.text,
          newMsg.attachments,
          newMsg.messageType,
          newMsg.callInfo
        ),
        sender: senderId,
          status: conversation.isGroup ? undefined : newMsg.status,
        updatedAt: new Date(),
        callInfo: newMsg.callInfo || null,
      };

      await conversation.save();

      if (isNew) {
        emitToUser(recipientId, "conversationCreated", conversation.toObject());
        emitToUser(senderId, "conversationCreated", conversation.toObject());
      }

      emitToUser(recipientId, "newMessage", newMsg);
      emitToUser(senderId, "newMessage", newMsg);
      emitToUser(
        recipientId,
        "conversationUpdated",
        buildConversationPreview(conversation)
      );
      emitToUser(
        senderId,
        "conversationUpdated",
        buildConversationPreview(conversation)
      );

      forwarded.push(newMsg);
    }

    return forwarded;
  } catch (err) {
    console.error("Forward message error:", err);
    throw err;
  }
};

// -----------------------------
// DELETE MESSAGE FOR ME
// -----------------------------
const deleteMessageForMe = async ({ messageId, currentUserId }) => {
  try {
    const message = await Message.findByIdAndUpdate(
      messageId,
{ $addToSet: { deletedFor: currentUserId } },
      { new: true }
    );
    if (!message) throw new Error("Message not found or update failed.");

    const conversation = await Conversation.findById(message.conversationId);
    if (!conversation) {
      return { messageId, permanentlyDeleted: false };
    }

    const totalParticipants = conversation.participants.length;
    const deletedByCount = message.deletedFor.length;

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

// -----------------------------
// UPDATE MESSAGES SEEN STATUS
// -----------------------------
const updateMessagesSeenStatus = async ({ conversationId, userId }) => {
  try {
    const cid = String(conversationId);
    const uid = String(userId);

    const conv = await Conversation.findById(cid).select("isGroup");
    if (!conv || conv.isGroup) return;

    // mark unread messages as read (only sender ≠ me)
    await Message.updateMany(
      {
        conversationId: cid,
        sender: { $ne: uid },
        status: { $ne: "read" },
      },
      {
        status: "read",
        readAt: new Date(),
      }
    );

    //  find LAST MESSAGE SENT BY OTHER USER
    const lastFromOther = await Message.findOne({
      conversationId: cid,
      sender: { $ne: uid },
      deletedForAll: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .lean();

    //  update conversation.lastMessage ONLY if needed
    if (lastFromOther) {
      await Conversation.findByIdAndUpdate(cid, {
        $set: {
          "lastMessage.status": "read",
          "lastMessage.readAt": lastFromOther.readAt || new Date(),
        },
      });
    }

    emitToRoom(cid, "messagesSeen", {
      conversationId: cid,
      userId: uid,
    });

    return { ok: true };
  } catch (err) {
    console.error("Update Messages Seen Status Error:", err);
    throw err;
  }
};


// -----------------------------
// MESSAGE REACTIONS
// -----------------------------

const reactToMessage = async ({ messageId, userId, emoji }) => {
  const message = await Message.findById(messageId);
  if (!message) throw new Error("Message not found");

  const uid = String(userId);
  let reactions = message.reactions || [];

  const index = reactions.findIndex((r) => r.user.toString() === uid);

  if (!emoji || !emoji.trim()) {
    if (index !== -1) reactions.splice(index, 1);
  } else if (index === -1) {
    reactions.push({ user: uid, emoji });
  } else {
    reactions[index].emoji = emoji;
  }

  message.reactions = reactions;
  await message.save();
  const conv = await Conversation.findById(message.conversationId);
  if (conv) {
    conv.participants.forEach((uid) => {
      emitToUser(uid.toString(), "messageReactionUpdated", {
        conversationId: String(message.conversationId),
        messageId: String(message._id),
        reactions: message.reactions,
      });
    });
  }

  return message;
};

// -----------------------------
// PIN / UNPIN MESSAGES
// -----------------------------
const pinMessage = async ({ conversationId, messageId, userId }) => {
  try {
    const conv = await Conversation.findById(conversationId);
    if (!conv) throw new Error("Conversation not found");

    conv.pinnedMessages = conv.pinnedMessages || [];
    const already = conv.pinnedMessages.find(
      (p) => p.messageId.toString() === String(messageId)
    );
    if (!already) {
      conv.pinnedMessages.push({
        messageId,
        pinnedBy: userId,
        pinnedAt: new Date(),
      });
      await conv.save();
    }

    emitToRoom(conversationId, "messagePinned", {
      conversationId: String(conversationId),
      messageId: String(messageId),
    });

    return conv;
  } catch (error) {
    console.error("pinMessage Error:", error);
    throw error;
  }
};

const unpinMessage = async ({ conversationId, messageId }) => {
  try {
    const conv = await Conversation.findById(conversationId);
    if (!conv) throw new Error("Conversation not found");

    conv.pinnedMessages =
      conv.pinnedMessages?.filter(
        (p) => p.messageId.toString() !== String(messageId)
      ) || [];
    await conv.save();
    emitToRoom(conversationId, "messageUnpinned", {
      conversationId: String(conversationId),
      messageId: String(messageId),
    });

    return conv;
  } catch (error) {
    console.error("unpinMessage Error:", error);
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
  leaveGroup,
  deleteMessage,
  deleteConversation,
  updateMessage,
  forwardMessage,
  deleteMessageForMe,
  updateMessagesSeenStatus,
  pinMessage,
  unpinMessage,
  searchMessages,
  reactToMessage,
};
