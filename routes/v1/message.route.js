const express = require("express");
const router = express.Router();
const messageController = require("../../controllers/message.controller");
const isAuth = require("../../middlewares/isAuth");
const upload=require('../../util/multer')
//goto message page
router.post("/conversations/start", isAuth, messageController.startConversation);
// Send message (to group or one-to-one)
router.post("/", isAuth, upload.single('image'), messageController.sendMessage);

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


// Message delete route 
router.get("/message/:messageId", isAuth, messageController.deleteMessage);

// Conversation delete route
router.delete(
  "/conversation/:conversationId",
  isAuth,
  messageController.deleteConversation
);



module.exports = router;
