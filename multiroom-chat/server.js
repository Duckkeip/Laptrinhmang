require('dotenv').config();

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');

const { connectDB } = require('./db/connection');
const Room = require('./db/Room');
const Message = require('./db/Message');
const DirectMessage = require('./db/DirectMessage');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/multiroom-chat';

// ---------- AI Bot config ----------
// URL cua service inference (xem ai_service/app.py) - noi model da finetune dang chay
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const AI_BOT_NAME = 'AI Bot';
// Nhan biet lenh goi AI: "/ai <cau hoi>" hoac chua "@AI <cau hoi>" o bat ky dau trong tin nhan
function extractAIPrompt(text) {
  const trimmed = text.trim();
  if (trimmed.toLowerCase().startsWith('/ai ')) {
    return trimmed.slice(4).trim();
  }
  const mentionMatch = trimmed.match(/@AI\b[:,]?\s*(.*)/i);
  if (mentionMatch) {
    return (mentionMatch[1] || '').trim() || trimmed.replace(/@AI\b[:,]?/i, '').trim();
  }
  return null;
}

// Goi service inference (model da finetune) va tra ve cau tra loi dang text
async function askAIBot(prompt, room, username) {
  const res = await fetch(`${AI_SERVICE_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, room, username })
  });
  if (!res.ok) throw new Error(`AI service tra ve loi ${res.status}`);
  const data = await res.json();
  return data.reply || 'Xin loi, minh chua nghi ra cau tra loi.';
}
const PUBLIC_DIR = path.join(__dirname, 'public');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./db/User');
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');

const JWT_SECRET = process.env.JWT_SECRET ;
if (!process.env.JWT_SECRET) {
  console.warn('[CANH BAO] Chua dat JWT_SECRET trong .env, dang dung gia tri mac dinh KHONG AN TOAN cho production.');
}

// ---------- App & Server setup ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // 10MB, du phong cho socket payload
});

app.use(express.static(PUBLIC_DIR));
app.use(express.json());
// ---------- HTML Routes ----------
// Route mặc định: Chuyển hướng sang /login
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Route render trang Login
app.get('/login', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

// Route render trang Chat
app.get('/chat', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'chat.html'));
});

// Cho client biet cac gioi han hien hanh (vd dung luong file toi da), tranh
// phai go cung 1 con so o ca server lan client de gay lech nhau ve sau.
app.get('/api/config', (req, res) => {
  res.json({ maxFileSizeMB: MAX_FILE_SIZE_MB });
});
// ---------- File upload (Multer + GridFS) ----------
// Doc file vao bo nho (buffer) truoc, roi ghi thang vao MongoDB qua GridFS,
// khong luu ra o dia server nua.
const MAX_FILE_SIZE_MB = 15;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ALLOWED_FILE_PATTERN = /\.(jpg|jpeg|png|gif|webp|pdf|docx?|xlsx?|pptx?|txt|zip|mp4|mov|webm)$/i;

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_FILE_PATTERN.test(file.originalname)) {
      return cb(new Error('Dinh dang file khong duoc ho tro'));
    }
    cb(null, true);
  }
});

// GridFSBucket duoc khoi tao SAU KHI ket noi MongoDB thanh cong (xem cuoi file,
// cho nam trong ham start()). Bucket "uploads" se tao 2 collection trong Mongo:
// uploads.files (metadata) va uploads.chunks (du lieu nhi phan chia nho).
let gridFSBucket = null;

function getGridFSBucket() {
  if (!gridFSBucket) {
    gridFSBucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  }
  return gridFSBucket;
}

// Xoa 1 file trong GridFS dua vao url dang "/files/<id>" da luu trong tin nhan.
// Dung khi xoa tin nhan loai 'file' de khong de rac trong uploads.files/uploads.chunks.
async function deleteFileFromUrl(url) {
  const match = String(url || '').match(/\/files\/([a-f0-9]{24})$/i);
  if (!match) return;
  try {
    const fileId = new mongoose.Types.ObjectId(match[1]);
    await getGridFSBucket().delete(fileId);
  } catch (err) {
    // File co the da bi xoa truoc do hoac khong ton tai - khong can chan luong xoa tin nhan
    console.warn('Khong xoa duoc file GridFS (co the da khong con ton tai):', err.message);
  }
}

// Xac thuc JWT tu header "Authorization: Bearer <token>"
function verifyAuthHeader(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    return jwt.verify(token, JWT_SECRET); // { id, username, iat, exp }
  } catch (err) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const decoded = verifyAuthHeader(req);
  if (!decoded) return res.status(401).json({ error: 'Chua dang nhap hoac phien da het han' });
  req.user = decoded;
  next();
}

// Middleware upload rieng, bat loi multer (vd vuot gioi han dung luong) va
// tra ve JSON ro rang thay vi de Express hien trang loi HTML mac dinh.
function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `File vượt quá giới hạn cho phép (tối đa ${MAX_FILE_SIZE_MB}MB). Vui lòng chọn file nhỏ hơn.`
        });
      }
      return res.status(400).json({ error: err.message || 'Lỗi khi tải file lên' });
    }
    next();
  });
}

app.post('/upload', requireAuth, handleUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Không có file nào được gửi lên' });

  const bucket = getGridFSBucket();
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(req.file.originalname);

  // Ghi buffer vao GridFS: mo 1 upload stream, ket thuc se co _id cua file
  const uploadStream = bucket.openUploadStream(req.file.originalname, {
    contentType: req.file.mimetype,
    metadata: { uploadedBy: req.user.username }
  });

  uploadStream.end(req.file.buffer);

  uploadStream.on('error', (err) => {
    console.error('Loi khi ghi file vao GridFS:', err);
    res.status(500).json({ error: 'Loi khi luu file' });
  });

  uploadStream.on('finish', () => {
    res.json({
      url: `/files/${uploadStream.id}`, // duong dan de tai/xem lai file
      name: req.file.originalname,
      size: req.file.size,
      isImage
    });
  });
});

// Doc lai file tu GridFS de hien thi/tai xuong (thay the cho express.static
// vao thu muc uploads truoc day)
app.get('/files/:id', async (req, res) => {
  let fileId;
  try {
    fileId = new mongoose.Types.ObjectId(req.params.id);
  } catch (err) {
    return res.status(400).json({ error: 'ID file khong hop le' });
  }

  const bucket = getGridFSBucket();
  const filesCursor = bucket.find({ _id: fileId });
  const fileDoc = await filesCursor.next();

  if (!fileDoc) return res.status(404).json({ error: 'Khong tim thay file' });

  res.set('Content-Type', fileDoc.contentType || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename="${encodeURIComponent(fileDoc.filename)}"`);

  const downloadStream = bucket.openDownloadStream(fileId);
  downloadStream.on('error', () => res.status(404).end());
  downloadStream.pipe(res);
});

