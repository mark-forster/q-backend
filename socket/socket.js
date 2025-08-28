const { Server } = require("socket.io");
const http = require("http");
const express = require("express");
const app = express();
const server = http.createServer(app);

const Conversation = require('../models/conversation.model');
const Message = require('../models/message.model');

// Map to store userId and socketId pairs
const userSocketMap = new Map();

// Setting up the socket server
const io = new Server(server, {
  cors: {
    origin: [
      process.env.RENDER_HOST,
      process.env.DOMAINHOST, // Frontend origin(s)
    ],
    methods: ["GET", "POST","PUT","DELETE"],
    credentials: true
  },
});

// Getting the recipient's socketId
const getRecipientSocketId = (recipientId) => {
  return userSocketMap.get(String(recipientId));
};

// Logic to be executed when a client connects
io.on("connection", async (socket) => {
  const { userId } = socket.handshake.query || {};
  if (!userId) return;

  // Adding the new user to the userSocketMap
  userSocketMap.set(userId, socket.id);

  // Emitting the list of online users to clients
  io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));

  // Joining the user to all their conversation rooms
  try {
    const userConversations = await Conversation.find({
      participants: userId
    }).select("_id");

    userConversations.forEach(({ _id }) => {
      socket.join(_id.toString());
    });
  } catch (err) {
    console.error("Error joining conversation rooms:", err);
  }

  // 💡 Change: The sendMessage listener has been commented out.
  // This logic has already been built in the API endpoint (message.controller.js).
  // The socket's job is only to notify after a message is saved to the DB.
  /*
  socket.on("sendMessage", async (data) => {
    // after saving message to DB
    const { conversationId, message } = data;

    // emit to all sockets in conversation room
    io.to(conversationId).emit("newMessage", message);

    // update lastMessage on conversation if needed
    io.to(conversationId).emit("lastMessageUpdate", {
      conversationId,
      lastMessage: message,
    });
  });
  */

  // 💡 Change: Added a note for clients to listen for the messageDeleted event.
  // However, this type of listener is not needed on the server-side.
  // The logic for deleting a message is already in message.controller.js.
  // socket.on("messageDeleted", ...);

  // When a client disconnects
  socket.on("disconnect", () => {
    // Removing the user from userSocketMap
    userSocketMap.delete(userId);
    // Emitting the new list of online users to clients
    io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));
  });
});

// Exporting app, server, and io for use by other modules
module.exports = { app, server, io, getRecipientSocketId, userSocketMap };
