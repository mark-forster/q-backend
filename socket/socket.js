const { Server } = require("socket.io");
const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");

const app = express();
const server = http.createServer(app);

const { config } = require("../config");
const Conversation = require("../models/conversation.model");
const CallLog = require("../models/callLog.model");

const JWT_SECRET = config.jwt?.secret || process.env.JWT_SECRET;

// userId -> Set<socketId> (multi-device)
const userSocketMap = new Map();
// socketId -> userId
const socketToUserId = new Map();

// userId -> "idle" | "ringing" | "in-call"
const userCallState = new Map();

// roomID -> { caller, receiver, callType, status, startedAt }
const activeCalls = new Map();

// roomID -> timeoutId (call timeout)
const callTimeoutMap = new Map();

// rate limit: userId -> [timestamp,...]
const callRateMap = new Map();

// constants
const CALL_TIMEOUT_MS = 30_000; // 30 sec
const MAX_CALLS_PER_WINDOW = 5;
const RATE_WINDOW_MS = 30_000; // 30 sec

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

const getRecipientSocketId = (recipientId) => {
  const set = userSocketMap.get(String(recipientId));
  if (!set) return null;
  // default – first device only (backward compatible)
  return [...set][0];
};

const getAllRecipientSockets = (recipientId) => {
  const set = userSocketMap.get(String(recipientId));
  return set ? [...set] : [];
};

const setUserSocket = (userId, socketId) => {
  const key = String(userId);
  const existing = userSocketMap.get(key) || new Set();
  existing.add(socketId);
  userSocketMap.set(key, existing);
  socketToUserId.set(socketId, key);
};

const removeUserSocket = (socketId) => {
  const userId = socketToUserId.get(socketId);
  if (!userId) return;
  const set = userSocketMap.get(userId);
  if (set) {
    set.delete(socketId);
    if (set.size === 0) userSocketMap.delete(userId);
  }
  socketToUserId.delete(socketId);
};

// rate-limit helper
const isRateLimited = (userId) => {
  const now = Date.now();
  const key = String(userId);
  const attempts = callRateMap.get(key) || [];

  // remove old attempts
  const fresh = attempts.filter((ts) => now - ts < RATE_WINDOW_MS);
  fresh.push(now);

  callRateMap.set(key, fresh);
  return fresh.length > MAX_CALLS_PER_WINDOW;
};

// helper – end call & save log
const finalizeCall = async (roomID, reason = "completed") => {
  const call = activeCalls.get(roomID);
  if (!call) return;

  const { caller, receiver, startedAt, callType } = call;
  const end = new Date();
  const duration =
    startedAt instanceof Date ? Math.round((end - startedAt) / 1000) : 0;

  let status = reason;
  if (reason === "timeout") status = "missed";

  try {
    // upsert: one callLog per roomID
    const existing = await CallLog.findOne({ roomID }).exec();
    if (!existing) {
      await CallLog.create({
        roomID,
        caller,
        receiver,
        callType: callType || "audio",
        status,
        startedAt: startedAt || end,
        endedAt: end,
        durationSeconds: duration,
      });
    } else {
      existing.status = status;
      existing.endedAt = end;
      if (!existing.startedAt) existing.startedAt = startedAt || end;
      existing.durationSeconds = duration;
      await existing.save();
    }
  } catch (err) {
    console.error("Error saving CallLog:", err.message);
  }

  // clear memory
  activeCalls.delete(roomID);
  const timeoutId = callTimeoutMap.get(roomID);
  if (timeoutId) {
    clearTimeout(timeoutId);
    callTimeoutMap.delete(roomID);
  }

  // reset call states
  if (caller) userCallState.set(String(caller), "idle");
  if (receiver) userCallState.set(String(receiver), "idle");
};

