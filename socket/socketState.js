const userSocketMap = new Map();
const socketToUserId = new Map();

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

module.exports = {
  getRecipientSocketIds,
  getOnlineUserIds,
  setUserSocket,
  removeUserSocket,
};
