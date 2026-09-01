const mongoose = require('mongoose');
const DirectMessage = require('../db/models/DirectMessage');

const presence = require('../services/presence');
const { getConversationId, loadDMHistory } = require('../services/dmRepository');
const { deleteFileFromUrl } = require('../services/gridfs');

// Dang ky toan bo su kien socket lien quan toi nhan tin rieng 1-1 cho 1 ket noi socket.
function registerDMHandlers(io, socket) {
  socket.on('join-dm', async (otherUsername, ack) => {
    try {
      otherUsername = String(otherUsername || '').trim().slice(0, 30);
      if (!otherUsername || otherUsername === socket.user.username) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Nguoi dung khong hop le' });
        return;
      }

      const conversationId = getConversationId(socket.user.username, otherUsername);
      socket.join(`dm:${conversationId}`);

      const history = await loadDMHistory(conversationId);

      if (typeof ack === 'function') {
        ack({ ok: true, conversationId, otherUsername, history, online: presence.isUserOnline(otherUsername) });
      }
    } catch (err) {
      console.error('Loi khi mo DM:', err);
      if (typeof ack === 'function') ack({ ok: false, error: 'Loi server, thu lai sau' });
    }
  });

  socket.on('dm-message', async ({ to, text, type, url, name, size, isImage }, ack) => {
    try {
      to = String(to || '').trim().slice(0, 30);
      if (!to || to === socket.user.username) return;

      const conversationId = getConversationId(socket.user.username, to);
      const msgType = type === 'file' ? 'file' : 'text';

      if (msgType === 'text' && (!text || !text.trim())) return;

      const doc = await DirectMessage.create({
        conversationId,
        from: socket.user.username,
        to,
        type: msgType,
        text: msgType === 'text' ? text.trim().slice(0, 2000) : undefined,
        url: msgType === 'file' ? url : undefined,
        name: msgType === 'file' ? name : undefined,
        size: msgType === 'file' ? size : undefined,
        isImage: msgType === 'file' ? !!isImage : undefined,
        time: Date.now()
      });

      // Gui toi TAT CA socket cua ca 2 nguoi dang mo phong DM nay (neu co)
      io.to(`dm:${conversationId}`).emit('dm-message', doc.toObject());

      // Du nguoi nhan CHUA mo phong DM (chi dang online noi khac), van bao
      // cho ho biet co tin nhan moi de UI hien thong bao/dau cham do
      const recipientSockets = presence.onlineByUsername.get(to);
      if (recipientSockets) {
        recipientSockets.forEach(sid => {
          io.to(sid).emit('dm-notify', { from: socket.user.username, text: doc.text || '[file]' });
        });
      }

      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      console.error('Loi khi gui DM:', err);
      if (typeof ack === 'function') ack({ ok: false, error: 'Loi server, thu lai sau' });
    }
  });

  // Xoa tin nhan rieng - chi cho phep xoa tin nhan CUA CHINH MINH
  socket.on('delete-dm-message', async (messageId, ack) => {
    try {
      let objectId;
      try {
        objectId = new mongoose.Types.ObjectId(messageId);
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: 'ID tin nhan khong hop le' });
        return;
      }

      const msg = await DirectMessage.findById(objectId);
      if (!msg) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Tin nhan khong ton tai' });
        return;
      }
      if (msg.from !== socket.user.username) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Ban chi co the xoa tin nhan cua chinh minh' });
        return;
      }

      if (msg.type === 'file' && msg.url) {
        await deleteFileFromUrl(msg.url);
      }

      await DirectMessage.deleteOne({ _id: objectId });

      io.to(`dm:${msg.conversationId}`).emit('dm-message-deleted', { id: String(objectId) });
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      console.error('Loi khi xoa DM:', err);
      if (typeof ack === 'function') ack({ ok: false, error: 'Loi server, thu lai sau' });
    }
  });
}

module.exports = { registerDMHandlers };
