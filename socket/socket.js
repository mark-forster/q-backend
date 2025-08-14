const { Server } = require("socket.io");
const http = require("http");
const express = require("express");
const app = express();
const server = http.createServer(app);

const Conversation = require('../models/conversation.model');
const Message = require('../models/message.model');

// map of userId => socketId
const userSocketMap = new Map();

const io = new Server(server, {
 cors: {
origin: [
process.env.RENDER_HOST,
  process.env.DOMAINHOST, //  frontend origin(s)
],
 methods: ["GET", "POST","PUT","DELETE"],
 credentials: true
 },// path: "/socket.io" // default
});

const getRecipientSocketId = (recipientId) => {  return userSocketMap.get(String(recipientId));
};

io.on("connection", async (socket) => {
const { userId } = socket.handshake.query || {};
 if (!userId) return;

// insert new user to userSocketMap
userSocketMap.set(userId, socket.id);

// user  connect and send  online users list  clients
io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));

// join user to all their conversation rooms
try {
 const userConversations = await Conversation.find({
 participants: userId
 }).select("_id");

 userConversations.forEach(({ _id }) => {
socket.join(_id.toString());
});
} catch (err) {
 console.error("Error joining conversation rooms:", err);  }

 // handle new message event if you want (or elsewhere in your API)
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

socket.on("disconnect", () => {
 // user disconnect  delete form array map
 userSocketMap.delete(userId);
 // online users list to  clients 
 io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));
});
});

module.exports = { app, server, io, getRecipientSocketId, userSocketMap };
