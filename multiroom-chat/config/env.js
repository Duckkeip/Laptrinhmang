require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('[CANH BAO] Chua dat JWT_SECRET trong .env, dang dung gia tri mac dinh KHONG AN TOAN cho production.');
}

module.exports = {
  PORT: process.env.PORT || 3000,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/multiroom-chat',
  JWT_SECRET,

  // AI Bot
  AI_SERVICE_URL: process.env.AI_SERVICE_URL || 'http://localhost:8000',
  AI_BOT_NAME: 'AI Bot',

  // Upload
  MAX_FILE_SIZE_MB: 15,
  MAX_FILE_SIZE_BYTES: 15 * 1024 * 1024,

  // Rooms / history
  HISTORY_LIMIT: 200,
  DEFAULT_ROOMS: ['General', 'Random', 'Tech']
};
