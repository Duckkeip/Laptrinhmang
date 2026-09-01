const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const presence = require('../services/presence');
const { registerRoomHandlers } = require('./roomHandlers');
const { registerDMHandlers } = require('./dmHandlers');

// Khoi tao toan bo logic Socket.io: xac thuc JWT truoc khi cho ket noi, roi
// dang ky cac nhom su kien (phong chat cong khai + nhan tin rieng) cho tung
// ket noi moi.
function initSockets(io) {
  // Moi ket noi socket bat buoc phai co JWT hop le (lay tu handshake.auth.token).
  // Neu khong co / het han / sai chu ky -> tu choi ket noi ngay tu dau.
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('AUTH_REQUIRED'));
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = { id: decoded.id, username: decoded.username };
      next();
    } catch (err) {
      next(new Error('AUTH_INVALID'));
    }
  });

  io.on('connection', socket => {
    // Theo doi online theo username NGAY TU LUC KET NOI (khong doi den luc
    // join phong) - de nhan tin rieng duoc voi nguoi chua vao phong nao ca.
    presence.trackOnline(socket.user.username, socket.id);
    socket.emit('room-list', presence.getRoomList());

    registerRoomHandlers(io, socket);
    registerDMHandlers(io, socket);

    socket.on('disconnect', () => {
      presence.untrackOnline(socket.user.username, socket.id);
    });
  });
}

module.exports = { initSockets };
