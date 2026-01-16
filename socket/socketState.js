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
// conversationId => Set(userId)
const conversationReaders = new Map();

function addConversationReader(conversationId, userId) {
  const cid = String(conversationId);
  const uid = String(userId);
  if (!conversationReaders.has(cid)) {
    conversationReaders.set(cid, new Set());
  }
  conversationReaders.get(cid).add(uid);
}

function removeConversationReader(conversationId, userId) {
  const cid = String(conversationId);
  const uid = String(userId);
  conversationReaders.get(cid)?.delete(uid);
}

function isUserReadingConversation(conversationId, userId) {
  return conversationReaders
    .get(String(conversationId))
    ?.has(String(userId));
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
function removeUserFromAllConversationReaders(userId) {
  const uid = String(userId);
  for (const set of conversationReaders.values()) {
    set.delete(uid);
  }
}

module.exports = {
  getRecipientSocketIds,
  getOnlineUserIds,
  setUserSocket,
  removeUserSocket,
  addConversationReader,
  removeConversationReader,
  isUserReadingConversation,
  removeUserFromAllConversationReaders
};
