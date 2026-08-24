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

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/multiroom-chat';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- App & Server setup ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // 10MB, du phong cho socket payload
});

app.use(express.static(PUBLIC_DIR));
app.use(express.json());

// ---------- File upload (Multer) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = `${Date.now()}-${nanoid(8)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|pdf|docx?|xlsx?|pptx?|txt|zip)$/i;
    if (!allowed.test(file.originalname)) {
      return cb(new Error('Dinh dang file khong duoc ho tro'));
    }
    cb(null, true);
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Khong co file' });
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(req.file.originalname);
  res.json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    size: req.file.size,
    isImage
  });
});

// Middleware bat loi tu Multer (vd file qua lon, sai dinh dang)
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
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

// ---------- Socket.io ----------
io.on('connection', socket => {
  socket.emit('room-list', getRoomList());

  socket.on('join', async ({ username, room }, ack) => {
    try {
      username = String(username || '').trim().slice(0, 30) || `Guest${nanoid(4)}`;
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

  socket.on('disconnect', () => {
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
