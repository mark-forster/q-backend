const express = require("express");
const router = express.Router();
const messageController = require("../../controllers/message.controller");
const isAuth = require("../../middlewares/isAuth");
const upload=require('../../util/multer')
//goto message page
router.post("/conversations/start", isAuth, messageController.startConversation);
// Send message (to group or one-to-one)
router.post("/", isAuth, upload.array('files'), messageController.sendMessage);
// router.post("/upload-signature", isAuth, messageController.getUploadSignature);

//Cloudinary download url check auth
router.get("/get-signed-url/:publicId", isAuth,messageController.getSignedUrl);

// Get messages from a conversation (group or one-to-one)
router.get(
  "/conversation/:conversationId",
  isAuth,
  messageController.getMessages
);

//Get conversation
router.get("/conve/:id", isAuth,messageController.startConversation);

// Get all conversations for current user
router.get("/conversations", isAuth, messageController.getConversations);

//  Group routes
router.post("/group/create", isAuth, messageController.createGroupChat);
router.put("/group/rename", isAuth, messageController.renameGroup);
router.put("/group/add", isAuth, messageController.addToGroup);
router.put("/group/remove", isAuth, messageController.removeFromGroup);
//
router.put("/update/:messageId", isAuth, messageController.updateMessage);
// Message delete route 
router.delete("/message/:messageId", isAuth, messageController.deleteMessage);
router.delete("/message/for-me/:messageId", isAuth, messageController.deleteMessageForMe);
// message seen
router.put("/seen/:conversationId", isAuth, messageController.updateMessagesSeenStatus);

// Conversation delete route
router.delete(
  "/conversation/:conversationId",
  isAuth,
  messageController.deleteConversation
);

// Forward Message Route
router.post("/message/forward/:messageId", isAuth, messageController.forwardMessage)

module.exports = router;