// Middleware bat loi tu Multer (vd file qua lon, sai dinh dang)
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

// ----- API 1: Đăng ký -----
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ tên và mật khẩu' });
    }
    if (String(username).trim().length < 3) {
      return res.status(400).json({ error: 'Tên đăng nhập phải có ít nhất 3 ký tự' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Tên người dùng đã tồn tại' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ username, password: hashedPassword });

    const token = jwt.sign({ id: newUser._id, username: newUser.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ ok: true, username: newUser.username, token });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi máy chủ khi đăng ký' });
  }
});

// ----- API 2: Đăng nhập -----
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'Tài khoản hoặc mật khẩu không đúng' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Tài khoản hoặc mật khẩu không đúng' });
    }

    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ ok: true, username: user.username, token });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi máy chủ khi đăng nhập' });
  }
});

// ---------- Persistence layer (MongoDB) ----------
const HISTORY_LIMIT = 200;
const DEFAULT_ROOMS = ['General', 'Random', 'Tech'];

// Doc N tin nhan gan nhat cua 1 phong, tra ve theo thu tu tang dan thoi gian
async function loadHistory(room) {
  const docs = await Message.find({ room })
    .sort({ time: -1 })
    .limit(HISTORY_LIMIT)
    .lean();
  return docs.reverse().map(toClientMessage);
}

async function appendHistory(room, message) {
  const doc = await Message.create({ room, ...message });
  return toClientMessage(doc.toObject ? doc.toObject() : doc);
}

// Chuyen doc Mongo (_id, __v...) thanh object gon nhe gui ve client
function toClientMessage(doc) {
  return {
    id: String(doc._id),
    type: doc.type,
    username: doc.username,
    text: doc.text,
    url: doc.url,
    name: doc.name,
    size: doc.size,
    isImage: doc.isImage,
    time: doc.time
  };
}

async function ensureDefaultRooms() {
  for (const name of DEFAULT_ROOMS) {
    await Room.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true });
  }
}

async function loadRoomNamesFromDB() {
  const docs = await Room.find({}).sort({ createdAt: 1 }).lean();
  return docs.map(d => d.name);
}

async function createRoomInDB(name) {
  try {
    await Room.create({ name });
    return true;
  } catch (err) {
    if (err.code === 11000) return false; // phong da ton tai
    throw err;
  }
}

// ---------- In-memory presence state (khong can luu DB) ----------
// socket.id -> { username, room }
const users = new Map();
// roomName -> Set<socket.id>  (chi de theo doi ai dang online, khong phai nguon su that ve phong)
const rooms = new Map();

function ensureRoomTracked(room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
}

function getRoomList() {
  return Array.from(rooms.keys()).map(name => ({
    name,
    online: rooms.get(name).size
  }));
}

function getOnlineUsers(room) {
  const socketIds = rooms.get(room) || new Set();
  return Array.from(socketIds)
    .map(id => users.get(id)?.username)
    .filter(Boolean);
}

