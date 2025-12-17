// ===============================================
//  socket.js — STABLE VERSION (GROUP + SINGLE CALL FIXED)
// ===============================================
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

/* ---------------------------------------------------
   SOCKET USER MAPS
--------------------------------------------------- */
const userSocketMap = new Map();
const socketToUserId = new Map();

/* ---------------------------------------------------
   ACTIVE CALLS
--------------------------------------------------- */
const activeCalls = new Map();
const callTimeoutMap = new Map();
const CALL_TIMEOUT_MS = 30000;

/* ---------------------------------------------------
   Helpers
--------------------------------------------------- */
function getRecipientSocketIds(userId) {
  const set = userSocketMap.get(String(userId));
  return set ? [...set] : [];
}

function getOnlineUserIds() {
  return [...userSocketMap.keys()];
}

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

/* ---------------------------------------------------
   Finalize Call
--------------------------------------------------- */
async function finalizeCall(roomID, reason) {
  const call = activeCalls.get(roomID);
  if (!call) return;

  const { startedAt, participants } = call;
  const end = new Date();
  const duration = startedAt ? Math.round((end - startedAt) / 1000) : 0;

  await CallLog.findOneAndUpdate(
    { roomID },
    {
      status: reason,
      endedAt: end,
      startedAt: startedAt || end,
      durationSeconds: duration,
    },
    { new: true }
  );

  participants.forEach((uid) => {
    getRecipientSocketIds(uid).forEach((sid) =>
      io.to(sid).emit("callEnded", { roomID })
    );
  });

  activeCalls.delete(roomID);

  const t = callTimeoutMap.get(roomID);
  if (t) clearTimeout(t);
  callTimeoutMap.delete(roomID);
}

