let io = null;
let getRecipientSocketIds = null;

function initSocketEmitter({ ioInstance, getSockets }) {
  io = ioInstance;
  getRecipientSocketIds = getSockets;
}

function emitToUser(userId, event, payload) {
  if (!io || !getRecipientSocketIds) return;
  const sockets = getRecipientSocketIds(userId);
  sockets.forEach((sid) => io.to(sid).emit(event, payload));
}

function emitToRoom(roomId, event, payload) {
  if (!io) return;
  io.to(String(roomId)).emit(event, payload);
}

module.exports = {
  initSocketEmitter,
  emitToUser,
  emitToRoom,
};
