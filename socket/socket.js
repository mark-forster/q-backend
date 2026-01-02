// ===============================================
//  socket.js 
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

  // 1️⃣ CallLog update
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

  // 2️⃣ ✅ GROUP CALL END MESSAGE (ဒီနေရာမှာပဲ ရေးရမယ်)
  if (call.isGroup && call.conversationId) {
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
  }
participants.forEach((uid) => {
  getRecipientSocketIds(uid).forEach((sid) =>
    io.to(sid).emit("callEnded", { roomID })
  );
});

if (call.isGroup && call.conversationId) {
  io.to(String(call.conversationId)).emit("roomEnded", {
    roomID,
    conversationId: call.conversationId,
  });
}

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
  socket.on("typing", async ({ conversationId }) => {
  if (!conversationId) return;

  io.to(String(conversationId)).emit("typing", {
    conversationId,
    userId: uid,
  });

  const conv = await Conversation.findById(conversationId).select("participants isGroup");
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
  const conv = await Conversation.findById(conversationId).select("participants isGroup");
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
        await createCallMessage({
  sender: from,
  receiver: null,
  callType,
  status: "started",
  duration: 0,
  io,
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

        if (call.isGroup) {
          // GROUP → single message
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
          // SINGLE → participant message
          for (const rid of call.participants) {
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
  });

  /* ---------------------------------------------------
     ANSWER CALL
  --------------------------------------------------- */
socket.on("answerCall", ({ roomID }) => {
  const call = activeCalls.get(roomID);
  if (!call) return;

  // ⭐ ပထမဆုံး accept လား စစ်
  const isFirstAccept = call.status === "ringing";

  call.status = "in-call";
  if (!call.startedAt) call.startedAt = new Date();

  // 🔥 FIRST ACCEPT → CALL STARTED
  if (isFirstAccept) {
    call.participants.forEach((uidInCall) => {
      getRecipientSocketIds(uidInCall).forEach((sid) =>
        io.to(sid).emit("callStarted", {
          roomID,
          startedBy: uid, // who accepted first
        })
      );
    });
  }

  // 🔁 participant joined (UI update only)
  call.participants.forEach((uidInCall) => {
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

      call.participants = call.participants.filter((u) => u !== rejecterId);

      if (!call.isGroup) {
        getRecipientSocketIds(to).forEach((sid) =>
          io.to(sid).emit("callRejected", { roomID })
        );
      } else {
        call.participants.forEach((uidInCall) => {
          getRecipientSocketIds(uidInCall).forEach((sid) =>
            io.to(sid).emit("groupCallParticipantLeft", {
              roomID,
              userId: rejecterId,
            })
          );
        });
      }

      if (call.participants.length <= 1) {
        await finalizeCall(roomID, "declined");
      }

      // MESSAGE LOG → single for group
      if (call.isGroup) {
        await createCallMessage({
          sender: callerId,
          receiver: null,
          callType: call.callType,
          status: "declined",
          duration: 0,
          io,
          isGroup: true,
          conversationId: call.conversationId || null,
        });
      } else {
        await createCallMessage({
          sender: callerId,
          receiver: rejecterId,
          callType: call.callType,
          status: "declined",
          duration: 0,
          io,
          isGroup: false,
          conversationId: call.conversationId || null,
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

      const others = call.participants.filter((u) => u !== callerId);
      await finalizeCall(roomID, "canceled");

      others.forEach((rid) => {
        getRecipientSocketIds(rid).forEach((sid) =>
          io.to(sid).emit("callCanceled", { roomID })
        );
      });

      // MESSAGE LOG
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

    // 1️⃣ leave user ကို participants ထဲက ဖယ်
    call.participants = call.participants.filter(
      (u) => String(u) !== String(leaver)
    );

    // 2️⃣ ကျန်တဲ့သူတွေကို "user left" notify
    call.participants.forEach((pid) => {
      getRecipientSocketIds(pid).forEach((sid) =>
        io.to(sid).emit("groupCallParticipantLeft", {
          roomID,
          userId: leaver,
        })
      );
    }); 

    // 3️⃣ Room ထဲ လူ ၁ ယောက်ပဲကျန်ရင် → call end
    if (call.participants.length <= 1) {
      await finalizeCall(roomID, "completed");
      call.participants.forEach((uidInCall) => {
  getRecipientSocketIds(uidInCall).forEach((sid) =>
    io.to(sid).emit("roomEnded", { roomID })
  );
});
    } else {
      // 4️⃣ leave လုပ်တဲ့ user ကိုပဲ call window ပိတ်
      getRecipientSocketIds(leaver).forEach((sid) =>
        io.to(sid).emit("callEnded", { roomID })
      );
    }
  } catch (err) {
    console.error("endCall:", err.message);
  }
});

// Rejoin Call
socket.on("rejoinCall", ({ roomID }) => {
  const call = activeCalls.get(roomID);
  if (!call) return;

  // call မပြီးသေးရင်ပဲ rejoin ခွင့်ပေး
  if (call.participants.length === 0) return;

  // already joined မဖြစ်အောင်
  if (!call.participants.includes(uid)) {
    call.participants.push(uid);
  }

  // others ကို notify
  call.participants.forEach((pid) => {
    getRecipientSocketIds(pid).forEach((sid) =>
      io.to(sid).emit("groupCallParticipantJoined", {
        roomID,
        userId: uid,
        rejoin: true,
      })
    );
  });

  // rejoiner ကို confirm
  getRecipientSocketIds(uid).forEach((sid) =>
    io.to(sid).emit("callRejoined", {
      roomID,
      callType: call.callType,
    })
  );
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
