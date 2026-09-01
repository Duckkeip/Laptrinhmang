// Trang thai "ai dang online, o dau" - luu trong bo nho (KHONG ghi DB) vi chi
// can ton tai trong luc server dang chay, mat di khi restart la binh thuong.

// socket.id -> { username, room }
const users = new Map();

// roomName -> Set<socket.id>  (chi de theo doi ai dang online, khong phai nguon su that ve phong)
const rooms = new Map();

// username -> Set<socket.id>  (theo doi TOAN CUC, khong theo phong - dung de
// gui Direct Message realtime toi dung nguoi nhan du ho dang o phong nao)
const onlineByUsername = new Map();

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

module.exports = {
  users,
  rooms,
  onlineByUsername,
  ensureRoomTracked,
  getRoomList,
  getOnlineUsers,
  trackOnline,
  untrackOnline,
  isUserOnline
};