function broadcastRoomList() {
  io.emit('room-list', getRoomList());
}

function broadcastOnlineUsers(room) {
  io.to(room).emit('online-users', getOnlineUsers(room));
}

// ---------- Direct Message (nhan tin rieng 1-1) helpers ----------
// username -> Set<socket.id>  (theo doi TOAN CUC, khong theo phong, de gui DM
// realtime toi dung nguoi nhan du ho dang o phong nao hoac chua vao phong nao)
const onlineByUsername = new Map();

function trackOnline(username, socketId) {
  if (!onlineByUsername.has(username)) onlineByUsername.set(username, new Set());
  onlineByUsername.get(username).add(socketId);
}

function untrackOnline(username, socketId) {
  const set = onlineByUsername.get(username);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) onlineByUsername.delete(username);
}

function isUserOnline(username) {
  return onlineByUsername.has(username);
}

// Dam bao conversationId luon giong nhau du ai nhan tin truoc: sap xep 2 ten
// theo alphabet roi noi lai, vi du "alice::bob"
function getConversationId(userA, userB) {
  return [userA, userB].sort((a, b) => a.localeCompare(b)).join('::');
}

async function loadDMHistory(conversationId, limit = 50) {
  const docs = await DirectMessage.find({ conversationId })
    .sort({ time: -1 })
    .limit(limit)
    .lean();
  return docs.reverse();
}

// ---------- Socket.io ----------
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
  socket.emit('room-list', getRoomList());

  // Theo doi online theo username NGAY TU LUC KET NOI (khong doi den luc join
  // phong) - de nhan tin rieng duoc voi nguoi chua vao phong nao ca.
  trackOnline(socket.user.username, socket.id);

  socket.on('join', async ({ room }, ack) => {
    try {
      // Username khong con lay tu client nua - dung dung username da duoc
      // xac thuc trong JWT de tranh gia mao ten nguoi khac.
      const username = socket.user.username;
      room = String(room || 'General').trim().slice(0, 30) || 'General';

      // Dam bao phong ton tai trong DB (vd nguoi dung go thang ten phong moi)
      await createRoomInDB(room).catch(() => {});
      ensureRoomTracked(room);

      // Neu socket dang o phong khac, roi phong cu truoc
      const prev = users.get(socket.id);
      if (prev && prev.room && prev.room !== room) {
        leaveRoom(socket, prev.room, prev.username);
      }

      socket.join(room);
      rooms.get(room).add(socket.id);
      users.set(socket.id, { username, room });

      const history = await loadHistory(room);

      if (typeof ack === 'function') {
        ack({ ok: true, username, room, history });
      }

      socket.to(room).emit('system-message', {
        type: 'join',
        text: `${username} da tham gia phong`,
        time: Date.now()
      });

      broadcastOnlineUsers(room);
      broadcastRoomList();
    } catch (err) {
      console.error('Loi khi join phong:', err);
      if (typeof ack === 'function') ack({ ok: false, error: 'Loi server, thu lai sau' });
    }
  });

  socket.on('chat-message', async ({ text }) => {
    try {
      const user = users.get(socket.id);
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
      const user = users.get(socket.id);
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
      const user = users.get(socket.id);
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
    const user = users.get(socket.id);
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
      ensureRoomTracked(roomName);
      if (created) broadcastRoomList();

      if (ack) ack({ ok: true });
    } catch (err) {
      console.error('Loi khi tao phong:', err);
      if (ack) ack({ ok: false, error: 'Loi server, thu lai sau' });
    }
  });

  // ---------- Direct Message (nhan tin rieng 1-1) ----------
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
        ack({ ok: true, conversationId, otherUsername, history, online: isUserOnline(otherUsername) });
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
      const recipientSockets = onlineByUsername.get(to);
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

  socket.on('disconnect', () => {
    untrackOnline(socket.user.username, socket.id);
    const user = users.get(socket.id);
    if (!user) return;
    leaveRoom(socket, user.room, user.username);
    users.delete(socket.id);
  });

  function leaveRoom(sock, room, username) {
    sock.leave(room);
    const set = rooms.get(room);
    if (set) {
      set.delete(sock.id);
      sock.to(room).emit('system-message', {
        type: 'leave',
        text: `${username} da roi phong`,
        time: Date.now()
      });
      broadcastOnlineUsers(room);
      broadcastRoomList();
    }
  }
});

// ---------- Khoi dong: ket noi DB truoc, roi moi mo cong lang nghe ----------
async function main() {
  try {
    await connectDB(MONGODB_URI);
    await ensureDefaultRooms();

    const roomNames = await loadRoomNamesFromDB();
    roomNames.forEach(ensureRoomTracked);

    server.listen(PORT, () => {
      console.log(`Multi-room chat server dang chay tai http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Khong the ket noi MongoDB:', err.message);
    console.error(`Kiem tra bien moi truong MONGODB_URI (hien tai: ${MONGODB_URI})`);
    process.exit(1);
  }
}

main();