// ===== SOCKET MAIN =====
io.on("connection", async (socket) => {
  // 1) auth: try JWT first, fallback to query.userId (for backward compatibility)
  let userId = null;

  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      (socket.handshake.headers?.authorization || "").replace("Bearer ", "");

    if (token && JWT_SECRET) {
      const decoded = jwt.verify(token, JWT_SECRET);
      userId = decoded?.id || decoded?._id || decoded?.userId || null;
    } else if (socket.handshake.query?.userId) {
      userId = socket.handshake.query.userId; // old style
    }
  } catch (err) {
    console.warn("Socket auth failed:", err.message);
  }

  if (!userId) {
    // no auth -> disconnect
    socket.disconnect(true);
    return;
  }

  setUserSocket(userId, socket.id);
  userCallState.set(String(userId), userCallState.get(String(userId)) || "idle");

  // room for direct messages
  socket.join(String(userId));

  // online users broadcast
  io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));

  try {
    // join conversation rooms (chat)
    const userConversations = await Conversation.find({
      participants: userId,
    }).select("_id");
    userConversations.forEach(({ _id }) => socket.join(_id.toString()));
  } catch (err) {
    console.error("Error joining conversation rooms:", err);
  }

  // =========================
  //      CALL SIGNALLING
  // =========================

  // 1) Caller -> invite receiver
  // payload: { userToCall, roomID, from, name, callType }
  socket.on("callUser", async ({ userToCall, roomID, from, name, callType }) => {
    try {
      const caller = String(from || userId);
      const receiver = String(userToCall);

      // security: caller must be current socket user
      if (caller !== String(userId)) {
        return socket.emit("callFailed", {
          reason: "Unauthorized caller.",
        });
      }

      // rate limit
      if (isRateLimited(caller)) {
        return socket.emit("callRateLimited", {
          reason: "Too many calls in a short time.",
        });
      }

      // busy checks
      const callerState = userCallState.get(caller) || "idle";
      const receiverState = userCallState.get(receiver) || "idle";

      if (callerState !== "idle") {
        return socket.emit("callFailed", { reason: "You are already in a call." });
      }
      if (receiverState !== "idle") {
        return socket.emit("callBusy", { to: receiver });
      }

      const recipientSockets = getAllRecipientSockets(receiver);
      if (!recipientSockets.length) {
        return socket.emit("callFailed", { reason: "User is offline." });
      }

      // update states
      userCallState.set(caller, "ringing");
      userCallState.set(receiver, "ringing");

      // create active call record
      activeCalls.set(roomID, {
        caller,
        receiver,
        callType: callType || "audio",
        status: "ringing",
        startedAt: null,
      });

      // create initial call log (ringing)
      try {
        await CallLog.create({
          roomID,
          caller,
          receiver,
          callType: callType || "audio",
          status: "ringing",
        });
      } catch (e) {
        console.error("CallLog create error:", e.message);
      }

      // emit incomingCall to ALL devices of receiver
      recipientSockets.forEach((sid) => {
        io.to(sid).emit("incomingCall", {
          from: caller,
          name,
          callType,
          roomID,
        });
      });

      // set timeout for missed call
      const timeoutId = setTimeout(async () => {
        const call = activeCalls.get(roomID);
        if (call && call.status === "ringing") {
          // missed call
          await finalizeCall(roomID, "timeout");

          // notify both sides
          const callerSockets = getAllRecipientSockets(caller);
          const receiverSockets = getAllRecipientSockets(receiver);

          callerSockets.forEach((sid) => {
            io.to(sid).emit("callTimeout", { roomID });
          });
          receiverSockets.forEach((sid) => {
            io.to(sid).emit("callTimeout", { roomID });
          });
        }
      }, CALL_TIMEOUT_MS);

      callTimeoutMap.set(roomID, timeoutId);
    } catch (err) {
      console.error("Error in callUser event:", err);
      socket.emit("callFailed", { reason: "Internal error starting call." });
    }
  });

  // 2) Receiver -> accept (answerCall) – payload { to, roomID }
  socket.on("answerCall", async ({ to, roomID }) => {
    try {
      const receiver = String(userId);
      const caller = String(to);

      const call = activeCalls.get(roomID);
      if (!call || call.caller !== caller || call.receiver !== receiver) {
        return socket.emit("callFailed", { reason: "Call not found or expired." });
      }

      // clear timeout
      const timeoutId = callTimeoutMap.get(roomID);
      if (timeoutId) {
        clearTimeout(timeoutId);
        callTimeoutMap.delete(roomID);
      }

      // update states
      userCallState.set(caller, "in-call");
      userCallState.set(receiver, "in-call");
      call.status = "in-call";
      call.startedAt = new Date();
      activeCalls.set(roomID, call);

      // update call log start time
      try {
        await CallLog.findOneAndUpdate(
          { roomID },
          { status: "completed", startedAt: call.startedAt },
          { new: true }
        );
      } catch (e) {
        console.error("CallLog update on accept:", e.message);
      }

      const callerSocketId = getRecipientSocketId(caller);
      if (callerSocketId) {
        io.to(callerSocketId).emit("callAccepted", { roomID });
      }
    } catch (err) {
      console.error("Error in answerCall event:", err);
      socket.emit("callFailed", { reason: "Internal error accepting call." });
    }
  });

  // 3) Either side -> endCall – payload { to, roomID }
  socket.on("endCall", async ({ to, roomID }) => {
    try {
      const ender = String(userId);
      const target = String(to);

      await finalizeCall(roomID, "completed");

      const targetSockets = getAllRecipientSockets(target);
      targetSockets.forEach((sid) => {
        io.to(sid).emit("callEnded", { roomID, by: ender });
      });
    } catch (err) {
      console.error("Error in endCall event:", err);
    }
  });

  // 4) Call Rejected – payload { to, roomID }
  socket.on("callRejected", async ({ to, roomID }) => {
    try {
      const rejector = String(userId);
      const caller = String(to);

      // finalize log as rejected
      await finalizeCall(roomID, "rejected");

      const callerSockets = getAllRecipientSockets(caller);
      callerSockets.forEach((sid) => {
        io.to(sid).emit("callRejected", { roomID, by: rejector });
      });
    } catch (err) {
      console.error("Error in callRejected event:", err);
    }
  });

  // keep your existing joinConversationRoom for chat
  socket.on("joinConversationRoom", ({ conversationId }) => {
    if (conversationId) socket.join(String(conversationId));
  });

  // DISCONNECT – clean call state if in-call
  socket.on("disconnect", async () => {
    const uid = String(userId);
    removeUserSocket(socket.id);

    // online users refresh
    io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));

    // if user in active call, end it and notify peer
    for (const [roomID, call] of activeCalls.entries()) {
      if (String(call.caller) === uid || String(call.receiver) === uid) {
        const other =
          String(call.caller) === uid ? String(call.receiver) : String(call.caller);

        await finalizeCall(roomID, "completed");

        const otherSockets = getAllRecipientSockets(other);
        otherSockets.forEach((sid) => {
          io.to(sid).emit("callEnded", { roomID, by: uid });
        });
      }
    }
  });
});

module.exports = { app, server, io, getRecipientSocketId, userSocketMap };
