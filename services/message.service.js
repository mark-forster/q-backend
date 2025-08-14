const Message = require("../models/message.model");
const Conversation = require("../models/conversation.model");
const { getRecipientSocketId, io } = require("../socket/socket");
const cloudinary = require("cloudinary").v2;
const fs = require("fs");
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
    }).populate("participants", "username profilePic");

    return conversation;
  } catch (error) {
    console.error("findConversation error:", error);
    return null;
  }
};

const sendMessage = async ({ recipientId, conversationId, message, senderId, img }) => {
    try {
        let conversation;
        let imageInfo = null;

        if (conversationId && conversationId.startsWith('mock-')) {
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
        }

        // 3. Upload image if provided
        let uploadedFile = null;
        if (img) {
            uploadedFile = img.path;

            const uploadedResponse = await cloudinary.uploader.upload(img.path, {
                resource_type: "auto",
            });

            fs.unlinkSync(img.path);

            imageInfo = {
                public_id: uploadedResponse.public_id,
                url: uploadedResponse.secure_url,
            };
        }

        // 4. Create new message
        const newMessage = await Message.create({
            conversationId: conversation._id,
            sender: senderId,
            text: message || "",
            img: imageInfo || null,
            seenBy: [senderId],
        });

        // 5. Update conversation's last message
        conversation.lastMessage = {
            text: message || (imageInfo ? "[Image]" : ""),
            sender: senderId,
            seenBy: [senderId],
        };
        await conversation.save();

        // 6. Emit socket event to recipient(s)
        conversation.participants.forEach((pid) => {
            const socketId = getRecipientSocketId(pid.toString());
            if (socketId) {
                io.to(socketId).emit("newMessage", newMessage);
            }
        });

        return newMessage;
    } catch (err) {
        // ... (existing error handling code)
        console.error("Send Message Error:", err.message || err);
        fs.unlink(img.path);
        return null;
    }
};


const getMessages = async ({ conversationId }) => {
  const messages = await Message.find({ conversationId }).sort({
    createdAt: 1,
  });
  return messages;
};

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
      (id) => id.toString() !== userId
    );
    await conversation.save();

    return conversation;
  } catch (error) {
    console.error("Remove from Group Error:", error);
    return null;
  }
};

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
    const conversation = await Conversation.findById(conversationId);
    if (conversation && conversation.lastMessage.text && conversation.lastMessage.sender) {
        if (conversation.lastMessage.sender.toString() === message.sender.toString() && conversation.lastMessage.text === message.text) {
            const lastMessage = await Message.findOne({ conversationId }).sort({ createdAt: -1 });
            conversation.lastMessage = lastMessage ? {
                text: lastMessage.text,
                sender: lastMessage.sender,
                seenBy: lastMessage.seenBy
            } : {};
            await conversation.save();
        }
    }
    
    // Conversation  participants 
    const updatedConversation = await Conversation.findById(conversationId);
    const participants = updatedConversation ? updatedConversation.participants : [];
    
    return { deletedMessageId, conversationId, participants };

  } catch (error) {
    console.error("Delete Message Error:", error);
    return null;
  }
};


const deleteConversation = async ({ conversationId, currentUserId }) => {
  try {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return null;

    // conversation  participants 
    const participants = conversation.participants;

    // Check permessiong to delete conversation 
    if (!conversation.participants.some(p => p.toString() === currentUserId.toString())) {
      throw new Error("You are not authorized to delete this conversation.");
    }
    
    // Conversation  messages delete
    await Message.deleteMany({ conversationId });
    
    // Conversation delete
    await Conversation.findByIdAndDelete(conversationId);
    
    return { deletedConversationId: conversation._id, participants };

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
