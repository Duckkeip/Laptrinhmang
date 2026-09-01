const Room = require('../db/models/Room');
const Message = require('../db/models/Message');
const { HISTORY_LIMIT, DEFAULT_ROOMS } = require('../config/env');

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

module.exports = {
  toClientMessage,
  loadHistory,
  appendHistory,
  ensureDefaultRooms,
  loadRoomNamesFromDB,
  createRoomInDB
};
