const mongoose = require('mongoose');
const Message = require('../db/models/Message');

const presence = require('../services/presence');
const { loadHistory, appendHistory, createRoomInDB } = require('../services/roomRepository');
const { extractAIPrompt, askAIBot } = require('../services/aiBot');
const { deleteFileFromUrl } = require('../services/gridfs');
const { AI_BOT_NAME } = require('../config/env');

function broadcastRoomList(io) {
  io.emit('room-list', presence.getRoomList());
}

function broadcastOnlineUsers(io, room) {
  io.to(room).emit('online-users', presence.getOnlineUsers(room));
}

function leaveRoom(io, sock, room, username) {
  sock.leave(room);
  const set = presence.rooms.get(room);
  if (set) {
    set.delete(sock.id);
    sock.to(room).emit('system-message', {
      type: 'leave',
      text: `${username} da roi phong`,
      time: Date.now()
    });
    broadcastOnlineUsers(io, room);
    broadcastRoomList(io);
  }
}

// Dang ky toan bo su kien socket lien quan toi phong chat cong khai (join,
// gui/xoa tin nhan, upload file, typing, tao phong) cho 1 ket noi socket.
function registerRoomHandlers(io, socket) {
  socket.on('join', async ({ room }, ack) => {
    try {
      // Username khong con lay tu client nua - dung dung username da duoc
      // xac thuc trong JWT de tranh gia mao ten nguoi khac.
      const username = socket.user.username;
      room = String(room || 'General').trim().slice(0, 30) || 'General';

      await createRoomInDB(room).catch(() => {});
      presence.ensureRoomTracked(room);

      const prev = presence.users.get(socket.id);
      if (prev && prev.room && prev.room !== room) {
        leaveRoom(io, socket, prev.room, prev.username);
      }

      socket.join(room);
      presence.rooms.get(room).add(socket.id);
      presence.users.set(socket.id, { username, room });

      const history = await loadHistory(room);

      if (typeof ack === 'function') {
        ack({ ok: true, username, room, history });
      }

      socket.to(room).emit('system-message', {
        type: 'join',
        text: `${username} da tham gia phong`,
        time: Date.now()
      });

      broadcastOnlineUsers(io, room);
      broadcastRoomList(io);
    } catch (err) {
      console.error('Loi khi join phong:', err);
      if (typeof ack === 'function') ack({ ok: false, error: 'Loi server, thu lai sau' });
    }
  });

  socket.on('chat-message', async ({ text }) => {
    try {
      const user = presence.users.get(socket.id);
      if (!user || !text || !text.trim()) return;

      const saved = await appendHistory(user.room, {
        type: 'text',
        username: user.username,
        text: text.trim().slice(0, 2000),
        time: Date.now()
      });

      io.to(user.room).emit('chat-message', saved);

      // Neu tin nhan la lenh goi AI Bot (/ai ... hoac @AI ...), goi model
      // da finetune de sinh cau tra loi, roi phat no nhu 1 tin nhan binh
      // thuong tu user "AI Bot" trong cung phong.
      const aiPrompt = extractAIPrompt(saved.text);
      if (aiPrompt) {
        io.to(user.room).emit('typing', { username: AI_BOT_NAME, isTyping: true });
        try {
          const reply = await askAIBot(aiPrompt, user.room, user.username);
          const aiSaved = await appendHistory(user.room, {
            type: 'text',
            username: AI_BOT_NAME,
            text: reply.slice(0, 2000),
            time: Date.now()
          });
          io.to(user.room).emit('chat-message', aiSaved);
        } catch (err) {
          console.error('Loi khi goi AI service:', err.message);
          io.to(user.room).emit('system-message', {
            type: 'error',
            text: 'AI Bot dang gap su co, thu lai sau.',
            time: Date.now()
          });
        } finally {
          io.to(user.room).emit('typing', { username: AI_BOT_NAME, isTyping: false });
        }
      }
    } catch (err) {
      console.error('Loi khi luu tin nhan:', err);
    }
  });

  socket.on('file-message', async ({ url, name, size, isImage }) => {
    try {
      const user = presence.users.get(socket.id);
      if (!user || !url) return;

      const saved = await appendHistory(user.room, {
        type: 'file',
        username: user.username,
        url,
        name,
        size,
        isImage: !!isImage,
        time: Date.now()
      });

      io.to(user.room).emit('chat-message', saved);
    } catch (err) {
      console.error('Loi khi luu file message:', err);
    }
  });

  // Xoa tin nhan (phong chat) - chi cho phep xoa tin nhan CUA CHINH MINH
  socket.on('delete-message', async (messageId, ack) => {
    try {
      const user = presence.users.get(socket.id);
      if (!user) return;

      let objectId;
      try {
        objectId = new mongoose.Types.ObjectId(messageId);
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: 'ID tin nhan khong hop le' });
        return;
      }

      const msg = await Message.findById(objectId);
      if (!msg) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Tin nhan khong ton tai' });
        return;
      }
      if (msg.username !== user.username) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Ban chi co the xoa tin nhan cua chinh minh' });
        return;
      }

      // Neu la file, xoa luon file that trong GridFS de tranh rac du lieu
      if (msg.type === 'file' && msg.url) {
        await deleteFileFromUrl(msg.url);
      }

      await Message.deleteOne({ _id: objectId });

      io.to(msg.room).emit('message-deleted', { id: String(objectId) });
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      console.error('Loi khi xoa tin nhan:', err);
      if (typeof ack === 'function') ack({ ok: false, error: 'Loi server, thu lai sau' });
    }
  });

  socket.on('typing', isTyping => {
    const user = presence.users.get(socket.id);
    if (!user) return;
    socket.to(user.room).emit('typing', {
      username: user.username,
      isTyping: !!isTyping
    });
  });

  socket.on('create-room', async (roomName, ack) => {
    try {
      roomName = String(roomName || '').trim().slice(0, 30);
      if (!roomName) {
        if (ack) ack({ ok: false, error: 'Ten phong khong hop le' });
        return;
      }

      const created = await createRoomInDB(roomName);
      presence.ensureRoomTracked(roomName);
      if (created) broadcastRoomList(io);

      if (ack) ack({ ok: true });
    } catch (err) {
      console.error('Loi khi tao phong:', err);
      if (ack) ack({ ok: false, error: 'Loi server, thu lai sau' });
    }
  });

  socket.on('disconnect', () => {
    const user = presence.users.get(socket.id);
    if (!user) return;
    leaveRoom(io, socket, user.room, user.username);
    presence.users.delete(socket.id);
  });
}

module.exports = { registerRoomHandlers, broadcastRoomList, broadcastOnlineUsers };