/* ---------------------------------------------------
   Init IO
--------------------------------------------------- */
const io = new Server(server, {
  cors: {
    origin: config.cors?.prodOrigins || "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

/* ---------------------------------------------------
   ON SOCKET CONNECT
--------------------------------------------------- */
io.on("connection", async (socket) => {
  let userId = null;

  /* ------------ AUTH ------------ */
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
    return socket.disconnect(true);
  }

  if (!userId) return socket.disconnect(true);

  const uid = String(userId);
  setUserSocket(uid, socket.id);
  socket.join(uid);

  // join user's conversations
  try {
    const convs = await Conversation.find({ participants: uid }).select("_id");
    convs.forEach((c) => socket.join(String(c._id)));
  } catch {}

  io.emit("getOnlineUsers", getOnlineUserIds());

  /* ------------ TYPING ------------ */
  socket.on("typing", ({ conversationId }) => {
    if (conversationId) {
      io.to(String(conversationId)).emit("typing", { conversationId, userId: uid });
    }
  });

  socket.on("stopTyping", ({ conversationId }) => {
    if (conversationId) {
      io.to(String(conversationId)).emit("stopTyping", { conversationId, userId: uid });
    }
  });

  /* ---------------------------------------------------
     CALL USER (Group + Single)
  --------------------------------------------------- */
  socket.on("callUser", async ({ userToCall, conversationId, roomID, from, name, callType }) => {
    try {
      const caller = String(from);
      let receivers = [];

      // GROUP CALL
      if (conversationId) {
        const conv = await Conversation.findById(conversationId).select("participants");
        if (!conv) return;

        receivers = conv.participants
          .map((id) => String(id))
          .filter((id) => id !== caller);

        activeCalls.set(roomID, {
          caller,
          participants: [caller, ...receivers],
          callType,
          status: "ringing",
          startedAt: null,
          isGroup: true,
          conversationId,
        });

      } else {
        // SINGLE CALL
        receivers = Array.isArray(userToCall)
          ? userToCall.map(String)
          : [String(userToCall)];

        activeCalls.set(roomID, {
          caller,
          participants: [...new Set([caller, ...receivers])],
          callType,
          status: "ringing",
          startedAt: null,
          isGroup: false,
        });
      }

      // Incoming Call
      receivers.forEach((rid) => {
        getRecipientSocketIds(rid).forEach((sid) =>
          io.to(sid).emit("incomingCall", {
            from: caller,
            name,
            callType,
            roomID,
            group: receivers.length > 1,
            receivers,
            conversationId: conversationId || null,
          })
        );
      });

      // TIMEOUT
      const t = setTimeout(async () => {
        const call = activeCalls.get(roomID);
        if (!call || call.status !== "ringing") return;

        await finalizeCall(roomID, "timeout");

        const callerId = call.caller;
        for (const rid of call.participants) {
          if (rid === callerId) continue;
          await createCallMessage({
            sender: callerId,
            receiver: call.isGroup ? null : rid,
            callType,
            status: "missed",
            duration: 0,
            io,
            isGroup: call.isGroup,
            conversationId: call.conversationId || null,
          });
        }
      }, CALL_TIMEOUT_MS);

      callTimeoutMap.set(roomID, t);
    } catch (err) {
      console.error("callUser error:", err.message);
    }
  });

  /* ---------------------------------------------------
     ANSWER CALL
  --------------------------------------------------- */
  socket.on("answerCall", ({ roomID }) => {
    const call = activeCalls.get(roomID);
    if (!call) return;

    call.status = "in-call";
    if (!call.startedAt) call.startedAt = new Date();

    call.participants.forEach((uidInCall) => {
      getRecipientSocketIds(uidInCall).forEach((sid) =>
        io.to(sid).emit("callAccepted", { roomID })
      );

      getRecipientSocketIds(uidInCall).forEach((sid) =>
        io.to(sid).emit("groupCallParticipantJoined", {
          roomID,
          userId: uid,
        })
      );
    });
  });

  /* ---------------------------------------------------
     REJECT CALL
  --------------------------------------------------- */
  socket.on("callRejected", async ({ to, roomID }) => {
    try {
      const call = activeCalls.get(roomID);
      if (!call) return;

      const rejecterId = uid;
      const callerId = call.caller;

      // Remove rejecter
      call.participants = call.participants.filter((u) => u !== rejecterId);

      // SINGLE CALL → notify caller
      if (!call.isGroup) {
        getRecipientSocketIds(to).forEach((sid) =>
          io.to(sid).emit("callRejected", { roomID })
        );
      }

      // GROUP CALL → notify participants only
      if (call.isGroup) {
        call.participants.forEach((uidInCall) => {
          getRecipientSocketIds(uidInCall).forEach((sid) =>
            io.to(sid).emit("groupCallParticipantLeft", {
              roomID,
              userId: rejecterId,
            })
          );
        });
      }

      // End call if no one left except caller
      if (call.participants.length <= 1) {
        await finalizeCall(roomID, "declined");
      }

      // Message log
      await createCallMessage({
        sender: callerId,
        receiver: call.isGroup ? null : rejecterId,
        callType: call.callType,
        status: "declined",
        duration: 0,
        io,
        isGroup: call.isGroup,
        conversationId: call.conversationId || null,
      });

    } catch (err) {
      console.error("callRejected:", err.message);
    }
  });

  /* ---------------------------------------------------
     CANCEL CALL BY CALLER
  --------------------------------------------------- */
  socket.on("cancelCall", async ({ roomID }) => {
    try {
      const call = activeCalls.get(roomID);
      if (!call) return;

      const callerId = call.caller;

      const t = callTimeoutMap.get(roomID);
      if (t) clearTimeout(t);
      callTimeoutMap.delete(roomID);

      const others = call.participants.filter((u) => u !== callerId);

      await finalizeCall(roomID, "canceled");

      // Notify receivers
      others.forEach((rid) => {
        getRecipientSocketIds(rid).forEach((sid) =>
          io.to(sid).emit("callCanceled", { roomID })
        );
      });

      // Message log
      for (const rid of others) {
        await createCallMessage({
          sender: callerId,
          receiver: call.isGroup ? null : rid,
          callType: call.callType,
          status: "canceled",
          duration: 0,
          io,
          isGroup: call.isGroup,
          conversationId: call.conversationId || null,
        });
      }

    } catch (err) {
      console.error("cancelCall:", err.message);
    }
  });

  /* ---------------------------------------------------
     END CALL
  --------------------------------------------------- */
  socket.on("endCall", async ({ roomID }) => {
    try {
      const call = activeCalls.get(roomID);
      if (!call) return;

      const ender = uid;
      const callerId = call.caller;
      const before = [...call.participants];

      const end = new Date();
      const duration = call.startedAt
        ? Math.round((end - call.startedAt) / 1000)
        : 0;

      let callEndedNow = false;

      // Caller ended call → force end
      if (ender === callerId) {
        await finalizeCall(roomID, "completed");
        callEndedNow = true;

      } else {
        // Participant left
        call.participants = call.participants.filter((u) => u !== ender);

        // Notify remaining group callers
        call.participants.forEach((uidInCall) => {
          getRecipientSocketIds(uidInCall).forEach((sid) =>
            io.to(sid).emit("groupCallParticipantLeft", {
              roomID,
              userId: ender,
            })
          );
        });

        // If only caller left → end call
        if (call.participants.length <= 1) {
          await finalizeCall(roomID, "completed");
          callEndedNow = true;

        } else {
          // Only remove UI for leaver
          getRecipientSocketIds(ender).forEach((sid) =>
            io.to(sid).emit("callEnded", { roomID })
          );
        }
      }

      // Add call message log
      if (callEndedNow) {
        const others = before.filter((u) => u !== callerId);

        for (const rid of others) {
          await createCallMessage({
            sender: callerId,
            receiver: call.isGroup ? null : rid,
            callType: call.callType,
            status: "completed",
            duration,
            io,
            isGroup: call.isGroup,
            conversationId: call.conversationId || null,
          });
        }
      }

    } catch (err) {
      console.error("endCall:", err.message);
    }
  });

  /* ------------ DISCONNECT ------------ */
  socket.on("disconnect", () => {
    removeUserSocket(socket.id);
    io.emit("getOnlineUsers", getOnlineUserIds());
  });
});

/* ---------------------------------------------------
   EXPORT
--------------------------------------------------- */
module.exports = {
  app,
  server,
  io,
  getRecipientSocketIds,
  getOnlineUserIds,
};
