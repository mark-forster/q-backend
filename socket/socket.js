// socket.js

const { Server } = require("socket.io");
const http = require("http");
const express = require("express");
const app = express();
const server = http.createServer(app);

const Conversation = require("../models/conversation.model");
const Message = require("../models/message.model");

// Map to store userId and socketId pairs
const userSocketMap = new Map();

// Setting up the socket server
const io = new Server(server, {
  cors: {
    origin: [
      process.env.RENDER_HOST,
      process.env.DOMAINHOST, // Frontend origin(s)
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
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

  socket.join(userId);

  userSocketMap.set(userId, socket.id);
  io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));

  try {
    const userConversations = await Conversation.find({
      participants: userId,
    }).select("_id");

    userConversations.forEach(({ _id }) => {
      socket.join(_id.toString());
    });
  } catch (err) {
    console.error("Error joining conversation rooms:", err);
  }

  // 💡 အသစ်ထပ်ထည့်ရန်: Frontend က ပို့လိုက်တဲ့ "joinConversationRoom" event ကို နားထောင်ပါ
  socket.on("joinConversationRoom", ({ conversationId }) => {
    socket.join(conversationId);
    console.log(`User ${userId} joined conversation room: ${conversationId}`);
  }); // When a client disconnects

  socket.on("disconnect", () => {
    // Removing the user from userSocketMap
    userSocketMap.delete(userId);
    // Emitting the new list of online users to clients
    io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));
  });
});

module.exports = { app, server, io, getRecipientSocketId, userSocketMap };
