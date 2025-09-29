// socket/socket.js
const { Server } = require("socket.io");
const http = require("http");
const express = require("express");
const app = express();
const server = http.createServer(app);
const { config } = require("../config");
const Conversation = require("../models/conversation.model");

// userId <-> socketId
const userSocketMap = new Map();

const io = new Server(server, {
  cors: {
    origin: config.cors.prodOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  },
});

// helper
const getRecipientSocketId = (recipientId) => userSocketMap.get(String(recipientId));

io.on("connection", async (socket) => {
  const { userId } = socket.handshake.query || {};
  if (!userId) return;

  // personal room for direct emits if needed
  socket.join(userId);

  // track online users
  userSocketMap.set(String(userId), socket.id);
  io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));

  try {
    // join all conversation rooms for this user
    const userConversations = await Conversation.find({ participants: userId }).select("_id");
    userConversations.forEach(({ _id }) => socket.join(_id.toString()));

    // -----------------------------------------------------------
    // WebRTC Signaling Events
    // -----------------------------------------------------------

    // 1. Call one-on-one
    socket.on("callUser", ({ userToCall, signalData, from, name, callType }) => {
      try {
        const recipientSocketId = getRecipientSocketId(userToCall);
        if (!recipientSocketId) {
          return socket.emit("callFailed", { reason: "Recipient is not online." });
        }
        io.to(recipientSocketId).emit("incomingCall", {
          signal: signalData,
          from,
          name,
          callType, // pass-through for UI
        });
      } catch (err) {
        console.error("Error in callUser event:", err);
      }
    });

    // 2. Answer a call
    socket.on("answerCall", (data) => {
      try {
        const callerSocketId = getRecipientSocketId(data.to);
        if (!callerSocketId) {
          return console.log("Caller socket not found.");
        }
        io.to(callerSocketId).emit("callAccepted", data.signal);
      } catch (err) {
        console.error("Error in answerCall event:", err);
      }
    });

    // 3. End a call
    socket.on("endCall", ({ to }) => {
      try {
        const recipientSocketId = getRecipientSocketId(to);
        if (!recipientSocketId) return;
        io.to(recipientSocketId).emit("callEnded");
      } catch (err) {
        console.error("Error in endCall event:", err);
      }
    });

    // Optional: join specific conversation room
    socket.on("joinConversationRoom", ({ conversationId }) => {
      if (conversationId) socket.join(String(conversationId));
    });

  } catch (err) {
    console.error("Error joining conversation rooms or setting up socket listeners:", err);
  }

  socket.on("disconnect", () => {
    userSocketMap.delete(String(userId));
    io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));
  });
});

module.exports = { app, server, io, getRecipientSocketId, userSocketMap };
