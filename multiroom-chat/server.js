const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { PORT, MONGODB_URI } = require('./config/env');
const { connectDB } = require('./db/connection');
const { ensureDefaultRooms, loadRoomNamesFromDB } = require('./services/roomRepository');
const presence = require('./services/presence');
const { initSockets } = require('./sockets');

const pagesRoutes = require('./routes/pages.routes');
const configRoutes = require('./routes/config.routes');
const authRoutes = require('./routes/auth.routes');
const uploadRoutes = require('./routes/upload.routes');

const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- App & Server setup ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // 10MB, du phong cho socket payload
});

app.use(express.static(PUBLIC_DIR));
app.use(express.json());

app.use(pagesRoutes);
app.use(configRoutes);
app.use(authRoutes);
app.use(uploadRoutes);

// Middleware bat loi chung (fallback cuoi cung, vd loi khong luong truoc duoc)
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

initSockets(io);

// ---------- Khoi dong: ket noi DB truoc, roi moi mo cong lang nghe ----------
async function main() {
  try {
    await connectDB(MONGODB_URI);
    await ensureDefaultRooms();

    const roomNames = await loadRoomNamesFromDB();
    roomNames.forEach(presence.ensureRoomTracked);

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
