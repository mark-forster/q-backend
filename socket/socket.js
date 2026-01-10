const { Server } = require("socket.io");
const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");
const { createSystemMessage } = require("../helpers/createSystemMessage");

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

  const finalParticipants = [
    ...new Set([
      ...(call.originalParticipants || []), // ✅ ALWAYS use original list for final event
      ...(call.participants || []),
      ...(call.ringingUsers || []),
    ]),
  ];

  const end = new Date();
  const duration = call.startedAt
    ? Math.round((end - call.startedAt) / 1000)
    : 0;

  await CallLog.findOneAndUpdate(
    { roomID },
    {
      status: reason,
      endedAt: end,
      startedAt: call.startedAt || end,
      durationSeconds: duration,
    }
  );

  if (reason === "completed") {
    if (call.isGroup) {
      await createCallMessage({
        sender: call.caller,
        receiver: null,
        callType: call.callType,
        status: "completed",
        duration,
        io,
        isGroup: true,
        conversationId: call.conversationId,
      });
    } else {
      // 🔥 Single Call Completed Message
      const otherUserId = (call.originalParticipants || []).find(
        (p) => String(p) !== String(call.caller)
      );
      if (otherUserId) {
        await createCallMessage({
          sender: call.caller,
          receiver: otherUserId,
          callType: call.callType,
          status: "completed",
          duration,
          io,
          isGroup: false,
          conversationId: call.conversationId,
        });
      }
    }
  }

  finalParticipants.forEach((uid) => {
    getRecipientSocketIds(uid).forEach((sid) => {
      io.to(sid).emit("callEnded", { roomID });
      io.to(sid).emit("callCanceled", { roomID });
    });
  });

  activeCalls.delete(roomID);

  if (call.isGroup && call.conversationId) {
    io.to(String(call.conversationId)).emit("groupCallEnded", {
      conversationId: call.conversationId,
    });
  }

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
  socket.on("typing", async ({ conversationId }) => {
    if (!conversationId) return;

    io.to(String(conversationId)).emit("typing", {
      conversationId,
      userId: uid,
    });

    const conv = await Conversation.findById(conversationId).select(
      "participants isGroup"
    );
    if (!conv || conv.isGroup) return;

    conv.participants.forEach((pid) => {
      const id = String(pid);
      if (id !== uid) {
        getRecipientSocketIds(id).forEach((sid) =>
          io.to(sid).emit("typing", { conversationId, userId: uid })
        );
      }
    });
  });

  socket.on("stopTyping", async ({ conversationId }) => {
    if (!conversationId) return;

    io.to(String(conversationId)).emit("stopTyping", {
      conversationId,
      userId: uid,
    });
    const conv = await Conversation.findById(conversationId).select(
      "participants isGroup"
    );
    if (!conv || conv.isGroup) return;

    conv.participants.forEach((pid) => {
      const id = String(pid);
      if (id !== uid) {
        getRecipientSocketIds(id).forEach((sid) =>
          io.to(sid).emit("stopTyping", { conversationId, userId: uid })
        );
      }
    });
  });

  // ==============================
  // VOICE RECORDING STATUS
  // ==============================
  socket.on("recording", ({ conversationId }) => {
    if (!conversationId) return;

    io.to(String(conversationId)).emit("recording", {
      conversationId,
      userId: uid,
    });
  });

  socket.on("stopRecording", ({ conversationId }) => {
    if (!conversationId) return;

    io.to(String(conversationId)).emit("stopRecording", {
      conversationId,
      userId: uid,
    });
  });

  /* ---------------------------------------------------
      CALL USER (Group + Single)
  --------------------------------------------------- */
  socket.on(
    "callUser",
    async ({ userToCall, conversationId, roomID, from, name, callType }) => {
      try {
        const caller = String(from);
        let receivers = [];

        // GROUP CALL
        if (conversationId) {
          const conv = await Conversation.findById(conversationId).select(
            "participants isGroup"
          );
          if (!conv) return;

          // If it is NOT a group chat (meaning it's a DM), treat as Single Call
          if (!conv.isGroup) {
            // ... fall through to single call logic ...
            // To reuse single call logic, we can just skip this block or handle it here.
            // Let's redirect to single call logic below by clearing conversationId for this scope
            // OR better: copy-paste single call logic or refactor.
            
            // Refactor:
            receivers = conv.participants
              .map((id) => String(id))
              .filter((id) => id !== caller);

            activeCalls.set(roomID, {
              caller,
              participants: [...new Set([caller, ...receivers])],
              ringingUsers: [caller, ...receivers],
              originalParticipants: [caller, ...receivers],
              callType,
              status: "ringing",
              startedAt: null,
              isGroup: false, // ✅ DM = Single Call
              conversationId,
            });

          } else {
             // REAL GROUP CALL
             receivers = conv.participants
            .map((id) => String(id))
            .filter((id) => id !== caller);

            activeCalls.set(roomID, {
              caller,
              participants: [], 
              ringingUsers: [caller, ...receivers], 
              originalParticipants: [caller, ...receivers],
              callType,
              status: "ringing",
              startedAt: null,
              isGroup: true,
              conversationId,
            });

            io.to(String(conversationId)).emit("groupCallActive", {
              conversationId,
              roomID,
              callType,
            });
          }
        } else {
          // ===== SINGLE CALL =====
          receivers = Array.isArray(userToCall)
            ? userToCall.map(String)
            : [String(userToCall)];

          let conversation = await Conversation.findOne({
            participants: { $all: [caller, ...receivers] },
            isGroup: false,
          });

          if (!conversation) {
            conversation = await Conversation.create({
              participants: [caller, ...receivers],
              isGroup: false,
            });
          }

          activeCalls.set(roomID, {
            caller,
            participants: [...new Set([caller, ...receivers])],
            originalParticipants: [...new Set([caller, ...receivers])], // Added for final message
            callType,
            status: "ringing",
            startedAt: null,
            isGroup: false,
            conversationId: conversation._id,
          });
        }

        // Incoming Call Notification
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

        // TIMEOUT LOGIC
        const t = setTimeout(async () => {
          const call = activeCalls.get(roomID);
          if (!call || call.status !== "ringing") return;

          await finalizeCall(roomID, "timeout");

          const callerId = call.caller;
          const finalUsers = call.originalParticipants || call.participants;

          if (call.isGroup) {
            await createCallMessage({
              sender: callerId,
              receiver: null,
              callType,
              status: "missed",
              duration: 0,
              io,
              isGroup: true,
              conversationId: call.conversationId || null,
            });
          } else {
            for (const rid of finalUsers) {
              if (rid === callerId) continue;
              await createCallMessage({
                sender: callerId,
                receiver: rid,
                callType,
                status: "missed",
                duration: 0,
                io,
                isGroup: false,
                conversationId: call.conversationId || null,
              });
            }
          }
        }, CALL_TIMEOUT_MS);

        callTimeoutMap.set(roomID, t);
      } catch (err) {
        console.error("callUser error:", err.message);
      }
    }
  );

  /* ---------------------------------------------------
      ANSWER CALL
  --------------------------------------------------- */
  socket.on("answerCall", ({ roomID }) => {
    const call = activeCalls.get(roomID);
    if (!call) return;

    const isFirstAccept = call.status === "ringing";
    call.status = "in-call";

    if (!call.participants.includes(uid)) {
      call.participants.push(uid);
    }

    // ringing list မှ ဖယ်
    call.ringingUsers = call.ringingUsers.filter(
      (u) => String(u) !== String(uid)
    );

    if (!call.startedAt) call.startedAt = new Date();

    if (isFirstAccept) {
      const notifyUsers = [
        ...new Set([
          ...call.participants,
          ...call.ringingUsers,
        ]),
      ];
      notifyUsers.forEach((uidInCall) => {
        getRecipientSocketIds(uidInCall).forEach((sid) =>
          io.to(sid).emit("callStarted", {
            roomID,
            startedBy: uid,
          })
        );
      });
    }

    const currentParticipants = call.participants;

    currentParticipants.forEach((uidInCall) => {
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
 socket.on("callRejected", async ({ roomID }) => {
  try {
    const call = activeCalls.get(roomID);
    if (!call) return;

    const rejecterId = uid;
    const callerId = call.caller;

    // remove rejecter
    call.ringingUsers = call.ringingUsers.filter(
      (u) => String(u) !== String(rejecterId)
    );
    call.participants = call.participants.filter(
      (u) => String(u) !== String(rejecterId)
    );

    // 🔥 SINGLE CALL → notify caller directly
    if (!call.isGroup) {
      getRecipientSocketIds(callerId).forEach((sid) =>
        io.to(sid).emit("callRejected", { roomID })
      );
      // Single Call Reject = End Call
      await finalizeCall(roomID, "declined");
    } else {
      // GROUP
      (call.originalParticipants || []).forEach((pid) => {
        getRecipientSocketIds(pid).forEach((sid) =>
          io.to(sid).emit("groupCallParticipantLeft", {
            roomID,
            userId: rejecterId,
          })
        );
      });
    }

    if (call.isGroup && call.participants.length === 0 && call.ringingUsers.length === 0) {
      await finalizeCall(roomID, "declined");
    }

    // save message
    if (!call.isGroup) {
      await createCallMessage({
        sender: callerId,
        receiver: rejecterId,
        callType: call.callType,
        status: "declined",
        duration: 0,
        io,
        isGroup: false,
        conversationId: call.conversationId,
      });
    }
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

      const finalUsers = call.originalParticipants || call.participants;
      const others = finalUsers.filter((u) => u !== callerId);

      await finalizeCall(roomID, "canceled");

      others.forEach((rid) => {
        getRecipientSocketIds(rid).forEach((sid) =>
          io.to(sid).emit("callCanceled", { roomID })
        );
      });

      if (call.isGroup) {
        await createCallMessage({
          sender: callerId,
          receiver: null,
          callType: call.callType,
          status: "canceled",
          duration: 0,
          io,
          isGroup: true,
          conversationId: call.conversationId || null,
        });
      } else {
        for (const rid of others) {
          await createCallMessage({
            sender: callerId,
            receiver: rid,
            callType: call.callType,
            status: "canceled",
            duration: 0,
            io,
            isGroup: false,
            conversationId: call.conversationId || null,
          });
        }
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

      const leaver = uid;

      // 🔥 SINGLE CALL → One leaves = END for everyone
      if (!call.isGroup) {
        await finalizeCall(roomID, "completed");
        return;
      }

      // remove from participants
      call.participants = call.participants.filter(
        (u) => String(u) !== String(leaver)
      );

      // notify remaining IN-CALL users
      call.participants.forEach((pid) => {
        getRecipientSocketIds(pid).forEach((sid) =>
          io.to(sid).emit("groupCallParticipantLeft", {
            roomID,
            userId: leaver,
          })
        );
      });

      // 🔥 no one left in call → END CALL
      if (call.participants.length === 0) {
        // stop ringing for others
        call.ringingUsers.forEach((rid) => {
          getRecipientSocketIds(rid).forEach((sid) =>
            io.to(sid).emit("callCanceled", { roomID })
          );
        });

        await finalizeCall(roomID, "completed");
        return;
      }

      // notify leaver only
      getRecipientSocketIds(leaver).forEach((sid) =>
        io.to(sid).emit("callEnded", { roomID })
      );
    } catch (err) {
      console.error("endCall error:", err.message);
    }
  });


  /* ------------ REJOIN CALL ------------ */
  socket.on("rejoinCall", ({ roomID }) => {
    const call = activeCalls.get(roomID);
    if (!call) return;
    if (call.participants.length === 0) return;

    if (!call.participants.includes(uid)) {
      call.participants.push(uid);
    }

    call.ringingUsers = call.ringingUsers.filter(
      (u) => String(u) !== String(uid)
    );


    const currentParticipants = call.originalParticipants || call.participants;
    currentParticipants.forEach((pid) => {
      getRecipientSocketIds(pid).forEach((sid) =>
        io.to(sid).emit("groupCallParticipantJoined", {
          roomID,
          userId: uid,
          rejoin: true,
        })
      );
    });

    getRecipientSocketIds(uid).forEach((sid) =>
      io.to(sid).emit("callRejoined", {
        roomID,
        callType: call.callType,
      })
    );
  });

  /* ------------ CHECK CALL STATUS (Robustness) ------------ */
  socket.on("checkCallStatus", ({ roomID }, callback) => {
    const call = activeCalls.get(roomID);
    if (!call) {
      callback({ status: "ended" });
    } else {
      callback({
        status: call.status,
        participants: call.participants,
        isGroup: call.isGroup,
      });
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