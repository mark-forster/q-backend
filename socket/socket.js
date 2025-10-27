const { Server } = require("socket.io");
const http = require("http");
const express = require("express");
const app = express();
const server = http.createServer(app);
const { config } = require("../config");
const Conversation = require("../models/conversation.model");

// userId <-> socketId
const userSocketMap = new Map();
// 🚨 ပြင်ဆင်ချက်: socketId <-> userId (callRejected အတွက်)
const socketToUserId = new Map();

const io = new Server(server, {
  cors: {
    origin: config.cors.prodOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingInterval: 20000,
  pingTimeout: 25000,
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
});

const getRecipientSocketId = (recipientId) => userSocketMap.get(String(recipientId));

io.on("connection", async (socket) => {
  const { userId } = socket.handshake.query || {};
  if (!userId) return;

  socket.join(userId);
  userSocketMap.set(String(userId), socket.id);
  socketToUserId.set(socket.id, String(userId)); // 👈 socketToUserId map ကို အသုံးပြုရန်
  io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));

  try {
    const userConversations = await Conversation.find({ participants: userId }).select("_id");
    userConversations.forEach(({ _id }) => socket.join(_id.toString()));
// ========================= ZEGOCLOUD Call Signaling (Simplified) =========================

    // 1) Caller -> invite receiver
    // payload from client: { userToCall, roomID, from, name, callType }
    socket.on("callUser", ({ userToCall, roomID, from, name, callType }) => {
      try {
        const recipientSocketId = getRecipientSocketId(userToCall);
        if (!recipientSocketId) {
          return; 
        }
        
        // Receiver UI အတွက် incomingCall
        io.to(recipientSocketId).emit("incomingCall", {
          from,
          name,
          callType,
          // Zego အတွက် အရေးကြီးတဲ့ roomID ကို ပို့ပေးပါ
          roomID, 
        });
      } catch (err) {
        console.error("Error in callUser event:", err);
        socket.emit("callFailed", { reason: "Internal error starting call." });
      }
    });

    // 2) Receiver -> accept (No SDP/ICE Signal needed, only confirmation)
    // payload from client: { to }
    socket.on("answerCall", ({ to }) => {
      try {
        const callerSocketId = getRecipientSocketId(to);
        if (!callerSocketId) {
          return;
        }
        // Caller UI အတွက် callAccepted 
        io.to(callerSocketId).emit("callAccepted", {}); 
      } catch (err) {
        console.error("Error in answerCall event:", err);
        socket.emit("callFailed", { reason: "Internal error accepting call." });
      }
    });

    // 3) Either side -> end 
    socket.on("endCall", ({ to }) => {
      try {
        const recipientSocketId = getRecipientSocketId(to);
        if (recipientSocketId) io.to(recipientSocketId).emit("callEnded");
      } catch (err) {
        console.error("Error in endCall event:", err);
      }
    });

    // 🚨 NEW EVENT: Call Rejected logic
    socket.on("callRejected", ({ to }) => {
      try {
        const callerSocketId = getRecipientSocketId(to);
        if (callerSocketId) {
          io.to(callerSocketId).emit("callRejected"); // Caller ဆီသို့ signal ပြန်ပို့ပါ
          console.log(`[Socket] Call rejected by ${socketToUserId.get(socket.id)} to ${to}`);
        }
      } catch (err) {
        console.error("Error in callRejected event:", err);
      }
    });


    socket.on("joinConversationRoom", ({ conversationId }) => {
      if (conversationId) socket.join(String(conversationId));
    });

  } catch (err) {
    console.error("Error setting up socket listeners:", err);
  }

  socket.on("disconnect", () => {
    userSocketMap.delete(String(userId));
    socketToUserId.delete(socket.id);
    io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));
  });
});

module.exports = { app, server, io, getRecipientSocketId, userSocketMap };