const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    room: { type: String, required: true, index: true, trim: true },
    type: { type: String, enum: ['text', 'file'], required: true },
    username: { type: String, required: true, trim: true, maxlength: 30 },

    // type === 'text'
    text: { type: String, maxlength: 2000 },

    // type === 'file'
    url: String,
    name: String,
    size: Number,
    isImage: Boolean,

    time: { type: Number, required: true, index: true }
  },
  { versionKey: false }
);

// Truy van lich su tin nhan theo phong, sap xep theo thoi gian la thao tac chinh
messageSchema.index({ room: 1, time: -1 });

module.exports = mongoose.model('Message', messageSchema);
