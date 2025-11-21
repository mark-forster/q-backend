// socket.js
const { Server } = require("socket.io");
const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");

const app = express();
const server = http.createServer(app);

const { config } = require("../config");
const Conversation = require("../models/conversation.model");
const CallLog = require("../models/callLog.model");
const { createCallMessage } = require("../helpers/createCallMessage");

const JWT_SECRET = config.jwt?.secret || process.env.JWT_SECRET;

// USER SOCKET STORAGE
// userId -> Set(socketIds)
const userSocketMap = new Map();
// socketId -> userId
const socketToUserId = new Map();

// roomID -> call info
const activeCalls = new Map();
// roomID -> timeoutRef
const callTimeoutMap = new Map();

const CALL_TIMEOUT_MS = 30000;

// Exportable for message.service.js
function getRecipientSocketIds(userId) {
  const set = userSocketMap.get(String(userId));
  return set ? [...set] : [];
}

const io = new Server(server, {
  cors: {
    origin: config.cors?.prodOrigins || "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// -------------------------
// Helpers
// -------------------------
function setUserSocket(userId, socketId) {
  const id = String(userId);
  const set = userSocketMap.get(id) || new Set();
  set.add(socketId);
  userSocketMap.set(id, set);
  socketToUserId.set(socketId, id);
}

function removeUserSocket(socketId) {
  const uid = socketToUserId.get(socketId);
  if (!uid) return;

  const set = userSocketMap.get(uid);
  if (set) {
    set.delete(socketId);
    if (set.size === 0) userSocketMap.delete(uid);
  }
  socketToUserId.delete(socketId);
}

async function finalizeCall(roomID, reason) {
  const call = activeCalls.get(roomID);
  if (!call) return;

  const { startedAt } = call;
  const end = new Date();

  const duration = startedAt
    ? Math.round((end - startedAt.getTime()) / 1000)
    : 0;

  await CallLog.findOneAndUpdate(
    { roomID },
    {
      status: reason === "timeout" ? "missed" : reason,
      endedAt: end,
      startedAt: startedAt || end,
      durationSeconds: duration,
    },
    { new: true }
  );

  activeCalls.delete(roomID);
  const t = callTimeoutMap.get(roomID);
  if (t) clearTimeout(t);
  callTimeoutMap.delete(roomID);
}

// -------------------------
// SOCKET CONNECTION
// -------------------------
io.on("connection", async (socket) => {
  let userId = null;

  // Auth
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      (socket.handshake.headers.authorization || "").replace("Bearer ", "");

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      userId = decoded.id || decoded._id;
    } else {
      userId = socket.handshake.query.userId;
    }
  } catch (err) {
    console.error("Socket auth error:", err?.message);
    return socket.disconnect(true);
  }

  if (!userId) {
    return socket.disconnect(true);
  }

  const uid = String(userId);

  // Register socket
  setUserSocket(uid, socket.id);
  // Join personal room
  socket.join(uid);

  // Join conversation rooms (for messageDeleted, messagesSeen, etc.)
  try {
    const convs = await Conversation.find({ participants: uid }).select("_id");
    convs.forEach((c) => socket.join(String(c._id)));
  } catch (e) {
    console.error("Join conversation rooms error:", e?.message);
  }

  // Send online users
  io.emit("getOnlineUsers", [...userSocketMap.keys()]);

  // -------------------------
  // CALL EVENTS
  // -------------------------

  socket.on("callUser", async ({ userToCall, roomID, from, name, callType }) => {
    try {
      const caller = String(from);
      const receiver = String(userToCall);
      const ridSockets = getRecipientSocketIds(receiver);

      if (!ridSockets.length) {
        return socket.emit("callFailed", { reason: "User offline" });
      }

      activeCalls.set(roomID, {
        caller,
        receiver,
        callType,
        status: "ringing",
        startedAt: null,
      });

      await CallLog.create({
        roomID,
        caller,
        receiver,
        callType,
        status: "ringing",
      });

      // incomingCall → receiver all sockets
      ridSockets.forEach((sid) => {
        io.to(sid).emit("incomingCall", {
          from: caller,
          name,
          callType,
          roomID,
        });
      });

      // timeout
      const t = setTimeout(async () => {
        const data = activeCalls.get(roomID);
        if (!data || data.status !== "ringing") return;

        await finalizeCall(roomID, "timeout");

        await createCallMessage({
          sender: caller,
          receiver,
          callType,
          status: "missed",
          duration: 0,
          io,
        });

        // inform both sides
        const callerSockets = getRecipientSocketIds(caller);
        callerSockets.forEach((sid) =>
          io.to(sid).emit("callTimeout", { roomID })
        );

        const receiverSockets = getRecipientSocketIds(receiver);
        receiverSockets.forEach((sid) =>
          io.to(sid).emit("callTimeout", { roomID })
        );
      }, CALL_TIMEOUT_MS);

      callTimeoutMap.set(roomID, t);
    } catch (err) {
      console.error("callUser error:", err?.message);
    }
  });

  socket.on("answerCall", ({ to, roomID }) => {
    try {
      const call = activeCalls.get(roomID);
      if (!call) return;

      call.status = "in-call";
      call.startedAt = new Date();
      activeCalls.set(roomID, call);

      const targetSockets = getRecipientSocketIds(to);
      targetSockets.forEach((sid) =>
        io.to(sid).emit("callAccepted", { roomID })
      );
    } catch (err) {
      console.error("answerCall error:", err?.message);
    }
  });

  socket.on("callRejected", async ({ to, roomID }) => {
    try {
      const call = activeCalls.get(roomID);
      if (!call) return;

      const { caller, receiver, callType } = call;
      await finalizeCall(roomID, "rejected");

      await createCallMessage({
        sender: caller,
        receiver,
        callType,
        status: "declined",
        duration: 0,
        io,
      });

      const callerSockets = getRecipientSocketIds(caller);
      callerSockets.forEach((sid) =>
        io.to(sid).emit("callRejected", { roomID })
      );

      const receiverSockets = getRecipientSocketIds(receiver);
      receiverSockets.forEach((sid) =>
        io.to(sid).emit("callRejected", { roomID })
      );
    } catch (err) {
      console.error("callRejected error:", err?.message);
    }
  });

  socket.on("endCall", async ({ to, roomID }) => {
    try {
      const call = activeCalls.get(roomID);
      if (!call) return;

      const ender = String(userId);
      const target = String(to);

      const duration = call.startedAt
        ? Math.round((Date.now() - call.startedAt.getTime()) / 1000)
        : 0;

      const finalReason =
        call.status === "ringing" || !call.startedAt
          ? "canceled"
          : "completed";

      await finalizeCall(roomID, finalReason);

      await createCallMessage({
        sender: ender,
        receiver: target,
        callType: call.callType,
        status: finalReason,
        duration,
        io,
      });

      const targetSockets = getRecipientSocketIds(target);
      targetSockets.forEach((sid) =>
        io.to(sid).emit("callEnded", { roomID })
      );
    } catch (err) {
      console.error("endCall error:", err?.message);
    }
  });

  // -------------------------
  // DISCONNECT
  // -------------------------
  socket.on("disconnect", () => {
    removeUserSocket(socket.id);
    io.emit("getOnlineUsers", [...userSocketMap.keys()]);
  });
});

module.exports = {
  app,
  server,
  io,
  getRecipientSocketIds,
};
