// routes/message.route.js
const express = require("express");
const router = express.Router();
const messageController = require("../../controllers/message.controller");
const isAuth = require("../../middlewares/isAuth");
const upload = require("../../util/multer");

//goto message page / start conversation
router.post(
  "/conversations/start",
  isAuth,
  messageController.startConversation
);

// Send message (to group or one-to-one)
router.post(
  "/",
  isAuth,
  upload.array("files"),
  messageController.sendMessage
);

//Cloudinary download url check auth
router.get(
  "/get-signed-url/:publicId",
  isAuth,
  messageController.getSignedUrl
);

// Get messages from a conversation (group or one-to-one) + pagination
router.get(
  "/conversation/:conversationId",
  isAuth,
  messageController.getMessages
);

// Search messages in a conversation
router.get(
  "/conversation/:conversationId/search",
  isAuth,
  messageController.searchMessages
);

// Legacy route (if used) - still mapped to startConversation
router.get("/conve/:id", isAuth, messageController.startConversation);

// Get all conversations for current user
router.get("/conversations", isAuth, messageController.getConversations);

//  Group routes
router.post("/group/create", isAuth, messageController.createGroupChat);
router.put("/group/rename", isAuth, messageController.renameGroup);
router.put("/group/add", isAuth, messageController.addToGroup);
router.put("/group/remove", isAuth, messageController.removeFromGroup);

// Update message (edit text)
router.put("/update/:messageId", isAuth, messageController.updateMessage);

// Message delete route
router.delete("/message/:messageId", isAuth, messageController.deleteMessage);

// Message delete for me
router.delete(
  "/message/for-me/:messageId",
  isAuth,
  messageController.deleteMessageForMe
);

// message seen
router.put(
  "/seen/:conversationId",
  isAuth,
  messageController.updateMessagesSeenStatus
);

// Conversation delete route
router.delete(
  "/conversation/:conversationId",
  isAuth,
  messageController.deleteConversation
);

// Forward Message Route
router.post(
  "/message/forward/:messageId",
  isAuth,
  messageController.forwardMessage
);

// Message reactions
router.post(
  "/message/react/:messageId",
  isAuth,
  messageController.reactToMessage
);
router.delete(
  "/message/react/:messageId",
  isAuth,
  messageController.removeReaction
);

// Pin / Unpin message in conversation
router.post(
  "/conversation/:conversationId/pin/:messageId",
  isAuth,
  messageController.pinMessage
);
router.delete(
  "/conversation/:conversationId/pin/:messageId",
  isAuth,
  messageController.unpinMessage
);

module.exports = router;
