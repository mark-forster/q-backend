// socket/index.js
const { Server } = require("socket.io");
const { config } = require("../config");
const registerSocket = require("./socket");
const { initSocketEmitter } = require("./socketEmitter");
const { getRecipientSocketIds } = require("./socketState");

module.exports = function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: config.cors?.prodOrigins || "*",
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  initSocketEmitter({
    ioInstance: io,
    getSockets: getRecipientSocketIds,
  });

  registerSocket(io);

  return io;
};
